'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ID='11111111-2222-4333-8444-555555555555';
const base={status:'staging_access_readonly',production_ready:false,
 session_created:false,mutations_enabled:false};
const json=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8'}
});
class FakeNode{
 constructor(tagName){
  this.tagName=tagName;this.children=[];this.listeners={};this.hidden=false;
  this.dataset={};this.disabled=false;this.value='';this.textContent='';
  this.classList={add(){},remove(){},toggle(){}};
 }
 replaceChildren(...xs){this.children=xs;}
 append(...xs){this.children.push(...xs);}
 addEventListener(event,callback){this.listeners[event]=callback;}
 setAttribute(){}
}
function fakeDocument(){
 const byId=new Map(),created=[];
 const ids=['preview-user','preview-content','preview-status','preview-title',
  'preview-heading','preview-reload'];
 for(const id of ids)byId.set(id,new FakeNode('div'));
 const nav=[new FakeNode('button'),new FakeNode('button')];
 nav[0].dataset.view='overview';nav[1].dataset.view='tasks';
 return {created,nav,byId,
  document:{
   createElement(tag){const n=new FakeNode(tag);created.push(n);return n;},
   getElementById(id){return byId.get(id);},
   querySelectorAll(query){
    if(query==='#preview-nav button[data-view]')return nav;
    if(query==='.preview-task-action button')
     return created.filter(n=>n.tagName==='button'&&n.textContent==='確認更新（Staging）');
    return [];
   }
  }};
}
async function flush(){await new Promise(resolve=>setImmediate(resolve));}
test('reload and navigate during pending task POST cannot display stale GET; settle re-reads latest D1',async()=>{
 const originals={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
 const fake=fakeDocument();let dbStatus='todo',completePost=null;
 const calls=[];
 globalThis.document=fake.document;
 globalThis.window={confirm:()=>true};
 globalThis.fetch=async(url,options)=>{
  calls.push({url,method:options.method});
  if(url==='/api/access/me')return json({...base,user:{id:'staff',username:'staff',
   display_name:'Synthetic Staff',role:'staff',locations:['store-a']}});
  if(url==='/api/access/overview')return json({...base,metrics:{
   open_tasks:1,pending_orders:0,open_repairs:0,low_stock:0}});
  if(url==='/api/access/data?entity=tasks')return json({...base,entity:'tasks',
   rows:[{id:ID,title:'Synthetic',status:dbStatus,location_id:'store-a'}]});
  if(url==='/api/access/task-status'&&options.method==='POST'){
   return new Promise(resolve=>{
    completePost=()=>{dbStatus='done';resolve(json({
     ok:true,environment:'staging_access',production_ready:false,
     result:{id:ID,status:'done'}
    }));};
   });
  }
  throw Error('Unexpected network call: '+url);
 };
 try{
  await import('../vercel-demo/staging-access-preview.js?staging-task-race-test');
  await flush();
  await fake.nav[1].listeners.click();
  await flush();
  const select=fake.created.find(n=>n.tagName==='select');
  const button=fake.created.find(n=>n.tagName==='button'&&n.textContent==='確認更新（Staging）');
  assert.ok(select&&button);
  select.value='done';select.listeners.change();
  assert.equal(button.disabled,false);
  button.listeners.click();
  await flush();
  assert.equal(typeof completePost,'function');
  const initialTaskGets=calls.filter(c=>c.url==='/api/access/data?entity=tasks').length;
  fake.byId.get('preview-reload').listeners.click();
  fake.nav[0].listeners.click();fake.nav[1].listeners.click();
  await flush();
  assert.equal(calls.filter(c=>c.url==='/api/access/data?entity=tasks').length,
   initialTaskGets,'no stale GET while transaction pending');
  completePost();await flush();await flush();
  assert.equal(dbStatus,'done');
  assert.equal(calls.filter(c=>c.url==='/api/access/data?entity=tasks').length,
   initialTaskGets+1,'successful task POST forces a fresh GET despite navigation');
  assert.match(fake.byId.get('preview-status').textContent,/讀取完成/);
  assert.equal(fake.byId.get('preview-content').hidden,false);
 }finally{
  globalThis.document=originals.document;
  globalThis.window=originals.window;
  globalThis.fetch=originals.fetch;
 }
});
