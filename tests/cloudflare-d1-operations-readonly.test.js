'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const authPromise=import('../cloudflare/auth-core.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const root=path.join(__dirname,'..');
function d1(db){
 return {prepare(sql){
   const bound=(args=[])=>({
     first:async()=>db.prepare(sql).get(...args),
     all:async()=>({results:db.prepare(sql).all(...args)})
   });
   return {first:bound().first,all:bound().all,bind:(...args)=>bound(args)};
 }};
}
async function fixture(t){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-a','虛構A');
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-b','虛構B');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)').run('ing-1','I001','測試食材','kg');
 const auth=await authPromise, cookies={};
 for(const [id,role,locations] of [
   ['owner','owner',['store-a']],
   ['manager','manager',['store-a']],
   ['staff','staff',['store-a']]
 ]){
   db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)').run(id,id,'虛構'+id,role,'salt','hash');
   for(const l of locations)db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,l);
   const token=auth.freshSessionToken(),csrf=auth.freshSessionToken();
   db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run(await auth.tokenSha256(token),csrf,id,new Date(Date.now()+3600000).toISOString());
   cookies[id]=auth.SESSION_COOKIE+'='+token;
 }
 for(const [id,store,assigned] of [['ta','store-a','staff'],['tb','store-b','staff'],['tm','store-a','manager']])
   db.prepare('INSERT INTO tasks(id,location_id,title,assigned_to) VALUES(?,?,?,?)').run(id,store,id,assigned);
 for(const [id,store] of [['ma','store-a'],['mb','store-b']])
   db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,'ing-1',?,5,'purchase')").run(id,store);
 return {db,cookies,auth};
}
async function get(f,role,entity,phase='preview-readonly',method='GET'){
 const worker=(await workerPromise).default;
 const request=new Request('https://private-preview.workers.dev/api/data?entity='+encodeURIComponent(entity),{method,headers:{cookie:f.cookies[role]||''}});
 return worker.fetch(request,{DB:d1(f.db),CLOUD_AUTH_PHASE:phase,ASSETS:{fetch:async()=>new Response('demo')}});
}
test('owner preview reads both stores while manager/staff are scoped in SQL before LIMIT',async t=>{
 const f=await fixture(t);
 assert.deepEqual((await (await get(f,'owner','tasks')).json()).rows.map(x=>x.id).sort(),['ta','tb','tm']);
 assert.deepEqual((await (await get(f,'manager','tasks')).json()).rows.map(x=>x.id).sort(),['ta','tm']);
 assert.deepEqual((await (await get(f,'staff','tasks')).json()).rows.map(x=>x.id),['ta']);
 assert.deepEqual((await (await get(f,'manager','locations')).json()).rows.map(x=>x.id),['store-a']);
 assert.deepEqual((await (await get(f,'owner','locations')).json()).rows.map(x=>x.id).sort(),['store-a','store-b']);
 assert.deepEqual((await (await get(f,'staff','stock')).json()).rows.map(x=>x.location_id),['store-a']);
 assert.deepEqual((await (await get(f,'owner','stock')).json()).rows.map(x=>x.location_id).sort(),['store-a','store-b']);
});
test('deactivated location revokes read access even when stale user_locations grants remain',async t=>{
 const f=await fixture(t);
 const db=f.db;
 db.prepare('INSERT INTO repairs(id,location_id,equipment,description,created_by) VALUES(?,?,?,?,?)')
   .run('repair-a','store-a','測試設備','虛構故障','staff');
 db.prepare('INSERT INTO shifts(id,location_id,user_id,shift_date,start_time,end_time,created_by) VALUES(?,?,?,?,?,?,?)')
   .run('shift-a','store-a','staff','2026-11-02','09:00','17:00','manager');
 db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)')
   .run('po-a','PO-TEST','store-a','ing-1','虛構廠商',1,'staff');
 // Mirror the auth-core contract: inactive locations are excluded by loadPrincipal.
 db.prepare("UPDATE locations SET active=0 WHERE id='store-a'").run();
 const principal=await f.auth.loadPrincipal(d1(db),
   new Request('https://private-preview.workers.dev/api/me',{headers:{cookie:f.cookies.manager}}));
 assert.deepEqual(principal.locations,[]);
 assert.equal(f.auth.hasAccess(principal,'staff','store-a'),false);
 const auditBefore=db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
 for(const role of ['manager','staff']){
   for(const entity of ['locations','tasks','repairs','purchase_orders','shifts','stock','staff_directory']){
     const response=await get(f,role,entity);
     assert.equal(response.status,200,role+' '+entity);
     assert.deepEqual((await response.json()).rows,[],role+' '+entity+' must not leak inactive-store data');
   }
 }
 // Owner retains global administrative visibility to manage a disabled store.
 assert.deepEqual((await (await get(f,'owner','tasks')).json()).rows.map(r=>r.id).sort(),['ta','tb','tm']);
 assert.deepEqual((await (await get(f,'owner','locations')).json()).rows.filter(r=>r.active===0).map(r=>r.id),['store-a']);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,auditBefore);
});

test('production remains disabled; unknown resources and all writes fail closed',async t=>{
 const f=await fixture(t);
 assert.equal((await get(f,'owner','tasks','disabled')).status,503);
 assert.equal((await get(f,'owner','tasks','preview-readonly','POST')).status,405);
 assert.equal((await get(f,'manager','users')).status,404);
 assert.equal((await get(f,'staff','audit_logs')).status,404);
 assert.equal((await get(f,'owner','unknown')).status,404);
 assert.equal((await get(f,'anonymous','tasks')).status,401);
 assert.equal((await get(f,'owner','users')).status,200);
 f.db.prepare('UPDATE users SET active=0 WHERE id=?').run('staff');
 assert.equal((await get(f,'staff','tasks')).status,401);
 const worker=(await workerPromise).default;
 const bad=await worker.fetch(new Request('https://private-preview.workers.dev/api/command',{method:'POST'}),{DB:d1(f.db),CLOUD_AUTH_PHASE:'preview-readonly'});
 assert.equal(bad.status,503);
});
test('missing D1 contract and SQL failures do not leak SQL or write data',async t=>{
 const f=await fixture(t);
 const before=f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
 f.db.prepare('DELETE FROM cloud_schema_contract').run();
 let r=await get(f,'owner','tasks');
 assert.equal(r.status,503);assert.equal((await r.json()).code,'E_SCHEMA_NOT_READY');
 f.db.prepare('INSERT INTO cloud_schema_contract(id,contract_version) VALUES(1,3)').run();
 f.db.exec('DROP TABLE tasks');
 r=await get(f,'owner','tasks');
 assert.equal(r.status,503);
 assert.doesNotMatch(await r.text(),/no such table|SELECT|SQLite/i);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,before);
});
