'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const base=path.join(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(base,'wrangler.jsonc'),'utf8'));
const workerPromise=import('../cloudflare/worker.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
const pepper='synthetic-IP-source-pepper-32-characters-only';
const URL='https://restaurant.example.workers.dev';

function dbFixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync(path.join(base,'db/schema.sql'),'utf8'));
 db.exec('CREATE TABLE cloud_schema_contract(id INTEGER PRIMARY KEY,contract_version INTEGER NOT NULL); INSERT INTO cloud_schema_contract VALUES(1,3);');
 const prepare=sql=>{
  const bound=(args)=>({
   first:async()=>db.prepare(sql).get(...args),
   all:async()=>({results:db.prepare(sql).all(...args)}),
   run:async()=>({meta:db.prepare(sql).run(...args)})
  });
  return {...bound([]),bind(...args){return bound(args);}};
 };
 const adapter={prepare,async batch(statements){
  db.exec('BEGIN');try{
   const result=[];
   for(const stmt of statements)result.push(await stmt.run());
   db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }};
 return {db,adapter};
}
function request(route,opts={},edge=true){
 const r=new Request(URL+route,opts);
 if(edge)Object.defineProperty(r,'cf',{value:{colo:'TPE'},configurable:true});
 return r;
}
const origin=URL;
const form=(username='owner',password='example-password-123')=>request('/api/login',{method:'POST',headers:{
 'content-type':'application/json','origin':origin,'sec-fetch-site':'same-origin','CF-Connecting-IP':'198.51.100.18'
},body:JSON.stringify({username,password})});
const enabled=(db)=>({...config.vars,DB:db,CLOUD_AUTH_PHASE:'native-production',CLOUD_NATIVE_LOGIN_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:pepper});

test('native login remains 503 with production/preview config and missing each independent gate',async()=>{
 const worker=(await workerPromise).default;
 const f=dbFixture();
 try{
  const cases=[{...config.vars,DB:f.adapter},{...config.previews.vars,DB:f.adapter},
   {...enabled(f.adapter),CLOUD_AUTH_PHASE:'disabled'},
   {...enabled(f.adapter),CLOUD_NATIVE_LOGIN_GATE:'disabled'},
   {...enabled(f.adapter),NATIVE_AUTH_SOURCE_PEPPER:'short'},
   {...enabled(f.adapter),DB:undefined}];
  for(const env of cases){
   const r=await worker.fetch(form(),env);
   assert.equal(r.status,503);
   assert.equal((await r.json()).code,'E_NOT_READY');
   assert.equal((await worker.fetch(request('/api/me'),env)).status,
     env.CLOUD_AUTH_PHASE==='preview-readonly'?401:503);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,0);
 }finally{f.db.close();}
});

test('synthetic owner logs in, sees own identity and revokes session with same-origin CSRF',async()=>{
 const worker=(await workerPromise).default, auth=await authPromise;
 const f=dbFixture();
 try{
  const pass='example-password-123';
  const stored=await auth.hashWorkerPassword(pass);
  f.db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
    .run('synthetic-owner','owner','合成業主','owner',stored.password_salt,stored.password_hash);
  const r=await worker.fetch(form(),enabled(f.adapter));
  assert.equal(r.status,200);
  const cookie=r.headers.get('set-cookie');
  assert.match(cookie,/^__Host-restaurant_session=[A-Za-z0-9_-]{43};/);
  assert.match(cookie,/; Secure; HttpOnly; SameSite=Strict;/);
  const body=await r.json();
  assert.equal(body.user.username,'owner');
  assert.match(body.csrf,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE success=1').get().n,1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='auth.login'").get().n,1);
  const token=cookie.split(';')[0];
  const me=await worker.fetch(request('/api/me',{headers:{cookie:token}}),enabled(f.adapter));
  assert.equal(me.status,200);
  assert.equal((await me.json()).user.role,'owner');
  assert.equal((await worker.fetch(request('/api/logout',{method:'POST',headers:{
    cookie:token,origin:'https://elsewhere.example','x-csrf-token':body.csrf}}),enabled(f.adapter))).status,403);
  const out=await worker.fetch(request('/api/logout',{method:'POST',headers:{
   cookie:token,origin,'x-csrf-token':body.csrf,'sec-fetch-site':'same-origin'}}),enabled(f.adapter));
  assert.equal(out.status,200);
  assert.match(out.headers.get('set-cookie'),/Max-Age=0$/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  assert.equal((await worker.fetch(request('/api/me',{headers:{cookie:token}}),enabled(f.adapter))).status,401);
 }finally{f.db.close();}
});

test('native login rejects cross-origin, spoofed/unknown source, malformed or oversize body, wrong methods',async()=>{
 const worker=(await workerPromise).default,f=dbFixture();
 try{
  const env=enabled(f.adapter);
  const cases=[
   request('/api/login',{method:'GET'}),
   request('/api/login?x=1',{method:'POST',headers:{origin},body:'{}'}),
   request('/api/login',{method:'POST',headers:{origin:'https://evil.example','content-type':'application/json'},body:'{}'}),
   request('/api/login',{method:'POST',headers:{origin,'sec-fetch-site':'cross-site','content-type':'application/json'},body:'{}'}),
   request('/api/login',{method:'POST',headers:{origin,'content-type':'text/plain'},body:'{}'}),
   request('/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:'{bad'}),
   request('/api/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:'x'.repeat(2049)}),
   request('/api/login',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':'1.2.3.4'},body:JSON.stringify({username:'owner',password:'example-password-123'})},false),
   request('/api/login',{method:'POST',headers:{origin,'content-type':'application/json','CF-Connecting-IP':'198.51.100.2'},body:JSON.stringify({username:'owner',password:'example-password-123'})},false)
  ];
  for(const x of cases)assert.notEqual((await worker.fetch(x,env)).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,0);
 }finally{f.db.close();}
});

test('native release gate refuses uninitialized production D1 instead of creating tables or owner',async()=>{
 const worker=(await workerPromise).default,f=dbFixture();
 try{
  f.db.exec('DROP TABLE cloud_schema_contract');
  const r=await worker.fetch(form(),enabled(f.adapter));
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'E_AUTH_UNAVAILABLE');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
 }finally{f.db.close();}
});
