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
  try{db.exec(proposal);db.exec('COMMIT');}
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
 return {db,env,send,login,adapter};
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
