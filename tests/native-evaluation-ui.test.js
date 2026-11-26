'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const ui=import('../vercel-demo/native-evaluation-ui.mjs'),cap=import('../vercel-demo/native-owner-capability.mjs');
function node(tag){return {tag,children:[],handlers:{},value:'',disabled:false,
 append(...xs){this.children.push(...xs);},addEventListener(k,f){this.handlers[k]=f;}};}
const walk=n=>[n,...n.children.flatMap(walk)];
async function fixture(t,{role='manager',enabled=true,empty=false,malformed=false}={}){
 const doc=global.document,confirm=global.confirm;global.document={createElement:node};global.confirm=()=>true;
 t.after(()=>{global.document=doc;global.confirm=confirm;});
 const pane=node('main'),controller=new AbortController(),calls=[],deferred=[],notices=[],flags=[];
 let alive=true,refreshed=0,reads=0,expired=0;
 const candidate={user_id:randomUUID(),location_id:randomUUID(),staff_name:'員工',location_name:'門市'};
 const api=async(url,opts)=>{
  if(url==='/api/evaluation/capability'){reads++;return {enabled,candidates:empty?[]:[malformed?{...candidate,user_id:'bad'}:candidate],truncated:false};}
  calls.push({url,opts});return new Promise((resolve,reject)=>deferred.push({resolve,reject}));
 };
 await (await ui).renderNativeEvaluationActions({pane,api,role,signal:controller.signal,live:()=>alive,token:'csrf',
  notice:(message,error)=>notices.push({message,error}),refresh:async()=>{refreshed++;},onAuthExpired:()=>{expired++;},onCapabilityChange:x=>flags.push(x)});
 const find=tag=>walk(pane).find(n=>n.tag===tag),input=type=>walk(pane).find(n=>n.tag==='input'&&n.type===type);
 const fill=(points='85')=>{find('select').value='0';input('text').value='期'.repeat(30);input('number').value=points;find('textarea').value='評'.repeat(1000);};
 const submit=()=>find('form').handlers.submit({preventDefault(){}});
 return {pane,candidate,calls,deferred,notices,flags,controller,find,input,fill,submit,stale:()=>{alive=false;},refreshed:()=>refreshed,reads:()=>reads,expired:()=>expired};
}
test('staff, gate off, empty or malformed candidate never has a write form',async t=>{
 for(const opts of [{role:'staff'},{enabled:false},{empty:true},{malformed:true}])await t.test(JSON.stringify(opts),async sub=>{
  const f=await fixture(sub,opts);assert.equal(f.find('form'),undefined);assert.equal(f.flags.at(-1),false);
  if(opts.role==='staff')assert.equal(f.reads(),0);
 });
 const c=(await cap).nativeOwnerCapability;
 for(const role of ['owner','manager'])assert.equal(c({view:'evaluations',role,evaluation:true}).pageWritable,true);
 assert.equal(c({view:'evaluations',role:'staff',evaluation:true}).pageWritable,false);
 assert.equal(c({view:'evaluations',role:'manager',shift:true}).pageWritable,false);
});
test('max Chinese payload, integer validation, shared lock and exact receipt',async t=>{
 const f=await fixture(t);for(const bad of ['','-1','101','80.5','8e1']){f.fill(bad);await f.submit();assert.equal(f.calls.length,0);}
 f.fill();const p=f.submit();assert.equal(f.calls.length,1);assert.equal(f.find('textarea').value,'');assert.equal(f.input('number').value,'');
 const req=f.calls[0].opts,key=req.headers['X-Idempotency-Key'];
 assert.equal(req.headers['X-CSRF-Token'],'csrf');
 assert.deepEqual(JSON.parse(req.body),{action:'evaluation.create',data:{user_id:f.candidate.user_id,location_id:f.candidate.location_id,period:'期'.repeat(30),score:85,feedback:'評'.repeat(1000)}});
 await f.submit();assert.equal(f.calls.length,1);
 f.deferred[0].resolve({ok:true,result:{id:key}});await p;assert.equal(f.refreshed(),1);assert(f.find('button').disabled);
});
test('ambiguous response locks form without exposing raw private errors',async t=>{
 const f=await fixture(t);f.fill();const p=f.submit();f.deferred[0].reject(Error('private raw feedback'));await p;
 assert(f.find('button').disabled);await f.submit();assert.equal(f.calls.length,1);
 assert(f.notices.some(n=>n.message.includes('不要直接重送')));assert(!JSON.stringify(f.notices).includes('private raw feedback'));
});
test('abort scrubs detached fields and stale result cannot refresh another session',async t=>{
 const f=await fixture(t);f.fill();const p=f.submit();f.fill();f.stale();f.controller.abort();
 assert.equal(f.find('textarea').value,'');assert.equal(f.input('text').value,'');assert.equal(f.input('number').value,'');
 f.deferred[0].resolve({ok:true,result:{id:f.calls[0].opts.headers['X-Idempotency-Key']}});await p;assert.equal(f.refreshed(),0);
});
