'use strict';
// Synthetic D1-shaped in-memory only. Production Gate remains unset.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),site='https://stock.example.workers.dev';
const worker=import('../cloudflare/worker.mjs'),auth=import('../cloudflare/auth-core.mjs');
const schema=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const v4=fs.readFileSync(path.join(root,'cloudflare/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
function adapter(db,opt={}){
 const stmt=(sql,args=[])=>({
  first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
  async batch(steps){
   if(opt.beforeBatch)opt.beforeBatch();
   db.exec('BEGIN IMMEDIATE');
   try{
    const out=[];
    for(let i=0;i<steps.length;i++){
     if(opt.failNow&&opt.failAt===i)throw Error('SYNTHETIC_FAILURE');
     out.push(await steps[i].run());
    }
    db.exec('COMMIT');return out;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 };
}
async function fixture(t,opts={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema);
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL)');
 db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(1,'0001_initial_v3.sql');
 db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(2,'0002_login_attempts_window_indexes.sql');
 const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
  store:randomUUID(),other:randomUUID(),ing:randomUUID()};
 const hash=await (await auth).hashWorkerPassword('synthetic-test-password-123');
 for(const [id,name] of [[ids.store,'Test location A'],[ids.other,'Test location B']])
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(ids.ing,'TEST-V4-ING','Test ingredient','kg');
 for(const role of ['owner','manager','staff']){
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(ids[role],role,'Test '+role,role,hash.password_salt,hash.password_hash);
  if(role!=='owner')db.prepare(
   'INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(ids[role],ids.store);
 }
 if(opts.v4!==false){
  db.exec('BEGIN IMMEDIATE');
  try{
   db.exec(v4);
   db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)')
    .run(3,'0004_stock_move_kinds.sql');
   db.exec('COMMIT');
  }
  catch(e){db.exec('ROLLBACK');throw e;}
 }
 const env={DB:adapter(db,opts),CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  CLOUD_NATIVE_STOCK_V4_WRITE_GATE:'operator-released',
  NATIVE_AUTH_SOURCE_PEPPER:'synthetic-stock-v4-pepper-at-least-32'};
 const send=async(url,init={},e=env)=>{
  const req=new Request(site+url,init);
  Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
  return (await worker).default.fetch(req,e);
 };
 const login=async role=>{
  const r=await send('/api/login',{method:'POST',headers:{origin:site,
   'content-type':'application/json','sec-fetch-site':'same-origin',
   'CF-Connecting-IP':'198.51.100.60'},
   body:JSON.stringify({username:role,password:'synthetic-test-password-123'})});
  assert.equal(r.status,200);
  return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};
 };
 const scrap=(qty=1,loc=ids.store)=>({action:'stock.scrap',data:{
  ingredient_id:ids.ing,location_id:loc,qty,reason:'expired'}});
 const adjust=(qty_delta=1,loc=ids.store)=>({action:'stock.adjust',data:{
  ingredient_id:ids.ing,location_id:loc,qty_delta,reason:'stock count'}});
 const write=(who,body=scrap(),opt={})=>send('/api/stock/v4',{
  method:'POST',headers:{origin:site,'content-type':'application/json',
   'sec-fetch-site':'same-origin',cookie:who.cookie,'x-csrf-token':who.csrf,
   'x-idempotency-key':opt.key||randomUUID(),...opt.headers},
  body:JSON.stringify(body)
 },opt.env||env);
 const stock=(delta,location_id=ids.store)=>db.prepare(
  'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)')
   .run(randomUUID(),ids.ing,location_id,delta,delta>0?'purchase':'usage');
 const balance=()=>db.prepare(
  'SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?')
   .get(ids.ing,ids.store).n;
 const count=()=>db.prepare(
  "SELECT COUNT(*) AS n FROM stock_moves WHERE move_type IN ('scrap','adjustment')").get().n;
 const audit=()=>db.prepare(
  "SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('stock.scrap','stock.adjust')").get().n;
 return {db,ids,env,send,login,write,stock,balance,count,audit,scrap,adjust};
}
test('Owner and Manager append scrap and signed adjustments with matched audits',async t=>{
 const f=await fixture(t);f.stock(10.5);
 const original=f.db.prepare("SELECT * FROM stock_moves WHERE move_type='purchase'").get();
 const owner=await f.login('owner'),manager=await f.login('manager');
 assert.equal((await f.write(manager,f.scrap(2.125))).status,200);
 assert.equal((await f.write(owner,f.adjust(-1.25))).status,200);
 assert.equal((await f.write(owner,f.adjust(3))).status,200);
 assert(Math.abs(f.balance()-10.125)<0.0000001);
 assert.equal(f.count(),3);assert.equal(f.audit(),3);
 assert.deepEqual(f.db.prepare("SELECT * FROM stock_moves WHERE move_type='purchase'").get(),original);
 assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('same request idempotency key cannot append movement/audit twice',async t=>{
 const f=await fixture(t);f.stock(10);
 const owner=await f.login('owner'),key=randomUUID();
 assert.equal((await f.write(owner,f.scrap(2),{key:key.toUpperCase()})).status,200);
 assert.equal((await f.write(owner,f.scrap(2),{key})).status,409);
 assert.equal(f.count(),1);assert.equal(f.audit(),1);assert.equal(f.balance(),8);
});
test('strict amount, reason, action and unauthenticated input reject',async t=>{
 const f=await fixture(t);f.stock(2);
 const owner=await f.login('owner');
 for(const qty of [0,-1,.0001,1000000.001,'2',null]){
  assert.equal((await f.write(owner,f.scrap(qty))).status,400);
 }
 for(const payload of [{...f.scrap(),data:{...f.scrap().data,reason:''}},
  {...f.scrap(),data:{...f.scrap().data,inject:true}},
  {action:'stock.supplier_return',data:f.scrap().data},
  {action:'stock.adjust',data:{...f.adjust().data,qty_delta:0}}]){
  assert.equal((await f.write(owner,payload)).status,400);
 }
 assert.equal((await f.write(owner,f.scrap(3))).status,409);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('Staff, out-of-store Manager, invalid CSRF and Origin cannot write',async t=>{
 const f=await fixture(t);f.stock(10);
 const staff=await f.login('staff'),manager=await f.login('manager');
 assert.equal((await f.write(staff,f.scrap())).status,403);
 assert.equal((await f.write(manager,f.scrap(1,f.ids.other))).status,403);
 assert.equal((await f.write(manager,f.scrap(),{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.write(manager,f.scrap(),{headers:{origin:'https://evil.test'}})).status,403);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('default-off Gate, old v3 D1 and missing login deny all writes',async t=>{
 const f=await fixture(t),owner=await f.login('owner');f.stock(10);
 for(const env of [{...f.env,CLOUD_NATIVE_STOCK_V4_WRITE_GATE:undefined},
  {...f.env,CLOUD_NATIVE_STOCK_V4_WRITE_GATE:'disabled'},
  {...f.env,CLOUD_NATIVE_LOGIN_GATE:'disabled'}]){
  assert.equal((await f.write(owner,f.scrap(),{env})).status,503);
  const status=await (await f.send('/api/native/status',{},env)).json();
  assert.equal(status.stock_v4_write_enabled,undefined,
   'Do not change the previously versioned Native status response contract');
 }
 assert.equal((await f.send('/api/stock/v4',{method:'GET'})).status,405);
 const old=await fixture(t,{v4:false}),oldOwner=await old.login('owner');
 old.stock(10);
 assert.equal((await old.write(oldOwner,old.scrap())).status,503);
 assert.equal(old.count(),0);assert.equal(f.count(),0);
 const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
 assert.equal(Object.hasOwn(config,'vars'),false);
});
test('D1 batch failure at stock/audit/guard step rolls back ledger and audit',async t=>{
 for(const failAt of [0,1,2]){
  const opt={failAt,failNow:false},f=await fixture(t,opt);f.stock(10);
  const owner=await f.login('owner');opt.failNow=true;
  assert.equal((await f.write(owner,f.scrap(2))).status,503);
  assert.equal(f.count(),0);assert.equal(f.audit(),0);
  assert.equal(f.balance(),10);
 }
});
test('stale scope and concurrent stock change are refused inside D1 batch',async t=>{
 let f,mode='none';
 const opts={beforeBatch(){
  if(mode==='remove')f.db.prepare('DELETE FROM user_locations WHERE user_id=?')
   .run(f.ids.manager);
  if(mode==='debit')f.stock(-5);
 }};
 f=await fixture(t,opts);f.stock(6);
 const manager=await f.login('manager');mode='remove';
 assert.equal((await f.write(manager,f.scrap(1))).status,503);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
 const owner=await f.login('owner');
 mode='debit';
 assert.equal((await f.write(owner,f.scrap(2))).status,503);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
 assert.equal(f.balance(),1);
});
test('real worker is default denied and no migration or setting is enabled',()=>{
 const workerCode=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
 assert.match(workerCode,/nativeStockV4Http/);
 const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
 assert.equal(JSON.stringify(config).includes('CLOUD_NATIVE_STOCK_V4_WRITE_GATE'),false);
 const migrations=fs.readdirSync(path.join(root,'cloudflare/migrations')).filter(x=>x.endsWith('.sql'));
 assert.equal(migrations.some(x=>x.startsWith('0004')),false);
});
