'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const ui=import('../vercel-demo/native-training-ui.mjs'),cap=import('../vercel-demo/native-owner-capability.mjs');
function node(tag){return {tag,children:[],handlers:{},value:'',disabled:false,
 append(...xs){this.children.push(...xs);},addEventListener(k,f){this.handlers[k]=f;},setAttribute(k,v){this[k]=v;}};}
const walk=n=>[n,...n.children.flatMap(walk)];
async function fixture(t,{role='manager',view='training_courses',enabled=true,malformed=false,empty=false}={}){
 const doc=global.document,confirm=global.confirm;global.document={createElement:node};global.confirm=()=>true;
 t.after(()=>{global.document=doc;global.confirm=confirm;});
 const pane=node('main'),controller=new AbortController(),calls=[],deferred=[],notices=[],flags=[];
 let alive=true,reads=0,refreshed=0;
 const course={id:randomUUID(),title:'食品衛生',required_score:80},candidate={user_id:randomUUID(),location_id:randomUUID(),staff_name:'員工',location_name:'門市'},
  record={id:randomUUID(),course_title:course.title,required_score:80,staff_name:'員工',location_name:'門市'};
 const api=async(url,opts)=>{if(url==='/api/training/capability'){reads++;return {enabled,courses:[course],candidates:[candidate],pending:empty?[]:[malformed?{...record,required_score:101}:record],truncated:false};}
  calls.push({url,opts});return new Promise((resolve,reject)=>deferred.push({resolve,reject}));};
 await (await ui).renderNativeTrainingActions({pane,api,view,role,signal:controller.signal,live:()=>alive,token:'csrf',
  notice:(message,error)=>notices.push({message,error}),refresh:async()=>{refreshed++;},onAuthExpired:()=>{alive=false;},onCapabilityChange:x=>flags.push(x)});
 const forms=()=>walk(pane).filter(n=>n.tag==='form'),nodes=(f,tag)=>walk(forms()[f]).filter(n=>n.tag===tag);
 const submit=f=>forms()[f].handlers.submit({preventDefault(){}});
 return {pane,course,candidate,record,calls,deferred,notices,flags,controller,forms,nodes,submit,reads:()=>reads,refreshed:()=>refreshed,stale:()=>{alive=false;}};
}
test('role, gate, malformed and empty score state fail closed',async t=>{
 for(const opts of [{role:'staff'},{enabled:false},{malformed:true},{view:'training_records',empty:true}])await t.test(JSON.stringify(opts),async sub=>{
  const f=await fixture(sub,opts);assert.equal(f.forms().length,0);assert.equal(f.flags.at(-1),false);
  if(opts.role==='staff')assert.equal(f.reads(),0);
 });
 const c=(await cap).nativeOwnerCapability;
 for(const view of ['training_courses','training_records']){
  assert.equal(c({view,role:'manager',training:true}).pageWritable,true);
  assert.equal(c({view,role:'staff',training:true}).pageWritable,false);
  assert.equal(c({view,role:'manager',shift:true}).pageWritable,false);
 }
});
test('create max Chinese course, lock assignment during write, exact success receipt',async t=>{
 const f=await fixture(t),[title,required]=f.nodes(0,'input'),[description]=f.nodes(0,'textarea');
 title.value='課'.repeat(150);description.value='說'.repeat(1200);required.value='80';
 const p=f.submit(0);assert.equal(f.calls.length,1);assert.equal(description.value,'');assert.equal(title.value,'');
 const o=f.calls[0].opts;assert.equal(o.headers['X-CSRF-Token'],'csrf');
 assert.equal(JSON.parse(o.body).data.description.length,1200);
 const [course,person]=f.nodes(1,'select');course.value=person.value='0';
 await f.submit(1);assert.equal(f.calls.length,1);
 f.deferred[0].resolve({ok:true,result:{id:o.headers['X-Idempotency-Key']}});await p;
 assert.equal(f.refreshed(),1);assert(f.nodes(1,'button')[0].disabled);
});
test('assignment sends only selected IDs, ambiguous result locks both forms',async t=>{
 const f=await fixture(t),[course,person]=f.nodes(1,'select');course.value=person.value='0';
 const p=f.submit(1);assert.deepEqual(JSON.parse(f.calls[0].opts.body),{action:'training.assign',data:{course_id:f.course.id,user_id:f.candidate.user_id,location_id:f.candidate.location_id}});
 f.deferred[0].reject(Error('private raw'));await p;await f.submit(1);assert.equal(f.calls.length,1);
 assert(f.notices.some(n=>n.message.includes('不要直接重送')));assert(!JSON.stringify(f.notices).includes('private raw'));
});
test('score validates integer/date, shows pass threshold, accepts record receipt not request UUID',async t=>{
 const f=await fixture(t,{view:'training_records'}),[record]=f.nodes(0,'select'),[points,date]=f.nodes(0,'input');
 record.value='0';points.value='79.5';date.value='2026-12-01';await f.submit(0);assert.equal(f.calls.length,0);
 points.value='79';points.handlers.input();assert(walk(f.pane).some(n=>n.textContent?.includes('未及格')));
 points.value='80';points.handlers.input();assert(walk(f.pane).some(n=>n.textContent?.endsWith('，及格')));
 const p=f.submit(0);assert.equal(points.value,'');
 assert.deepEqual(JSON.parse(f.calls[0].opts.body),{action:'training.score',data:{id:f.record.id,score:80,completed_on:'2026-12-01'}});
 f.deferred[0].resolve({ok:true,result:{id:f.record.id}});await p;assert.equal(f.refreshed(),1);
});
test('abort scrubs private fields and ignores stale response',async t=>{
 const f=await fixture(t),[title,required]=f.nodes(0,'input'),[description]=f.nodes(0,'textarea');
 title.value='course';description.value='secret';required.value='80';const p=f.submit(0);
 description.value='detached';f.stale();f.controller.abort();assert.equal(description.value,'');
 f.deferred[0].resolve({ok:true,result:{id:f.calls[0].opts.headers['X-Idempotency-Key']}});await p;assert.equal(f.refreshed(),0);
});
