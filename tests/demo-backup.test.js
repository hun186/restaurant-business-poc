'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'../vercel-demo');
function demo(existing){
 const store=new Map(existing?[['restaurant-public-demo-v1',JSON.stringify(existing)]]:[]);
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const location={href:'https://restaurant-business-poc.vercel.app/',reload:()=>{}};
 const window={fetch:async()=>{throw Error('Unexpected remote request')},confirm:()=>true};
 const context=vm.createContext({window,sessionStorage:storage,location,URL,Response,Date,console});
 for(const script of ['pricing-demo.js','backup-demo.js','order-batch-demo.js','mock.js'])
  vm.runInContext(fs.readFileSync(path.join(dir,script),'utf8'),context,{filename:script});
 const api=async(action,data={})=>{
  const response=await window.fetch('/api/demo-backups',{method:'POST',body:JSON.stringify({action,...data})});
  return {status:response.status,body:await response.json()};
 };
 const state=()=>JSON.parse(storage.getItem('restaurant-public-demo-v1')||'null');
 const status=async()=>await (await window.fetch('/api/demo-backups')).json();
 const change=async title=>{
  const response=await window.fetch('/api/command',{method:'POST',body:JSON.stringify({action:'task.create',data:{title,location_id:'l1'}})});
  return {status:response.status,body:await response.json()};
 };
 return {window,storage,api,status,state,change};
}
test('first simulated due check skips unchanged and advances next due without creating a file',async()=>{
 const d=demo(),before=await d.status();
 assert.equal(before.mode,'SIMULATION_ONLY');
 assert.equal(before.intervalDays,1);
 assert.equal(before.retentionCount,50);
 assert.equal(before.autoCount,1);
 assert.equal(before.manualCount,1);
 const r=await d.api('auto');
 assert.equal(r.status,200);
 assert.equal(r.body.result,'skipped');
 const after=await d.status();
 assert.equal(after.autoCount,1);
 assert.equal(after.history.length,before.history.length);
 assert.ok(Date.parse(after.nextDueAt)>Date.parse(after.lastAutoAt));
 assert.equal(after.lastResult,'skipped');
 assert.ok(!('file' in after.history[0]));
});
test('business change adds new automatic sample; second unchanged check is skipped',async()=>{
 const d=demo();
 assert.equal((await d.api('auto')).body.result,'skipped');
 assert.equal((await d.change('虛構工作：請準備開店')).status,200);
 assert.equal((await d.api('auto')).body.result,'created');
 assert.equal((await d.status()).autoCount,2);
 assert.equal((await d.api('auto')).body.result,'skipped');
 assert.equal((await d.status()).autoCount,2);
});
test('simulated backup history excludes backup settings and manual versions from data change triggers',async()=>{
 const d=demo();
 assert.equal((await d.api('save',{intervalDays:7,retentionCount:2})).status,200);
 assert.equal((await d.api('manual')).body.result,'created_manual');
 assert.equal((await d.api('manual')).body.result,'created_manual');
 assert.equal((await d.status()).manualCount,3);
 assert.equal((await d.api('auto')).body.result,'skipped');
 assert.equal((await d.status()).autoCount,1);
});
test('retention prunes only automatic examples; delete latest auto forces fresh simulated snapshot',async()=>{
 const d=demo();
 assert.equal((await d.api('save',{intervalDays:1,retentionCount:1})).status,200);
 await d.change('第一筆虛構營運變化');
 assert.equal((await d.api('auto')).body.result,'created');
 let s=await d.status();
 assert.equal(s.autoCount,1);
 assert.equal(s.manualCount,1);
 await d.api('manual');
 await d.change('第二筆虛構營運變化');
 assert.equal((await d.api('auto')).body.result,'created');
 s=await d.status();
 assert.equal(s.autoCount,1);
 assert.equal(s.manualCount,2);
 const newest=s.history.find(x=>x.type==='auto');
 assert.equal((await d.api('delete',{id:newest.id})).status,200);
 assert.equal((await d.status()).autoCount,0);
 assert.equal((await d.api('auto')).body.result,'created');
 assert.equal((await d.status()).autoCount,1);
});
test('invalid demo settings and nonexistent deletes are rejected without changing state',async()=>{
 const d=demo();
 await d.api('manual');
 const before=d.state();
 for(const payload of [{intervalDays:0,retentionCount:50},{intervalDays:1.4,retentionCount:50},{intervalDays:1,retentionCount:501},{intervalDays:'abc',retentionCount:10}]){
  assert.equal((await d.api('save',payload)).status,400);
  assert.deepEqual(d.state(),before);
 }
 assert.equal((await d.api('delete',{id:'fake-snapshot'})).status,400);
 assert.deepEqual(d.state(),before);
});
test('sessionStorage old demo data are extended without erasing tasks; reset erases all simulated history',async()=>{
 const d=demo();
 assert.equal((await d.change('之前保存的虛構工作')).status,200);
 const previous=d.state();
 delete previous.demoBackup;
 const migrated=demo(previous);
 assert.equal((await migrated.status()).autoCount,1);
 assert.equal(migrated.state().demoBackup,undefined); // seed alone does not rewrite previous sessionStorage
 assert.equal((await migrated.api('manual')).status,200);
 assert.ok(migrated.state().tasks.some(x=>x.title==='之前保存的虛構工作'));
 assert.equal((await migrated.status()).manualCount,2);
 migrated.window.restaurantDemoReset();
 assert.equal(migrated.storage.getItem('restaurant-public-demo-v1'),null);
});
test('public demo exposes explicit simulation-only navigation and cannot download real backups',()=>{
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
 const app=fs.readFileSync(path.join(dir,'app.js'),'utf8');
 const mock=fs.readFileSync(path.join(dir,'mock.js'),'utf8');
 const ui=fs.readFileSync(path.join(dir,'backup-demo-ui.js'),'utf8');
 assert.ok(html.includes('data-page="backup_demo" data-owner'));
 assert.ok(html.indexOf('backup-demo.js')<html.indexOf('mock.js'));
 assert.ok(html.indexOf('app.js')<html.indexOf('backup-demo-ui.js'));
 assert.ok(app.includes('demoBackupPage()'));
 assert.ok(mock.includes('/api/demo-backups'));
 assert.ok(!mock.includes("url.pathname==='/api/backups'"));
 assert.ok(!ui.includes('data-backup-download'));
 assert.ok(!ui.includes('VACUUM INTO'));
 assert.ok(ui.includes('不能真正下載或還原'));
});
