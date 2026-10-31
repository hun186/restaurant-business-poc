'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const enrollmentPromise=import('../tools/cloudflare-staging-access-owner-enroll.mjs');
const root=path.join(__dirname,'..');
const SQL={
 v3:fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'),
 v2:fs.readFileSync(path.join(root,'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8'),
 v3access:fs.readFileSync(path.join(root,'cloudflare/migrations-access-0003/0003_access_identity_links.sql'),'utf8')
};
const ISSUER='https://synthetic-operator.cloudflareaccess.com';
const CFG={issuer:ISSUER,audience:'a'.repeat(64),subject:'operator-test-user-5d014f54'};
const wrangler=rows=>[{success:true,results:rows}];
const get=(db,sql)=>db.prepare(sql).all();
function fixture(t,{migrated=true}={}){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec(SQL.v3);db.exec(SQL.v2);
 db.exec('CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);');
 for(const name of ['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'])
  db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
 if(migrated){
  db.exec(SQL.v3access);
  db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run('0003_access_identity_links.sql');
 }
 const owner=randomUUID();
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?,1)')
  .run(owner,'owner','Synthetic Owner','owner','dummy','dummy');
 const snapshot=()=>({
  ledger:wrangler(get(db,'SELECT name FROM d1_migrations ORDER BY name')),
  contract:wrangler(get(db,'SELECT contract_version FROM cloud_schema_contract WHERE id=1')),
  owners:wrangler(get(db,'SELECT id,username,role,active FROM users ORDER BY id')),
  tables:wrangler(get(db,"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name")),
  indexes:wrangler(get(db,"SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_login_attempts_%' ORDER BY name")),
  table:wrangler(get(db,"SELECT name,sql FROM sqlite_master WHERE type='table' AND name='access_identity_links'")),
  fk:wrangler(get(db,'PRAGMA foreign_key_check')),
  integrity:wrangler(get(db,'PRAGMA quick_check')),
  counts:migrated?wrangler(get(db,"SELECT (SELECT COUNT(*) FROM users) AS users,(SELECT COUNT(*) FROM sessions) AS sessions,(SELECT COUNT(*) FROM locations) AS locations,(SELECT COUNT(*) FROM user_locations) AS user_locations,(SELECT COUNT(*) FROM login_attempts) AS login_attempts,(SELECT COUNT(*) FROM audit_logs) AS audit_logs,(SELECT COUNT(*) FROM tasks) AS tasks,(SELECT COUNT(*) FROM ingredients) AS ingredients,(SELECT COUNT(*) FROM stock_moves) AS stock_moves,(SELECT COUNT(*) FROM purchase_orders) AS purchase_orders,(SELECT COUNT(*) FROM stocktakes) AS stocktakes,(SELECT COUNT(*) FROM repairs) AS repairs,(SELECT COUNT(*) FROM shifts) AS shifts,(SELECT COUNT(*) FROM leave_requests) AS leave_requests,(SELECT COUNT(*) FROM training_courses) AS training_courses,(SELECT COUNT(*) FROM training_records) AS training_records,(SELECT COUNT(*) FROM evaluations) AS evaluations,(SELECT COUNT(*) FROM backup_settings) AS backup_settings,(SELECT COUNT(*) FROM ingredient_prices) AS ingredient_prices,(SELECT COUNT(*) FROM menu_dishes) AS menu_dishes,(SELECT COUNT(*) FROM dish_ingredients) AS dish_ingredients,(SELECT COUNT(*) FROM access_identity_links) AS access_identity_links;")):wrangler([]),
  links:migrated?wrangler(get(db,'SELECT issuer,audience,subject,user_id,active FROM access_identity_links ORDER BY issuer,audience,subject')):wrangler([]),
  audits:wrangler(get(db,'SELECT id,actor_id,actor_name,action,entity,entity_id,location_id,detail FROM audit_logs ORDER BY id'))
 });
 return {db,owner,snapshot};
}
test('preflight must find exact v3+0003, single active synthetic owner and zero activity',async t=>{
 const api=await enrollmentPromise;
 const f=fixture(t);
 const before=api.assertEnrollmentPreflight(f.snapshot(),CFG);
 assert.equal(before.result,'STAGING_ACCESS_OWNER_ENROLL_READY');
 assert.equal(before.owner_id,f.owner);
 assert.equal(before.remote_write_performed,false);
 for(const sql of [
  "INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES('x','x','"+f.owner+"','2099-01-01')",
  "INSERT INTO audit_logs(id,actor_name,action,entity) VALUES('x','system','test','users')"
 ]){
  const other=fixture(t);
  other.db.exec(sql.replaceAll(f.owner,other.owner));
  assert.throws(()=>api.assertEnrollmentPreflight(other.snapshot(),CFG));
 }
 const notMigrated=fixture(t,{migrated:false});
 assert.throws(()=>api.assertEnrollmentPreflight(notMigrated.snapshot(),CFG));
 // Some v3 business records do not need an active location. Every such
 // independent table must still prevent Owner Access privilege activation.
 for(const [table,insert] of [
  ['ingredients',db=>db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
    .run(randomUUID(),'SYNT-ING','Synthetic Ingredient','kg')],
  ['training_courses',db=>db.prepare('INSERT INTO training_courses(id,title) VALUES(?,?)')
    .run(randomUUID(),'Synthetic Training')]
 ]){
  const populated=fixture(t);
  insert(populated.db);
  assert.throws(()=>api.assertEnrollmentPreflight(populated.snapshot(),CFG),table);
 }

 f.db.prepare("UPDATE users SET active=0 WHERE id=?").run(f.owner);
 assert.throws(()=>api.assertEnrollmentPreflight(f.snapshot(),CFG));
});
test('staged inactive link, then audit, then activate; interrupted enrollment never grants access',async t=>{
 const api=await enrollmentPromise;
 const f=fixture(t);
 const sql=api.generateEnrollmentSql(CFG,{auditId:'11111111-2222-4333-8444-555555555555'});
 assert.equal(sql.statements.length,3);
 assert.match(sql.statements[0],/active\)\s+SELECT /);
 assert.match(sql.statements[0],/u.id,0/);
 assert.match(sql.statements[1],/INSERT INTO audit_logs/);
 assert.match(sql.statements[2],/UPDATE access_identity_links SET active=1/);
 api.assertEnrollmentPreflight(f.snapshot(),CFG);
 f.db.exec(sql.statements[0]);
 assert.equal(get(f.db,'SELECT active FROM access_identity_links')[0].active,0);
 assert.throws(()=>api.assertEnrollmentPostflight(f.snapshot(),CFG,sql.auditId));
 assert.throws(()=>api.assertEnrollmentPreflight(f.snapshot(),CFG));
 f.db.exec(sql.statements[1]);
 assert.equal(get(f.db,'SELECT active FROM access_identity_links')[0].active,0);
 assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM audit_logs')[0].n,1);
 assert.throws(()=>api.assertEnrollmentPostflight(f.snapshot(),CFG,sql.auditId));
 f.db.exec(sql.statements[2]);
 assert.equal(get(f.db,'SELECT active FROM access_identity_links')[0].active,1);
 const evidence=api.assertEnrollmentPostflight(f.snapshot(),CFG,sql.auditId);
 assert.equal(evidence.result,'STAGING_ACCESS_OWNER_ENROLLED_AND_AUDITED');
 assert.equal(evidence.access_policy_verified,false);
 assert.equal(evidence.write_gate_enabled,false);
 assert.equal(evidence.production_ready,false);
 assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM sessions')[0].n,0);
 assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM users')[0].n,1);
});
test('malicious or missing identity inputs and test activation with wrong audit are rejected',async t=>{
 const api=await enrollmentPromise;
 for(const config of [
  {...CFG,issuer:'http://synthetic-operator.cloudflareaccess.com'},
  {...CFG,issuer:'https://other.example.com'},
  {...CFG,audience:'not-a-64-hex-audience'},
  {...CFG,subject:"uuid');DELETE FROM users;--"},
  {...CFG,subject:'x\nz'},
  {...CFG,subject:'x--y'},
  {...CFG,subject:''},
  {...CFG,subject:'A'.repeat(129)},
  {audience:CFG.audience,subject:CFG.subject},
  {...CFG,issuer:'https://a.cloudflareaccess.com/evil'}
 ]){
  assert.throws(()=>api.validateInputs(config));
  assert.throws(()=>api.generateEnrollmentSql(config));
 }
 assert.throws(()=>api.generateEnrollmentSql(CFG,{auditId:"1' OR 1=1"}));
 const f=fixture(t),sql=api.generateEnrollmentSql(CFG,{auditId:'11111111-2222-4333-8444-555555555555'});
 f.db.exec(sql.statements[0]);
 f.db.exec(sql.statements[2]); // cannot activate: matching audit not present
 assert.equal(get(f.db,'SELECT active FROM access_identity_links')[0].active,0);
 assert.throws(()=>api.assertEnrollmentPostflight(f.snapshot(),CFG,sql.auditId));
});
test('workflow is manual main/SHA/environment gated and never enables login or Production',()=>{
 const work=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-access-owner-enroll.yml'),'utf8');
 assert.match(work,/workflow_dispatch:/);
 assert.match(work,/github\.ref == 'refs\/heads\/main'/);
 assert.match(work,/inputs\.reviewed_head_sha == github\.sha/);
 assert.match(work,/inputs\.confirm == 'ENROLL_STAGING_ACCESS_OWNER_ONCE'/);
 assert.match(work,/environment: d1-staging-access-enroll-write/);
 assert.match(work,/STAGING_ACCESS_OWNER_ENROLL_APPROVED/);
 assert.match(work,/ALLOW_STAGING_TEST_OWNER_LINK_ONLY/);
 assert.match(work,/wrangler\.staging-access-0003\.jsonc/);
 assert.doesNotMatch(work,/migrations apply|wrangler\.production|--config wrangler\.jsonc|workflow_call:|schedule:/);
 assert.doesNotMatch(work,/echo .*(?:STAGING_ACCESS_OWNER_SUBJECT|STAGING_ACCESS_ISSUER)/);
});

test('preflight-to-write race fails closed at every stage; no new Access grant',async t=>{
 const api=await enrollmentPromise;
 for(const stage of ['before-link','before-audit','before-activation']){
  const f=fixture(t);
  const sql=api.generateEnrollmentSql(CFG,{auditId:'11111111-2222-4333-8444-555555555555'});
  api.assertEnrollmentPreflight(f.snapshot(),CFG);
  const injectBusinessRecord=()=>f.db.prepare('INSERT INTO training_courses(id,title) VALUES(?,?)')
   .run(randomUUID(),'Synthetic concurrent training record');
  if(stage==='before-link')injectBusinessRecord();
  f.db.exec(sql.statements[0]);
  if(stage==='before-audit')injectBusinessRecord();
  f.db.exec(sql.statements[1]);
  if(stage==='before-activation')injectBusinessRecord();
  f.db.exec(sql.statements[2]);
  assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM access_identity_links WHERE active=1')[0].n,0,stage);
  assert.throws(()=>api.assertEnrollmentPostflight(f.snapshot(),CFG,sql.auditId),stage);
  assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM training_courses')[0].n,1,stage);
  if(stage==='before-link'){
   assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM access_identity_links')[0].n,0);
   assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM audit_logs')[0].n,0);
  }
  if(stage==='before-audit'){
   assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM access_identity_links')[0].n,1);
   assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM audit_logs')[0].n,0);
  }
  if(stage==='before-activation'){
   assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM access_identity_links')[0].n,1);
   assert.equal(get(f.db,'SELECT COUNT(*) AS n FROM audit_logs')[0].n,1);
  }
 }
});
