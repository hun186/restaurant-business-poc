'use strict';
// No live Cloudflare requests. SQLite simulates the documented Worker D1 batch contract.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const worker=import('../cloudflare/owner-recovery-local-worker.mjs');
const core=import('../cloudflare/owner-recovery-atomic-internal.mjs');
const recovery=import('../tools/cloudflare-prod-owner-password-recovery.mjs');
const auth=import('../cloudflare/auth-core.mjs');
const owner='61d29848-4153-4d0a-8db2-bfaee0d6f625';
const approval='RESET_EXISTING_OWNER_PASSWORD_ONCE';
const uuid='a1b2c3d4-1111-4222-8333-abcdef123456';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 db.exec('CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);');
 db.exec("INSERT INTO d1_migrations VALUES('0001_initial_v3.sql'),('0002_login_attempts_window_indexes.sql')");
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-original','合成門市');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('ing-original','SYN-1','測試食材','包');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?,1)')
  .run(owner,'owner','合成業主','owner','a'.repeat(32),'pbkdf2-sha256$100000$'+'b'.repeat(64));
 db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)')
  .run('bootstrap','production-bootstrap','auth.owner_bootstrap','users',owner,
   '{"hash_version":"pbkdf2-sha256$100000"}');
 db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
  .run('session','csrf',owner,new Date(Date.now()+1e8).toISOString());
 return db;
}
function binding(db){
 const stmt=(sql,args=[])=>({
  sql,args,
  bind(...values){return stmt(sql,values);},
  async all(){return {results:db.prepare(sql).all(...args)};},
  async first(){return db.prepare(sql).get(...args);}
 });
 return {
  prepare(sql){return stmt(sql);},
  async batch(stmts){
   assert.equal(stmts.length,3);
   db.exec('BEGIN IMMEDIATE');
   try{
    const results=stmts.map(s=>({meta:{changes:db.prepare(s.sql).run(...s.args).changes}}));
    db.exec('COMMIT');return results;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
 };
}
const count=(db,t)=>db.prepare('SELECT COUNT(*) n FROM '+t).get().n;
const credentials=async()=>(await auth).hashWorkerPassword('new-synthetic-owner-password-1234');
const original=db=>({owner_id:owner,...db.prepare(
 "SELECT password_salt,password_hash FROM users WHERE username='owner'").get()});
test('Worker binding atomic reset revokes sessions and audits, preserving business rows',async t=>{
 const db=fixture(t),c=await core,a=await auth,secret=await credentials();
 const old=original(db);
 const result=await c.atomicOwnerRecovery(binding(db),old,secret,uuid);
 assert.equal(result.atomic_binding_batch,true);
 assert.equal(count(db,'users'),1);assert.equal(count(db,'sessions'),0);
 assert.equal(count(db,'locations'),1);assert.equal(count(db,'ingredients'),1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.password_reset'").get().n,1);
 const after=original(db);
 assert.notEqual(after.password_hash,old.password_hash);
 assert.equal(await a.verifyWorkerPassword('new-synthetic-owner-password-1234',
   after.password_salt,after.password_hash),true);
});
test('synthetic failure in final audit statement rolls back password and all Session changes',async t=>{
 const db=fixture(t),c=await core,secret=await credentials(),before=original(db);
 db.exec("CREATE TRIGGER refuse_reset BEFORE INSERT ON audit_logs WHEN NEW.action='auth.password_reset' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
 await assert.rejects(c.atomicOwnerRecovery(binding(db),before,secret,uuid));
 assert.deepEqual(original(db),before);
 assert.equal(count(db,'sessions'),1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.password_reset'").get().n,0);
});
test('invalid approval and malformed credentials never send a D1 batch',async t=>{
 const db=fixture(t),c=await core,secret=await credentials(),before=original(db);
 let calls=0;
 const deny={prepare:()=>{throw Error('unexpected prepare');},batch:()=>{calls++;}};
 await assert.rejects(c.atomicOwnerRecovery(deny,before,secret,'bad-audit'));
 await assert.rejects(c.atomicOwnerRecovery(deny,before,secret,{uuid}));
 assert.equal(calls,0);assert.equal(count(db,'sessions'),1);
});
test('localhost Worker rejects remote Host, browser Origin, missing mode and other methods',async t=>{
 const db=fixture(t),w=await worker;
 const env={DB:binding(db),RECOVERY_LOCAL_MODE:'operator-loopback-only'};
 const post=(url,extra={})=>new Request(url,{method:'POST',
  headers:{host:new URL(url).host,...extra},body:'{}'});
 const dangerous=[
  post('https://public.example.test/__recovery/inspect'),
  post('http://127.0.0.1:8787/__recovery/inspect',{origin:'https://other.site'}),
 ];
 for(const request of dangerous)
  assert.equal((await w.handleLocalRecovery(request,env)).status,403);
 assert.equal((await w.handleLocalRecovery(
  post('http://127.0.0.1:8787/__recovery/inspect'),{DB:env.DB})).status,403);
 const result=await w.handleLocalRecovery(
  post('http://127.0.0.1:8787/__recovery/inspect'),env);
 assert.equal(result.status,200);
 assert.equal((await result.json()).code,'OWNER_RECOVERY_PRECHECK_PASS');
 assert.equal(count(db,'sessions'),1);
});
test('loopback Worker performs confirmed atomic recovery and never echoes private credentials',async t=>{
 const db=fixture(t),w=await worker,secret=await credentials();
 const body=JSON.stringify({approval,audit_id:uuid,...secret});
 const req=new Request('http://127.0.0.1:8787/__recovery/reset',{method:'POST',
  headers:{host:'127.0.0.1:8787','content-type':'application/json',
   'content-length':String(Buffer.byteLength(body))},body});
 const res=await w.handleLocalRecovery(req,{DB:binding(db),
  RECOVERY_LOCAL_MODE:'operator-loopback-only'});
 assert.equal(res.status,200);
 const output=await res.text();
 assert.equal(JSON.parse(output).code,'OWNER_RECOVERY_ATOMIC_VERIFIED');
 for(const value of [secret.password_hash,secret.password_salt,
  'new-synthetic-owner-password-1234'])assert.equal(output.includes(value),false);
 assert.equal(count(db,'sessions'),0);
});
test('REST write path stays disabled and local recovery never enters GitHub Actions',async()=>{
 const r=await recovery;
 await assert.rejects(r.resetExistingProductionOwner(),e=>e.message==='E_PROD_OWNER_PASSWORD_RECOVERY');
 const script=fs.readFileSync(path.join(root,'tools/cloudflare-prod-owner-password-recovery.mjs'),'utf8');
 const publicWorker=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
 const config=JSON.parse(fs.readFileSync(path.join(root,
  'cloudflare/wrangler.owner-recovery.local.jsonc'),'utf8'));
 assert.match(script,/UNSAFE_REST_DISABLED/);
 assert.match(script,/127\.0\.0\.1/);
 assert.doesNotMatch(publicWorker,/owner-recovery-local-worker|__recovery/);
 assert.equal(config.d1_databases[0].remote,true);
 assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
 const cmd=spawnSync(process.execPath,[path.join(root,
  'tools/cloudflare-prod-owner-password-recovery.mjs'),'--reset'],
  {cwd:root,input:'',encoding:'utf8',timeout:10000});
 assert.notEqual(cmd.status,0);
 assert.doesNotMatch(cmd.stderr,/Bearer|token_hash|password_salt|password_hash/i);
});
