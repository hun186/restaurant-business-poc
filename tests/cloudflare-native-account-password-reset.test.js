'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const worker=import('../cloudflare/worker.mjs'),auth=import('../cloudflare/auth-core.mjs');
const site='https://reset.example.workers.dev',root=path.resolve(__dirname,'..');
const ownerPassword='synthetic-owner-password-123',oldPassword='synthetic-staff-old-password-123',newPassword='synthetic-staff-new-password-456';
async function fixture(t,opts={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
 for(const f of ['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'])
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations',f),'utf8'));
 const ids={},sessions={},a=await auth;
 for(const [name,role,pw] of [['owner','owner',ownerPassword],['staff','staff',oldPassword],['manager','manager',oldPassword],['otherOwner','owner',oldPassword]]){
  ids[name]=randomUUID();const hash=await a.hashWorkerPassword(pw);
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(ids[name],name,name,role,hash.password_salt,hash.password_hash);
  const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run(createHash('sha256').update(token).digest('hex'),csrf,ids[name],new Date(Date.now()+3600000).toISOString());
  sessions[name]={cookie:'__Host-restaurant_session='+token,csrf};
 }
 const stmt=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});
 const env={DB:{prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
  async batch(steps){
   opts.beforeBatch?.(db,steps);
   db.exec('BEGIN IMMEDIATE');
   try{const out=[];for(let i=0;i<steps.length;i++){
    if(steps.length===5&&opts.failAt===i)throw Error('SYNTHETIC_FAILURE');
    out.push(await steps[i].run());
   }db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
  }},CLOUD_AUTH_PHASE:'native-production',CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE:'operator-released',CLOUD_NATIVE_ACCOUNT_PASSWORD_RESET_WRITE_GATE:'operator-released',
  NATIVE_AUTH_SOURCE_PEPPER:'synthetic-reset-pepper-at-least-32'};
 const payload={targetUserId:ids.staff,currentOwnerPassword:ownerPassword,newPassword};
 const send=async({who='owner',body=payload,override=env,headers={},edge=true}={})=>{
  const s=sessions[who]??{};
  const req=new Request(site+'/api/accounts/password-reset',{method:'POST',
   headers:{origin:site,'sec-fetch-site':'same-origin','content-type':'application/json',
    'CF-Connecting-IP':'198.51.100.65',...(s.cookie?{cookie:s.cookie,'x-csrf-token':s.csrf}:{}),...headers},
   body:JSON.stringify(body)});
  if(edge)Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
  return (await worker).default.fetch(req,override);
 };
 const snapshot=()=>({users:db.prepare('SELECT * FROM users ORDER BY id').all(),
  sessions:db.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),
  audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all()});
 return {db,ids,sessions,env,payload,send,snapshot};
}
test('Owner reset rotates only active staff credentials, revokes all target sessions, and writes one redacted audit',async t=>{
 const f=await fixture(t),a=await auth,before=f.snapshot();
 f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
  .run('additional-session','synthetic-csrf',f.ids.staff,new Date(Date.now()+3600000).toISOString());
 const res=await f.send();assert.equal(res.status,200);
 assert.deepEqual(await res.json(),{code:'OK'});
 const target=f.db.prepare('SELECT * FROM users WHERE id=?').get(f.ids.staff);
 assert.equal(await a.verifyWorkerPassword(newPassword,target.password_salt,target.password_hash),true);
 assert.equal(await a.verifyWorkerPassword(oldPassword,target.password_salt,target.password_hash),false);
 assert.deepEqual(f.db.prepare('SELECT * FROM users WHERE id<>? ORDER BY id').all(f.ids.staff),before.users.filter(x=>x.id!==f.ids.staff));
 assert.deepEqual(f.db.prepare('SELECT * FROM sessions ORDER BY token_hash').all(),before.sessions.filter(x=>x.user_id!==f.ids.staff));
 const audit=f.db.prepare('SELECT * FROM audit_logs').all();assert.equal(audit.length,1);
 assert.equal(audit[0].entity_id,f.ids.staff);assert.equal(audit[0].actor_id,f.ids.owner);
 assert.equal(audit[0].action,'user.password_reset');assert.equal(audit[0].detail,'{}');
 assert.doesNotMatch(JSON.stringify(audit),/synthetic-(owner|staff)-|pbkdf2|password_hash|password_salt/);
 assert.equal(f.db.prepare('SELECT success FROM login_attempts').get().success,1);
});
test('Independent gates, Owner RBAC, source, CSRF, Origin and credential reauthentication deny before target mutation',async t=>{
 const f=await fixture(t),before=f.snapshot();
 for(const key of ['CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE','CLOUD_NATIVE_ACCOUNT_PASSWORD_RESET_WRITE_GATE','CLOUD_NATIVE_LOGIN_GATE'])
  assert.equal((await f.send({override:{...f.env,[key]:undefined}})).status,503);
 assert.equal((await f.send({who:'none'})).status,401);
 for(const who of ['staff','manager'])assert.equal((await f.send({who})).status,403);
 assert.equal((await f.send({headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.send({headers:{origin:'https://evil.invalid'}})).status,403);
 assert.equal((await f.send({edge:false})).status,503);
 assert.equal((await f.send({body:{...f.payload,currentOwnerPassword:'wrong-synthetic-password'}})).status,403);
 assert.equal((await f.send({body:{...f.payload,unknown:1}})).status,400);
 assert.deepEqual(f.snapshot(),before);
});
test('Owner/self and disabled target cannot reset; no change or audit',async t=>{
 const f=await fixture(t);
 f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
 const before=f.snapshot();
 for(const targetUserId of [f.ids.owner,f.ids.otherOwner,f.ids.staff])
  assert.equal((await f.send({body:{...f.payload,targetUserId}})).status,403);
 assert.deepEqual(f.snapshot(),before);
});
test('Failure at each of five batch boundaries rolls back target credential, sessions and audit',async t=>{
 for(let failAt=0;failAt<5;failAt++)await t.test('step '+failAt,async sub=>{
  const f=await fixture(sub,{failAt}),before=f.snapshot();
  assert.equal((await f.send()).status,503);
  assert.deepEqual(f.snapshot(),before);
 });
});
test('Owner revocation, target credential race, and target role promotion before batch fail closed',async t=>{
 for(const mode of ['session','credential','role'])await t.test(mode,async sub=>{
  let f,atRace;
  f=await fixture(sub,{beforeBatch(db,steps){
   if(steps.length!==5)return;
   if(mode==='session')db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.owner);
   if(mode==='credential')db.prepare("UPDATE users SET password_hash='concurrent-hash' WHERE id=?").run(f.ids.staff);
   if(mode==='role')db.prepare("UPDATE users SET role='owner' WHERE id=?").run(f.ids.staff);
   atRace=f.snapshot();
  }});
  assert.equal((await f.send()).status,503);assert.ok(atRace);assert.deepEqual(f.snapshot(),atRace);
 });
});
test('successful reset quota is enforced before reauthentication and inside atomic audit',async t=>{
 const f=await fixture(t);
 for(let i=0;i<5;i++)f.db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,detail) VALUES(?,?,?,'user.password_reset','users','{}')").run(randomUUID(),f.ids.owner,'owner');
 const before=f.snapshot();
 assert.equal((await f.send()).status,429);assert.deepEqual(f.snapshot(),before);
});

test('Owner-only account listing exposes reset capability only with both independent gates',async t=>{
 const f=await fixture(t),w=(await worker).default;
 for(const [admin,reset,expected] of [[false,false,false],[true,false,false],[false,true,false],[true,true,true]]){
  const env={...f.env,CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE:admin?'operator-released':undefined,
   CLOUD_NATIVE_ACCOUNT_PASSWORD_RESET_WRITE_GATE:reset?'operator-released':undefined};
  for(const who of ['owner','staff','manager']){
   const r=await w.fetch(new Request(site+'/api/accounts',{headers:{cookie:f.sessions[who].cookie,'sec-fetch-site':'same-origin'}}),env);
   assert.equal(r.status,who==='owner'?200:403);
   if(who==='owner'){
    const data=await r.json();assert.equal(data.can_reset_password,expected);
    assert.doesNotMatch(JSON.stringify(data),/password_hash|password_salt|csrf_token|token_hash/);
   }
  }
 }
});
