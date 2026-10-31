'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const guardPromise=import('../tools/cloudflare-staging-access-0003-readonly.mjs');
const read=x=>fs.readFileSync(path.join(root,x),'utf8');
const sql=read('cloudflare/migrations-access-0003/0003_access_identity_links.sql');
const ACCOUNT='31b409b04896d260ba0fadf6cc2bb305';
const wrap=rows=>[{success:true,results:rows}];
function fixture(t,applied=false){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec(read('cloudflare/migrations/0001_initial_v3.sql'));
 db.exec(read('cloudflare/migrations/0002_login_attempts_window_indexes.sql'));
 db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE);"+
  "INSERT INTO d1_migrations VALUES(1,'0001_initial_v3.sql'),(2,'0002_login_attempts_window_indexes.sql');");
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
  .run('synthetic-owner-id-000001','owner','Synthetic Owner','owner','not-real-salt','not-real-hash');
 if(applied){
   db.exec(sql);
   db.prepare('INSERT INTO d1_migrations VALUES(3,?)').run('0003_access_identity_links.sql');
 }
 const snapshot=()=>{
   const from=sql=>wrap(db.prepare(sql).all());
   return {
     ledger:from('SELECT name FROM d1_migrations ORDER BY name'),
     contract:from('SELECT contract_version FROM cloud_schema_contract WHERE id=1'),
     owners:from('SELECT id,username,role,active FROM users ORDER BY id'),
     tables:from("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV' ORDER BY name"),
     indexes:from("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_login_attempts_%' ORDER BY name"),
     table:from("SELECT name,sql FROM sqlite_master WHERE type='table' AND name='access_identity_links'"),
     fk:from('PRAGMA foreign_key_check'),
     integrity:from('PRAGMA quick_check')
   };
 };
 return {db,snapshot};
}
test('config pins staging with separate 0003 only; production and 0002 unchanged',async()=>{
 const g=await guardPromise;
 assert.equal(g.verify0003ReadOnlyConfig(root,ACCOUNT),true);
 assert.throws(()=>g.verify0003ReadOnlyConfig(root,'other-account'),/E_STAGING_0003_READONLY_ACCOUNT/);
 const conf=JSON.parse(read('wrangler.staging-access-0003.jsonc'));
 assert.notEqual(conf.d1_databases[0].database_id,JSON.parse(read('wrangler.jsonc')).d1_databases[0].database_id);
});
test('ready before 0003: exact existing ledger, one active owner, clean database',async t=>{
 const g=await guardPromise,f=fixture(t);
 const result=g.inspect0003ReadOnly(f.snapshot(),sql);
 assert.deepEqual(result,{result:'STAGING_0003_READONLY_READY',database:'staging',
   cloud_auth_ready:false,identity_enrollment_verified:false,production_ready:false,remote_write_authorized:false});
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='access_identity_links'").get().n,0);
});
test('after offline 0003: schema and ledger prove installed, but no login authorization',async t=>{
 const g=await guardPromise,f=fixture(t,true);
 const result=g.inspect0003ReadOnly(f.snapshot(),sql);
 assert.equal(result.result,'STAGING_0003_READONLY_ALREADY_APPLIED');
 assert.equal(result.remote_write_authorized,false);
 assert.equal(result.identity_enrollment_verified,false);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,0);
});
test('partial migration, unexpected ledger, schema drift, FK and integrity errors deny',async t=>{
 const g=await guardPromise,f=fixture(t);
 const source=f.snapshot();
 const clone=()=>structuredClone(source);
 const reject=(value)=>assert.throws(()=>g.inspect0003ReadOnly(value,sql),/E_STAGING_0003_READONLY_/);
 let broken=clone();broken.ledger[0].results.push({name:'unexpected.sql'});reject(broken);
 broken=clone();broken.contract[0].results[0].contract_version=2;reject(broken);
 broken=clone();broken.owners[0].results[0].active=0;reject(broken);
 broken=clone();broken.fk[0].results.push({table:'users',rowid:1,parent:'locations'});reject(broken);
 broken=clone();broken.integrity[0].results=[{quick_check:'corrupt'}];reject(broken);
 broken=clone();delete broken.integrity;reject(broken);
 broken=clone();broken.table[0].results.push({name:'access_identity_links',sql:'CREATE TABLE access_identity_links(x TEXT)'});reject(broken);
 broken=clone();broken.tables[0].results=broken.tables[0].results.filter(x=>x.name!=='stock_moves');reject(broken);
 broken=clone();broken.tables[0].results.push({name:'unexpected_table'});reject(broken);
 broken=clone();broken.indexes[0].results=broken.indexes[0].results.filter(x=>x.name!=='idx_login_attempts_at');reject(broken);
 broken=clone();broken.indexes[0].results[0].sql='CREATE INDEX idx_login_attempts_username_nocase_at ON login_attempts(username,at)';reject(broken);
 f.db.exec('DROP TABLE stock_moves; DROP INDEX idx_login_attempts_at;');
 reject(f.snapshot());
 const applied=fixture(t,true).snapshot();
 applied.table[0].results[0].sql='CREATE TABLE access_identity_links(x TEXT)';
 reject(applied);
 applied.table[0].results=[];reject(applied);
});
test('all Wrangler snapshots must be one successful result set, with no omissions',async t=>{
 const g=await guardPromise,f=fixture(t);
 for(const name of ['ledger','contract','owners','tables','indexes','table','fk','integrity']){
   const b=f.snapshot();b[name]=[{success:false,results:[]}];
   assert.throws(()=>g.inspect0003ReadOnly(b,sql),/E_STAGING_0003_READONLY_/);
   const c=f.snapshot();c[name]=[{success:true,results:[]},{success:true,results:[]}];
   assert.throws(()=>g.inspect0003ReadOnly(c,sql),/E_STAGING_0003_READONLY_/);
 }
});
test('new workflow is human-only, GET-only, main-only and has no apply path',()=>{
 const y=read('.github/workflows/d1-staging-access-0003-readonly.yml');
 assert.match(y,/workflow_dispatch:/);
 assert.match(y,/github\.ref == 'refs\/heads\/main'/);
 assert.match(y,/inputs\.confirm == 'CHECK_STAGING_0003_READONLY'/);
 assert.match(y,/environment: d1-staging/);
 assert.match(y,/group: restaurant-business-d1-staging-migrations/);
 assert.match(y,/--config wrangler\.staging-access-0003\.jsonc --command/);
 assert.match(y,/node tools\/cloudflare-staging-access-0003-readonly\.mjs inspect/);
 assert.doesNotMatch(y,/d1 migrations apply|d1 migrations create|d1 execute DB\b|--file\b|^\s*push:/m);
 for(const line of y.split('\n').filter(x=>x.includes('query ') && !x.includes('query()')))
   assert.match(line,/^\s+query (?:ledger|contract|owners|tables|indexes|table|fk|integrity) "SELECT |^\s+query (?:fk|integrity) "PRAGMA (?:foreign_key_check|quick_check);"/);
 const install=y.slice(y.indexOf('- name: Install fixed Wrangler'),y.indexOf('- name: Staging D1 read-only'));
 assert.doesNotMatch(install,/secrets\.|CLOUDFLARE_API_TOKEN/);
});
