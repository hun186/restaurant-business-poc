'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const source='cloudflare/migrations-access-0003/0003_access_identity_links.sql';
const proposal='cloudflare/migration-proposals/0003_access_identity_links.sql';
const conf='wrangler.staging-access-0003.jsonc';
const normal='wrangler.preview-migrations.jsonc';
const PROD='wrangler.jsonc';
const migration=read(source);
const createBody=x=>x.slice(x.indexOf('CREATE TABLE access_identity_links (')).trim();
const STAGING_ID='2c355bed-d9c3-449c-aa9b-1018f3bc1177';
const PROD_ID='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';

test('isolated config pins exact staging D1 and only the 0003 directory',()=>{
 const config=JSON.parse(read(conf)),original=JSON.parse(read(normal)),prod=JSON.parse(read(PROD));
 assert.deepEqual(Object.keys(config).sort(),['compatibility_date','d1_databases','name']);
 assert.equal(config.compatibility_date,original.compatibility_date);
 assert.equal(config.d1_databases.length,1);
 const [db]=config.d1_databases;
 assert.deepEqual(Object.keys(db).sort(),['binding','database_id','database_name','migrations_dir']);
 assert.equal(db.binding,'STAGING_DB');
 assert.equal(db.database_name,'restaurant-business-staging');
 assert.equal(db.database_id,STAGING_ID);
 assert.equal(db.database_id,original.d1_databases[0].database_id);
 assert.notEqual(db.database_id,prod.d1_databases[0].database_id);
 assert.notEqual(db.database_id,PROD_ID);
 assert.equal(db.migrations_dir,'cloudflare/migrations-access-0003');
 assert.equal(original.d1_databases[0].migrations_dir,'cloudflare/migrations');
 assert.deepEqual(fs.readdirSync(path.join(root,db.migrations_dir)).sort(),['0003_access_identity_links.sql']);
 assert.deepEqual(fs.readdirSync(path.join(root,'cloudflare/migrations')).filter(x=>x.endsWith('.sql')).sort(),
   ['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql']);
 assert.equal(prod.d1_databases[0].migrations_dir,'cloudflare/migrations');
});
test('candidate copies the reviewed 0003 proposal DDL without any extra commands',()=>{
 assert.equal(createBody(migration),createBody(read(proposal)));
 const nonComments=migration.split('\n').filter(line=>!line.trim().startsWith('--')).join('\n').trim();
 assert.match(nonComments,/^CREATE TABLE access_identity_links \(/);
 assert.equal(nonComments.split(';').filter(x=>x.trim()).length,1);
 assert.doesNotMatch(nonComments,/\b(?:DROP|INSERT|UPDATE|DELETE|ALTER|ATTACH|PRAGMA|REPLACE|TRIGGER|BEGIN)\b/i);
});
test('existing 0001 and 0002 remain unchanged and 0002 workflow cannot select 0003',()=>{
 const oldWorkflow=read('.github/workflows/d1-staging-incremental-0002.yml');
 assert.match(oldWorkflow,/wrangler\.preview-migrations\.jsonc/);
 assert.doesNotMatch(oldWorkflow,/staging-access-0003|migrations-access-0003|0003_access_identity_links/);
 for(const name of ['d1-staging-migration.yml','d1-staging-owner-bootstrap.yml']){
   const workflow=read('.github/workflows/'+name);
   assert.doesNotMatch(workflow,/staging-access-0003|migrations-access-0003|0003_access_identity_links/);
 }
});
test('offline v3 and 0002 fixture gains only an empty, inactive-by-default link table',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(read('cloudflare/migrations/0001_initial_v3.sql'));
 db.exec(read('cloudflare/migrations/0002_login_attempts_window_indexes.sql'));
 db.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL);"+
   "INSERT INTO d1_migrations VALUES(1,'0001_initial_v3.sql');"+
   "INSERT INTO d1_migrations VALUES(2,'0002_login_attempts_window_indexes.sql');");
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run('sample-owner','owner','Synthetic Owner','owner','fake-salt','fake-hash');
 const before={users:db.prepare('SELECT * FROM users').all(),
   ledger:db.prepare('SELECT * FROM d1_migrations ORDER BY id').all(),
   contract:db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').get()};
 db.exec(migration);
 assert.deepEqual(db.prepare('SELECT * FROM users').all(),before.users);
 assert.deepEqual(db.prepare('SELECT * FROM d1_migrations ORDER BY id').all(),before.ledger);
 assert.deepEqual(db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').get(),before.contract);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const issuer='https://synthetic.cloudflareaccess.com',aud='a'.repeat(64);
 db.prepare('INSERT INTO access_identity_links(issuer,audience,subject,user_id) VALUES(?,?,?,?)')
   .run(issuer,aud,'synthetic-subject','sample-owner');
 assert.equal(db.prepare('SELECT active FROM access_identity_links').get().active,0);
 assert.throws(()=>db.prepare('INSERT INTO access_identity_links(issuer,audience,subject,user_id) VALUES(?,?,?,?)')
   .run(issuer,aud,'another-subject','sample-owner'),/UNIQUE constraint failed/);
 db.prepare("DELETE FROM users WHERE id='sample-owner'").run();
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,0);
});
