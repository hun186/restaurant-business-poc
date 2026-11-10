'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const cli=path.join(root,'tools/cloudflare-prod-enrolled-owner-readonly.mjs');
const helper=import('../tools/cloudflare-prod-enrolled-owner-readonly.mjs');
const bootstrap=import('../tools/cloudflare-production-owner.mjs');
const wrap=x=>[{success:true,results:x}];
const source=fs.readFileSync(cli,'utf8');
const action=fs.readFileSync(path.join(root,
 '.github/workflows/d1-production-enrolled-owner-readonly.yml'),'utf8');

function database(){
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync(path.join(root,'db/schema.sql'),'utf8'));
 db.exec('CREATE TABLE cloud_schema_contract(id INTEGER PRIMARY KEY,contract_version INTEGER NOT NULL);');
 db.exec('INSERT INTO cloud_schema_contract VALUES(1,3)');
 db.exec('CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);');
 db.exec("INSERT INTO d1_migrations VALUES('0001_initial_v3.sql'),('0002_login_attempts_window_indexes.sql')");
 return db;
}
async function ownerDatabase(){
 const db=database();
 const b=await bootstrap;
 const sql=await b.buildProductionOwnerSql('synthetic-only-good-password-123');
 db.exec(sql);
 return db;
}
async function evidence(db){
 const o=await bootstrap,m=await helper;
 return {
  before:wrap([db.prepare(o.preflightSql()).get()]),
  after:wrap([db.prepare(m.enrolledOwnerSql('after')).get()]),
  quick:wrap([db.prepare('PRAGMA quick_check;').get()]),
  foreign:wrap(db.prepare('PRAGMA foreign_key_check;').all())
 };
}
function addLoginHistory(db){
 const id=db.prepare("SELECT id FROM users WHERE username='owner'").get().id;
 const hash='b'.repeat(64);
 db.prepare('INSERT INTO login_attempts(id,username,ip_hash,success) VALUES(?,?,?,?)')
  .run('attempt-failed','unknown-user',hash,0);
 db.prepare('INSERT INTO login_attempts(id,username,ip_hash,success) VALUES(?,?,?,?)')
  .run('attempt-success','owner',hash,1);
 db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?)')
  .run('audit-failed','unknown-user','auth.login_failed','sessions',hash,'{}');
 db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?,?)')
  .run('audit-success',id,'owner','auth.login','sessions',hash,'{}');
 db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,detail) VALUES(?,?,?,?,?,?)')
  .run('audit-logout',id,'owner','auth.logout','sessions','{}');
}
test('fixed read-only query keeps pristine bootstrap SQL unchanged',async()=>{
 const o=await bootstrap,m=await helper;
 for(const key of ['before','after','quick','foreign']){
  const sql=m.enrolledOwnerSql(key);
  assert.match(sql,/^(SELECT|PRAGMA) /);
  assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|ATTACH)\b/i);
  assert.equal((sql.match(/;/g)||[]).length,1);
 }
 assert.equal(m.enrolledOwnerSql('before'),o.preflightSql());
 assert.equal(m.enrolledOwnerSql('quick'),'PRAGMA quick_check;');
 assert.equal(m.enrolledOwnerSql('foreign'),'PRAGMA foreign_key_check;');
 assert.match(m.enrolledOwnerSql('after'),/AS unrecognized_audits;/);
 assert.match(m.enrolledOwnerSql('after'),/auth\.login_failed/);
 assert.match(m.enrolledOwnerSql('after'),/auth\.owner_bootstrap/);
 for(const x of ['enroll','write','','cleanup'])assert.throws(
  ()=>m.enrolledOwnerSql(x),/E_PROD_ENROLLED_OWNER_READONLY/);
 // Original postflight is still strict: it has no extra read-only audit column.
 assert.doesNotMatch(o.postflightSql(),/unrecognized_audits/);
});

test('already-enrolled Owner without login history validates, empty DB does not',async()=>{
 const m=await helper;
 const empty=database(),enrolled=await ownerDatabase();
 try{
  const emptyEvidence=await evidence(empty);
  assert.throws(()=>m.inspectEnrolledOwner(emptyEvidence),
   /E_PROD_ENROLLED_OWNER_READONLY/);
  const result=m.inspectEnrolledOwner(await evidence(enrolled));
  assert.equal(result.status,'PRODUCTION_ENROLLED_OWNER_READONLY_PASS');
  assert.equal(result.owner_count,1);
  assert.equal(result.retained_login_attempt_history,false);
  assert.equal(result.retained_auth_audit_history,false);
  assert.equal(result.production_write_performed,false);
  assert.equal(result.initial_owner_enrollment_authorized,false);
  assert.equal(result.release_authorized,false);
  assert.equal(result.business_tables_empty_verified,true);
 }finally{empty.close();enrolled.close();}
});

test('reviewed authentication history is retained and accepted; strict initial postflight remains unchanged',async()=>{
 const db=await ownerDatabase(),m=await helper,o=await bootstrap;
 try{
  addLoginHistory(db);
  const state=await evidence(db);
  const result=m.inspectEnrolledOwner(state);
  assert.equal(result.status,'PRODUCTION_ENROLLED_OWNER_READONLY_PASS');
  assert.equal(result.retained_login_attempt_history,true);
  assert.equal(result.retained_auth_audit_history,true);
  assert.equal(result.session_count_zero_verified,true);
  assert.equal(result.login_gate_modified,false);
  assert.throws(()=>o.verifyProductionOwnerPostflight(
    wrap([db.prepare(o.postflightSql()).get()]),
    wrap(db.prepare('PRAGMA foreign_key_check;').all())),/E_PROD_OWNER_ENROLL/);
  assert.doesNotMatch(JSON.stringify(result),
   /password|csrf|token_hash|ip_hash|username|actor_name|entity_id/i);
 }finally{db.close();}
});

test('invalid Owner, business state, audit history, live Session, schema, FK and mixed snapshots fail closed',async()=>{
 const m=await helper;
 let negativeCase=0;
 for(const mutate of [
  db=>db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('loc','Synthetic location'),
  db=>db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run('one','csrf',db.prepare("SELECT id FROM users WHERE username='owner'").get().id,
      new Date(Date.now()+3600000).toISOString()),
  db=>db.prepare('UPDATE users SET active=0 WHERE username=?').run('owner'),
  db=>db.prepare('UPDATE users SET password_hash=? WHERE username=?').run('unsupported','owner'),
  db=>db.prepare('UPDATE users SET password_hash=? WHERE username=?')
   .run('pbkdf2-sha256$100000$'+'z'.repeat(64),'owner'),
  db=>db.prepare('UPDATE users SET password_salt=? WHERE username=?')
   .run('z'.repeat(32),'owner'),
  db=>db.prepare('UPDATE audit_logs SET action=? WHERE action=?')
   .run('unexpected.bootstrap','auth.owner_bootstrap'),
  db=>db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,detail) VALUES(?,?,?,?,?)')
   .run('extra','owner','auth.permission_grant','users','{}'),
  db=>db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,detail) VALUES(?,?,?,?,?)')
   .run('fake','owner','auth.login_failed','sessions','{}'),
  db=>db.prepare('UPDATE cloud_schema_contract SET contract_version=2').run()
 ]){
  const db=await ownerDatabase();
  try{
   mutate(db);
   const invalidEvidence=await evidence(db);
   negativeCase++;
   assert.throws(()=>m.inspectEnrolledOwner(invalidEvidence),
    /E_PROD_ENROLLED_OWNER_READONLY/,'negative scenario #'+negativeCase);
  }finally{db.close();}
 }
 const db=await ownerDatabase();
 try{
  const state=await evidence(db);
  state.after[0].results[0].audit_logs++;
  assert.throws(()=>m.inspectEnrolledOwner(state),
   e=>e.message==='E_PROD_ENROLLED_OWNER_READONLY'&&e.safeStage==='SNAPSHOT_DRIFT');
  const bad=await evidence(db);
  bad.after[0].results[0].extra=0;
  assert.throws(()=>m.inspectEnrolledOwner(bad),
   e=>e.message==='E_PROD_ENROLLED_OWNER_READONLY'&&e.safeStage==='RESULT_SHAPE');
  const fk=await evidence(db);
  fk.foreign[0].results.push({table:'users'});
  assert.throws(()=>m.inspectEnrolledOwner(fk),
   e=>e.message==='E_PROD_ENROLLED_OWNER_READONLY'&&e.safeStage==='INTEGRITY');
  const wrong=await evidence(db);
  wrong.before[0].results[0].users='1';
  assert.throws(()=>m.inspectEnrolledOwner(wrong),
   e=>e.message==='E_PROD_ENROLLED_OWNER_READONLY'&&e.safeStage==='SCHEMA_CONTRACT');
 }finally{db.close();}
});

test('CLI private evidence emits safe summary only and never rows or counts',async()=>{
 const m=await helper,db=await ownerDatabase();
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prod-enrolled-owner-'));
 const run=(...args)=>spawnSync(process.execPath,[cli,...args],
  {cwd:root,encoding:'utf8',timeout:12000});
 try{
  addLoginHistory(db);
  for(const [name,raw] of Object.entries(await evidence(db)))
   fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(raw),{mode:0o600});
  const good=run('inspect',dir);
  assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).retained_login_attempt_history,true);
  assert.doesNotMatch(good.stdout,/password|token_hash|ip_hash|actor_name|account_id/i);
  const filepath=path.join(dir,'after.json');
  const raw=JSON.parse(fs.readFileSync(filepath,'utf8'));
  raw[0].results[0].unexpected_private_value='DO_NOT_DISCLOSE';
  fs.writeFileSync(filepath,JSON.stringify(raw),{mode:0o600});
  const bad=run('inspect',dir);
  assert.equal(bad.status,1);
  assert.equal(bad.stdout,'');
  assert.equal(bad.stderr.trim(),'E_PROD_ENROLLED_OWNER_READONLY stage=RESULT_SHAPE');
  assert.doesNotMatch(bad.stderr,/DO_NOT_DISCLOSE/);
  const wrong=run('sql','DROP');
  assert.equal(wrong.status,1);
  assert.equal(wrong.stderr.trim(),'E_PROD_ENROLLED_OWNER_READONLY stage=INVALID_MODE');
 }finally{fs.rmSync(dir,{recursive:true,force:true});db.close();}
});

test('malformed authentication audit actor/IP/target fields are never allowlisted',async()=>{
 const verifier=await helper;
 const h='a'.repeat(64);
 const cases=[
  ['invalid actor-name syntax',db=>{
   db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?)')
    .run('bad-actor','!!!','auth.login_failed','sessions',h,'{}');
  }],
  ['invalid source-hash charset',db=>{
   db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?)')
    .run('bad-hash','owner','auth.login_failed','sessions','z'.repeat(64),'{}');
  }],
  ['unrecognized entity target on login failure',db=>{
   db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,ip_hash,detail) VALUES(?,?,?,?,?,?,?)')
    .run('bad-entity','owner','auth.login_failed','sessions','unexpected',h,'{}');
  }],
  ['unrecognized location target on login failure',db=>{
   db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,location_id,ip_hash,detail) VALUES(?,?,?,?,?,?,?)')
    .run('bad-location','owner','auth.login_failed','sessions','unexpected',h,'{}');
  }],
  ['unexpected entity target on successful login',db=>{
   const id=db.prepare("SELECT id FROM users WHERE username='owner'").get().id;
   db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,ip_hash,detail) VALUES(?,?,?,?,?,?,?,?)')
    .run('bad-success',id,'owner','auth.login','sessions','unexpected',h,'{}');
  }],
  ['non-hex source hash on successful login',db=>{
   const id=db.prepare("SELECT id FROM users WHERE username='owner'").get().id;
   db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?,?)')
    .run('bad-success-hash',id,'owner','auth.login','sessions','Z'.repeat(64),'{}');
  }],
  ['unexpected ip hash on logout',db=>{
   const id=db.prepare("SELECT id FROM users WHERE username='owner'").get().id;
   db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?,?)')
    .run('bad-logout',id,'owner','auth.logout','sessions',h,'{}');
  }],
  ['bootstrap audit with a non-null actor ID',db=>{
   const id=db.prepare("SELECT id FROM users WHERE username='owner'").get().id;
   db.prepare("UPDATE audit_logs SET actor_id=? WHERE action='auth.owner_bootstrap'").run(id);
  }],
  ['bad source hash with valid length and unknown username',db=>{
   db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?)')
    .run('bad-both','!!!','auth.login_failed','sessions','z'.repeat(64),'{}');
  }]
 ];
 for(const [label,mutate] of cases){
  const db=await ownerDatabase();
  try{
   mutate(db);
   const state=await evidence(db);
   assert(state.after[0].results[0].unrecognized_audits>0,
    'audit SQL must flag '+label);
   assert.throws(()=>verifier.inspectEnrolledOwner(state),
    /E_PROD_ENROLLED_OWNER_READONLY/,'must reject '+label);
  }finally{db.close();}
 }
});

test('manually run enrolled Owner Action never exposes a write token or release gate',()=>{
 assert.match(action,/^  workflow_dispatch:/m);
 assert.match(action,/CHECK_ENROLLED_OWNER_READONLY/);
 assert.match(action,/github\.ref == 'refs\/heads\/main'/);
 assert.match(action,/environment: d1-production-readonly/);
 assert.match(action,/restaurant-business-production-d1-initialization/);
 assert.match(action,/CLOUDFLARE_PROD_D1_READ_TOKEN/);
 assert.match(action,/cloudflare-hosted-probe-preflight/);
 assert.match(action,/cloudflare-prod-d1-init\.mjs config/);
 assert.match(action,/wrangler@4\.152\.0/);
 assert.match(action,/d1 execute PROD_DB --remote --json/);
 assert.match(action,/cloudflare-prod-enrolled-owner-readonly\.mjs inspect/);
 assert.doesNotMatch(action,/^\s*(push|pull_request|schedule):/m);
 assert.doesNotMatch(action,
  /CLOUDFLARE_PROD_D1_WRITE_TOKEN|PRODUCTION_OWNER_PASSWORD|wrangler deploy|d1 migrations apply|time-travel restore|d1 execute.*--file/i);
 assert.match(source,/initial_owner_enrollment_authorized:false/);
 assert.match(source,/release_authorized:false/);
});
