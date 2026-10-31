'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const text=p=>fs.readFileSync(path.join(root,p),'utf8');
const ddl=text('cloudflare/migrations-access-0003/0003_access_identity_links.sql');
const g=import('../tools/cloudflare-staging-0003-apply-gate.mjs');
const wrap=records=>[{success:true,results:records}];
function fixture(t){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(text('cloudflare/migrations/0001_initial_v3.sql'));
  db.exec(text('cloudflare/migrations/0002_login_attempts_window_indexes.sql'));
  db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);"+
    "INSERT INTO d1_migrations VALUES(1,'0001_initial_v3.sql'),(2,'0002_login_attempts_window_indexes.sql');");
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
    .run('synthetic-owner-id-000001','owner','Synthetic Owner','owner','fake','fake');
  const from=q=>wrap(db.prepare(q).all());
  const snapshot=(applied=false)=>({
    ledger:from('SELECT name FROM d1_migrations ORDER BY name'),
    contract:from('SELECT contract_version FROM cloud_schema_contract WHERE id=1'),
    owners:from('SELECT id,username,role,active FROM users ORDER BY id'),
    tables:from("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"),
    indexes:from("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_login_attempts_%' ORDER BY name"),
    table:from("SELECT name,sql FROM sqlite_master WHERE type='table' AND name='access_identity_links'"),
    fk:from('PRAGMA foreign_key_check'),
    integrity:from('PRAGMA quick_check'),
    counts:from('SELECT (SELECT COUNT(*) FROM users) AS users,'+
      '(SELECT COUNT(*) FROM sessions) AS sessions,'+
      '(SELECT COUNT(*) FROM locations) AS locations,'+
      '(SELECT COUNT(*) FROM user_locations) AS user_locations,'+
      '(SELECT COUNT(*) FROM tasks) AS tasks,'+
      '(SELECT COUNT(*) FROM stock_moves) AS stock_moves,'+
      '(SELECT COUNT(*) FROM audit_logs) AS audit_logs'),
    ...(applied?{link_count:from('SELECT COUNT(*) AS n FROM access_identity_links')}:{})
  });
  const apply=()=>{
    db.exec(ddl);
    db.prepare('INSERT INTO d1_migrations(id,name) VALUES(3,?)').run('0003_access_identity_links.sql');
  };
  return {db,snapshot,apply};
}
test('staging-only pristine 0001/0002 allows offline readiness; no migration runs',async t=>{
 const v=await g,f=fixture(t);
 const r=v.validate0003ApplyPreflight(f.snapshot(),ddl);
 assert.equal(r.result,'STAGING_0003_APPLY_PREFLIGHT_PASS');
 assert.equal(r.remote_write_executed,false);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='access_identity_links'").get().n,0);
});
test('offline additive 0003 passes before/after evidence without any enrollment',async t=>{
 const v=await g,f=fixture(t),before=f.snapshot();
 f.apply();
 const r=v.validate0003ApplyPostflight(before,f.snapshot(true),ddl);
 assert.equal(r.result,'STAGING_0003_ADD_ONLY_OFFLINE_TRANSITION_VERIFIED');
 assert.equal(r.real_cloudflare_migration_performed_by_this_tool,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,0);
});
test('preflight fails closed on real sessions, stock, staff, activity, counts or corrupt ledger',async t=>{
 const v=await g,f=fixture(t),b=f.snapshot();
 for(const key of ['sessions','locations','stock_moves','tasks','audit_logs','user_locations','users']){
  const snapshot=structuredClone(b);snapshot.counts[0].results[0][key]+=1;
  assert.throws(()=>v.validate0003ApplyPreflight(snapshot,ddl),/E_STAGING_0003_APPLY_/);
 }
 for(const x of [-1,1.5,'0',NaN,2**53]){
  const snapshot=structuredClone(b);snapshot.counts[0].results[0].tasks=x;
  assert.throws(()=>v.validate0003ApplyPreflight(snapshot,ddl),/E_STAGING_0003_APPLY_/);
 }
 const missing=structuredClone(b);delete missing.counts;
 assert.throws(()=>v.validate0003ApplyPreflight(missing,ddl),/E_STAGING_0003_APPLY_/);
 const corrupted=structuredClone(b);corrupted.ledger[0].results.push({name:'unauthorized-migration.sql'});
 assert.throws(()=>v.validate0003ApplyPreflight(corrupted,ddl),/E_STAGING_0003_/);
 f.apply();
 assert.throws(()=>v.validate0003ApplyPreflight(f.snapshot(true),ddl),/E_STAGING_0003_APPLY_/);
});
test('postflight rejects added links and modified business data',async t=>{
 const v=await g,f=fixture(t),before=f.snapshot();f.apply();
 f.db.prepare('INSERT INTO access_identity_links(issuer,audience,subject,user_id) VALUES(?,?,?,?)')
  .run('https://synthetic.cloudflareaccess.com','a'.repeat(64),'synthetic','synthetic-owner-id-000001');
 assert.throws(()=>v.validate0003ApplyPostflight(before,f.snapshot(true),ddl),/LINKS_NOT_EMPTY/);
 f.db.exec('DELETE FROM access_identity_links;');
 f.db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('synthetic-store','Synthetic Test Store');
 assert.throws(()=>v.validate0003ApplyPostflight(before,f.snapshot(true),ddl),/BUSINESS_DATA_CHANGED/);
});
test('manual workflow pins main, exact SHA, separate protected write environment and no unattended action',()=>{
 const y=text('.github/workflows/d1-staging-access-0003-apply.yml');
 assert.match(y,/workflow_dispatch:/);
 assert.match(y,/github\.ref == 'refs\/heads\/main'/);
 assert.match(y,/inputs\.approved_head_sha == github\.sha/);
 assert.match(y,/inputs\.confirm == 'APPLY_STAGING_0003_SCHEMA_ONLY'/);
 assert.match(y,/environment: d1-staging-0003-write/);
 assert.match(y,/group: restaurant-business-d1-staging-migrations/);
 assert.match(y,/STAGING_0003_SCHEMA_APPLY_APPROVED/);
 assert.match(y,/ENABLED_STAGING_0003_SCHEMA_ONLY/);
 assert.match(y,/tools\/cloudflare-staging-0003-apply-gate\.mjs preflight/);
 assert.match(y,/tools\/cloudflare-staging-0003-apply-gate\.mjs postflight/);
 assert.match(y,/wrangler d1 migrations apply STAGING_DB --remote/);
 assert.match(y,/--config wrangler\.staging-access-0003\.jsonc/);
 assert.doesNotMatch(y,/d1 migrations apply DB\b|wrangler d1 execute DB\b|push:\s|pull_request:\s|--file /);
 const install=y.slice(y.indexOf('- name: Install fixed Wrangler'),y.indexOf('- name: Verify remote Staging baseline'));
 assert.doesNotMatch(install,/CLOUDFLARE_API_TOKEN|secrets\./);
 const index1=y.indexOf('apply-gate.mjs preflight'),index2=y.indexOf('wrangler d1 migrations apply'),index3=y.indexOf('apply-gate.mjs postflight');
 assert.ok(index1<index2&&index2<index3);
 assert.equal(text('cloudflare/migrations-access-0003/0003_access_identity_links.sql').includes('DEFAULT 0'),true);
 assert.deepEqual(fs.readdirSync(path.join(root,'cloudflare/migrations-access-0003')),
   ['0003_access_identity_links.sql']);
});
