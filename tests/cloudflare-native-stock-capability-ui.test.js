'use strict';
// Synthetic in-memory D1/Worker capability tests and Native UI wiring contract.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const worker=import('../cloudflare/worker.mjs'),auth=import('../cloudflare/auth-core.mjs');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const v3=read('cloudflare/migrations/0001_initial_v3.sql');
const proposal=read('cloudflare/migration-proposals/0004_stock_move_kinds.sql');
function d1(db){
 let sqls=[];
 const make=(sql,args=[])=>{
  sqls.push(sql);
  if(!/^\s*SELECT\b/.test(sql))throw Error('capability unexpectedly requested mutation');
  return {first:async()=>db.prepare(sql).get(...args),
   all:async()=>({results:db.prepare(sql).all(...args)})};
 };
 return {prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
  // Native-login readiness requires batch support; invocation is prohibited.
  async batch(){throw Error('read-only capability must never execute a D1 batch');},
  getSql:()=>[...sqls]};
}
async function fixture(t,{v4=true}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(v3);
 // Wrangler-managed versioning is separate from the v3 application schema.
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL)');
 db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(1,'0001_initial_v3.sql');
 db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(2,'0002_login_attempts_window_indexes.sql');
 const hash=await (await auth).hashWorkerPassword('synthetic-capability-pass-123');
 const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),store:randomUUID()};
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(ids.store,'Mock Store');
 for(const role of ['owner','manager','staff']){
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(ids[role],role,'Mock '+role,role,hash.password_salt,hash.password_hash);
  if(role!=='owner')db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
   .run(ids[role],ids.store);
 }
 if(v4){
  db.exec('BEGIN IMMEDIATE');
  try{
   db.exec(proposal);
   db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)')
    .run(3,'0004_stock_move_kinds.sql');
   db.exec('COMMIT');
  }
  catch(e){db.exec('ROLLBACK');throw e;}
 }
 const adapter=d1(db);
 const env={DB:adapter,CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  CLOUD_NATIVE_STOCK_V4_WRITE_GATE:'operator-released',
  CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:'operator-released',
  NATIVE_AUTH_SOURCE_PEPPER:'synthetic-capability-pepper-32-characters'};
 const send=(url,init={},e=env)=>{
  const request=new Request(site+url,init);
  Object.defineProperty(request,'cf',{value:{colo:'TPE'}});
  return (async()=>(await worker).default.fetch(request,e))();
 };
 const login=async role=>{
  // Login writes sessions by design; the read-only adapter is only used
  // AFTER initial login through a separately writable adapter.
  const sessHash=randomUUID().replace(/-/g,'').padEnd(64,'0');
  const csrf=(await auth).freshSessionToken();
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run(sessHash,csrf,ids[role],'2999-01-01T00:00:00.000Z');
  // Browser cookie must hash to stored token; derive using shared tokenSha256.
  const token=(await auth).freshSessionToken(),digest=await (await auth).tokenSha256(token);
  db.prepare('UPDATE sessions SET token_hash=? WHERE token_hash=?').run(digest,sessHash);
  return {cookie:(await auth).SESSION_COOKIE+'='+token,csrf};
 };
 return {db,env,send,login,adapter,ids};
}
test('authorized Owner/Manager see only explicitly gated capabilities on migrated v4',async t=>{
 const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager');
 for(const who of [owner,manager]){
  const res=await f.send('/api/stock/capability',{headers:{cookie:who.cookie}});
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{scrap_adjust_enabled:true,supplier_return_enabled:true});
 }
 assert(f.adapter.getSql().every(x=>/^\s*SELECT\b/.test(x)));
});
test('staff and unauthenticated requests never advertise stock v4 writes',async t=>{
 const f=await fixture(t),staff=await f.login('staff');
 const s=await f.send('/api/stock/capability',{headers:{cookie:staff.cookie}});
 assert.equal(s.status,200);
 assert.deepEqual(await s.json(),{scrap_adjust_enabled:false,supplier_return_enabled:false});
 assert.equal((await f.send('/api/stock/capability')).status,401);
});
test('both gates independently controlled, absent schema hides even an enabled gate',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 for(const [v4,returns,expected] of [
  [undefined,undefined,[false,false]],
  ['operator-released',undefined,[true,false]],
  [undefined,'operator-released',[false,true]]
 ]){
  const env={...f.env,CLOUD_NATIVE_STOCK_V4_WRITE_GATE:v4,
   CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:returns};
  const res=await f.send('/api/stock/capability',{headers:{cookie:owner.cookie}},env);
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{scrap_adjust_enabled:expected[0],
   supplier_return_enabled:expected[1]});
 }
 const old=await fixture(t,{v4:false}),oldOwner=await old.login('owner');
 const r=await old.send('/api/stock/capability',{headers:{cookie:oldOwner.cookie}});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{scrap_adjust_enabled:false,supplier_return_enabled:false});
});
test('read-only route rejects wrong path/method and unauthorized header',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 assert.equal((await f.send('/api/stock/capability',{method:'POST',headers:{cookie:owner.cookie}})).status,405);
 assert.equal((await f.send('/api/stock/capability?not=allowed',{headers:{cookie:owner.cookie}})).status,400);
 assert.equal((await f.send('/api/stock/capability',{headers:{cookie:owner.cookie,authorization:'Bearer invalid'}})).status,403);
 const env={...f.env,CLOUD_NATIVE_LOGIN_GATE:'disabled'};
 assert.equal((await f.send('/api/stock/capability',{headers:{cookie:owner.cookie}},env)).status,503);
});
test('Native owner form gates by server capability, uses shared v4 contract and no auto-retry',async()=>{
 const app=read('vercel-demo/owner-app.js'),cap=await import('../vercel-demo/native-owner-capability.mjs');
 assert.match(app,/async function stockV4Actions\(marker\)/);
 assert.match(app,/api\('\/api\/stock\/capability'\)/);
 assert.match(app,/['"]\/api\/stock\/return['"]/); // guarded endpoint selected by action
 assert.match(app,/stockV4:stockV4WriteEnabled/);
 assert.match(app,/normalizeStockV4\(kind,data\)/);
 assert.match(app,/X-Idempotency-Key/);
 assert.match(app,/submit.disabled=true;/);
 assert.match(app,/結果未確認/);
 assert.doesNotMatch(app,/localStorage|sessionStorage|from ['"]\.\/mock\.js['"]/);
 for(const role of ['owner','manager']){
  const enabled=cap.nativeOwnerCapability({view:'stock',role,stockV4:true});
  assert.equal(enabled.pageWritable,true);
 }
 assert.equal(cap.nativeOwnerCapability({view:'stock',role:'staff',stockV4:true}).pageWritable,false);
 assert.equal(cap.nativeOwnerCapability({view:'stock_moves',role:'owner',stockV4:true}).pageWritable,false);
});

test('Native stock return receipt search finds older received rows beyond 500, with no D1 writes',async t=>{
 const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager');
 const ing=randomUUID(),older=randomUUID();
 f.db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(ing,'SYNTH-PO-ING','Synthetic Item','kg');
 const insert=f.db.prepare(
  'INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by,received_at) VALUES(?,?,?,?,?,?,?,?,?)');
 insert.run(older,'PO-OLD-RECEIPT',f.ids.store,ing,'Mock Supplier',10,'received',
  f.ids.owner,'2020-01-01T00:00:00.000Z');
 for(let i=0;i<520;i++)
  insert.run(randomUUID(),'PO-NEW-'+String(i).padStart(5,'0'),f.ids.store,ing,
   'Mock Supplier',5,'received',f.ids.owner,'2026-11-01T00:00:00.000Z');
 const other=randomUUID();
 f.db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(other,'Another Store');
 insert.run(randomUUID(),'PO-OTHER-STORE',other,ing,'Private Supplier',3,
  'received',f.ids.owner,'2026-11-02T00:00:00.000Z');
 const route='/api/stock/receipts?location_id='+f.ids.store+'&ingredient_id='+ing;
 const get=(who,url=route)=>f.send(url,{headers:{cookie:who.cookie}});
 for(const who of [owner,manager]){
  const res=await get(who,route+'&q=OLD');
  assert.equal(res.status,200);
  assert.deepEqual((await res.json()).rows.map(x=>x.id),[older]);
 }
 const many=await get(owner);
 assert.equal(many.status,200);
 const body=await many.json();
 assert.equal(body.mode,'native_d1');
 assert.equal(body.rows.length,50);assert.equal(body.truncated,true);
 assert(body.rows.every(x=>x.location_id===f.ids.store&&x.ingredient_id===ing));
 assert(f.adapter.getSql().every(q=>/^\s*SELECT\b/.test(q)),
  'read-only path must not call INSERT, UPDATE, DELETE or batch');
 const notOwner=await get(manager,
  '/api/stock/receipts?location_id='+other+'&ingredient_id='+ing+'&q=OTHER');
 assert.equal(notOwner.status,403);
 const ownerOther=await get(owner,
  '/api/stock/receipts?location_id='+other+'&ingredient_id='+ing+'&q=OTHER');
 assert.equal(ownerOther.status,200);
 assert.equal((await ownerOther.json()).rows.length,1);
});
test('Native receipt lookup refuses absent session, staff, OFF Gate and invalid query',async t=>{
 const f=await fixture(t),owner=await f.login('owner'),staff=await f.login('staff');
 const ing=randomUUID();
 f.db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(ing,'SYNTH-PO-ING2','Synthetic Item 2','kg');
 const route='/api/stock/receipts?location_id='+f.ids.store+'&ingredient_id='+ing;
 assert.equal((await f.send(route)).status,401);
 assert.equal((await f.send(route,{headers:{cookie:staff.cookie}})).status,403);
 assert.equal((await f.send(route,{headers:{cookie:owner.cookie,authorization:'Bearer fake'}})).status,403);
 for(const suffix of ['&q=PO%25','&q=evil%20where','&q=a&q=b','&unknown=1']){
  assert.equal((await f.send(route+suffix,{headers:{cookie:owner.cookie}})).status,400);
 }
 assert.equal((await f.send('/api/stock/receipts?location_id=not-uuid&ingredient_id='+ing,
  {headers:{cookie:owner.cookie}})).status,400);
 const disabled={...f.env,CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:'disabled'};
 assert.equal((await f.send(route,{headers:{cookie:owner.cookie}},disabled)).status,503);
 const v3=await fixture(t,{v4:false}),v3owner=await v3.login('owner');
 assert.equal((await v3.send('/api/stock/receipts?location_id='+v3.ids.store+
   '&ingredient_id='+ing,{headers:{cookie:v3owner.cookie}})).status,503);
});
test('Native stock v4 Owner UI has explicit scoped receipt lookup and no 500-item listing dependency',()=>{
 const app=read('vercel-demo/owner-app.js');
 const start=app.indexOf('async function stockV4Actions('),end=app.indexOf('async function stocktakeActions(');
 assert(start>=0&&end>start);
 const ui=app.slice(start,end);
 assert.match(ui,/api\/stock\/receipts\?location_id=/);
 assert.match(ui,/poFind\.addEventListener\('click',searchReceipts\)/);
 assert.match(ui,/poSearchTicket/);
 assert.match(ui,/res\.truncated/);
 assert.doesNotMatch(ui,/entity=purchase_orders/);
 assert.match(ui,/stock\.supplier_return/);
 assert.match(ui,/normalizeStockV4\(kind,data\)/);
 assert.match(ui,/submit\.disabled=true/);
});


test('versioned receipt mismatch cannot expose live v4 UI even when both gates and kind marker are ON',async t=>{
 const cases=[
  ['missing v4 receipt',db=>db.exec('DELETE FROM d1_migrations WHERE id=3')],
  ['wrong v4 migration name',db=>db.prepare('UPDATE d1_migrations SET name=? WHERE id=3').run('0003_unreviewed.sql')],
  ['wrong v3 migration name',db=>db.prepare('UPDATE d1_migrations SET name=? WHERE id=2').run('0002_changed.sql')],
  ['missing initial receipt',db=>db.exec('DELETE FROM d1_migrations WHERE id=1')],
  ['extra migration receipt',db=>db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(4,'unreviewed.sql')],
  ['non-contiguous IDs',db=>db.exec('UPDATE d1_migrations SET id=5 WHERE id=3')],
  ['missing ledger table',db=>db.exec('DROP TABLE d1_migrations')],
  ['incomplete kind marker',db=>db.exec('DELETE FROM stock_move_kind_contract WHERE id=1')]
 ];
 for(const [name,mutate] of cases){
  await t.test(name,async sub=>{
   const f=await fixture(sub),owner=await f.login('owner');
   mutate(f.db);
   const response=await f.send('/api/stock/capability',{headers:{cookie:owner.cookie}});
   assert.equal(response.status,200);
   assert.deepEqual(await response.json(),{scrap_adjust_enabled:false,supplier_return_enabled:false});
   assert(f.adapter.getSql().every(sql=>/^\\s*SELECT\\b/.test(sql)),
    'capability must never modify D1');
  });
 }
});
