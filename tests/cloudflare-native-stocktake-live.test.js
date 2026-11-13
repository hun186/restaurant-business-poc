'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const workerPromise=import('../cloudflare/worker.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
function d1(db,opt={}){
  const make=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})});
  return {prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(statements){
      if(opt.beforeBatch)opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');try{
        const out=[];
        for(let i=0;i<statements.length;i++){
          if(opt.failNow&&opt.failAt===i)throw Error('SYNTHETIC_ROLLBACK');
          out.push(await statements[i].run());
        }
        db.exec('COMMIT');return out;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }};
}
async function fixture(t,opt={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
  const hash=await (await authPromise).hashWorkerPassword('synthetic-password-12345');
  const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
    a:randomUUID(),b:randomUUID(),ingredient:randomUUID()};
  for(const [id,name] of [[ids.a,'虛構A店'],[ids.b,'虛構B店']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
    .run(ids.ingredient,'RICE-SYN','虛構米','kg');
  for(const role of ['owner','manager','staff']){
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(ids[role],role,'合成'+role,role,hash.password_salt,hash.password_hash);
    if(role!=='owner')
      db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
        .run(ids[role],ids.a);
  }
  const env={DB:d1(db,opt),CLOUD_AUTH_PHASE:'native-production',
    CLOUD_NATIVE_LOGIN_GATE:'operator-released',
    CLOUD_NATIVE_STOCKTAKE_WRITE_GATE:'operator-released',
    NATIVE_AUTH_SOURCE_PEPPER:'synthetic-source-pepper-32-characters-only'};
  const worker=(await workerPromise).default;
  const send=(route,init={},e=env)=>{
    const req=new Request(site+route,init);
    Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
    return worker.fetch(req,e);
  };
  async function login(username){
    const res=await send('/api/login',{method:'POST',headers:{
      origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
      'CF-Connecting-IP':'198.51.100.71'
    },body:JSON.stringify({username,password:'synthetic-password-12345'})});
    assert.equal(res.status,200);
    const body=await res.json();
    return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:body.csrf};
  }
  const write=(who,action,data,opts={})=>send('/api/stocktake',{method:'POST',headers:{
    'content-type':'application/json',origin:site,'sec-fetch-site':'same-origin',
    cookie:who.cookie,'x-csrf-token':who.csrf,...opts.headers
  },body:opts.body??JSON.stringify({action,data})},opts.env||env);
  const ledger=(qty,location=ids.a)=>{
    db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,note,actor_id) VALUES(?,?,?,?,?,?,?)')
      .run(randomUUID(),ids.ingredient,location,qty,qty>0?'purchase':'usage','合成初始流水',ids.owner);
  };
  return {db,ids,env,send,login,write,ledger};
}
const stock=db=>db.prepare("SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves").get().n;
const takeCount=db=>db.prepare("SELECT COUNT(*) AS n FROM stocktakes").get().n;
const adjusts=db=>db.prepare("SELECT * FROM stock_moves WHERE move_type='adjustment'").all();
const audits=db=>db.prepare("SELECT action,entity_id FROM audit_logs WHERE action LIKE 'stocktake.%' ORDER BY rowid").all();
const draft=(f,qty=4)=>({location_id:f.ids.a,ingredient_id:f.ids.ingredient,counted_qty:qty});
test('staff counts, manager confirms and inventory adjustment + audit persist atomically',async t=>{
  const f=await fixture(t);f.ledger(10);
  const staff=await f.login('staff'),manager=await f.login('manager');
  const created=await f.write(staff,'stocktake.create',draft(f,8.125));
  assert.equal(created.status,200);const row=(await created.json()).result;
  const fromDb=f.db.prepare('SELECT * FROM stocktakes WHERE id=?').get(row.id);
  assert.equal(fromDb.expected_qty,10);assert.equal(fromDb.counted_qty,8.125);
  assert.equal(fromDb.status,'pending');
  assert.equal(adjusts(f.db).length,0);assert.equal(stock(f.db),10);
  const list=await f.send('/api/data?entity=stocktakes',{headers:{cookie:staff.cookie}});
  assert.equal(list.status,200);
  assert((await list.json()).rows.some(x=>x.id===row.id));
  const confirmed=await f.write(manager,'stocktake.confirm',{id:row.id,expected_status:'pending'});
  assert.equal(confirmed.status,200);
  const details=(await confirmed.json()).result;
  assert.equal(details.adjustment,-1.875);
  assert.equal(adjusts(f.db).length,1);assert.equal(adjusts(f.db)[0].reference_id,row.id);
  assert.equal(stock(f.db),8.125);
  assert.deepEqual(audits(f.db).map(x=>x.action),['stocktake.create','stocktake.confirm']);
  assert.equal((await f.write(manager,'stocktake.confirm',{
    id:row.id,expected_status:'pending'})).status,409);
  assert.equal(adjusts(f.db).length,1);
});
test('equal stocktake confirms without invalid zero stock_move',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  const create=await f.write(owner,'stocktake.create',draft(f,0));
  assert.equal(create.status,200);
  const id=(await create.json()).result.id;
  const confirm=await f.write(owner,'stocktake.confirm',{id,expected_status:'pending'});
  assert.equal(confirm.status,200);
  assert.equal((await confirm.json()).result.adjustment,0);
  assert.equal(adjusts(f.db).length,0);
  assert.deepEqual(audits(f.db).map(x=>x.action),['stocktake.create','stocktake.confirm']);
});
test('ledger changed after count rejects confirmation and leaves data untouched',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  f.ledger(5);
  const created=await f.write(owner,'stocktake.create',draft(f,7));
  const id=(await created.json()).result.id;
  f.ledger(2);
  const outcome=await f.write(owner,'stocktake.confirm',{id,expected_status:'pending'});
  assert.equal(outcome.status,409);
  assert.equal(f.db.prepare('SELECT status FROM stocktakes WHERE id=?').get(id).status,'pending');
  assert.equal(stock(f.db),7);assert.equal(adjusts(f.db).length,0);
  assert.deepEqual(audits(f.db).map(x=>x.action),['stocktake.create']);
});
test('manager cannot confirm another store; staff cannot confirm any store',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),
    manager=await f.login('manager'),staff=await f.login('staff');
  const other=await f.write(owner,'stocktake.create',{...draft(f,3),location_id:f.ids.b});
  assert.equal(other.status,200);
  const id=(await other.json()).result.id;
  assert.equal((await f.write(manager,'stocktake.confirm',{
    id,expected_status:'pending'})).status,404);
  assert.equal((await f.write(staff,'stocktake.confirm',{
    id,expected_status:'pending'})).status,403);
  assert.equal((await f.write(staff,'stocktake.create',{
    ...draft(f,2),location_id:f.ids.b})).status,409);
  assert.equal(adjusts(f.db).length,0);
});
test('out-of-range quantity, extra keys, malformed CSRF and stale status fail',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const qty of [-1,1000000.001,0.00001,'3',null,NaN,Infinity]){
    assert.equal((await f.write(owner,'stocktake.create',draft(f,qty))).status,400);
  }
  assert.equal((await f.write(owner,'stocktake.create',{...draft(f),extra:1})).status,400);
  assert.equal((await f.write(owner,'stocktake.create',draft(f),{
    headers:{'x-csrf-token':'invalid'}})).status,403);
  assert.equal((await f.write(owner,'stocktake.confirm',{
    id:randomUUID(),expected_status:'done'})).status,400);
  assert.equal(takeCount(f.db),0);
});
test('late store grant removal blocks confirm and preserves pending status + audit',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare('DELETE FROM user_locations WHERE user_id=? AND location_id=?')
      .run(f.ids.manager,f.ids.a);
  }});
  const owner=await f.login('owner'),manager=await f.login('manager');
  const created=await f.write(owner,'stocktake.create',draft(f,1));
  const id=(await created.json()).result.id;
  revoke=true;
  const result=await f.write(manager,'stocktake.confirm',{id,expected_status:'pending'});
  assert.equal(result.status,409);
  assert.equal(f.db.prepare('SELECT status FROM stocktakes WHERE id=?').get(id).status,'pending');
  assert.deepEqual(audits(f.db).map(x=>x.action),['stocktake.create']);
  assert.equal(adjusts(f.db).length,0);
});
test('D1 adjustment failure rolls back stocktake status, move and confirm audit',async t=>{
  const opt={failAt:2},f=await fixture(t,opt),owner=await f.login('owner');
  f.ledger(10);
  const created=await f.write(owner,'stocktake.create',draft(f,5));
  const id=(await created.json()).result.id;
  opt.failNow=true;
  assert.equal((await f.write(owner,'stocktake.confirm',{
    id,expected_status:'pending'})).status,503);
  assert.equal(f.db.prepare('SELECT status FROM stocktakes WHERE id=?').get(id).status,'pending');
  assert.equal(stock(f.db),10);assert.equal(adjusts(f.db).length,0);
  assert.deepEqual(audits(f.db).map(x=>x.action),['stocktake.create']);
});
test('stocktake gate defaults off in real Wrangler config and blocks all writes',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const env of [{...f.env,CLOUD_AUTH_PHASE:'disabled'},
    {...f.env,CLOUD_NATIVE_LOGIN_GATE:undefined},
    {...f.env,CLOUD_NATIVE_STOCKTAKE_WRITE_GATE:undefined}]){
    const res=await f.write(owner,'stocktake.create',draft(f),{env});
    assert.equal(res.status,503);assert.equal((await res.json()).code,'E_NOT_READY');
  }
  const status=await f.send('/api/native/status',{},{
    ...f.env,CLOUD_NATIVE_STOCKTAKE_WRITE_GATE:undefined});
  assert.equal((await status.json()).stocktake_write_enabled,false);
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(config.keep_vars,true);
  assert.equal(Object.hasOwn(config,'vars'),false);
  assert.equal(Object.hasOwn(config.vars??{},'CLOUD_NATIVE_STOCKTAKE_WRITE_GATE'),false);
  assert.equal(takeCount(f.db),0);
});
