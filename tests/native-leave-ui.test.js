'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const modulePromise=import('../vercel-demo/native-leave-ui.mjs');
const cap=import('../vercel-demo/native-owner-capability.mjs');
function node(tag){return {tag,children:[],handlers:{},value:'',disabled:false,
 append(...xs){this.children.push(...xs);},addEventListener(k,f){this.handlers[k]=f;}};}
const walk=n=>[n,...n.children.flatMap(walk)];
async function fixture(t,{role='manager',enabled=true,malformed=false}={}){
 const oldDoc=global.document,oldConfirm=global.confirm;
 global.document={createElement:node};global.confirm=()=>true;
 t.after(()=>{global.document=oldDoc;global.confirm=oldConfirm;});
 const pane=node('main'),controller=new AbortController(),calls=[],deferred=[],notices=[],flags=[];
 let alive=true,refreshed=0,expired=0;
 const row={id:randomUUID(),start_date:'2026-12-01',end_date:'2026-12-02',reason:'private reason',staff_name:'employee',location_name:'store'};
 const candidate={user_id:randomUUID(),location_id:randomUUID(),staff_name:'employee',location_name:'store'};
 const api=async(url,opts)=>{
  if(url==='/api/leave/capability')return {enabled,candidates:[candidate],pending:role==='staff'&&!malformed?[]:[row],truncated:false};
  calls.push({url,opts});return new Promise((resolve,reject)=>deferred.push({resolve,reject}));
 };
 await (await modulePromise).renderNativeLeaveActions({pane,api,role,signal:controller.signal,
  live:()=>alive,token:'csrf',notice:(message,error)=>notices.push({message,error}),
  refresh:async()=>{refreshed++;},onAuthExpired:()=>{expired++;},onCapabilityChange:x=>flags.push(x)});
 const find=(tag,text)=>walk(pane).find(n=>n.tag===tag&&(text===undefined||n.textContent===text));
 const submit=()=>{
  const form=find('form');find('select').value='0';const inputs=walk(form).filter(n=>n.tag==='input');
  inputs[0].value='2026-12-01';inputs[1].value='2026-12-02';find('textarea').value='private application';
  return form.handlers.submit({preventDefault(){}});
 };
 return {pane,row,candidate,calls,deferred,flags,notices,controller,find,submit,stale:()=>{alive=false;},refreshed:()=>refreshed,expired:()=>expired};
}
test('staff only sees application; gate off and malformed staff review fail closed',async t=>{
 for(const opts of [{role:'staff'},{enabled:false},{role:'staff',malformed:true}])await t.test(JSON.stringify(opts),async sub=>{
  const f=await fixture(sub,opts);
  assert.equal(Boolean(f.find('form')),opts.enabled!==false&&!opts.malformed);
  assert.equal(f.find('button','核准'),undefined);
  assert.equal(f.flags.at(-1),opts.enabled!==false&&!opts.malformed);
  if(opts.enabled===false)assert(f.notices.some(n=>n.message.includes('目前僅供檢視')));
 });
 const c=(await cap).nativeOwnerCapability;
 assert.equal(c({view:'leave_requests',role:'staff',leave:true}).pageWritable,true);
 assert.equal(c({view:'leave_requests',role:'staff',task:true}).pageWritable,false);
 assert.equal(c({view:'leave_requests',role:null,leave:true}).pageWritable,false);
});
test('create sends one request with fixed selected IDs, clears private reason, validates receipt',async t=>{
 const f=await fixture(t),p=f.submit();
 assert.equal(f.find('textarea').value,'');assert.equal(f.calls.length,1);
 const req=f.calls[0].opts,key=req.headers['X-Idempotency-Key'];
 assert.equal(req.headers['X-CSRF-Token'],'csrf');
 assert.deepEqual(JSON.parse(req.body),{action:'leave.create',data:{user_id:f.candidate.user_id,
  location_id:f.candidate.location_id,start_date:'2026-12-01',end_date:'2026-12-02',reason:'private application'}});
 await f.find('button','核准').handlers.click();assert.equal(f.calls.length,1);
 f.deferred[0].resolve({ok:true,result:{id:key,status:'pending'}});await p;assert.equal(f.refreshed(),1);
 assert(f.find('button','核准').disabled);await f.find('button','核准').handlers.click();assert.equal(f.calls.length,1);
});
test('review unknown outcome locks all controls and never exposes raw exception',async t=>{
 const f=await fixture(t),p=f.find('button','駁回').handlers.click();
 assert.deepEqual(JSON.parse(f.calls[0].opts.body),{action:'leave.review',data:{id:f.row.id,status:'rejected'}});
 f.deferred[0].reject(Error('secret raw response'));await p;
 assert(f.find('button','核准').disabled);await f.find('button','核准').handlers.click();
 assert.equal(f.calls.length,1);assert.equal(f.refreshed(),0);
 assert(f.notices.some(n=>n.message.includes('不要直接重送')));
 assert(!JSON.stringify(f.notices).includes('secret raw response'));
});
test('abort clears reason and stale result cannot refresh another page',async t=>{
 const f=await fixture(t);f.find('textarea').value='unsent private reason';f.controller.abort();
 assert.equal(f.find('textarea').value,'');await f.find('button','核准').handlers.click();assert.equal(f.calls.length,0);
});
