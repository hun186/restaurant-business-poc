'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const workerPromise=import('../cloudflare/worker.mjs'),authPromise=import('../cloudflare/auth-core.mjs');
function d1(db,opt={}){
  const make=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})});
  return {prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(steps){
      if(opt.beforeBatch)opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');try{
        const out=[];
        for(let i=0;i<steps.length;i++){
          if(opt.failNow&&i===opt.failAt)throw Error('SYNTHETIC_D1_ROLLBACK');
          out.push(await steps[i].run());
        }
        db.exec('COMMIT');return out;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }};
}
async function fixture(t,opt={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
  const {hashWorkerPassword}=await authPromise;
  const hash=await hashWorkerPassword('synthetic-password-12345');
  const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
    a:randomUUID(),b:randomUUID(),ingredient:randomUUID()};
  for(const [id,name] of [[ids.a,'虛構A店'],[ids.b,'虛構B店']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
    .run(ids.ingredient,'SYN-001','虛構米','公斤');
  for(const role of ['owner','manager','staff']){
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(ids[role],role,'測試'+role,role,hash.password_salt,hash.password_hash);
    if(role!=='owner')
      db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
        .run(ids[role],ids.a);
  }
  const env={DB:d1(db,opt),CLOUD_AUTH_PHASE:'native-production',
    CLOUD_NATIVE_LOGIN_GATE:'operator-released',
    CLOUD_NATIVE_ORDER_WRITE_GATE:'operator-released',
    NATIVE_AUTH_SOURCE_PEPPER:'synthetic-IP-source-pepper-32-characters-only'};
  const worker=(await workerPromise).default;
  function send(route,init={},e=env){
    const req=new Request(site+route,init);
    Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
    return worker.fetch(req,e);
  }
  async function login(username){
    const response=await send('/api/login',{method:'POST',headers:{
      origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
      'CF-Connecting-IP':'198.51.100.16'
    },body:JSON.stringify({username,password:'synthetic-password-12345'})});
    assert.equal(response.status,200);
    const data=await response.json();
    return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:data.csrf};
  }
  const write=(login,action,data,opts={})=>send('/api/order',{method:'POST',headers:{
    'content-type':'application/json',origin:site,'sec-fetch-site':'same-origin',
    cookie:login.cookie,'x-csrf-token':login.csrf,...opts.headers
  },body:opts.body??JSON.stringify({action,data})},opts.env||env);
  return {db,ids,send,login,write,env};
}
const moveCount=db=>db.prepare("SELECT COUNT(*) AS n FROM stock_moves WHERE move_type='purchase'").get().n;
const audits=db=>db.prepare("SELECT action,entity_id FROM audit_logs WHERE action LIKE 'order.%' ORDER BY rowid").all();
const orderCount=db=>db.prepare('SELECT COUNT(*) AS n FROM purchase_orders').get().n;
const command=(id,status,action)=>({id,expected_status:status});
test('full D1 staff request -> manager approval -> one stock receipt and audit',async t=>{
  const f=await fixture(t),staff=await f.login('staff'),manager=await f.login('manager');
  const create=await f.write(staff,'order.create',{
    location_id:f.ids.a,ingredient_id:f.ids.ingredient,supplier:'虛構供應商',qty:2.125});
  assert.equal(create.status,200);
  const item=(await create.json()).result;
  assert.equal(item.status,'requested');
  assert.match(item.number,/^PO-[0-9A-F]{32}$/);
  assert.equal(orderCount(f.db),1);assert.equal(moveCount(f.db),0);
  const approve=await f.write(manager,'order.approve',command(item.id,'requested'));
  assert.equal(approve.status,200);
  assert.equal(f.db.prepare('SELECT status FROM purchase_orders WHERE id=?')
    .get(item.id).status,'approved');
  assert.equal(moveCount(f.db),0,'approval alone must NEVER increase stock');
  const receive=await f.write(manager,'order.receive',command(item.id,'approved'));
  assert.equal(receive.status,200);
  const stock=f.db.prepare(
    "SELECT qty_delta,reference_id,location_id,ingredient_id,move_type FROM stock_moves"
  ).get();
  assert.deepEqual(stock,{qty_delta:2.125,reference_id:item.id,
    location_id:f.ids.a,ingredient_id:f.ids.ingredient,move_type:'purchase'});
  const balance=await f.send('/api/data?entity=stock',{headers:{cookie:manager.cookie}});
  assert.equal(balance.status,200);
  assert((await balance.json()).rows.some(x=>x.ingredient_id===f.ids.ingredient&&
    x.location_id===f.ids.a&&x.on_hand===2.125));
  assert.deepEqual(audits(f.db).map(x=>x.action),
    ['order.create','order.approve','order.receive']);
  assert.equal((await f.write(manager,'order.receive',command(item.id,'approved'))).status,409);
  assert.equal(moveCount(f.db),1);
  assert.equal(audits(f.db).length,3);
});
test('staff can request but not approve, receive or cancel',async t=>{
  const f=await fixture(t),staff=await f.login('staff');
  const result=await f.write(staff,'order.create',{
    location_id:f.ids.a,ingredient_id:f.ids.ingredient,supplier:'供應商',qty:5});
  assert.equal(result.status,200);const item=(await result.json()).result;
  for(const action of ['order.approve','order.receive','order.cancel'])
    assert.equal((await f.write(staff,action,command(item.id,'requested'))).status,403);
  assert.equal(moveCount(f.db),0);
  assert.deepEqual(audits(f.db).map(x=>x.action),['order.create']);
});
test('cross-store order and inactive catalog denied, no hidden inventory updates',async t=>{
  const f=await fixture(t),staff=await f.login('staff'),manager=await f.login('manager'),
    owner=await f.login('owner');
  assert.equal((await f.write(staff,'order.create',{location_id:f.ids.b,
    ingredient_id:f.ids.ingredient,supplier:'X',qty:2})).status,409);
  const created=await f.write(owner,'order.create',{location_id:f.ids.b,
    ingredient_id:f.ids.ingredient,supplier:'X',qty:2});
  assert.equal(created.status,200);
  const id=(await created.json()).result.id;
  assert.equal((await f.write(manager,'order.approve',command(id,'requested'))).status,404);
  f.db.prepare('UPDATE ingredients SET active=0 WHERE id=?').run(f.ids.ingredient);
  assert.equal((await f.write(owner,'order.approve',command(id,'requested'))).status,409);
  assert.equal(moveCount(f.db),0);
  assert.deepEqual(audits(f.db).map(x=>x.action),['order.create']);
});
test('requested and approved orders cancel, but cancelled orders never receive stock',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const approveFirst of [false,true]){
    const create=await f.write(owner,'order.create',{location_id:f.ids.a,
      ingredient_id:f.ids.ingredient,supplier:'Y',qty:1});
    const id=(await create.json()).result.id;
    if(approveFirst)
      assert.equal((await f.write(owner,'order.approve',command(id,'requested'))).status,200);
    assert.equal((await f.write(owner,'order.cancel',
      command(id,approveFirst?'approved':'requested'))).status,200);
    assert.equal((await f.write(owner,'order.receive',command(id,'approved'))).status,409);
  }
  assert.equal(moveCount(f.db),0);
});
test('duplicate, stale, incomplete or invalid purchase actions reject',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const qty of [-1,0,1000000.001,0.0001,'2',NaN,Infinity]){
    assert.equal((await f.write(owner,'order.create',{location_id:f.ids.a,
      ingredient_id:f.ids.ingredient,supplier:'Y',qty})).status,400);
  }
  assert.equal((await f.write(owner,'order.create',{location_id:f.ids.a,
    ingredient_id:f.ids.ingredient,supplier:'  ',qty:1})).status,400);
  const row=await f.write(owner,'order.create',{location_id:f.ids.a,
    ingredient_id:f.ids.ingredient,supplier:'Y',qty:2});
  const id=(await row.json()).result.id;
  assert.equal((await f.write(owner,'order.receive',command(id,'requested'))).status,409);
  assert.equal((await f.write(owner,'order.approve',command(id,'approved'))).status,409);
  assert.equal((await f.write(owner,'order.approve',{...command(id,'requested'),extra:1})).status,400);
  assert.equal((await f.write(owner,'order.approve',command(id,'requested'),{
    headers:{'x-csrf-token':'forged'}})).status,403);
  assert.equal(moveCount(f.db),0);
  assert.equal(audits(f.db).length,1);
});
test('default gates never enable production order writes',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const env of [{...f.env,CLOUD_AUTH_PHASE:'disabled'},
    {...f.env,CLOUD_NATIVE_ORDER_WRITE_GATE:undefined},
    {...f.env,CLOUD_NATIVE_LOGIN_GATE:undefined}]){
    const r=await f.write(owner,'order.create',{location_id:f.ids.a,
      ingredient_id:f.ids.ingredient,supplier:'Y',qty:1},{env});
    assert.equal(r.status,503);assert.equal((await r.json()).code,'E_NOT_READY');
  }
  const status=await f.send('/api/native/status',{},{
    ...f.env,CLOUD_NATIVE_ORDER_WRITE_GATE:undefined});
  assert.equal((await status.json()).order_write_enabled,false);
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(Object.hasOwn(config.vars,'CLOUD_NATIVE_ORDER_WRITE_GATE'),false);
  assert.equal(orderCount(f.db),0);assert.equal(moveCount(f.db),0);
});
test('manager rights revoked inside batch prevent approval and audit',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare('DELETE FROM user_locations WHERE user_id=? AND location_id=?')
      .run(f.ids.manager,f.ids.a);
  }});
  const owner=await f.login('owner'),manager=await f.login('manager');
  const response=await f.write(owner,'order.create',{location_id:f.ids.a,
    ingredient_id:f.ids.ingredient,supplier:'Y',qty:1});
  const id=(await response.json()).result.id;
  revoke=true;
  assert.equal((await f.write(manager,'order.approve',command(id,'requested'))).status,409);
  assert.equal(f.db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(id).status,'requested');
  assert.deepEqual(audits(f.db).map(x=>x.action),['order.create']);
});
test('D1 failed ledger insert rolls back state and every receipt audit',async t=>{
  const opt={failAt:2};const f=await fixture(t,opt),owner=await f.login('owner');
  const create=await f.write(owner,'order.create',{location_id:f.ids.a,
    ingredient_id:f.ids.ingredient,supplier:'Y',qty:1});
  const id=(await create.json()).result.id;
  assert.equal((await f.write(owner,'order.approve',command(id,'requested'))).status,200);
  opt.failNow=true;
  assert.equal((await f.write(owner,'order.receive',command(id,'approved'))).status,503);
  assert.equal(f.db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(id).status,'approved');
  assert.equal(moveCount(f.db),0);
  assert.deepEqual(audits(f.db).map(x=>x.action),['order.create','order.approve']);
});
test('previously received marker blocks duplicate stock moves even on reopened status',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  const create=await f.write(owner,'order.create',{location_id:f.ids.a,
    ingredient_id:f.ids.ingredient,supplier:'Y',qty:3});
  const id=(await create.json()).result.id;
  assert.equal((await f.write(owner,'order.approve',command(id,'requested'))).status,200);
  assert.equal((await f.write(owner,'order.receive',command(id,'approved'))).status,200);
  f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(id);
  assert.equal((await f.write(owner,'order.receive',command(id,'approved'))).status,409);
  assert.equal(moveCount(f.db),1);
  assert.deepEqual(audits(f.db).map(x=>x.action),
    ['order.create','order.approve','order.receive']);
});
test('non-native grouped order is never handled as an individual line',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  const id=randomUUID();
  f.db.prepare(
    'INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)'
  ).run(id,'LEGACY-GROUP-0001',f.ids.a,f.ids.ingredient,'Legacy',2,f.ids.owner);
  assert.equal((await f.write(owner,'order.approve',command(id,'requested'))).status,409);
  assert.equal(moveCount(f.db),0);
  assert.equal(audits(f.db).length,0);
});
