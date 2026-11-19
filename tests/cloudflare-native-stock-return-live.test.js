'use strict';
// Synthetic D1-backed Worker integration: :memory: SQLite only.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),site='https://restaurant.example.workers.dev';
const worker=import('../cloudflare/worker.mjs'),auth=import('../cloudflare/auth-core.mjs');
const schema=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const v4=fs.readFileSync(path.join(root,'cloudflare/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
const entry=fs.readFileSync(path.join(root,'cloudflare/native-stock-return-http.mjs'),'utf8');
function adapter(db,opt={}){
 const call=(sql,args=[])=>({
  first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...call(sql),bind:(...args)=>call(sql,args)};},
  async batch(steps){
   if(typeof opt.beforeBatch==='function')opt.beforeBatch();
   db.exec('BEGIN IMMEDIATE');
   try{
    const out=[];
    for(let i=0;i<steps.length;i++){
     if(opt.failAt===i&&opt.failNow)throw Error('SYNTHETIC_D1_FAILURE');
     out.push(await steps[i].run());
    }
    db.exec('COMMIT');return out;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 };
}
async function fixture(t,opt={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema);
 const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
  store:randomUUID(),outside:randomUUID(),ing:randomUUID(),
  order:randomUUID()};
 const hash=await (await auth).hashWorkerPassword('synthetic-return-password-123');
 for(const [id,name] of [[ids.store,'Mock store'],[ids.outside,'Other mock store']])
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(ids.ing,'MOCK-RETURN-ING','Mock ingredient','kg');
 for(const role of ['owner','manager','staff']){
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(ids[role],role,'Mock '+role,role,hash.password_salt,hash.password_hash);
  if(role!=='owner')db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
   .run(ids[role],ids.store);
 }
 db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
  .run(ids.order,'PO-RETURN-TEST',ids.store,ids.ing,'Mock supplier',10,'received',ids.owner);
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,actor_id) VALUES(?,?,?,?,?,?,?)')
  .run(randomUUID(),ids.ing,ids.store,10,'purchase',ids.order,ids.owner);
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
  .run(randomUUID(),ids.ing,ids.store,-2,'usage',ids.owner);
 if(opt.v4!==false){
  db.exec('BEGIN IMMEDIATE');
  try{db.exec(v4);db.exec('COMMIT');}
  catch(e){db.exec('ROLLBACK');throw e;}
 }
 const env={DB:adapter(db,opt),CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:'operator-released',
  NATIVE_AUTH_SOURCE_PEPPER:'synthetic-return-pepper-at-least-32'};
 const send=(url,init={},selected=env)=>{
  const req=new Request(site+url,init);
  Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
  return (async()=>(await worker).default.fetch(req,selected))();
 };
 const login=async role=>{
  const result=await send('/api/login',{method:'POST',headers:{
   origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
   'CF-Connecting-IP':'198.51.100.19'},
   body:JSON.stringify({username:role,password:'synthetic-return-password-123'})});
  assert.equal(result.status,200);
  return {cookie:result.headers.get('set-cookie').split(';')[0],
   csrf:(await result.json()).csrf};
 };
 const command=(qty=2,location_id=ids.store,reference_id=ids.order)=>({
  action:'stock.supplier_return',data:{ingredient_id:ids.ing,location_id,
   reference_id,qty,reason:'damaged goods'}
 });
 const write=(user,body=command(),o={})=>send('/api/stock/return',{
  method:'POST',headers:{origin:site,'content-type':'application/json',
   'sec-fetch-site':'same-origin',cookie:user.cookie,'x-csrf-token':user.csrf,
   'x-idempotency-key':o.key||randomUUID(),...o.headers},
  body:o.body??JSON.stringify(body)
 },o.env||env);
 const count=()=>db.prepare("SELECT COUNT(*) AS n FROM stock_moves WHERE move_type='supplier_return'").get().n;
 const audit=()=>db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='stock.supplier_return'").get().n;
 const balance=()=>db.prepare('SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves WHERE location_id=? AND ingredient_id=?')
  .get(ids.store,ids.ing).n;
 return {db,ids,env,send,login,command,write,count,audit,balance,opt};
}
test('Owner + scoped Manager return stock append-only with paired audit',async t=>{
 const f=await fixture(t);const owner=await f.login('owner'),manager=await f.login('manager');
 const original=f.db.prepare("SELECT * FROM stock_moves WHERE move_type='purchase'").get();
 const po=f.db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(f.ids.order);
 const first=await f.write(owner,f.command(2.125));
 assert.equal(first.status,200,JSON.stringify(await first.clone().json()));
 assert.equal((await first.json()).result.qty,2.125);
 assert.equal((await f.write(manager,f.command(1.5))).status,200);
 assert(Math.abs(f.balance()-4.375)<0.0000001);
 assert.equal(f.count(),2);assert.equal(f.audit(),2);
 assert.deepEqual(f.db.prepare("SELECT * FROM stock_moves WHERE move_type='purchase'").get(),original);
 assert.deepEqual(f.db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(f.ids.order),po);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('duplicate UUID, case variant and replay cannot debit twice',async t=>{
 const f=await fixture(t),owner=await f.login('owner'),key=randomUUID();
 assert.equal((await f.write(owner,f.command(2),{key:key.toUpperCase()})).status,200);
 assert.equal((await f.write(owner,f.command(2),{key})).status,409);
 assert.equal(f.count(),1);assert.equal(f.audit(),1);assert.equal(f.balance(),6);
});
test('received purchase order, original purchase ledger and receipt cap required',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 assert.equal((await f.write(owner,f.command(9))).status,503,
  'cannot return more than currently available');
 f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(f.ids.order);
 assert.equal((await f.write(owner,f.command(2))).status,409);
 f.db.prepare("UPDATE purchase_orders SET status='received' WHERE id=?").run(f.ids.order);
 f.db.prepare("UPDATE stock_moves SET qty_delta=9 WHERE move_type='purchase'").run();
 assert.equal((await f.write(owner,f.command(1))).status,503);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('bad payload, foreign location, staff and wrong CSRF are denied',async t=>{
 const f=await fixture(t),owner=await f.login('owner'),
  mgr=await f.login('manager'),staff=await f.login('staff');
 assert.equal((await f.write(staff,f.command(1))).status,403);
 assert.equal((await f.write(mgr,f.command(1,f.ids.outside))).status,403);
 assert.equal((await f.write(owner,f.command(1),{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.write(owner,f.command(1),{headers:{origin:'https://evil.example'}})).status,403);
 for(const q of [0,-1,0.0001,1000000.001,'2',null]){
  assert.equal((await f.write(owner,f.command(q))).status,400);
 }
 for(const input of [{...f.command(),action:'stock.scrap'},
  {...f.command(),data:{...f.command().data,reason:' '}},
  {...f.command(),data:{...f.command().data,unapproved:true}}]){
  assert.equal((await f.write(owner,input)).status,400);
 }
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('Gate OFF, Login OFF and v3 schema reject before writing',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 for(const env of [{...f.env,CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:undefined},
  {...f.env,CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:'disabled'},
  {...f.env,CLOUD_NATIVE_LOGIN_GATE:'disabled'}]){
  assert.equal((await f.write(owner,f.command(1),{env})).status,503);
 }
 assert.equal((await f.send('/api/stock/return',{method:'GET'})).status,405);
 const old=await fixture(t,{v4:false}),oldOwner=await old.login('owner');
 assert.equal((await old.write(oldOwner,old.command(1))).status,503);
 assert.equal(old.count(),0);assert.equal(f.count(),0);
 const conf=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
 assert.equal(Object.hasOwn(conf,'vars'),false);
});
test('audit, guard and ledger injected failures roll back entire batch',async t=>{
 for(const failAt of [0,1,2]){
  const opt={failAt,failNow:false},f=await fixture(t,opt),owner=await f.login('owner');
  opt.failNow=true;
  assert.equal((await f.write(owner,f.command(2))).status,503);
  assert.equal(f.count(),0);assert.equal(f.audit(),0);assert.equal(f.balance(),8);
 }
});
test('scope revoked or stock depleted before locked batch cannot commit',async t=>{
 let f,mode='';
 const opt={beforeBatch(){
  if(mode==='scope')f.db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.manager);
  if(mode==='stock')f.db.prepare("UPDATE stock_moves SET qty_delta=-7 WHERE move_type='usage'").run();
 }};
 f=await fixture(t,opt);
 const manager=await f.login('manager');mode='scope';
 assert.equal((await f.write(manager,f.command(2))).status,503);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
 const owner=await f.login('owner');mode='stock';
 assert.equal((await f.write(owner,f.command(2))).status,503);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);assert.equal(f.balance(),3);
});
test('hard deny arbitrary client SQL and never import synthetic writer',()=>{
 assert.match(entry,/CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE/);
 assert.doesNotMatch(entry,/stock-v4-d1-synthetic-return-batch/);
 const workerCode=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
 assert.match(workerCode,/nativeStockReturnHttp/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'),/supplier_return|scrap/);
});
