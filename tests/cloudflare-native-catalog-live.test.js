'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const site='https://restaurant.example.workers.dev';
const pepper='synthetic-IP-source-pepper-32-characters-only';
const root=path.join(__dirname,'..');
const workerPromise=import('../cloudflare/worker.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
function adapter(db,opt={}){
  const call=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})});
  return {prepare(sql){return {...call(sql),bind:(...args)=>call(sql,args)};},
    async batch(statements){
      if(opt.beforeBatch)opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');
      try{
        const out=[];
        for(let i=0;i<statements.length;i++){
          if(opt.failNow&&i===opt.failAt)throw Error('SYNTHETIC_BATCH_FAILED');
          out.push(await statements[i].run());
        }
        db.exec('COMMIT');return out;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }};
}
async function fixture(t,opt={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
  const auth=await authPromise;
  const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
    store:randomUUID()};
  const hash=await auth.hashWorkerPassword('synthetic-owner-pass-123');
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(ids.store,'測試既有門市');
  for(const [role,id] of [['owner',ids.owner],['manager',ids.manager],['staff',ids.staff]]){
    db.prepare(
      'INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)'
    ).run(id,role,'測試'+role,role,hash.password_salt,hash.password_hash);
    if(role!=='owner')db.prepare(
      'INSERT INTO user_locations(user_id,location_id) VALUES(?,?)'
    ).run(id,ids.store);
  }
  const env={DB:adapter(db,opt),CLOUD_AUTH_PHASE:'native-production',
    CLOUD_NATIVE_LOGIN_GATE:'operator-released',
    CLOUD_NATIVE_CATALOG_WRITE_GATE:'operator-released',
    NATIVE_AUTH_SOURCE_PEPPER:pepper};
  const worker=(await workerPromise).default;
  function send(route,init={},e=env){
    const req=new Request(site+route,init);
    Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
    return worker.fetch(req,e);
  }
  async function login(username){
    const response=await send('/api/login',{method:'POST',headers:{
      origin:site,'content-type':'application/json',
      'sec-fetch-site':'same-origin','CF-Connecting-IP':'198.51.100.16'
    },body:JSON.stringify({username,password:'synthetic-owner-pass-123'})});
    assert.equal(response.status,200);
    const info=await response.json();
    return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:info.csrf};
  }
  function write(login,action,data,opts={}){
    return send('/api/catalog',{method:'POST',headers:{
      'content-type':'application/json','sec-fetch-site':'same-origin',
      origin:site,cookie:login.cookie,'x-csrf-token':login.csrf,...opts.headers
    },body:opts.body??JSON.stringify({action,data})},opts.env||env);
  }
  return {db,ids,env,send,login,write};
}
const count=(db,table)=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const audits=db=>db.prepare(
  "SELECT action,entity,entity_id FROM audit_logs WHERE action IN ('location.create','ingredient.create') ORDER BY rowid"
).all();
test('Owner creates first-class store + ingredient with D1 rows and atomic audits',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  const store=await f.write(owner,'location.create',{name:'虛構新店'});
  assert.equal(store.status,200);const id=(await store.json()).result.id;
  assert.equal(f.db.prepare('SELECT name FROM locations WHERE id=?').get(id).name,'虛構新店');
  const ing=await f.write(owner,'ingredient.create',{
    sku:'ONION_001',name:'洋蔥',unit:'公斤',min_stock:2.25});
  assert.equal(ing.status,200);const product=(await ing.json()).result;
  assert.equal(f.db.prepare('SELECT min_stock FROM ingredients WHERE id=?')
    .get(product.id).min_stock,2.25);
  assert.deepEqual(audits(f.db).map(x=>x.action),['location.create','ingredient.create']);
  const stores=await f.send('/api/data?entity=locations',{headers:{cookie:owner.cookie}});
  assert((await stores.json()).rows.some(x=>x.id===id));
  const ingredients=await f.send('/api/data?entity=ingredients',{headers:{cookie:owner.cookie}});
  assert((await ingredients.json()).rows.some(x=>x.id===product.id));
});
test('different write gate states reject before mutation and preserve native status',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const env of [{...f.env,CLOUD_AUTH_PHASE:'disabled'},
    {...f.env,CLOUD_NATIVE_CATALOG_WRITE_GATE:undefined},
    {...f.env,CLOUD_NATIVE_LOGIN_GATE:undefined}]){
    const res=await f.write(owner,'location.create',{name:'Do not create'},{env});
    assert.equal(res.status,503);
    assert.equal((await res.json()).code,'E_NOT_READY');
  }
  const status=await f.send('/api/native/status',{},{
    ...f.env,CLOUD_NATIVE_CATALOG_WRITE_GATE:undefined});
  const info=await status.json();
  assert.equal(info.catalog_write_enabled,false);
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(Object.hasOwn(config.vars,'CLOUD_NATIVE_CATALOG_WRITE_GATE'),false);
  assert.equal(count(f.db,'locations'),1);assert.equal(audits(f.db).length,0);
});
test('staff and manager cannot create shared catalogue or a store',async t=>{
  const f=await fixture(t),manager=await f.login('manager'),staff=await f.login('staff');
  for(const identity of [manager,staff]){
    assert.equal((await f.write(identity,'location.create',{name:'Staff shop'})).status,403);
    assert.equal((await f.write(identity,'ingredient.create',{
      sku:'BAD',name:'No',unit:'kg'})).status,403);
  }
  assert.equal(count(f.db,'ingredients'),0);
  assert.equal(audits(f.db).length,0);
});
test('reject invalid keys, quantities, empty values, duplicate SKU/store and CSRF',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const data of [{sku:'bad sku',name:'N',unit:'kg'},
    {sku:'A',name:'',unit:'kg'}, {sku:'A',name:'x',unit:'kg',min_stock:-1},
    {sku:'A',name:'x',unit:'kg',min_stock:0.00001},
    {sku:'A',name:'x',unit:'kg',min_stock:1e8},
    {sku:'A',name:'x',unit:'kg',extra:1}]){
    assert.equal((await f.write(owner,'ingredient.create',data)).status,400);
  }
  assert.equal((await f.write(owner,'location.create',{name:' '})).status,400);
  assert.equal((await f.write(owner,'location.create',{name:'測試既有門市'})).status,409);
  assert.equal((await f.write(owner,'ingredient.create',{
    sku:'DUP',name:'Dup',unit:'pcs'})).status,200);
  assert.equal((await f.write(owner,'ingredient.create',{
    sku:'DUP',name:'Dup again',unit:'pcs'})).status,409);
  assert.equal((await f.write(owner,'location.create',{name:'Unauthorized'},{
    headers:{'x-csrf-token':'invalid'}})).status,403);
  assert.equal(count(f.db,'locations'),1);
  assert.equal(count(f.db,'ingredients'),1);
  assert.equal(audits(f.db).length,1);
});
test('Owner role revoked immediately before D1 batch leaves no store or audit',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare('UPDATE users SET role=? WHERE id=?')
      .run('staff',f.ids.owner);
  }});
  const owner=await f.login('owner');revoke=true;
  const res=await f.write(owner,'location.create',{name:'Blocked'});
  assert.equal(res.status,409);
  assert.equal(count(f.db,'locations'),1);
  assert.equal(audits(f.db).length,0);
});
test('synthetic D1 audit write exception rolls back new ingredient',async t=>{
  const opt={failAt:1},f=await fixture(t,opt),owner=await f.login('owner');
  opt.failNow=true;
  const res=await f.write(owner,'ingredient.create',{
    sku:'ROLLBACK',name:'Test',unit:'kg'});
  assert.equal(res.status,503);
  assert.equal(count(f.db,'ingredients'),0);
  assert.equal(audits(f.db).length,0);
});
