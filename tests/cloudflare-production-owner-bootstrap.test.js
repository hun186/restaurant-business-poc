'use strict';
const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),
 path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const modulePromise=import('../tools/cloudflare-production-owner.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
const wrap=rows=>[{success:true,results:rows}];
const tables=['locations','users','user_locations','sessions','login_attempts','audit_logs',
'tasks','ingredients','stock_moves','purchase_orders','stocktakes','repairs','shifts',
'leave_requests','training_courses','training_records','evaluations','ingredient_prices',
'menu_dishes','dish_ingredients'];
function initDb(){
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync(path.join(root,'db/schema.sql'),'utf8'));
 db.exec('CREATE TABLE cloud_schema_contract(id INTEGER PRIMARY KEY,contract_version INTEGER NOT NULL);');
 db.exec('INSERT INTO cloud_schema_contract VALUES(1,3)');
 db.exec('CREATE TABLE d1_migrations(name TEXT PRIMARY KEY);');
 db.exec("INSERT INTO d1_migrations VALUES('0001_initial_v3.sql'),('0002_login_attempts_window_indexes.sql')");
 return db;
}
function row(){
 return {contract_version:3,migration_total:2,migration_1:1,migration_2:1,
  ...Object.fromEntries(tables.map(n=>[n,0]))};
}
test('owner helper is separate Production-only target guard, never staging',async()=>{
 const m=await modulePromise;
 const worker=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc')));
 const stage=JSON.parse(fs.readFileSync(path.join(root,'wrangler.preview-migrations.jsonc')));
 const prod=JSON.parse(fs.readFileSync(path.join(root,'wrangler.production-initialize.jsonc')));
 assert.equal(m.verifyProductionOwnerTarget(worker,stage,prod,'31b409b04896d260ba0fadf6cc2bb305'),true);
 for(const modify of [p=>p.d1_databases[0].database_id=stage.d1_databases[0].database_id,
 p=>p.d1_databases[0].binding='STAGING_DB',p=>p.main='./cloudflare/worker.mjs']){
  const a=structuredClone(prod);modify(a);
  assert.throws(()=>m.verifyProductionOwnerTarget(worker,stage,a,'31b409b04896d260ba0fadf6cc2bb305'),/E_PROD_OWNER_ENROLL/);
 }
 assert.throws(()=>m.verifyProductionOwnerTarget(worker,stage,prod,'wrong'),/E_PROD_OWNER_ENROLL/);
});
test('strict pristine/v3 migration preflight refuses rows or unexpected query shape',async()=>{
 const m=await modulePromise;
 assert.deepEqual(m.EMPTY_TABLES,tables);
 assert.equal(m.checkProductionOwnerPreflight(wrap([row()])),true);
 for(const field of [...tables,'migration_total','migration_1','migration_2','contract_version']){
  const r=row();r[field]=field==='contract_version'?2:field==='migration_total'?3:1;
  assert.throws(()=>m.checkProductionOwnerPreflight(wrap([r])),/E_PROD_OWNER_ENROLL/,field);
 }
 for(const change of [
  r=>{delete r.users;},r=>{r.extra=0;},r=>{r.users='0';}
 ]){
  const r=row();change(r);assert.throws(()=>m.checkProductionOwnerPreflight(wrap([r])),/E_PROD_OWNER_ENROLL/);
 }
 assert.throws(()=>m.checkProductionOwnerPreflight(wrap([])),/E_PROD_OWNER_ENROLL/);
 assert.throws(()=>m.checkProductionOwnerPreflight([{success:false,results:[row()]}]),/E_PROD_OWNER_ENROLL/);
});
test('100k password hash creates exactly one Owner; any business row blocks the insert',async()=>{
 const m=await modulePromise,auth=await authPromise,password='test-only-owner-password-123';
 const sql=await m.buildProductionOwnerSql(password);
 assert.doesNotMatch(sql,/test-only-owner-password-123|PRODUCTION_OWNER_PASSWORD/);
 assert.match(sql,/pbkdf2-sha256\$100000\$/);
 assert.match(sql,/INSERT INTO users/);
 assert.match(sql,/d1_migrations/);
 for(const name of tables)assert.match(sql,new RegExp('COUNT\\(\\*\\) FROM '+name+'\\)'));
 const db=initDb();
 try{
  db.exec(sql);db.exec(sql);
  const c=db.prepare('SELECT COUNT(*) AS n FROM users').get().n;assert.equal(c,1);
  const owner=db.prepare('SELECT username,role,active,password_salt,password_hash FROM users').get();
  assert.equal(owner.username,'owner');assert.equal(owner.role,'owner');assert.equal(owner.active,1);
  assert.match(owner.password_hash,/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/);
  assert.equal(await auth.verifyWorkerPassword(password,owner.password_salt,owner.password_hash),true);
 }finally{db.close();}
 const second=initDb();
 try{
  second.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('x','測試門市');
  second.exec(sql);
  assert.equal(second.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
 }finally{second.close();}
 for(const p of ['short','x'.repeat(257),'x'.repeat(16)+'\n'])
  await assert.rejects(()=>m.buildProductionOwnerSql(p),/E_PROD_OWNER_ENROLL/);
});
test('postflight requires exact active Owner with 0 attempts/sessions/audit and FK OK',async()=>{
 const m=await modulePromise;
 const input=()=>({contract_version:3,migration_total:2,users:1,owners:1,sessions:0,login_attempts:0,audit_logs:0});
 assert.equal(m.verifyProductionOwnerPostflight(wrap([input()]),wrap([])),true);
 for(const key of Object.keys(input())){
  const row=input();row[key]=row[key]===0?1:0;
  assert.throws(()=>m.verifyProductionOwnerPostflight(wrap([row]),wrap([])),/E_PROD_OWNER_ENROLL/,key);
 }
 assert.throws(()=>m.verifyProductionOwnerPostflight(wrap([input()]),wrap([{table:'users'}])),/E_PROD_OWNER_ENROLL/);
});
test('private Owner SQL uses a single expected ephemeral path without overwrite',async()=>{
 const m=await modulePromise;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prod-owner-'));
 const file=path.join(dir,'production-owner-once.sql');
 try{
  assert.equal(m.savePrivateOwnerSql(file,'SELECT 1;',dir),true);
  assert.throws(()=>m.savePrivateOwnerSql(file,'SELECT 2;',dir));
  assert.equal(fs.readFileSync(file,'utf8'),'SELECT 1;');
  assert.throws(()=>m.savePrivateOwnerSql(path.join(dir,'other.sql'),'X',dir),/E_PROD_OWNER_ENROLL/);
  assert.throws(()=>m.savePrivateOwnerSql(path.join(dir,'../elsewhere.sql'),'X',dir),/E_PROD_OWNER_ENROLL/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
