'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const workerPromise=import('../cloudflare/worker.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
const root=path.join(__dirname,'..');

function fakeD1(db){
  return {prepare(sql){
    const stmt=(args=[])=>({
      first:async()=>db.prepare(sql).get(...args),
      all:async()=>({results:db.prepare(sql).all(...args)})
    });
    return {...stmt(),bind:(...args)=>stmt(args)};
  }};
}
async function fixture(t){
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
  const ins=(sql,...args)=>db.prepare(sql).run(...args);
  for(const [id,active] of [['store-a',1],['store-b',1],['store-off',0]])
    ins('INSERT INTO locations(id,name,active) VALUES(?,?,?)',id,id,active);
  ins('INSERT INTO ingredients(id,sku,name,unit,min_stock) VALUES(?,?,?,?,?)','ing-1','SKU-1','虛構測試食材','kg',4);
  const auth=await authPromise;
  const cookies={};
  for(const [id,role,stores] of [
    ['owner','owner',[]],['manager','manager',['store-a']],
    ['staff','staff',['store-a']],['outsider','staff',['store-b']]
  ]){
    ins('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)',
      id,id,'虛構'+id,role,'unused','unused');
    for(const store of stores)ins('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)',id,store);
    const token=auth.freshSessionToken(),csrf=auth.freshSessionToken();
    ins('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)',
      await auth.tokenSha256(token),csrf,id,new Date(Date.now()+3600000).toISOString());
    cookies[id]=auth.SESSION_COOKIE+'='+token;
  }
  for(const [id,store,assignee,status] of [
    ['task-a','store-a','staff','todo'],['task-m','store-a','manager','doing'],
    ['task-b','store-b','staff','todo'],['task-off','store-off','staff','todo'],
    ['task-done','store-a','staff','done']
  ]) ins('INSERT INTO tasks(id,location_id,title,assigned_to,status) VALUES(?,?,?,?,?)',
    id,store,id,assignee,status);
  for(const [id,store,by,status] of [
    ['order-a','store-a','staff','requested'],['order-m','store-a','manager','approved'],
    ['order-b','store-b','outsider','requested'],['order-off','store-off','staff','requested'],
    ['order-done','store-a','staff','received']
  ]) ins('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by,status) VALUES(?,?,?,?,?,?,?,?)',
    id,id,store,'ing-1','測試供應商',1,by,status);
  for(const [id,store,by,status] of [
    ['repair-a','store-a','staff','reported'],['repair-m','store-a','manager','assigned'],
    ['repair-b','store-b','outsider','reported'],['repair-off','store-off','staff','reported'],
    ['repair-done','store-a','staff','closed']
  ]) ins('INSERT INTO repairs(id,location_id,equipment,description,created_by,status) VALUES(?,?,?,?,?,?)',
    id,store,'虛構設備','虛構內容',by,status);
  for(const [id,store,qty] of [
    ['stock-a','store-a',3],['stock-b','store-b',8]
  ]) ins("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,'ing-1',?,?,'purchase')",
    id,store,qty);
  return {db,env:{DB:fakeD1(db),CLOUD_AUTH_PHASE:'preview-readonly'},cookies};
}
async function get(f,role='owner',path='/api/overview',options={}){
  const worker=(await workerPromise).default;
  const req=new Request('https://preview.workers.dev'+path,{
    method:options.method||'GET',
    headers:{cookie:f.cookies[role]||'',...options.headers},
    ...(options.method==='POST'?{body:'{}'}:{})
  });
  return worker.fetch(req,options.env||f.env);
}
test('staging overview uses real D1 aggregate counts and never exposes underlying rows',async t=>{
  const f=await fixture(t);
  for(const [role,metrics] of [
    ['owner',{open_tasks:3,pending_orders:3,open_repairs:3,low_stock:1}],
    ['manager',{open_tasks:2,pending_orders:2,open_repairs:2,low_stock:1}],
    ['staff',{open_tasks:1,pending_orders:1,open_repairs:1,low_stock:1}],
    ['outsider',{open_tasks:0,pending_orders:1,open_repairs:1,low_stock:0}]
  ]){
    const res=await get(f,role);
    assert.equal(res.status,200,role);
    assert.equal(res.headers.get('cache-control'),'no-store');
    const body=await res.json();
    assert.deepEqual(body,{status:'staging_readonly',metrics,production_ready:false});
    assert.doesNotMatch(JSON.stringify(body),/虛構|store-a|store-b|secret|token|csrf/i);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,0);
});
test('inactive/grant changes and user deactivation immediately revoke overview visibility',async t=>{
  const f=await fixture(t);
  f.db.prepare("UPDATE locations SET active=0 WHERE id='store-a'").run();
  const r=await get(f,'manager');
  assert.equal(r.status,200);
  assert.deepEqual((await r.json()).metrics,{open_tasks:0,pending_orders:0,open_repairs:0,low_stock:0});
  f.db.prepare("UPDATE users SET active=0 WHERE id='staff'").run();
  assert.equal((await get(f,'staff')).status,401);
  f.db.prepare("DELETE FROM user_locations WHERE user_id='outsider'").run();
  const outsider=await get(f,'outsider');
  assert.deepEqual((await outsider.json()).metrics,{open_tasks:0,pending_orders:0,open_repairs:0,low_stock:0});
});
test('low stock includes active ingredients with zero stock-move records',async t=>{
  const f=await fixture(t);
  f.db.prepare('INSERT INTO ingredients(id,sku,name,unit,min_stock) VALUES(?,?,?,?,?)')
    .run('ing-zero','SZ','虛構缺貨食材','kg',2);
  const owner=await (await get(f,'owner')).json();
  const manager=await (await get(f,'manager')).json();
  const outsider=await (await get(f,'outsider')).json();
  assert.equal(owner.metrics.low_stock,3); // store-a existing low + ing-zero at two active stores
  assert.equal(manager.metrics.low_stock,2);
  assert.equal(outsider.metrics.low_stock,1);
});
test('production and anonymous requests fail closed; unsupported methods and queries rejected',async t=>{
  const f=await fixture(t);
  for(const phase of ['disabled',undefined,'staging-write']){
    const res=await get(f,'owner','/api/overview',{env:{...f.env,CLOUD_AUTH_PHASE:phase}});
    assert.equal(res.status,503,phase);
    assert.equal((await res.json()).code,'E_NOT_READY');
  }
  assert.equal((await get(f,'anonymous')).status,401);
  assert.equal((await get(f,'owner','/api/overview',{method:'POST'})).status,405);
  assert.equal((await get(f,'manager','/api/overview?location_id=store-b')).status,400);
  assert.equal((await get(f,'owner','/api/overview?debug=1')).status,400);
});
test('missing schema or D1 failures return generic error without SQL disclosure',async t=>{
  const f=await fixture(t);
  f.db.prepare('DELETE FROM cloud_schema_contract').run();
  let r=await get(f,'owner');
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'E_SCHEMA_NOT_READY');
  f.db.prepare('INSERT INTO cloud_schema_contract(id,contract_version) VALUES(1,3)').run();
  f.db.exec('DROP TABLE repairs');
  r=await get(f,'owner');
  assert.equal(r.status,503);
  assert.equal((await r.clone().json()).code,'E_OVERVIEW_UNAVAILABLE');
  assert.doesNotMatch(await r.text(),/SQLite|no such table|SELECT|store-a/i);
});
