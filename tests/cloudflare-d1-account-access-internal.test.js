'use strict';
// Synthetic D1/SQLite account authorization tests. No real Worker route/DB.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const authPromise=import('../cloudflare/auth-core.mjs');
const accessPromise=import('../cloudflare/account-access-internal.mjs');
const migration=fs.readFileSync(path.join(__dirname,'..','cloudflare','migrations','0001_initial_v3.sql'),'utf8');
const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'..','docs','native-account-admin-api-contract-v1.json'),'utf8'));

function adapter(db,opt={}){
  const make=(sql,args=[])=>({
    first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})
  });
  return {prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(statements){
      if(opt.beforeBatch)opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');
      try{
        const results=[];
        for(let i=0;i<statements.length;i++){
          if(opt.failAt===i)throw Error('SYNTHETIC_D1_TRANSACTION_FAILURE');
          results.push(await statements[i].run());
        }
        db.exec('COMMIT');return results;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }};
}
async function fixture(t,opt={}){
  const auth=await authPromise,db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(migration);
  const ids={actor:randomUUID(),target:randomUUID(),manager:randomUUID(),
    storeA:randomUUID(),storeB:randomUUID()};
  for(const [id,name] of [[ids.storeA,'Synthetic A'],[ids.storeB,'Synthetic B']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  for(const [id,username,role] of [
    [ids.actor,'owner','owner'],[ids.target,'employee','staff'],
    [ids.manager,'manager','manager']]){
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(id,username,username,role,'fake-salt','fake-hash');
  }
  db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
    .run(ids.target,ids.storeA);
  const cookies={},csrf={};
  async function session(label,userId){
    const token=auth.freshSessionToken();
    cookies[label]=auth.SESSION_COOKIE+'='+token;
    csrf[label]=auth.freshSessionToken();
    db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
      .run(await auth.tokenSha256(token),csrf[label],userId,
        new Date(Date.now()+3600000).toISOString());
    return token;
  }
  await session('owner',ids.actor);
  await session('first',ids.target);
  await session('second',ids.target);
  await session('manager',ids.manager);
  const DB=adapter(db,opt),env={
    CLOUD_AUTH_PHASE:'preview-readonly',ACCOUNT_SECURITY_STAGE:'internal-test-only',DB
  };
  const req=(label='owner',headers={})=>new Request(
    'https://private.example/internal-account-operation',{
      method:'POST',headers:{cookie:cookies[label],origin:'https://private.example',
        'x-csrf-token':csrf[label],...headers}
    });
  return {auth,db,ids,env,req,session,cookies,csrf};
}
const account=(f,id=f.ids.target)=>f.db.prepare('SELECT role,active FROM users WHERE id=?').get(id);
const sessions=(f,id=f.ids.target)=>f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(id).n;
const grants=(f,id=f.ids.target)=>f.db.prepare('SELECT location_id FROM user_locations WHERE user_id=? ORDER BY location_id').all(id).map(x=>x.location_id);
const logs=(f)=>f.db.prepare("SELECT action,actor_id,entity_id,location_id,detail FROM audit_logs ORDER BY rowid").all();
const run=async(f,input,label='owner')=>(await accessPromise).internalChangeD1AccountAccess(f.req(label),f.env,input);

test('role change revokes both sessions and writes secret-free audit',async t=>{
  const f=await fixture(t);
  const result=await run(f,{action:'user.role',targetUserId:f.ids.target,role:'manager'});
  assert.deepEqual(result,{status:200,code:'OK',revokedSessions:2});
  assert.equal(account(f).role,'manager');
  assert.equal(sessions(f),0);
  assert.equal(sessions(f,f.ids.actor),1);
  const audit=logs(f);
  assert.equal(audit.length,1);
  assert.equal(audit[0].action,'user.role');
  assert.equal(audit[0].actor_id,f.ids.actor);
  assert.deepEqual(JSON.parse(audit[0].detail),
    {from:'staff',to:'manager',revoked_sessions:2});
  assert.doesNotMatch(JSON.stringify(audit),/__Host-|token_hash|csrf_token|fake-hash/);
  assert.deepEqual(await run(f,{action:'user.role',targetUserId:f.ids.target,role:'manager'}),
    {status:409,code:'E_NO_CHANGE'});
  assert.equal(logs(f).length,1);
});

test('deactivation revokes sessions; reactivation changes state with zero stale sessions',async t=>{
  const f=await fixture(t);
  const disable={action:'user.active',targetUserId:f.ids.target,active:false};
  assert.deepEqual(await run(f,disable),{status:200,code:'OK',revokedSessions:2});
  assert.equal(account(f).active,0);
  assert.equal(sessions(f),0);
  assert.equal(JSON.parse(logs(f)[0].detail).revoked_sessions,2);
  assert.equal((await f.auth.loadPrincipal(f.env.DB,f.req('first'))),null);
  assert.deepEqual(await run(f,{...disable,active:true}),
    {status:200,code:'OK',revokedSessions:0});
  assert.equal(account(f).active,1);
  assert.equal(sessions(f),0);
  assert.deepEqual(JSON.parse(logs(f)[1].detail),
    {active:1,revoked_sessions:0});
});

test('new and removed store grants revoke sessions; duplicate edits are harmless',async t=>{
  const f=await fixture(t);
  const grant={action:'user.assign-location',targetUserId:f.ids.target,locationId:f.ids.storeB};
  assert.deepEqual(await run(f,grant),{status:200,code:'OK',revokedSessions:2});
  assert.deepEqual(grants(f).sort(),[f.ids.storeA,f.ids.storeB].sort());
  assert.deepEqual(JSON.parse(logs(f)[0].detail),
    {new_assignment:1,revoked_sessions:2});
  assert.deepEqual(await run(f,grant),{status:409,code:'E_NO_CHANGE'});
  await f.session('third',f.ids.target);
  const remove={...grant,action:'user.unassign-location'};
  assert.deepEqual(await run(f,remove),{status:200,code:'OK',revokedSessions:1});
  assert.deepEqual(grants(f),[f.ids.storeA]);
  assert.deepEqual(JSON.parse(logs(f)[1].detail),
    {removed_assignment:1,revoked_sessions:1});
  assert.equal(sessions(f),0);
  assert.deepEqual(await run(f,remove),{status:409,code:'E_NO_CHANGE'});
  assert.equal(logs(f).length,2);
});

test('inactive target, self-demotion, nonowner, missing stage and invalid requests are denied',async t=>{
  const f=await fixture(t);
  const role={action:'user.role',targetUserId:f.ids.target,role:'manager'};
  const svc=(await accessPromise).internalChangeD1AccountAccess;
  for(const env of [{...f.env,CLOUD_AUTH_PHASE:'disabled'},
      {...f.env,ACCOUNT_SECURITY_STAGE:'disabled'}])
    assert.equal((await svc(f.req(),env,role)).status,503);
  assert.equal((await svc(f.req('manager'),f.env,role)).status,403);
  assert.equal((await svc(f.req('owner',{origin:'https://evil.invalid'}),f.env,role)).status,403);
  assert.equal((await svc(f.req('owner',{'x-csrf-token':f.csrf.manager}),f.env,role)).status,403);
  assert.equal((await svc(f.req('owner',{cookie:''}),f.env,role)).status,401);
  assert.equal((await svc(f.req(),f.env,{...role,extra:'ignored'})).status,400);
  assert.equal((await svc(f.req(),f.env,{...role,targetUserId:'bad'})).status,400);
  assert.equal((await svc(f.req(),f.env,{...role,role:'administrator'})).status,400);
  assert.equal((await svc(f.req(),f.env,{action:'user.active',targetUserId:f.ids.actor,active:false})).status,403);
  assert.equal((await svc(f.req(),f.env,{action:'user.role',targetUserId:f.ids.actor,role:'staff'})).status,403);
  f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.target);
  assert.equal((await svc(f.req(),f.env,role)).status,409);
  const store={action:'user.assign-location',targetUserId:f.ids.target,locationId:f.ids.storeB};
  assert.equal((await svc(f.req(),f.env,store)).status,409);
  assert.equal(logs(f).length,0);
  assert.equal(sessions(f),2);
});

test('batch-time race denies stale owner role, session, target snapshot and store state',async t=>{
  for(const race of ['owner-role','owner-session','target-role','target-active','store-added','store-disabled']){
    const f=await fixture(t);
    const cookie=f.cookies.owner.split('=')[1],tokenHash=await f.auth.tokenSha256(cookie);
    f.env.DB=adapter(f.db,{beforeBatch(){
      if(race==='owner-role')f.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ids.actor);
      if(race==='owner-session')f.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash);
      if(race==='target-role')f.db.prepare("UPDATE users SET role='manager' WHERE id=?").run(f.ids.target);
      if(race==='target-active')f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.target);
      if(race==='store-added')f.db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(f.ids.target,f.ids.storeB);
      if(race==='store-disabled')f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeB);
    }});
    const op=['store-added','store-disabled'].includes(race)?
      {action:'user.assign-location',targetUserId:f.ids.target,locationId:f.ids.storeB}:
      {action:'user.role',targetUserId:f.ids.target,role:'owner'};
    assert.deepEqual(await run(f,op),{status:409,code:'E_CONCURRENT_CHANGE'},race);
    assert.equal(logs(f).length,0,race);
    assert.equal(sessions(f),2,race);
  }
});

test('transaction error rolls back audit, role/grant changes, and session deletion',async t=>{
  for(const action of ['user.role','user.assign-location','user.active']){
    const f=await fixture(t,{failAt:2});
    const before=account(f),oldGrants=grants(f);
    const input=action==='user.role'?{action,targetUserId:f.ids.target,role:'manager'}:
      action==='user.active'?{action,targetUserId:f.ids.target,active:false}:
      {action,targetUserId:f.ids.target,locationId:f.ids.storeB};
    assert.deepEqual(await run(f,input),{status:503,code:'E_ACCOUNT_UNAVAILABLE'});
    assert.deepEqual(account(f),before,action);
    assert.deepEqual(grants(f),oldGrants,action);
    assert.equal(sessions(f),2,action);
    assert.equal(logs(f).length,0,action);
  }
});


test('v1 contract: each D1 account-access action is Owner-only even with store access',async t=>{
  const examples={
    'user.role':f=>({action:'user.role',targetUserId:f.ids.target,role:'manager'}),
    'user.active':f=>({action:'user.active',targetUserId:f.ids.target,active:false}),
    'user.assign-location':f=>({action:'user.assign-location',targetUserId:f.ids.target,locationId:f.ids.storeB}),
    'user.unassign-location':f=>({action:'user.unassign-location',targetUserId:f.ids.target,locationId:f.ids.storeA})
  };
  const actions=Object.keys(contract.actions).filter(action=>action!=='user.password');
  assert.deepEqual([...actions].sort(),Object.keys(examples).sort());
  for(const action of actions){
    const f=await fixture(t);
    f.db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
      .run(f.ids.manager,f.ids.storeA);
    const payload=examples[action](f),before=account(f),oldGrants=grants(f);
    assert.deepEqual(Object.keys(payload).sort(),contract.actions[action].fields,action);
    assert.equal(contract.actions[action].role,'owner');
    for(const role of ['manager','first']){
      const res=await run(f,payload,role);
      assert.deepEqual(res,{status:403,code:'E_FORBIDDEN'},action+':'+role);
      assert.deepEqual(account(f),before,action+':'+role);
      assert.deepEqual(grants(f),oldGrants,action+':'+role);
      assert.equal(sessions(f),2,action+':'+role);
      assert.equal(logs(f).length,0,action+':'+role);
    }
    const positive=await run(f,payload,'owner');
    assert.deepEqual(positive,{status:200,code:'OK',revokedSessions:2},action);
    assert.equal(sessions(f),0,action);
    assert.equal(logs(f).length,1,action);
    assert.equal(logs(f)[0].action,contract.actions[action].audit_action,action);
    assert.equal(JSON.parse(logs(f)[0].detail).revoked_sessions,2,action);
  }
});

test('v1 contract: malformed action types or extra fields never produce D1 writes',async t=>{
  const f=await fixture(t);
  const inputs=[
    {action:'user.role',targetUserId:f.ids.target,role:'owner',extra:1},
    {action:'user.role',targetUserId:[f.ids.target],role:'manager'},
    {action:'user.active',targetUserId:f.ids.target,active:'false'},
    {action:'user.assign-location',targetUserId:f.ids.target,locationId:[f.ids.storeB]},
    {action:'user.unassign-location',targetUserId:f.ids.target,locationId:null},
    {action:'user.no-such-action',targetUserId:f.ids.target},
    {action:'user.role',targetUserId:f.ids.target,role:'administrator'}
  ];
  for(const input of inputs){
    const res=await run(f,input);
    assert.deepEqual(res,{status:400,code:'E_INVALID_INPUT'},String(input.action));
  }
  assert.equal(sessions(f),2);
  assert.equal(logs(f).length,0);
  assert.equal(account(f).role,'staff');
  assert.equal(account(f).active,1);
  assert.deepEqual(grants(f),[f.ids.storeA]);
});

test('transaction-time actor CSRF, expiry and deactivation block all access actions',async t=>{
  const commands=[
    x=>({action:'user.role',targetUserId:x.ids.target,role:'manager'}),
    x=>({action:'user.active',targetUserId:x.ids.target,active:false}),
    x=>({action:'user.assign-location',targetUserId:x.ids.target,locationId:x.ids.storeB}),
    x=>({action:'user.unassign-location',targetUserId:x.ids.target,locationId:x.ids.storeA})
  ];
  for(const race of ['csrf-rotated','session-expired','owner-deactivated']){
    for(const input of commands){
      const f=await fixture(t),accountBefore=account(f),grantsBefore=grants(f);
      const token=f.cookies.owner.split('=')[1],digest=await f.auth.tokenSha256(token);
      f.env.DB=adapter(f.db,{beforeBatch(){
        if(race==='csrf-rotated')
          f.db.prepare('UPDATE sessions SET csrf_token=? WHERE token_hash=?')
            .run('synthetic-rotated-csrf',digest);
        if(race==='session-expired')
          f.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?')
            .run('2000-01-01T00:00:00.000Z',digest);
        if(race==='owner-deactivated')
          f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.actor);
      }});
      assert.deepEqual(await run(f,input(f)),
        {status:409,code:'E_CONCURRENT_CHANGE'},race);
      assert.deepEqual(account(f),accountBefore,race);
      assert.deepEqual(grants(f),grantsBefore,race);
      assert.equal(sessions(f),2,race);
      assert.equal(logs(f).length,0,race);
    }
  }
});


const createAccount=async(f,patch={})=>(await accessPromise).internalCreateD1Account(
  f.req(),f.env,{username:'newstaff',displayName:'測試員工',
    initialPassword:'synthetic-password-123456',role:'staff',
    locationIds:[f.ids.storeA],...patch});

test('P0 synthetic Owner create: PBKDF2 user + store + audit are one transaction',async t=>{
  const f=await fixture(t),auth=await authPromise;
  const out=await createAccount(f);
  assert.equal(out.status,201);
  assert.deepEqual(out.user.location_ids,[f.ids.storeA]);
  const row=f.db.prepare("SELECT * FROM users WHERE username='newstaff'").get();
  assert.equal(row.role,'staff');assert.equal(row.active,1);
  assert.ok(await auth.verifyWorkerPassword('synthetic-password-123456',
    row.password_salt,row.password_hash));
  assert.deepEqual(grants(f,row.id),[f.ids.storeA]);
  const a=logs(f);
  assert.equal(a.length,1);assert.equal(a[0].action,'user.create');
  assert.deepEqual(JSON.parse(a[0].detail),{role:'staff',assigned_locations:1});
  assert.doesNotMatch(JSON.stringify(a)+JSON.stringify(out),
    /synthetic-password-123456|password_hash|password_salt|pbkdf2-sha256/);
  assert.deepEqual(await createAccount(f),{status:409,code:'E_ACCOUNT_EXISTS'});
  assert.equal(logs(f).length,1);
});

test('P0 synthetic Owner create: Owner-only, unique username, live stores and denied Owner promotion',async t=>{
  const f=await fixture(t),svc=(await accessPromise).internalCreateD1Account;
  assert.equal((await createAccount(f,{role:'owner'})).status,400);
  assert.equal((await createAccount(f,{username:'owner'})).status,409);
  assert.equal((await createAccount(f,{locationIds:[f.ids.storeA,f.ids.storeA]})).status,400);
  assert.equal((await createAccount(f,{locationIds:[randomUUID()]})).status,400);
  assert.equal((await createAccount(f,{initialPassword:'short'})).status,400);
  assert.equal((await createAccount(f,{displayName:'\n'})).status,400);
  assert.equal((await svc(f.req('manager'),f.env,{username:'bad',displayName:'B',
    initialPassword:'synthetic-password-123456',role:'manager',
    locationIds:[f.ids.storeA]})).status,403);
  assert.equal((await createAccount({...f,env:{...f.env,CLOUD_AUTH_PHASE:'native-production'}})).status,503);
  assert.equal((await createAccount({...f,env:{...f.env,ACCOUNT_SECURITY_STAGE:'off'}})).status,503);
  assert.equal(logs(f).length,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,3);
});

test('P0 synthetic Owner create: role/session/store race and forced batch failure roll back',async t=>{
  const auth=await authPromise;
  for(const race of ['owner-demoted','owner-session-revoked','store-deactivated','duplicate','batch-failure']){
    const f=await fixture(t);
    const token=await auth.tokenSha256(f.cookies.owner.split('=')[1]);
    f.env.DB=adapter(f.db,{failAt:race==='batch-failure'?2:undefined,beforeBatch(){
      if(race==='owner-demoted')
        f.db.prepare("UPDATE users SET role='manager' WHERE id=?").run(f.ids.actor);
      if(race==='owner-session-revoked')
        f.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(token);
      if(race==='store-deactivated')
        f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
      if(race==='duplicate')
        f.db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
          .run(randomUUID(),'NEWSTAFF','Other','staff','salt','hash');
    }});
    const res=await createAccount(f);
    assert.equal(res.status,503,race);
    assert.equal(logs(f).length,0,race);
    assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username='newstaff'").get().n,
      race==='duplicate'?1:0,race);
  }
});


test('P0 synthetic create: naturally expiring Owner Session is rejected at D1 batch time',async t=>{
  const f=await fixture(t),auth=await authPromise;
  const digest=await auth.tokenSha256(f.cookies.owner.split('=')[1]);
  // The initial Principal lookup sees a live Session. The 1.4s queued
  // batch delay crosses expiry; D1 itself must reject, without partial write.
  f.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?')
    .run(new Date(Date.now()+900).toISOString(),digest);
  f.env.DB=adapter(f.db,{beforeBatch(){
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1400);
  }});
  const out=await createAccount(f);
  assert.equal(out.status,503);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM users WHERE username='newstaff'").get().n,0);
  assert.equal(logs(f).length,0);
});
