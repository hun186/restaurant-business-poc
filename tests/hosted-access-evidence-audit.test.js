'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const os=require('node:os');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const cli=path.join(__dirname,'../tools/hosted-access-evidence-audit.mjs');
const promise=import('../tools/hosted-access-evidence-audit.mjs');
const ISO=new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace('.000Z','Z');
async function valid(){
  const {EXPECTED_WORKER,REQUIRED_CHECKS}=await promise;
  return {schema_version:1,target_worker:EXPECTED_WORKER,observed_at_utc:ISO,
    checks:Object.fromEntries(REQUIRED_CHECKS.map(k=>[k,true]))};
}
function runJSON(value){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'private-access-evidence-'));
  const file=path.join(dir,'private.json');
  try{
    fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
    return spawnSync(process.execPath,[cli,file],{encoding:'utf8',timeout:10000});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('complete private checklist never certifies Access, URL exposure, CPU or deployment',async()=>{
  const {auditPrivateAccessEvidence}=await promise;
  const result=auditPrivateAccessEvidence(await valid());
  assert.equal(result.status,'EVIDENCE_RECORD_COMPLETE_NOT_VERIFIED');
  assert.equal(result.record_complete,true);
  for(const key of ['live_cloudflare_access_verified','version_and_deployment_url_exposure_verified',
    'remote_cpu_verified','deployment_authorized'])assert.equal(result[key],false);
  assert.match(result.next,/INDEPENDENT_LIVE/);
});
test('example or absent timestamp remains incomplete',async()=>{
  const {auditPrivateAccessEvidence}=await promise;
  const record=await valid();record.observed_at_utc=null;
  record.checks.scope_all_traffic_not_previews_only=false;
  const result=auditPrivateAccessEvidence(record);
  assert.equal(result.record_complete,false);
  assert.ok(result.outstanding_checks.includes('observed_at_utc_missing'));
  assert.ok(result.outstanding_checks.includes('scope_all_traffic_not_previews_only'));
});
test('all gates are required, especially bypass, hierarchy and version URLs',async()=>{
  const {auditPrivateAccessEvidence,REQUIRED_CHECKS}=await promise;
  for(const key of REQUIRED_CHECKS){
    const record=await valid();record.checks[key]=false;
    assert.deepEqual(auditPrivateAccessEvidence(record).outstanding_checks,[key]);
  }
});
test('fail closed on unknown fields, secret-like additions, malformed booleans or incorrect worker',async()=>{
  const {auditPrivateAccessEvidence}=await promise;
  const a=await valid();a.token='DO_NOT_LOG_ME';
  assert.throws(()=>auditPrivateAccessEvidence(a),/E_EVIDENCE_SCHEMA_KEYS/);
  const b=await valid();b.checks.bearer_token='DO_NOT_LOG_ME';
  assert.throws(()=>auditPrivateAccessEvidence(b),/E_EVIDENCE_SCHEMA_KEYS/);
  const c=await valid();c.checks.no_bypass_everyone_or_broad_access_policy='true';
  assert.throws(()=>auditPrivateAccessEvidence(c),/E_EVIDENCE_BOOLEAN_REQUIRED/);
  const d=await valid();d.target_worker='restaurant-business-poc';
  assert.throws(()=>auditPrivateAccessEvidence(d),/E_EVIDENCE_TARGET_OR_VERSION/);
});
test('reject impossible, stale and future timestamps',async()=>{
  const {auditPrivateAccessEvidence}=await promise;
  const record=await valid();
  record.observed_at_utc='2026-02-31T11:00:00Z';
  assert.throws(()=>auditPrivateAccessEvidence(record),/E_EVIDENCE_TIMESTAMP_FORMAT/);
  record.observed_at_utc='2020-01-01T00:00:00Z';
  assert.equal(auditPrivateAccessEvidence(record).record_complete,false);
  assert.ok(auditPrivateAccessEvidence(record).outstanding_checks.includes('observed_at_utc_stale'));
  record.observed_at_utc=new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,'Z');
  assert.ok(auditPrivateAccessEvidence(record).outstanding_checks.includes('observed_at_utc_in_future'));
});
test('CLI reads only private path, does not print evidence or claim live proof',async()=>{
  const record=await valid();
  const ok=runJSON(record);
  assert.equal(ok.status,0,ok.stderr);
  const parsed=JSON.parse(ok.stdout);
  assert.equal(parsed.record_complete,true);
  assert.equal(parsed.deployment_authorized,false);
  assert.doesNotMatch(ok.stdout,/correct_account_and_dedicated_worker_id.*true/);
  const incomplete=await valid();incomplete.checks.version_preview_and_deployment_urls_checked=false;
  const bad=runJSON(incomplete);
  assert.equal(bad.status,2,bad.stderr);
  assert.equal(JSON.parse(bad.stdout).record_complete,false);
});
test('CLI rejects repository-local evidence before opening and missing arguments',()=>{
  const missing=spawnSync(process.execPath,[cli],{encoding:'utf8'});
  assert.equal(missing.status,1);
  assert.match(missing.stderr,/E_EVIDENCE_FILE_ARGUMENT_REQUIRED/);
  const inRepo=spawnSync(process.execPath,[cli,path.join(__dirname,'not-existing.json')],{encoding:'utf8'});
  assert.equal(inRepo.status,1);
  assert.match(inRepo.stderr,/E_PRIVATE_EVIDENCE_MUST_BE_OUTSIDE_REPO/);
});
test('Windows distinct drives are outside the repository; sibling and prefix paths are handled',async()=>{
  const {isOutsideRepository}=await promise;
  const w=path.win32;
  const repo='D:\\a\\restaurant-business-poc\\restaurant-business-poc';
  assert.equal(isOutsideRepository(repo,'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\evidence.json',w),true);
  assert.equal(isOutsideRepository(repo,'D:\\a\\restaurant-business-poc\\restaurant-business-poc\\tests\\evidence.json',w),false);
  assert.equal(isOutsideRepository(repo,'D:\\a\\restaurant-business-poc\\other\\evidence.json',w),true);
  assert.equal(isOutsideRepository(repo,'D:\\a\\restaurant-business-poc\\restaurant-business-poc-copy\\evidence.json',w),true);
  assert.equal(isOutsideRepository(repo,repo,w),false);
});
test('no Cloudflare API, token, network or subprocess execution in audit CLI',()=>{
  const src=fs.readFileSync(cli,'utf8');
  assert.doesNotMatch(src,/api\.cloudflare\.com|fetch\s*\(|https\.request|execSync|spawnSync|CLOUDFLARE_API_TOKEN/);
  assert.match(src,/deployment_authorized:false/);
});
