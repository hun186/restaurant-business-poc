'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const validatorPromise=import('../tools/cloudflare-staging-0003-transition-evidence.mjs');
const sql=read('cloudflare/migrations-access-0003/0003_access_identity_links.sql');
const result=records=>[{success:true,results:records}];
function fixture(t){
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(read('cloudflare/migrations/0001_initial_v3.sql'));
  db.exec(read('cloudflare/migrations/0002_login_attempts_window_indexes.sql'));
  db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);"+
    "INSERT INTO d1_migrations VALUES(1,'0001_initial_v3.sql'),(2,'0002_login_attempts_window_indexes.sql');");
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
    .run('synthetic-owner-id-000001','owner','Synthetic Owner','owner','synthetic-not-valid','synthetic-not-valid');
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('synthetic-store','Synthetic Store');
  const all=q=>result(db.prepare(q).all());
  const snapshot=(has3=false)=>({
    ledger:all('SELECT name FROM d1_migrations ORDER BY name'),
    contract:all('SELECT contract_version FROM cloud_schema_contract WHERE id=1'),
    owners:all('SELECT id,username,role,active FROM users ORDER BY id'),
    tables:all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"),
    indexes:all("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_login_attempts_%' ORDER BY name"),
    table:all("SELECT name,sql FROM sqlite_master WHERE type='table' AND name='access_identity_links'"),
    fk:all('PRAGMA foreign_key_check'),
    integrity:all('PRAGMA quick_check'),
    counts:all("SELECT (SELECT COUNT(*) FROM users) AS users,"+
      "(SELECT COUNT(*) FROM sessions) AS sessions,"+
      "(SELECT COUNT(*) FROM locations) AS locations,"+
      "(SELECT COUNT(*) FROM user_locations) AS user_locations,"+
      "(SELECT COUNT(*) FROM tasks) AS tasks,"+
      "(SELECT COUNT(*) FROM stock_moves) AS stock_moves,"+
      "(SELECT COUNT(*) FROM audit_logs) AS audit_logs"),
    ...(has3?{link_count:all('SELECT COUNT(*) AS n FROM access_identity_links')}: {})
  });
  const apply=()=>{
    db.exec(sql);
    db.prepare('INSERT INTO d1_migrations(id,name) VALUES(3,?)').run('0003_access_identity_links.sql');
  };
  return {db,snapshot,apply};
}
test('synthetic 0001/0002 to empty inactive 0003 transition verifies, but never grants login or writes',async t=>{
 const v=await validatorPromise,f=fixture(t);
 const before=f.snapshot();
 f.apply();
 const after=f.snapshot(true);
 const r=v.verify0003Transition(before,after,sql);
 assert.equal(r.result,'STAGING_0003_ADD_ONLY_OFFLINE_TRANSITION_VERIFIED');
 assert.equal(r.staging_transition_verified,true);
 assert.equal(r.real_cloudflare_migration_performed_by_this_tool,false);
 assert.equal(r.identity_enrollment_verified,false);
 assert.equal(r.production_ready,false);
 assert.equal(r.remote_write_authorized,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,0);
 assert.equal(f.db.prepare('SELECT active FROM users WHERE id=?').get('synthetic-owner-id-000001').active,1);
});
test('wrong before/after ledger or partial DDL and incomplete indexes never verify',async t=>{
 const v=await validatorPromise,f=fixture(t);
 const before=f.snapshot();
 assert.throws(()=>v.verify0003Transition(before,before,sql),/E_STAGING_0003_/);
 f.apply();const after=f.snapshot(true);
 let x=structuredClone(after);x.table[0].results[0].sql='CREATE TABLE access_identity_links(x)';
 assert.throws(()=>v.verify0003Transition(before,x,sql),/E_STAGING_0003_/);
 x=structuredClone(before);x.indexes[0].results.pop();
 assert.throws(()=>v.verify0003Transition(x,after,sql),/E_STAGING_0003_/);
 x=structuredClone(before);x.tables[0].results=x.tables[0].results.filter(r=>r.name!=='stock_moves');
 assert.throws(()=>v.verify0003Transition(x,after,sql),/E_STAGING_0003_/);
});
test('new identity links, changed users, sessions, store/stock data and malformed counts deny',async t=>{
 const v=await validatorPromise,f=fixture(t),before=f.snapshot();
 f.apply();
 let after=f.snapshot(true);
 f.db.prepare('INSERT INTO access_identity_links(issuer,audience,subject,user_id) VALUES(?,?,?,?)')
   .run('https://synthetic.cloudflareaccess.com','a'.repeat(64),'synthetic-sub','synthetic-owner-id-000001');
 after=f.snapshot(true);
 assert.throws(()=>v.verify0003Transition(before,after,sql),/LINKS_NOT_EMPTY/);
 f.db.prepare('DELETE FROM access_identity_links').run();
 f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run('fake-token','fake-csrf','synthetic-owner-id-000001','2027-01-01');
 after=f.snapshot(true);
 assert.throws(()=>v.verify0003Transition(before,after,sql),/BUSINESS_DATA_CHANGED/);
 f.db.prepare('DELETE FROM sessions').run();
 f.db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('synthetic-store-2','Synthetic Other Store');
 after=f.snapshot(true);
 assert.throws(()=>v.verify0003Transition(before,after,sql),/BUSINESS_DATA_CHANGED/);
});
test('metadata changes, malformed JSON outputs and missing link_count deny',async t=>{
 const v=await validatorPromise,f=fixture(t),before=f.snapshot();f.apply();
 const after=f.snapshot(true);
 for(const name of ['owners','indexes','contract','counts','link_count']){
   let x=structuredClone(after);delete x[name];
   assert.throws(()=>v.verify0003Transition(before,x,sql),/E_STAGING_0003_/);
 }
 let x=structuredClone(after);x.counts[0].results[0].users=-1;
 assert.throws(()=>v.verify0003Transition(before,x,sql),/E_STAGING_0003_/);
 x=structuredClone(after);x.counts=[{success:false,results:[]}];
 assert.throws(()=>v.verify0003Transition(before,x,sql),/E_STAGING_0003_/);
 x=structuredClone(after);x.owners[0].results[0].display_name='changed';
 // Owner rows only carry identity+role+active; mutate an actual collected field.
 x.owners[0].results[0].active=0;
 assert.throws(()=>v.verify0003Transition(before,x,sql),/E_STAGING_0003_/);
});
test('offline evidence validator has no D1 apply workflow or network, and preserves explicit gating',()=>{
 const source=read('tools/cloudflare-staging-0003-transition-evidence.mjs');
 assert.doesNotMatch(source,/d1 migrations apply|--remote|--file |fetch\(/);
 assert.match(source,/real_cloudflare_migration_performed_by_this_tool:false/);
 assert.match(source,/remote_write_authorized:false/);
 assert.match(source,/STAGING_0003_TRANSITION_BLOCKED/);
});
