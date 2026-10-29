'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const modulePromise=import('../tools/cloudflare-prod-d1-init.mjs');
const wrap=results=>[{success:true,results}];
const sql=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
function pristine(){
 return {objects:wrap([{type:'table',name:'_cf_KV',tbl_name:'_cf_KV'}]),
   quick:wrap([{quick_check:'ok'}])};
}
function migrated(){
 const tables=[...sql.matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)]
  .map(x=>({name:x[1]}));
 return {
  tables:wrap([...tables,{name:'d1_migrations'}]),
  contract:wrap([{contract_version:3}]),
  migrations:wrap([{name:'0001_initial_v3.sql'},{name:'0002_login_attempts_window_indexes.sql'}]),
  indexes:wrap([
   {name:'idx_login_attempts_username_nocase_at',sql:'CREATE INDEX idx_login_attempts_username_nocase_at ON login_attempts(username COLLATE NOCASE,at)'},
   {name:'idx_login_attempts_ip_hash_at',sql:'CREATE INDEX idx_login_attempts_ip_hash_at ON login_attempts(ip_hash,at)'},
   {name:'idx_login_attempts_at',sql:'CREATE INDEX idx_login_attempts_at ON login_attempts(at,id)'}
  ]),
  foreign_keys:wrap([]),
  counts:wrap([{users:0,sessions:0,locations:0,purchase_orders:0,
    stocktakes:0,stock_moves:0,audit_logs:0}]),
  quick:wrap([{quick_check:'ok'}])
 };
}
test('production G5 config is isolated from preview and contains no Worker deploy definition',async()=>{
 const m=await modulePromise;
 const worker=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
 const staging=JSON.parse(fs.readFileSync(path.join(root,'wrangler.preview-migrations.jsonc'),'utf8'));
 const prod=JSON.parse(fs.readFileSync(path.join(root,'wrangler.production-initialize.jsonc'),'utf8'));
 assert.equal(m.verifyProductionTarget(worker,staging,prod,'31b409b04896d260ba0fadf6cc2bb305'),true);
 for(const mutate of [
  x=>x.d1_databases[0].database_id='2c355bed-d9c3-449c-aa9b-1018f3bc1177',
  x=>x.d1_databases[0].binding='DB',
  x=>x.d1_databases[0].migrations_dir='../unsafe',
  x=>x.assets={directory:'./vercel-demo'},
  x=>x.main='./cloudflare/worker.mjs',
  x=>x.vars={CLOUD_AUTH_PHASE:'enabled'}
 ]){const p=structuredClone(prod);mutate(p);assert.throws(()=>m.verifyProductionTarget(worker,staging,p,'31b409b04896d260ba0fadf6cc2bb305'),/E_PROD_D1_G5_GUARD/);}
 assert.throws(()=>m.verifyProductionTarget(worker,staging,prod,'b'.repeat(32)),/E_PROD_D1_G5_GUARD/);
});
test('migrations are exactly two allowlisted SHA-pinned migrations with 22 tables and three indexes',async()=>{
 const m=await modulePromise;
 assert.deepEqual(m.verifyExactMigrations(path.join(root,'cloudflare/migrations')),
  {schema_tables:22,migrations:2,login_indexes:3});
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'g5-test-migrations-'));
 try{
  for(const name of ['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'])
   fs.copyFileSync(path.join(root,'cloudflare/migrations',name),path.join(tmp,name));
  fs.appendFileSync(path.join(tmp,'0001_initial_v3.sql'),'\n-- appended');
  assert.throws(()=>m.verifyExactMigrations(tmp),/E_PROD_D1_G5_GUARD/);
  fs.copyFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),path.join(tmp,'0001_initial_v3.sql'));
  fs.writeFileSync(path.join(tmp,'0003_unknown.sql'),'CREATE TABLE unknown(id);');
  assert.throws(()=>m.verifyExactMigrations(tmp),/E_PROD_D1_G5_GUARD/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('preflight permits only D1 reserved _cf_KV and quick_check ok',async()=>{
 const m=await modulePromise;
 assert.equal(m.assertPristineProduction(pristine()).status,'PROD_D1_PRISTINE_READONLY_PASS');
 const x=pristine();x.objects[0].results.push({type:'index',name:'_cf_index',tbl_name:'_cf_KV'});
 assert.equal(m.assertPristineProduction(x).production_ready,false);
});
test('preflight refuses all business, migration, view, trigger, user-index or damaged DB states',async()=>{
 const m=await modulePromise;
 const bad=[
  s=>s.objects[0].results.push({type:'table',name:'users',tbl_name:'users'}),
  s=>s.objects[0].results.push({type:'table',name:'d1_migrations',tbl_name:'d1_migrations'}),
  s=>s.objects[0].results.push({type:'view',name:'legacy',tbl_name:'legacy'}),
  s=>s.objects[0].results.push({type:'trigger',name:'write',tbl_name:'users'}),
  s=>s.objects[0].results.push({type:'index',name:'weird',tbl_name:'_cf_KV'}),
  s=>s.objects[0].results=[],
  s=>s.objects[0].results[0].name='_cf_Other',
  s=>s.objects=[{success:false,results:[]}],
  s=>s.quick[0].results[0].quick_check='disk I/O error',
  s=>s.quick[0].results=[],
  s=>s.bad={success:true,results:[]}
 ];
 for(const change of bad){const p=pristine();change(p);
  assert.throws(()=>m.assertPristineProduction(p),/E_PROD_D1_G5_GUARD/);}
});
test('postflight proves exactly 22 business tables plus ledger, both migrations, empty business, FK ok',async()=>{
 const m=await modulePromise,report=m.verifyInitializedProduction(migrated(),sql);
 assert.equal(report.status,'PROD_D1_SCHEMA_ONLY_POSTFLIGHT_PASS');
 assert.equal(report.owner_created,false);
 assert.equal(report.login_enabled,false);
 assert.equal(report.production_ready,false);
});
test('postflight fails closed on missing tables, new data, migrations, index, FK errors, schema drift',async()=>{
 const m=await modulePromise;
 const bad=[
  p=>p.tables[0].results.pop(),
  p=>p.tables[0].results.push({name:'unexpected'}),
  p=>p.contract[0].results[0].contract_version=2,
  p=>p.migrations[0].results.reverse(),
  p=>p.indexes[0].results[0].sql='CREATE INDEX idx_login_attempts_username_nocase_at ON users(id)',
  p=>p.indexes[0].results.push({name:'extra',sql:'CREATE INDEX extra ON users(id)'}),
  p=>p.foreign_keys[0].results.push({table:'users'}),
  p=>p.counts[0].results[0].users=1,
  p=>p.counts[0].results[0].sessions=1,
  p=>p.counts[0].results[0].stock_moves=1,
  p=>p.counts[0].results[0].users='0',
  p=>p.quick[0].results[0].quick_check='bad',
  p=>p.counts[0].results[0].password_hash='LEAK'
 ];
 for(const change of bad){const input=migrated();change(input);
  assert.throws(()=>m.verifyInitializedProduction(input,sql),/E_PROD_D1_G5_GUARD/);}
});
test('production initialization workflow is main-only, manual, explicitly gated and no owner bootstrap',()=>{
 const f=fs.readFileSync(path.join(root,'.github/workflows/d1-production-initialize-g5.yml'),'utf8');
 assert.match(f,/^  workflow_dispatch:/m);
 assert.doesNotMatch(f,/^\s*(push|pull_request|schedule):/m);
 assert.match(f,/github\.ref == 'refs\/heads\/main'/);
 assert.match(f,/INITIALIZE_EMPTY_PROD_D1_V3_0001_0002/);
 assert.match(f,/RECOVERY_REHEARSED_AND_APPROVED/);
 assert.match(f,/expected_main_sha == github\.sha/);
 assert.match(f,/environment: d1-production-migration/);
 assert.match(f,/vars\.PROD_D1_SCHEMA_APPLY_RELEASE/);
 assert.match(f,/vars\.PROD_D1_RESTORE_DRILL_SIGNED_OFF/);
 assert.match(f,/vars\.PROD_D1_G1_REVIEWED_RUN/);
 assert.match(f,/40854101717/);
 assert.match(f,/CLOUDFLARE_PROD_D1_READ_TOKEN/);
 assert.match(f,/CLOUDFLARE_PROD_D1_WRITE_TOKEN/);
 assert.match(f,/node tools\/cloudflare-hosted-probe-preflight\.mjs/g);
 assert.match(f,/wrangler@4\.152\.0/);
 assert.match(f,/d1 migrations apply PROD_DB --remote --config wrangler\.production-initialize\.jsonc/);
 assert.doesNotMatch(f,/d1 migrations apply DB\b|STAGING_DB --remote --config wrangler\.production-initialize/);
 assert.doesNotMatch(f,/wrangler deploy|time-travel restore|seed.owner|STAGING_OWNER_PASSWORD/);
 assert.match(f,/PROD_D1_SCHEMA_ONLY_VERIFIED; NO OWNER, NO LOGIN, NO OPERATIONS ENABLED/);
});
test('CLI output never exposes DB IDs, account, passwords or raw JSON, and exits on invalid preflight',async()=>{
 const {ACCOUNT_ID}=await import('../tools/check-cloudflare-staging.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g5-pristine-'));
 try{
  for(const [name,data] of Object.entries(pristine()))
   fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(data),{mode:0o600});
  const script=path.join(root,'tools/cloudflare-prod-d1-init.mjs');
  const run=()=>spawnSync(process.execPath,[script,'preflight',dir],{
   cwd:root,encoding:'utf8',timeout:15000,
   env:{...process.env,CLOUDFLARE_ACCOUNT_ID:ACCOUNT_ID}
  });
  const good=run();assert.equal(good.status,0,good.stderr);
  assert.equal(JSON.parse(good.stdout).production_ready,false);
  assert.doesNotMatch(good.stdout,/database_id|password|31b409b0|b882a6e8/);
  const bad=pristine();bad.objects[0].results.push({type:'table',name:'users',tbl_name:'users'});
  fs.writeFileSync(path.join(dir,'objects.json'),JSON.stringify(bad.objects));
  const no=run();assert.equal(no.status,1);
  assert.match(no.stderr,/E_PROD_D1_G5_GUARD_FAILED/);
  assert.doesNotMatch(no.stderr,/users|database_id|31b409b0|b882a6e8/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
