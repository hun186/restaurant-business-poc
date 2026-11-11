'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const recovery=import('../tools/cloudflare-prod-owner-password-recovery.mjs');
const core=import('../cloudflare/auth-core.mjs');
const token='synthetic-unprivileged-fixture-token-000000000';
function dbFixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 // 0001_initial_v3.sql already contains the v3 schema contract row.
 db.exec('CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);');
 db.exec("INSERT INTO d1_migrations VALUES('0001_initial_v3.sql'),('0002_login_attempts_window_indexes.sql')");
 const id='61d29848-4153-4d0a-8db2-bfaee0d6f625';
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-original','正常營運門市');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('ing-original','TEST-1','奶油球','包');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?,1)')
  .run(id,'owner','餐廳業主','owner','a'.repeat(32),'pbkdf2-sha256$100000$'+'b'.repeat(64));
 db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)')
  .run('bootstrap','production-bootstrap','auth.owner_bootstrap','users',id,
   '{"hash_version":"pbkdf2-sha256$100000"}');
 db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
  .run('synthetic-session','synthetic-csrf',id,new Date(Date.now()+10000000).toISOString());
 return {db,id};
}
function remote(db){
 const calls=[];
 const transport=async(url,opts)=>{
  assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[^/]+\/d1\/database\/[^/]+\/query$/);
  assert.equal(opts.method,'POST');
  const request=JSON.parse(opts.body);
  calls.push(request);
  const execute=({sql,params=[]})=>{
   const stmt=db.prepare(sql);
   if(/^\s*(SELECT|PRAGMA)/i.test(sql))return {success:true,results:stmt.all(...params)};
   return {success:true,results:[],meta:stmt.run(...params)};
  };
  const results=[];
  if(request.sql)results.push(execute(request));
  else if(Array.isArray(request.batch)){
   db.exec('BEGIN IMMEDIATE');
   try{
    for(const item of request.batch)results.push(execute(item));
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
  }else throw Error('unexpected D1 write mode');
  return {ok:true,status:200,json:async()=>({success:true,result:results})};
 };
 return {transport,calls};
}
const count=(db,t)=>db.prepare('SELECT COUNT(*) n FROM '+t).get().n;

test('only existing Owner with bootstrap and intact D1 can pass read-only precheck',async t=>{
 const f=dbFixture(t),r=await recovery,remoteD1=remote(f.db);
 const first=await r.inspectProductionOwnerRecovery(token,remoteD1.transport);
 assert.equal(first.total_owners,1);assert.equal(first.bootstrap_audits,1);
 assert.equal(first.active_session_rows,1);
 assert.equal(first.business_rows,2);
 assert(remoteD1.calls.every(c=>typeof c.sql==='string'&&!c.batch));
 assert.deepEqual(r.safeRecoverySummary(),{
  status:'PRODUCTION_OWNER_PASSWORD_RECOVERY_PRECHECK_PASS',
  schema_version:3,owner_count:1,write_performed:false,
  password_in_output:false,permission_to_reset_granted:false
 });
 assert.doesNotMatch(JSON.stringify(r.safeRecoverySummary()),/salt|hash|owner_id/i);
});

test('one approved D1 REST batch updates ONLY existing Owner, audits, revokes sessions, preserves business',async t=>{
 const f=dbFixture(t),r=await recovery,auth=await core,remoteD1=remote(f.db);
 const before=f.db.prepare("SELECT password_hash,password_salt FROM users WHERE username='owner'").get();
 const status=await r.resetExistingProductionOwner({
  token,newPassword:'new-safe-owner-password-12345',
  approval:r.RESET_APPROVAL,transport:remoteD1.transport
 });
 assert.equal(status.status,'PRODUCTION_OWNER_PASSWORD_RESET_VERIFIED');
 assert.equal(status.owner_count,1);
 assert.equal(status.write_batch_attempts,1);
 assert.equal(status.all_prior_owner_sessions_revoked,true);
 assert.equal(status.business_row_counts_unchanged,true);
 assert.equal(status.audit_recorded,true);
 const after=f.db.prepare("SELECT password_hash,password_salt FROM users WHERE username='owner'").get();
 assert.notEqual(before.password_hash,after.password_hash);
 assert.notEqual(before.password_salt,after.password_salt);
 assert.equal(await auth.verifyWorkerPassword('new-safe-owner-password-12345',
   after.password_salt,after.password_hash),true);
 assert.equal(count(f.db,'sessions'),0);
 assert.equal(count(f.db,'locations'),1);assert.equal(count(f.db,'ingredients'),1);
 assert.equal(count(f.db,'users'),1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.password_reset'").get().n,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.owner_bootstrap'").get().n,1);
 const batches=remoteD1.calls.filter(c=>Array.isArray(c.batch));
 assert.equal(batches.length,1);
 assert.equal(batches[0].batch.length,3);
 assert(batches[0].batch.every(x=>Array.isArray(x.params)));
 assert.doesNotMatch(JSON.stringify(status),/salt|hash|token|password/i);
});

test('never writes on invalid approval/password or ambiguous Owner/bootstrap/schema',async t=>{
 const f=dbFixture(t),r=await recovery,d1=remote(f.db);
 for(const input of [
  {token,newPassword:'new-safe-owner-password-12345',approval:'NO'},
  {token,newPassword:'tiny',approval:r.RESET_APPROVAL},
  {token,newPassword:'valid-but\u0000-injected',approval:r.RESET_APPROVAL}
 ]){
  await assert.rejects(r.resetExistingProductionOwner({...input,transport:d1.transport}));
 }
 assert.equal(d1.calls.filter(x=>x.batch).length,0);
 f.db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)')
  .run('duplicate-bootstrap','production-bootstrap','auth.owner_bootstrap','users',f.id,
    '{"hash_version":"pbkdf2-sha256$100000"}');
 await assert.rejects(r.resetExistingProductionOwner({
  token,newPassword:'new-safe-owner-password-12345',
  approval:r.RESET_APPROVAL,transport:d1.transport
 }));
 assert.equal(d1.calls.filter(x=>x.batch).length,0);
});

test('remote write uncertainty is never automatically retried',async t=>{
 const f=dbFixture(t),r=await recovery,d1=remote(f.db);
 let writes=0;
 const unreliable=async(url,opts)=>{
  if(Array.isArray(JSON.parse(opts.body).batch)){writes++;throw Error('simulated ambiguous network');}
  return d1.transport(url,opts);
 };
 await assert.rejects(r.resetExistingProductionOwner({
  token,newPassword:'a-new-safe-owner-password-12345',
  approval:r.RESET_APPROVAL,transport:unreliable
 }),e=>e.message==='E_PROD_OWNER_PASSWORD_RECOVERY'&&e.safeStage==='REMOTE_WRITE_UNCERTAIN');
 assert.equal(writes,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.password_reset'").get().n,0);
});

test('recovery operator has no public reset route, no environment or argument secrets, local clean main guard',()=>{
 const file=fs.readFileSync(path.join(root,'tools/cloudflare-prod-owner-password-recovery.mjs'),'utf8');
 const batch=fs.readFileSync(path.join(root,'重設雲端業主密碼.bat'),'utf8');
 const worker=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
 assert.match(file,/assertTrustedMainCheckout/);
 assert.match(file,/RESET_EXISTING_OWNER_PASSWORD_ONCE/);
 assert.match(file,/REMOTE_WRITE_UNCERTAIN/);
 assert.match(file,/async function hidden/);
 assert.match(file,/password_in_output:false/);
 assert.match(batch,/--inspect/);assert.match(batch,/--reset/);
 assert.match(batch,/choice \/C 12/);
 assert.doesNotMatch(batch,/CLOUDFLARE_API_TOKEN|PASSWORD=|node .*--password/i);
 assert.doesNotMatch(worker,/owner-password-recovery|password\/reset|api\/reset-password/);
 const cmd=spawnSync(process.execPath,
  [path.join(root,'tools/cloudflare-prod-owner-password-recovery.mjs'),'--reset'],
  {cwd:root,input:'',encoding:'utf8',timeout:10000});
 assert.notEqual(cmd.status,0);
 assert.doesNotMatch(cmd.stderr,/Bearer|salt|hash|CREATE_ONE|synthetic-unprivileged/i);
});
