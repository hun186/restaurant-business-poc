'use strict';
// Synthetic SQLite/D1 only. Never invoke a Cloudflare remote binding or login.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const authPromise=import('../cloudflare/auth-core.mjs');
const securityPromise=import('../cloudflare/account-security-internal.mjs');
const root=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');

function d1Adapter(db,opt={}){
  const make=(sql,args=[])=>({
    first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})
  });
  return {
    prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(statements){
      if(opt.beforeBatch)opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');
      try{
        const results=[];
        for(let i=0;i<statements.length;i++){
          if(opt.failAt===i)throw Error('SYNTHETIC_BATCH_FAILURE');
          results.push(await statements[i].run());
        }
        db.exec('COMMIT');return results;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }
  };
}
async function fixture(t,opt={}){
  const auth=await authPromise,db=new DatabaseSync(':memory:');
  t.after(()=>db.close());db.exec(migration);
  const actor=randomUUID(),target=randomUUID();
  for(const [id,username,role,password] of [
    [actor,'owner','owner','owner-old-password-12345'],
    [target,'employee','staff','staff-old-password-12345']
  ]){
    const hash=await auth.hashWorkerPassword(password);
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(id,username,username,role,hash.password_salt,hash.password_hash);
  }
  const cookies={},csrf={};
  for(const [who,id] of [['actor',actor],['target',target],['target2',target]]){
    const token=auth.freshSessionToken();
    csrf[who]=auth.freshSessionToken();
    cookies[who]=auth.SESSION_COOKIE+'='+token;
    db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
      .run(await auth.tokenSha256(token),csrf[who],id,new Date(Date.now()+3600000).toISOString());
  }
  const DB=d1Adapter(db,opt),env={
    CLOUD_AUTH_PHASE:'preview-readonly',ACCOUNT_SECURITY_STAGE:'internal-test-only',DB
  };
  const req=(headers={})=>new Request('https://private.example/internal-account-operation',{
    method:'POST',headers:{cookie:cookies.actor,origin:'https://private.example',
      'x-csrf-token':csrf.actor,...headers}
  });
  return {auth,db,DB,env,actor,target,cookies,csrf,req};
}
const row=(db,id)=>db.prepare('SELECT role,active,password_hash,password_salt FROM users WHERE id=?').get(id);
const sessionCount=(db,id)=>db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(id).n;
const auditRows=db=>db.prepare("SELECT actor_id,entity_id,detail FROM audit_logs WHERE action='user.password'").all();

test('internal D1 password rotation revokes both old sessions and audits only their count',async t=>{
  const f=await fixture(t),svc=await securityPromise;
  const old=row(f.db,f.target),password='new-strong-password-12345';
  const out=await svc.internalRotateD1Password(f.req(),f.env,{targetUserId:f.target,newPassword:password});
  assert.deepEqual(out,{status:200,code:'OK',revokedSessions:2});
  assert.equal(sessionCount(f.db,f.target),0);
  assert.equal(sessionCount(f.db,f.actor),1);
  assert.notEqual(row(f.db,f.target).password_hash,old.password_hash);
  assert.equal(await f.auth.verifyWorkerPassword(password,row(f.db,f.target).password_salt,row(f.db,f.target).password_hash),true);
  assert.equal(await f.auth.verifyWorkerPassword('staff-old-password-12345',row(f.db,f.target).password_salt,row(f.db,f.target).password_hash),false);
  const audit=auditRows(f.db);
  assert.equal(audit.length,1);
  assert.equal(audit[0].actor_id,f.actor);
  assert.equal(audit[0].entity_id,f.target);
  assert.deepEqual(JSON.parse(audit[0].detail),{password_changed:true,revoked_sessions:2});
  assert.doesNotMatch(JSON.stringify(audit),/new-strong-password|staff-old-password|pbkdf2|__Host-/);
});

test('internal D1 self-rotation revokes owner session after successful audit',async t=>{
  const f=await fixture(t),svc=await securityPromise;
  const out=await svc.internalRotateD1Password(f.req(),f.env,{
    targetUserId:f.actor,newPassword:'owner-rotated-password-9876'});
  assert.deepEqual(out,{status:200,code:'OK',revokedSessions:1});
  assert.equal(sessionCount(f.db,f.actor),0);
  assert.deepEqual(JSON.parse(auditRows(f.db)[0].detail),
    {password_changed:true,revoked_sessions:1});
  assert.equal(await f.auth.loadPrincipal(f.DB,f.req()),null);
});

test('internal D1 account rotation refuses disabled gate, no session or wrong CSRF',async t=>{
  const f=await fixture(t),svc=await securityPromise;
  const original=row(f.db,f.target);
  const args={targetUserId:f.target,newPassword:'new-strong-password-12345'};
  assert.equal((await svc.internalRotateD1Password(f.req(),
    {...f.env,ACCOUNT_SECURITY_STAGE:'disabled'},args)).status,503);
  assert.equal((await svc.internalRotateD1Password(f.req(),
    {...f.env,CLOUD_AUTH_PHASE:'disabled'},args)).status,503);
  assert.equal((await svc.internalRotateD1Password(f.req({'x-csrf-token':f.csrf.target}),f.env,args)).status,403);
  assert.equal((await svc.internalRotateD1Password(f.req({origin:'https://evil.invalid'}),f.env,args)).status,403);
  assert.equal((await svc.internalRotateD1Password(f.req({cookie:''}),f.env,args)).status,401);
  assert.equal((await svc.internalRotateD1Password(f.req(),f.env,{...args,newPassword:'short'})).status,400);
  f.db.prepare("UPDATE users SET role='manager' WHERE id=?").run(f.actor);
  assert.equal((await svc.internalRotateD1Password(f.req(),f.env,args)).status,403);
  assert.deepEqual(row(f.db,f.target),original);
  assert.equal(sessionCount(f.db,f.target),2);
  assert.equal(auditRows(f.db).length,0);
});

test('D1 batch rechecks owner, target credentials, activation and revoked principal',async t=>{
  const svc=await securityPromise;
  for(const race of ['actor-role','actor-revoked','target-password','target-disabled']){
    const f=await fixture(t);
    const old=row(f.db,f.target);
    const token=f.cookies.actor.split('=')[1],hash=await f.auth.tokenSha256(token);
    f.env.DB=d1Adapter(f.db,{beforeBatch(){
      if(race==='actor-role')f.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.actor);
      if(race==='actor-revoked')f.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
      if(race==='target-password')f.db.prepare("UPDATE users SET password_hash='rotated-by-other' WHERE id=?").run(f.target);
      if(race==='target-disabled')f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.target);
    }});
    const res=await svc.internalRotateD1Password(f.req(),f.env,{
      targetUserId:f.target,newPassword:'updated-password-12345678'});
    assert.deepEqual(res,{status:409,code:'E_CONCURRENT_CHANGE'},race);
    assert.equal(auditRows(f.db).length,0,race);
    assert.equal(sessionCount(f.db,f.target),2,race);
    if(race!=='target-password')assert.equal(row(f.db,f.target).password_hash,old.password_hash,race);
  }
});

test('failed D1 batch rolls back audit and password update without revoking sessions',async t=>{
  const f=await fixture(t),svc=await securityPromise;
  const old=row(f.db,f.target);
  f.env.DB=d1Adapter(f.db,{failAt:2});
  const out=await svc.internalRotateD1Password(f.req(),f.env,{
    targetUserId:f.target,newPassword:'safe-new-password-45678'});
  assert.deepEqual(out,{status:503,code:'E_ACCOUNT_UNAVAILABLE'});
  assert.deepEqual(row(f.db,f.target),old);
  assert.equal(sessionCount(f.db,f.target),2);
  assert.equal(auditRows(f.db).length,0);
});


test('v1 contract: password rotation rejects manager and staff with no side effects',async t=>{
  const spec=JSON.parse(fs.readFileSync(path.join(root,'docs/native-account-admin-api-contract-v1.json'),'utf8'));
  const f=await fixture(t),svc=await securityPromise;
  assert.equal(spec.actions['user.password'].role,'owner');
  assert.deepEqual(spec.actions['user.password'].fields,
    ['action','newPassword','targetUserId']);
  const previous=row(f.db,f.target),actorBefore=row(f.db,f.actor);
  const args={targetUserId:f.target,newPassword:'synthetic-rotated-password-12345'};
  for(const role of ['manager','staff']){
    f.db.prepare('UPDATE users SET role=? WHERE id=?').run(role,f.actor);
    const res=await svc.internalRotateD1Password(f.req(),f.env,args);
    assert.deepEqual(res,{status:403,code:'E_FORBIDDEN'},role);
    assert.deepEqual(row(f.db,f.target),previous);
    assert.equal(sessionCount(f.db,f.target),2);
    assert.equal(auditRows(f.db).length,0);
  }
  f.db.prepare('UPDATE users SET role=? WHERE id=?').run(actorBefore.role,f.actor);
  const allowed=await svc.internalRotateD1Password(f.req(),f.env,args);
  assert.deepEqual(allowed,{status:200,code:'OK',revokedSessions:2});
  assert.equal(sessionCount(f.db,f.target),0);
  assert.equal(auditRows(f.db).length,1);
  assert.equal(JSON.parse(auditRows(f.db)[0].detail).revoked_sessions,2);
  assert.doesNotMatch(JSON.stringify(auditRows(f.db)),/synthetic-rotated-password-12345/);
});
