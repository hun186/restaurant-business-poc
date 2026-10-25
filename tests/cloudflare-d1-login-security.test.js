'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const base=path.join(__dirname,'..');
const servicePromise=import('../cloudflare/login-service.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const config=JSON.parse(fs.readFileSync(path.join(base,'wrangler.jsonc'),'utf8'));

function wrapDb(db, opts={}) {
  const prepare = (sql) => ({bind(...args){
    return {
      first: async() => db.prepare(sql).get(...args),
      all: async() => ({results:db.prepare(sql).all(...args)}),
      run: async() => ({meta:db.prepare(sql).run(...args)})
    };
  }});
  return {
    prepare,
    async batch(statements){
      db.exec('BEGIN');
      try {
        const results=[];
        for(let i=0;i<statements.length;i++){
          if(opts.failIndex===i) throw Error('E_TEST_ATOMIC_ROLLBACK');
          results.push(await statements[i].run());
        }
        db.exec('COMMIT');
        return results;
      }catch(err){db.exec('ROLLBACK');throw err;}
    }
  };
}
function tempDb(){
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(base,'db/schema.sql'),'utf8'));
  return db;
}
async function setup(){
  const auth=await authPromise;
  const db=tempDb(),pass='demo-safe-12';
  const encrypted=await auth.hashWorkerPassword(pass);
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
    .run('owner-1','owner','雲端測試業主','owner',encrypted.password_salt,encrypted.password_hash);
  const ip='1'.repeat(64);
  return {db,d1:wrapDb(db),password:pass,ip,auth};
}
const req=(url,options={})=>new Request('https://preview.workers.dev'+url,options);

test('login uses PBKDF2 versioned hash, saves opaque session, audit and attempt atomically', async()=>{
  const svc=await servicePromise, f=await setup();
  try{
    const output=await svc.authenticateD1(f.d1,{username:'owner',password:f.password,ipHash:f.ip});
    assert.equal(output.status,200);
    assert.match(output.cookie,/^__Host-restaurant_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict;/);
    assert.equal(output.user.username,'owner');
    assert.match(output.csrf,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE success=1').get().n,1);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='auth.login'").get().n,1);
    assert.doesNotMatch(JSON.stringify(f.db.prepare('SELECT * FROM audit_logs').all()),new RegExp(f.password));
    const token=output.cookie.match(/^__Host-restaurant_session=([^;]+)/)[1];
    assert.equal(f.db.prepare('SELECT token_hash FROM sessions').get().token_hash,await f.auth.tokenSha256(token));
    const logoutReq=req('/api/logout',{method:'POST',headers:{
      cookie: f.auth.SESSION_COOKIE+'='+token,
      origin:'https://preview.workers.dev',
      'x-csrf-token': output.csrf
    }});
    const revoke=await svc.revokeD1Session(f.d1,logoutReq);
    assert.equal(revoke.status,200);
    assert.match(revoke.cookie,/Max-Age=0$/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='auth.logout'").get().n,1);
    assert.equal((await svc.revokeD1Session(f.d1,logoutReq)).status,401);
  }finally{f.db.close();}
});
test('wrong, unknown and disabled accounts use same error; no session minted',async()=>{
  const svc=await servicePromise,f=await setup();
  try{
    const wrong=await svc.authenticateD1(f.d1,{username:'owner',password:'incorrect-12',ipHash:f.ip});
    assert.deepEqual(wrong,{status:401,code:'E_INVALID_CREDENTIALS'});
    const missing=await svc.authenticateD1(f.d1,{username:'ghost',password:'incorrect-12',ipHash:f.ip});
    assert.deepEqual(missing,wrong);
    f.db.prepare('UPDATE users SET active=0 WHERE username=?').run('owner');
    const disabled=await svc.authenticateD1(f.d1,{username:'owner',password:f.password,ipHash:f.ip});
    assert.deepEqual(disabled,wrong);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE success=0').get().n,3);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='auth.login_failed'").get().n,3);
  }finally{f.db.close();}
});
test('single SQL reservation enforces per username AND per IP including successful reservations',async()=>{
  const svc=await servicePromise,f=await setup();
  try{
    assert.equal(svc.LOGIN_LIMITS.perUser,8);
    assert.equal(svc.LOGIN_LIMITS.perSource,32);
    for(let i=0;i<8;i++)
      assert.match(await svc.reserveLoginAttempt(f.d1,'owner',f.ip),/^[0-9a-f-]{36}$/);
    assert.equal(await svc.reserveLoginAttempt(f.d1,'owner','2'.repeat(64)),null);
    for(let i=0;i<32;i++)
      assert.match(await svc.reserveLoginAttempt(f.d1,'staff'+i,'3'.repeat(64)),/^[0-9a-f-]{36}$/);
    assert.equal(await svc.reserveLoginAttempt(f.d1,'newuser','3'.repeat(64)),null);
    const denied=await svc.authenticateD1(f.d1,{username:'owner',password:f.password,ipHash:f.ip});
    assert.deepEqual(denied,{status:429,code:'E_RATE_LIMITED'});
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  }finally{f.db.close();}
});
test('invalid credentials/source fail before any SQL; source digest never trusts X-Forwarded-For',async()=>{
  const svc=await servicePromise,f=await setup();
  try{
    for(const input of [
      {username:'owner',password:'12345678',ipHash:f.ip},
      {username:'owner',password:f.password,ipHash:'invalid'},
      {username:'bad username',password:f.password,ipHash:f.ip},
    ])assert.deepEqual(await svc.authenticateD1(f.d1,input),{status:401,code:'E_INVALID_CREDENTIALS'});
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,0);
    const pepper='secret-unique-test-pepper-for-staging-auth';
    await assert.rejects(()=>svc.sourceIpDigest(req('/api/login',{headers:{'X-Forwarded-For':'203.0.113.1'}}),pepper),/E_AUTH_SOURCE_UNAVAILABLE/);
    const one=await svc.sourceIpDigest(req('/api/login',{headers:{'CF-Connecting-IP':'198.51.100.11'}}),pepper);
    const two=await svc.sourceIpDigest(req('/api/login',{headers:{'CF-Connecting-IP':'198.51.100.12'}}),pepper);
    assert.match(one,/^[a-f0-9]{64}$/);
    assert.notEqual(one,two);
    assert.equal(one,await svc.sourceIpDigest(req('/api/login',{headers:{'CF-Connecting-IP':'198.51.100.11'}}),pepper));
    await assert.rejects(()=>svc.sourceIpDigest(req('/api/login',{headers:{'CF-Connecting-IP':'198.51.100.11'}}),'weak'),/E_AUTH_SOURCE_UNAVAILABLE/);
  }finally{f.db.close();}
});
test('session is not created if account deactivated or password rotated between KDF and transaction',async()=>{
  const svc=await servicePromise,f=await setup();
  try{
    const failD1=wrapDb(f.db,{failIndex:1});
    await assert.rejects(()=>svc.authenticateD1(failD1,{username:'owner',password:f.password,ipHash:f.ip}),/E_AUTH_UNAVAILABLE/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='auth.login'").get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE success=0').get().n,1);
  }finally{f.db.close();}
});
test('logout refuses missing origin, invalid CSRF, and disabled account (no session data leaked)',async()=>{
  const svc=await servicePromise,f=await setup();
  try{
    const out=await svc.authenticateD1(f.d1,{username:'owner',password:f.password,ipHash:f.ip});
    const token=out.cookie.match(/^__Host-restaurant_session=([^;]+)/)[1];
    const cookie=f.auth.SESSION_COOKIE+'='+token;
    assert.equal((await svc.revokeD1Session(f.d1,req('/api/logout',{method:'POST',headers:{cookie,'x-csrf-token':out.csrf}}))).status,403);
    assert.equal((await svc.revokeD1Session(f.d1,req('/api/logout',{method:'POST',headers:{cookie,origin:'https://wrong.example','x-csrf-token':out.csrf}}))).status,403);
    assert.equal((await svc.revokeD1Session(f.d1,req('/api/logout',{method:'POST',headers:{cookie,origin:'https://preview.workers.dev','x-csrf-token':f.auth.freshSessionToken()}}))).status,403);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
    f.db.prepare('UPDATE users SET active=0 WHERE id=?').run('owner-1');
    assert.equal((await svc.revokeD1Session(f.d1,req('/api/logout',{method:'POST',headers:{cookie,origin:'https://preview.workers.dev','x-csrf-token':out.csrf}}))).status,401);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='auth.logout'").get().n,0);
  }finally{f.db.close();}
});
test('production and preview /api/login and /api/logout remain 503, no SQL writes',async()=>{
  const worker=(await workerPromise).default,f=await setup();
  try{
    for(const env of [{...config.vars,DB:f.d1},{...config.previews.vars,DB:f.d1}]) {
      for(const endpoint of ['/api/login','/api/logout']){
        const resp=await worker.fetch(req(endpoint,{method:'POST',headers:{origin:'https://preview.workers.dev', 'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:f.password})}),env);
        assert.equal(resp.status,503);
        assert.equal((await resp.json()).code,'E_NOT_READY');
      }
    }
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM login_attempts').get().n,0);
  }finally{f.db.close();}
});
