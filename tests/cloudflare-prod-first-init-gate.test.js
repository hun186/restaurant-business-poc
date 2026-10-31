'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const modulePromise=import('../tools/cloudflare-prod-first-init-gate.mjs');
const script=path.join(root,'tools/cloudflare-prod-first-init-gate.mjs');
const sha='9a4969d6ee2adaec78f841ef75e954584bffe44b';
const approved=()=>({
  mode:'first-init',github_ref:'refs/heads/main',github_sha:sha,expected_sha:sha,
  confirm:'INITIALIZE_PRISTINE_PROD_D1_V3_0001_0002',
  first_init_ack:'I_APPROVE_EMPTY_PRODUCTION_FIRST_INIT_WITHOUT_RESTORE_DRILL',
  recovery_ack:'',pristine_run:'41207484827',release_sha:sha,
  approval:'PRISTINE_EMPTY_PRODUCTION_SCHEMA_ONLY',approved_pristine_run:'41207484827'
});
test('only exact same-main-SHA and manually approved first-init read-only evidence passes',async()=>{
 const m=await modulePromise;
 assert.deepEqual(m.verifyPristineFirstInitApproval(approved()),{
   status:'G5_PRISTINE_FIRST_INIT_RELEASE_GATE_PASS',production_write_performed:false,
   restore_drill_verified:false,production_ready:false
 });
});
test('fail closed on every wrong or missing first-init authorization dimension',async()=>{
 const m=await modulePromise;
 const wrong={
  mode:['apply','preflight',''],
  github_ref:['refs/heads/dev','refs/tags/v1',''],
  github_sha:['b'.repeat(40),'bad',''],
  expected_sha:['b'.repeat(40),'bad',''],
  confirm:['PROD_D1_READONLY_CHECK','INITIALIZE_EMPTY_PROD_D1_V3_0001_0002',''],
  first_init_ack:['RECOVERY_REHEARSED_AND_APPROVED','', 'I_APPROVE_EMPTY_PRODUCTION_FIRST_INIT_WITHOUT_RESTORE_DRILL '],
  recovery_ack:['RECOVERY_REHEARSED_AND_APPROVED','x'],
  pristine_run:['41046807367','', '41207484827 '],
  release_sha:['b'.repeat(40),'','9a4969d6ee2adaec78f841ef75e954584bffe44B'],
  approval:['','RECOVERY_REHEARSED_AND_APPROVED','PRISTINE_EMPTY_PRODUCTION_SCHEMA_ONLY '],
  approved_pristine_run:['','40914927490']
 };
 for(const [k,values] of Object.entries(wrong))for(const value of values) {
   const t=approved();t[k]=value;
   assert.throws(()=>m.verifyPristineFirstInitApproval(t),/E_G5_FIRST_INIT_GATE/,k+': '+value);
 }
 for(const key of Object.keys(approved())) {
   const t=approved();delete t[key];
   assert.throws(()=>m.verifyPristineFirstInitApproval(t),/E_G5_FIRST_INIT_GATE/,key);
 }
 assert.throws(()=>m.verifyPristineFirstInitApproval(null),/E_G5_FIRST_INIT_GATE/);
});
test('CLI admits only complete env and never prints inputs or executes D1 writes',()=>{
 const t=approved();
 const env={...process.env,
  G5_MODE:t.mode,GITHUB_REF:t.github_ref,GITHUB_SHA:t.github_sha,
  G5_EXPECTED_SHA:t.expected_sha,G5_CONFIRM:t.confirm,
  G5_FIRST_INIT_ACK:t.first_init_ack,G5_RECOVERY_ACK:t.recovery_ack,
  G5_PRISTINE_RUN:t.pristine_run,G5_FIRST_INIT_RELEASE_SHA:t.release_sha,
  G5_FIRST_INIT_APPROVED:t.approval,G5_FIRST_INIT_PREFLIGHT_RUN:t.approved_pristine_run};
 const run=e=>spawnSync(process.execPath,[script],{cwd:root,encoding:'utf8',timeout:12000,env:e});
 const pass=run(env);assert.equal(pass.status,0,pass.stderr);
 assert.equal(JSON.parse(pass.stdout).production_write_performed,false);
 assert.doesNotMatch(pass.stdout,/41207484827|9a4969d6|password|token|bookmark/);
 for(const key of ['G5_FIRST_INIT_APPROVED','G5_FIRST_INIT_RELEASE_SHA','G5_PRISTINE_RUN','G5_FIRST_INIT_ACK']){
  const e={...env,[key]:''};const rejected=run(e);
  assert.equal(rejected.status,1,key);assert.match(rejected.stderr,/G5_PRISTINE_FIRST_INIT_GATE_CLOSED/);
  assert.doesNotMatch(rejected.stderr,/9a4969|41207484827|password|token|secret/);
 }
});
test('workflow preserves legacy restore-gated path while first-init has independent guarded release',()=>{
 const f=fs.readFileSync(path.join(root,'.github/workflows/d1-production-initialize-g5.yml'),'utf8');
 assert.match(f,/^  workflow_dispatch:/m);
 assert.doesNotMatch(f,/^\s*(push|pull_request|schedule):/m);
 assert.match(f,/^          - first-init$/m);
 assert.match(f,/^          - apply$/m);
 assert.match(f,/github\.ref == 'refs\/heads\/main'/g);
 assert.match(f,/inputs\.expected_main_sha == github\.sha/g);
 assert.match(f,/inputs\.first_init_ack == 'I_APPROVE_EMPTY_PRODUCTION_FIRST_INIT_WITHOUT_RESTORE_DRILL'/g);
 assert.match(f,/inputs\.pristine_run == '41207484827'/g);
 assert.match(f,/G5_FIRST_INIT_RELEASE_SHA: \$\{\{ vars\.PROD_D1_FIRST_INIT_RELEASE_SHA \}\}/);
 assert.match(f,/G5_FIRST_INIT_APPROVED: \$\{\{ vars\.PROD_D1_FIRST_INIT_APPROVED \}\}/);
 assert.match(f,/G5_FIRST_INIT_PREFLIGHT_RUN: \$\{\{ vars\.PROD_D1_FIRST_INIT_PREFLIGHT_RUN \}\}/);
 assert.match(f,/node tools\/cloudflare-prod-first-init-gate\.mjs/);
 assert.match(f,/RESTORE_SIGNOFF.*PROD_D1_RESTORE_DRILL_SIGNED_OFF/);
 assert.match(f,/RECOVERY_REHEARSED_AND_APPROVED/);
 assert.match(f,/environment: d1-production-readonly/);
 assert.match(f,/environment: d1-production-migration/);
 assert.match(f,/Repeat pristine check on production immediately before initialization/);
 assert.match(f,/Record current recoverable D1 bookmark without publishing it/);
 assert.match(f,/d1 migrations apply PROD_DB --remote --config wrangler\.production-initialize\.jsonc/);
 assert.match(f,/PROD_D1_SCHEMA_ONLY_VERIFIED; NO OWNER, NO LOGIN, NO OPERATIONS ENABLED/);
 assert.doesNotMatch(f,/time-travel restore|wrangler deploy|STAGING_OWNER_PASSWORD/);
});
