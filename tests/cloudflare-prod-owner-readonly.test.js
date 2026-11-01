'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const p=path.join(root,'tools/cloudflare-prod-owner-readonly.mjs');
const helper=import('../tools/cloudflare-prod-owner-readonly.mjs');
const owner=import('../tools/cloudflare-production-owner.mjs');
const wrap=x=>[{success:true,results:x}];
const empty=async()=>{
 const m=await owner;return {
  before:wrap([{contract_version:3,migration_total:2,migration_1:1,migration_2:1,
   ...Object.fromEntries(m.EMPTY_TABLES.map(t=>[t,0]))}]),
  after:wrap([{contract_version:3,migration_total:2,users:0,owners:0,sessions:0,
   login_attempts:0,audit_logs:0,owner_enrollment_audits:0}]),
  quick:wrap([{quick_check:'ok'}]),foreign:wrap([])
 };
};
const created=async()=>{
 const r=await empty();
 r.before[0].results[0].users=1;
 r.before[0].results[0].audit_logs=1;
 r.after[0].results[0]={contract_version:3,migration_total:2,users:1,owners:1,
  sessions:0,login_attempts:0,audit_logs:1,owner_enrollment_audits:1};
 return r;
};
test('only literal SELECT or read-only PRAGMA are exposed for cloud invocations',async()=>{
 const m=await helper;
 for(const k of ['before','after'])assert.match(m.ownerReadinessSql(k),/^SELECT /);
 assert.equal(m.ownerReadinessSql('quick'),'PRAGMA quick_check;');
 assert.equal(m.ownerReadinessSql('foreign'),'PRAGMA foreign_key_check;');
 for(const k of ['write','insert','migrate','owner',''])assert.throws(()=>m.ownerReadinessSql(k),/E_PRODUCTION_OWNER_READONLY/);
});
test('truly unused v3 Production database returns safe, credential-free ready-to-enroll status',async()=>{
 const m=await helper,x=m.verifyOwnerReadiness(await empty());
 assert.deepEqual(x,{status:'PRODUCTION_OWNER_READY_TO_ENROLL_READONLY',
  production_write_performed:false,owner_created_by_check:false,login_enabled_by_check:false,
  schema_version:3,applied_migrations:2,owner_count:0});
 assert.doesNotMatch(JSON.stringify(x),/password|token|account_id|database_id/i);
});
test('exactly one Owner with credential-free audit is recognized as already enrolled',async()=>{
 const m=await helper,x=m.verifyOwnerReadiness(await created());
 assert.equal(x.status,'PRODUCTION_OWNER_ALREADY_ENROLLED_READONLY');
 assert.equal(x.owner_count,1);
 assert.equal(x.production_write_performed,false);
});
test('incomplete or unexpected Owner, D1 ledger and integrity states fail closed',async()=>{
 const m=await helper;
 const changes=[
  x=>x.before[0].results[0].users=2,
  x=>x.before[0].results[0].locations=1,
  x=>x.before[0].results[0].migration_total=3,
  x=>x.before[0].results[0].contract_version=2,
  x=>x.after[0].results[0].contract_version=2,
  x=>x.after[0].results[0].migration_total=3,
  x=>x.after[0].results[0].owners=1,
  x=>x.after[0].results[0].users=2,
  x=>x.after[0].results[0].owner_enrollment_audits=1,
  x=>x.foreign[0].results.push({table:'users'}),
  x=>x.quick[0].results[0].quick_check='bad',
  x=>x.quick[0].results.push({quick_check:'ok'}),
  x=>x.before[0].success=false,
  x=>x.after[0].success=false,
  x=>x.foo='unexpected'
 ];
 for(const change of changes){const x=await empty();change(x);
  assert.throws(()=>m.verifyOwnerReadiness(x),/E_PRODUCTION_OWNER_READONLY/);
 }
 const bad=await created();bad.after[0].results[0].audit_logs=0;
 assert.throws(()=>m.verifyOwnerReadiness(bad),/E_PRODUCTION_OWNER_READONLY/);
});
test('CLI uses private files; prints only allowed status and rejects invalid payload',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prod-owner-readonly-'));
 const run=(mode,...args)=>spawnSync(process.execPath,[p,mode,...args],{
  cwd:root,encoding:'utf8',timeout:12000});
 try{
  for(const [k,v] of Object.entries(await empty()))
   fs.writeFileSync(path.join(dir,k+'.json'),JSON.stringify(v),{mode:0o600});
  const r=run('inspect',dir);assert.equal(r.status,0,r.stderr);
  assert.equal(JSON.parse(r.stdout).owner_count,0);
  assert.doesNotMatch(r.stdout,/password|token|database_id|account_id/i);
  const x=run('sql','before');assert.equal(x.status,0,x.stderr);
  assert.match(x.stdout,/^SELECT /);
  const bad=run('sql','DROP TABLE');assert.equal(bad.status,1);
  assert.equal(bad.stderr.trim(),'E_PRODUCTION_OWNER_READONLY');
  fs.writeFileSync(path.join(dir,'quick.json'),'{untrusted stuff',{mode:0o600});
  const error=run('inspect',dir);assert.equal(error.status,1);
  assert.equal(error.stderr.trim(),'E_PRODUCTION_OWNER_READONLY');
  assert.doesNotMatch(error.stderr,/untrusted stuff/);
 }finally{fs.rmSync(dir,{force:true,recursive:true});}
});
test('new readonly workflow is main/manual-only and never loads a D1 write token',()=>{
 const s=fs.readFileSync(path.join(root,'.github/workflows/d1-production-owner-readonly.yml'),'utf8');
 assert.match(s,/^  workflow_dispatch:/m);
 assert.doesNotMatch(s,/^\s*(push|pull_request|schedule):/m);
 assert.match(s,/github.ref == 'refs\/heads\/main'/);
 assert.match(s,/environment: d1-production-readonly/);
 assert.match(s,/CLOUDFLARE_PROD_D1_READ_TOKEN/);
 assert.doesNotMatch(s,/CLOUDFLARE_PROD_D1_WRITE_TOKEN|PRODUCTION_OWNER_PASSWORD|d1 migrations apply|d1 execute .*--file|wrangler deploy|time-travel restore/);
 assert.match(s,/cloudflare-hosted-probe-preflight/);
 assert.match(s,/cloudflare-prod-d1-init.mjs config/);
 assert.match(s,/cloudflare-prod-owner-readonly.mjs inspect/);
 assert.match(s,/--remote --json --config wrangler.production-initialize.jsonc/);
});
