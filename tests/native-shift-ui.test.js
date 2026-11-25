'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const ui=import('../vercel-demo/native-shift-ui.mjs'),cap=import('../vercel-demo/native-owner-capability.mjs');
function node(tag){return {tag,children:[],handlers:{},value:'',disabled:false,
 append(...xs){this.children.push(...xs);},addEventListener(k,f){this.handlers[k]=f;},setAttribute(k,v){this[k]=v;}};}
const walk=n=>[n,...n.children.flatMap(walk)];
async function fixture(t,{role='manager',enabled=true,malformed=false,empty=false}={}){
 const oldDoc=global.document,oldConfirm=global.confirm;
 const confirmations=[];global.document={createElement:node};global.confirm=x=>{confirmations.push(x);return true;};
 t.after(()=>{global.document=oldDoc;global.confirm=oldConfirm;});
 const pane=node('main'),controller=new AbortController(),calls=[],deferred=[],notices=[],flags=[];
 let alive=true,refreshed=0,expired=0,reads=0;
 const candidate={user_id:randomUUID(),location_id:randomUUID(),staff_name:'employee',location_name:'store'};
 const api=async(url,opts)=>{
  if(url==='/api/shift/capability'){reads++;return {enabled,candidates:empty?[]:[malformed?{...candidate,user_id:'bad'}:candidate],truncated:false};}
  calls.push({url,opts});return new Promise((resolve,reject)=>deferred.push({resolve,reject}));
 };
 await (await ui).renderNativeShiftActions({pane,api,role,signal:controller.signal,live:()=>alive,token:'csrf',
  notice:(message,error)=>notices.push({message,error}),refresh:async()=>{refreshed++;},
  onAuthExpired:()=>{expired++;},onCapabilityChange:x=>flags.push(x)});
 const find=tag=>walk(pane).find(n=>n.tag===tag);
 const input=type=>walk(pane).find(n=>n.tag==='input'&&n.type===type);
 const fill=(start='22:00',end='06:00')=>{
  find('select').value='0';input('date').value='2026-12-31';
  const times=walk(pane).filter(n=>n.type==='time');times[0].value=start;times[1].value=end;
  input('text').value='private note';times[1].handlers.input();
 };
 const submit=()=>find('form').handlers.submit({preventDefault(){}});
 return {pane,candidate,calls,deferred,notices,flags,controller,confirmations,find,input,fill,submit,
  stale:()=>{alive=false;},reads:()=>reads,refreshed:()=>refreshed,expired:()=>expired};
}
test('role, gate, malformed and empty candidates never expose a write form',async t=>{
 for(const opts of [{role:'staff'},{enabled:false},{malformed:true},{empty:true}])await t.test(JSON.stringify(opts),async sub=>{
  const f=await fixture(sub,opts);assert.equal(f.find('form'),undefined);assert.equal(f.flags.at(-1),false);
  if(opts.role==='staff')assert.equal(f.reads(),0);
 });
 const c=(await cap).nativeOwnerCapability;
 for(const role of ['owner','manager'])assert.equal(c({view:'shifts',role,shift:true}).pageWritable,true);
 assert.equal(c({view:'shifts',role:'staff',shift:true}).pageWritable,false);
 assert.equal(c({view:'shifts',role:'manager',leave:true}).pageWritable,false);
});
test('overnight preview, exact request, private note scrub, double-click lock and matching receipt',async t=>{
 const f=await fixture(t);f.fill();
 assert(walk(f.pane).some(n=>n.textContent?.includes('次日 06:00（共 8 小時 0 分鐘）')));
 const p=f.submit();assert.equal(f.input('text').value,'');assert.equal(f.calls.length,1);
 const req=f.calls[0].opts,key=req.headers['X-Idempotency-Key'];
 assert.equal(req.headers['X-CSRF-Token'],'csrf');assert.equal(f.calls[0].url,'/api/shift');
 assert.deepEqual(JSON.parse(req.body),{action:'shift.create',data:{user_id:f.candidate.user_id,
  location_id:f.candidate.location_id,shift_date:'2026-12-31',start_time:'22:00',end_time:'06:00',note:'private note'}});
 await f.submit();assert.equal(f.calls.length,1);
 f.deferred[0].resolve({ok:true,result:{id:key}});await p;
 assert.equal(f.refreshed(),1);assert(f.find('button').disabled);
 await f.submit();assert.equal(f.calls.length,1);
});
test('invalid same times do not submit; only explicit overlap denial permits new adjusted request',async t=>{
 const f=await fixture(t);f.fill('09:00','09:00');await f.submit();assert.equal(f.calls.length,0);
 f.fill();const p=f.submit();f.deferred[0].reject(Object.assign(Error('private conflict'),{status:409,code:'E_SHIFT_OVERLAP'}));await p;
 assert(!f.find('button').disabled);assert(f.notices.some(n=>n.message.includes('班次時間重疊')));
 f.fill('06:00','09:00');const p2=f.submit();assert.equal(f.calls.length,2);
 assert.notEqual(f.calls[0].opts.headers['X-Idempotency-Key'],f.calls[1].opts.headers['X-Idempotency-Key']);
 f.deferred[1].resolve({ok:true,result:{id:'wrong'}});await p2;assert(f.find('button').disabled);
 assert.equal(f.refreshed(),0);assert(!JSON.stringify(f.notices).includes('private conflict'));
});
test('unknown errors lock form and stale responses never refresh another session',async t=>{
 const f=await fixture(t);f.fill();const p=f.submit();f.deferred[0].reject(Error('private raw'));
 await p;assert(f.find('button').disabled);await f.submit();assert.equal(f.calls.length,1);
 assert(f.notices.some(n=>n.message.includes('不要直接重送')));
 assert(!JSON.stringify(f.notices).includes('private raw'));
});
test('abort clears detached note and stale success is ignored',async t=>{
 const f=await fixture(t);f.fill();const p=f.submit();f.input('text').value='detached note';
 f.stale();f.controller.abort();assert.equal(f.input('text').value,'');
 f.deferred[0].resolve({ok:true,result:{id:f.calls[0].opts.headers['X-Idempotency-Key']}});await p;
 assert.equal(f.refreshed(),0);
});
