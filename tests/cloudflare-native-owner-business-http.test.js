'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const workerPromise=import('../cloudflare/worker.mjs'),authPromise=import('../cloudflare/auth-core.mjs');
const pepper='synthetic-IP-source-pepper-32-characters-only';
function d1(db){
  const make=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})});
  return {prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(statements){db.exec('BEGIN IMMEDIATE');try{
      const output=[];for(const stmt of statements)output.push(await stmt.run());
      db.exec('COMMIT');return output;
    }catch(e){db.exec('ROLLBACK');throw e;}}};
}
async function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
  const {hashWorkerPassword}=await authPromise;
  const password='owner-example-12345',hash=await hashWorkerPassword(password);
  const owner='123e4567-e89b-12d3-a456-426614174000',
    manager='123e4567-e89b-12d3-a456-426614174001',
    a='123e4567-e89b-12d3-a456-426614174002',
    b='123e4567-e89b-12d3-a456-426614174003';
  for(const [id,name] of [[a,'虛構A店'],[b,'虛構B店']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  for(const [id,name,role] of [[owner,'owner','owner'],[manager,'manager','manager']])
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(id,name,'測試'+name,role,hash.password_salt,hash.password_hash);
  db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(manager,a);
  for(const [id,store] of [['tA',a],['tB',b]])
    db.prepare('INSERT INTO tasks(id,location_id,title) VALUES(?,?,?)').run(id,store,'合成工作');
  const env={DB:d1(db),CLOUD_AUTH_PHASE:'native-production',
    CLOUD_NATIVE_LOGIN_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:pepper,
    ASSETS:{fetch:async()=>new Response('STATIC')}};
  const worker=(await workerPromise).default;
  const send=(route,init={},override=env)=>{
    const r=new Request(site+route,init);Object.defineProperty(r,'cf',{value:{colo:'TPE'}});
    return worker.fetch(r,override);
  };
  async function login(username){
    const res=await send('/api/login',{method:'POST',headers:{
      origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
      'CF-Connecting-IP':'198.51.100.18'
    },body:JSON.stringify({username,password})});
    assert.equal(res.status,200);
    return {cookie:res.headers.get('set-cookie').split(';')[0],data:await res.json()};
  }
  return {db,env,send,login,owner,a,b};
}
test('production still disabled by default and native status rejects demo credentials',async t=>{
  const f=await fixture(t),config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
  assert(config.assets.run_worker_first.includes('/'));
  for(const env of [{...f.env,CLOUD_AUTH_PHASE:'disabled'},
                    {...f.env,CLOUD_NATIVE_LOGIN_GATE:undefined}]){
    for(const route of ['/api/data?entity=tasks','/api/overview']){
      const response=await f.send(route,{},env);
      assert.equal(response.status,503,route);
    }
    const response=await f.send('/api/native/status',{},env);
    assert.deepEqual(await response.json(),{mode:'demo',login_enabled:false,task_write_enabled:false,catalog_write_enabled:false,order_write_enabled:false});
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
});
test('native Owner login -> real D1 dashboard and role-scoped rows',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager');
  assert.deepEqual(await (await f.send('/api/native/status')).json(),{mode:'native',login_enabled:true,task_write_enabled:false,catalog_write_enabled:false,order_write_enabled:false});
  const me=await f.send('/api/me',{headers:{cookie:owner.cookie}});
  assert.equal((await me.json()).user.role,'owner');
  const summary=await f.send('/api/overview',{headers:{cookie:owner.cookie}});
  assert.equal(summary.status,200);
  assert.equal((await summary.json()).metrics.open_tasks,2);
  for(const [who,expected] of [[owner,['tA','tB']],[manager,['tA']]]){
    const result=await f.send('/api/data?entity=tasks',{headers:{cookie:who.cookie}});
    assert.equal(result.status,200);
    assert.equal(result.headers.get('cache-control'),'private, no-store, max-age=0');
    const body=await result.json();assert.equal(body.mode,'native_d1');
    assert.deepEqual(body.rows.map(r=>r.id).sort(),expected);
  }
  for(const entity of ['users','audit_logs','staff_directory']){
    assert.equal((await f.send('/api/data?entity='+entity,{headers:{cookie:owner.cookie}})).status,404);
  }
  assert.equal((await f.send('/api/data?entity=tasks',{method:'POST',body:'{}'})).status,405);
  assert.equal((await f.send('/api/overview?debug=1',{headers:{cookie:owner.cookie}})).status,400);
  assert.equal((await f.send('/api/overview')).status,401);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='task.status'").get().n,0);
});
test('active root routes to real application but disabled mode keeps demo',async t=>{
  const f=await fixture(t),r=await f.send('/');
  assert.equal(r.status,302);
  assert.equal(r.headers.get('location'),'/owner-app.html');
  const demo=await f.send('/',{}, {...f.env,CLOUD_AUTH_PHASE:'disabled'});
  assert.equal(await demo.text(),'STATIC');
  const html=fs.readFileSync(path.join(root,'vercel-demo/owner-app.html'),'utf8');
  const browser=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
  assert.match(html,/id="login-form"/);
  assert.match(browser,/\/api\/native\/status/);
  assert.doesNotMatch(html,/mock\.js|sessionStorage|demo-reset/);
  assert.doesNotMatch(browser,/mock\.js|sessionStorage|localStorage/);
});
test('revoked owner immediately loses access; D1 schema mismatch stays unavailable',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.owner);
  assert.equal((await f.send('/api/overview',{headers:{cookie:owner.cookie}})).status,401);
  f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(f.owner);
  f.db.prepare('DELETE FROM cloud_schema_contract').run();
  const r=await f.send('/api/data?entity=tasks',{headers:{cookie:owner.cookie}});
  assert.equal(r.status,503);assert.equal((await r.json()).code,'E_SCHEMA_NOT_READY');
});