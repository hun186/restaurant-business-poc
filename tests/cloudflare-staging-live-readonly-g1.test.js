'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const cli=path.join(root,'tools/cloudflare-staging-live-audit.mjs');
const loader=import('../tools/cloudflare-staging-live-audit.mjs');
const schema=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const wrap=results=>[{success:true,results}];
const tables=[...schema.matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)]
  .map(v=>v[1]);
function valid(){
 return {
   tables:wrap([...tables,'d1_migrations'].sort().map(name=>({name}))),
   contract:wrap([{contract_version:3}]),
   migrations:wrap(['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'].map(name=>({name}))),
   indexes:wrap([
     {name:'idx_login_attempts_at',sql:'CREATE INDEX idx_login_attempts_at ON login_attempts(at,id)'},
     {name:'idx_login_attempts_ip_hash_at',sql:'CREATE INDEX idx_login_attempts_ip_hash_at ON login_attempts(ip_hash,at)'},
     {name:'idx_login_attempts_username_nocase_at',sql:'CREATE INDEX idx_login_attempts_username_nocase_at ON login_attempts(username COLLATE NOCASE,at)'}
   ]),
   fk:wrap([]),
   counts:wrap([{total_users:1,active_owners:1,total_owners:1,sessions:0,
     purchase_orders:0,stocktakes:0,stock_moves:0}])
 };
}
test('read-only staging G1 contract accepts exact v3 + 0002 + one active Owner',async()=>{
 const mod=await loader;
 assert.equal(mod.verifyLocalTarget(
   JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8')),
   JSON.parse(fs.readFileSync(path.join(root,'wrangler.preview-migrations.jsonc'),'utf8')),
   mod.ACCOUNT_ID
 ),true);
 const result=mod.auditStagingSnapshot(valid(),schema);
 assert.equal(result.status,'STAGING_G1_READONLY_REMOTE_SNAPSHOT_CONSISTENT');
 assert.equal(result.foreign_keys,'verified_empty');
 assert.equal(result.live_access_verified,false);
 assert.equal(result.production_d1_verified,false);
 assert.equal(result.production_deploy_authorized,false);
 assert.equal(result.operations_write_enabled,false);
 assert.doesNotMatch(JSON.stringify(result),/password|user_id|token_hash/i);
});
test('staging target must not accidentally point at production or different account',async()=>{
 const mod=await loader;
 const worker=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
 const stage=JSON.parse(fs.readFileSync(path.join(root,'wrangler.preview-migrations.jsonc'),'utf8'));
 assert.throws(()=>mod.verifyLocalTarget(worker,stage,'a'.repeat(32)),/E_STAGING_G1_READONLY_CONTRACT/);
 const wrong=structuredClone(stage);
 wrong.d1_databases[0].database_id=worker.d1_databases[0].database_id;
 assert.throws(()=>mod.verifyLocalTarget(worker,wrong,mod.ACCOUNT_ID),/E_STAGING_G1_READONLY_CONTRACT/);
});
test('reject unexpected tables, missing migration, schema drift, index mutation or FK corruption',async()=>{
 const {auditStagingSnapshot:audit}=await loader;
 const mutate=[
   r=>r.tables[0].results.push({name:'unexpected_table'}),
   r=>r.tables[0].results.splice(0,1),
   r=>r.contract[0].results[0].contract_version=2,
   r=>r.migrations[0].results.pop(),
   r=>r.migrations[0].results.push({name:'0003_other.sql'}),
   r=>r.indexes[0].results[0].sql='CREATE INDEX idx_login_attempts_at ON users(id)',
   r=>r.indexes[0].results.pop(),
   r=>r.fk[0].results.push({table:'stock_moves',rowid:1,parent:'ingredients',fkid:0}),
   r=>r.counts[0].results[0].active_owners=0,
   r=>r.counts[0].results[0].total_owners=2,
   r=>r.counts[0].results[0].total_users=-1,
   r=>r.counts[0].results[0].total_users='1',
   r=>r.counts[0].results[0].username='synthetic-user',
   r=>r.tables[0].results[0].sql='CREATE TABLE bogus',
   r=>r.unknown=wrap([])
 ];
 for(const change of mutate){const input=valid();change(input);
   assert.throws(()=>audit(input,schema),/E_STAGING_G1_READONLY_CONTRACT/);
 }
});
test('refuse malformed Wrangler JSON, failed query, multiple result sets and partial metadata',async()=>{
 const {auditStagingSnapshot:audit}=await loader;
 const vals=[
  r=>r.counts={success:false,results:[]},
  r=>r.migrations=[{success:false,results:[{name:'0001_initial_v3.sql'}]}],
  r=>r.contract=[{success:true,results:[]},{success:true,results:[{contract_version:3}]}],
  r=>r.indexes[0].results[0].name=null
 ];
 for(const mutate of vals){const input=valid();mutate(input);
  assert.throws(()=>audit(input,schema));
 }
});
test('CLI uses only synthetic snapshot and prints no collected counts or raw response',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g1-readonly-synth-'));
 try{
  const snap=valid();
  for(const [k,v] of Object.entries(snap))
   fs.writeFileSync(path.join(dir,k+'.json'),JSON.stringify(v),{mode:0o600});
  const {ACCOUNT_ID}=await loader;
  const processResult=spawnSync(process.execPath,[cli,'verify',dir],
    {cwd:root,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:ACCOUNT_ID},encoding:'utf8',timeout:15000});
  assert.equal(processResult.status,0,processResult.stderr);
  const out=JSON.parse(processResult.stdout);
  assert.equal(out.status,'STAGING_G1_READONLY_REMOTE_SNAPSHOT_CONSISTENT');
  assert.equal(out.production_deploy_authorized,false);
  assert.doesNotMatch(processResult.stdout,/total_users|active_owners|password|database_id/);
  snap.counts[0].results[0].total_owners=0;
  fs.writeFileSync(path.join(dir,'counts.json'),JSON.stringify(snap.counts));
  const denied=spawnSync(process.execPath,[cli,'verify',dir],
    {cwd:root,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:ACCOUNT_ID},encoding:'utf8',timeout:15000});
  assert.equal(denied.status,1);
  assert.match(denied.stderr,/E_STAGING_G1_READONLY_AUDIT_FAILED/);
  assert.doesNotMatch(denied.stderr,/total_owners|0x|database_id/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('manual workflow is main-only, secret-scoped, D1 STAGING_DB read-only and never deploys',()=>{
 const wf=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-live-readonly-g1.yml'),'utf8');
 assert.match(wf,/^on:\s*$/m);
 assert.match(wf,/^  workflow_dispatch:/m);
 assert.doesNotMatch(wf,/^\s*(push|pull_request|schedule):/m);
 assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
 assert.match(wf,/inputs\.confirm == 'CHECK_STAGING_G1_READONLY'/);
 assert.match(wf,/environment: d1-staging/);
 assert.match(wf,/group: restaurant-business-d1-staging-migrations/);
 assert.match(wf,/node tools\/cloudflare-hosted-probe-preflight\.mjs/);
 assert.match(wf,/node tools\/cloudflare-staging-live-audit\.mjs config/);
 assert.match(wf,/node tools\/cloudflare-staging-live-audit\.mjs verify/);
 assert.match(wf,/npx --no-install wrangler d1 execute STAGING_DB --remote --json --config wrangler\.preview-migrations\.jsonc/);
 assert.match(wf,/wrangler@4\.152\.0/);
 assert.doesNotMatch(wf,/--config wrangler\.jsonc|d1 execute DB\b|d1 migrations apply|d1 execute [^\n]* --local|wrangler deploy|CLOUDFLARE_API_TOKEN: \S+\n\s*run: npm install/);
 assert.doesNotMatch(wf,/^\s*query\s+\w+\s+"(?:UPDATE|INSERT|DELETE|CREATE|ALTER|DROP|REPLACE)\b/m);
 assert.doesNotMatch(wf,/^\s*query\s+\w+\s+"SELECT (?:\*|id,|username,|password_|token_hash)/m);
 assert.match(wf,/trap 'rm -rf "\$snapshot"' EXIT/);
});
