'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

const root=path.join(__dirname,'..');
const modulePromise=import('../cloudflare/auth-core.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));

function fakeD1(db) {
  return {prepare(sql) {
    return {bind(...args) {
      return {
        first: async()=>db.prepare(sql).get(...args),
        all: async()=>({results:db.prepare(sql).all(...args)}),
      };
    }};
  }};
}
async function databaseForUser(role='staff') {
  const auth=await modulePromise;
  const db=new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root,'db/schema.sql'),'utf8'));
  const uid='unit-test-user',store='store-a';
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(store,'測試門市A');
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-b','測試門市B');
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
    .run(uid,'user','虛構員工',role,'unused','unused');
  db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(uid,store);
  const session=auth.freshSessionToken(), csrf=auth.freshSessionToken();
  const hash=await auth.tokenSha256(session),exp=new Date(Date.now()+3600000).toISOString();
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run(hash,csrf,uid,exp);
  return {db,session,csrf,hash,uid,store};
}
const request=(path,init={})=>new Request('https://example.workers.dev'+path,init);

test('Worker PBKDF2 password hashing uses distinct, versioned format without changing Node scrypt', async()=>{
  const auth=await modulePromise;
  const password=auth.freshSessionToken();
  const a=await auth.hashWorkerPassword(password),b=await auth.hashWorkerPassword(password);
  assert.match(a.password_salt,/^[a-f0-9]{32}$/);
  assert.match(a.password_hash,/^pbkdf2-sha256\$600000\$[a-f0-9]{64}$/);
  assert.notEqual(a.password_salt,b.password_salt);
  assert.notEqual(a.password_hash,b.password_hash);
  assert.equal(await auth.verifyWorkerPassword(password,a.password_salt,a.password_hash),true);
  assert.equal(await auth.verifyWorkerPassword(auth.freshSessionToken(),a.password_salt,a.password_hash),false);
  assert.equal(await auth.verifyWorkerPassword(password,a.password_salt,'scrypt-legacy-hash'),false);
  assert.equal(await auth.verifyWorkerPassword(password,'invalid',a.password_hash),false);
  await assert.rejects(()=>auth.hashWorkerPassword('too-short'),/E_PASSWORD_LENGTH/);
});

test('random session token and Secure Host-only cookie cannot be parsed twice',async()=>{
  const auth=await modulePromise;
  const token=auth.freshSessionToken();
  assert.match(token,/^[A-Za-z0-9_-]{43}$/);
  assert.match(await auth.tokenSha256(token),/^[a-f0-9]{64}$/);
  assert.match(auth.sessionCookie(token),/^__Host-restaurant_session=/);
  assert.match(auth.sessionCookie(token),/; Secure; HttpOnly; SameSite=Strict;/);
  assert.match(auth.expiredSessionCookie(),/Max-Age=0$/);
  assert.equal(auth.readSessionCookie(request('/api/me',{headers:{cookie:auth.SESSION_COOKIE+'='+token}})),token);
  assert.equal(auth.readSessionCookie(request('/api/me',{headers:{cookie:auth.SESSION_COOKIE+'='+token+'; '+auth.SESSION_COOKIE+'='+token}})),null);
  assert.equal(auth.readSessionCookie(request('/api/me',{headers:{cookie:auth.SESSION_COOKIE+'=bad-token'}})),null);
});

test('D1 read-only session lookup rechecks active status, expiry, role and assigned location',async()=>{
  const auth=await modulePromise;
  const f=await databaseForUser();
  try {
    const req=request('/api/me',{headers:{cookie:auth.SESSION_COOKIE+'='+f.session}});
    const principal=await auth.loadPrincipal(fakeD1(f.db),req);
    assert.equal(principal?.id,f.uid);
    assert.deepEqual(principal.locations,[f.store]);
    assert.equal(auth.hasAccess(principal,'staff',f.store),true);
    assert.equal(auth.hasAccess(principal,'staff','store-b'),false);
    assert.equal(auth.hasAccess(principal,'manager',f.store),false);
    f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.uid);
    assert.equal(await auth.loadPrincipal(fakeD1(f.db),req),null);
    f.db.prepare('UPDATE users SET active=1 WHERE id=?').run(f.uid);
    f.db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run('2020-01-01T00:00:00Z',f.hash);
    assert.equal(await auth.loadPrincipal(fakeD1(f.db),req),null);
  }finally {f.db.close();}
});

test('role elevation and cross-store requests are denied; owner can manage scoped stores',async()=>{
  const auth=await modulePromise;
  const f=await databaseForUser('manager');
  try {
    const req=request('/api/me',{headers:{cookie:auth.SESSION_COOKIE+'='+f.session}});
    const p=await auth.loadPrincipal(fakeD1(f.db),req);
    assert.equal(auth.hasAccess(p,'manager',f.store),true);
    assert.equal(auth.hasAccess(p,'manager','store-b'),false);
    assert.equal(auth.hasAccess(p,'owner',f.store),false);
    assert.equal(auth.hasAccess(null,'staff',f.store),false);
    f.db.prepare('UPDATE users SET role=? WHERE id=?').run('owner',f.uid);
    const owner=await auth.loadPrincipal(fakeD1(f.db),req);
    assert.equal(auth.hasAccess(owner,'owner','store-b'),true);
    f.db.prepare('UPDATE users SET role=? WHERE id=?').run('staff',f.uid);
    const lowered=await auth.loadPrincipal(fakeD1(f.db),req);
    assert.equal(auth.hasAccess(lowered,'manager',f.store),false);
  }finally {f.db.close();}
});

test('mutation helper checks same-origin, CSRF, role, method and store scope',async()=>{
  const auth=await modulePromise, f=await databaseForUser('manager');
  try{
    const req=request('/api/command',{method:'POST',headers:{origin:'https://example.workers.dev','x-csrf-token':f.csrf,cookie:auth.SESSION_COOKIE+'='+f.session}});
    const p=await auth.loadPrincipal(fakeD1(f.db),req);
    assert.equal(auth.authorizedMutation(req,p,'manager',f.store),true);
    assert.equal(auth.authorizedMutation(req,p,'manager','store-b'),false);
    assert.equal(auth.authorizedMutation(req,p,'owner',f.store),false);
    assert.equal(auth.authorizedMutation(request('/api/command',{method:'GET',headers:{origin:'https://example.workers.dev','x-csrf-token':f.csrf}}),p,'manager',f.store),false);
    assert.equal(auth.authorizedMutation(request('/api/command',{method:'POST',headers:{origin:'https://attacker.example','x-csrf-token':f.csrf}}),p,'manager',f.store),false);
    assert.equal(auth.authorizedMutation(request('/api/command',{method:'POST',headers:{'x-csrf-token':f.csrf}}),p,'manager',f.store),false);
    assert.equal(auth.authorizedMutation(request('/api/command',{method:'POST',headers:{origin:'https://example.workers.dev','x-csrf-token':auth.freshSessionToken()}}),p,'manager',f.store),false);
  }finally{f.db.close();}
});

test('Production /api/me remains disabled even with valid D1 cookie; Preview is read-only',async()=>{
  const auth=await modulePromise,worker=(await workerPromise).default,f=await databaseForUser('staff');
  const assets={fetch:async()=>new Response('demo')};
  try{
    assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
    assert.equal(config.previews.vars.CLOUD_AUTH_PHASE,'preview-readonly');
    assert.notEqual(config.d1_databases[0].database_id,config.previews.d1_databases[0].database_id);
    const req=request('/api/me',{headers:{cookie:auth.SESSION_COOKIE+'='+f.session}});
    let res=await worker.fetch(req,{ASSETS:assets,DB:fakeD1(f.db),...config.vars});
    assert.equal(res.status,503);
    res=await worker.fetch(req,{ASSETS:assets,DB:fakeD1(f.db),...config.previews.vars});
    assert.equal(res.status,200);
    const body=await res.json();
    assert.equal(body.user.role,'staff');
    assert.deepEqual(body.user.locations,[f.store]);
    assert.equal(body.csrf,f.csrf);
    const noCookie=await worker.fetch(request('/api/me'),{ASSETS:assets,DB:fakeD1(f.db),...config.previews.vars});
    assert.equal(noCookie.status,401);
    const login=await worker.fetch(request('/api/login',{method:'POST',body:'{}'}),{ASSETS:assets,DB:fakeD1(f.db),...config.previews.vars});
    assert.equal(login.status,503);
    assert.equal((await login.json()).code,'E_NOT_READY');
    const change=await worker.fetch(request('/api/command',{method:'POST',body:'{}'}),{ASSETS:assets,DB:fakeD1(f.db),...config.previews.vars});
    assert.equal(change.status,503);
  }finally{f.db.close();}
});

test('Preview identity errors fail closed with no SQL details',async()=>{
  const worker=(await workerPromise).default;
  const auth=await modulePromise;
  const failDB={prepare(){throw new Error('SHOULD_NOT_LEAK_SQL')}};
  const res=await worker.fetch(request('/api/me',{headers:{cookie:auth.SESSION_COOKIE+'='+auth.freshSessionToken()}}),
    {CLOUD_AUTH_PHASE:'preview-readonly',DB:failDB});
  assert.equal(res.status,503);
  assert.doesNotMatch(await res.text(),/SHOULD_NOT_LEAK_SQL/);
});
