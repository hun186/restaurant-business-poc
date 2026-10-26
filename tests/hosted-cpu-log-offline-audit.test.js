'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const cli=path.join(__dirname,'../tools/hosted-cpu-log-offline-audit.mjs');
const promise=import('../tools/hosted-cpu-log-offline-audit.mjs');
const iso=()=>new Date(Math.floor(Date.now()/1000)*1000).toISOString().replace('.000Z','Z');
const sample=(cpu=3,wall=10,outcome='ok')=>({cpuTimeMs:cpu,wallTimeMs:wall,outcome});
const fixture=()=>({schema_version:1,source:'workers_invocation_logs_manually_redacted',
 target_worker:'restaurant-pbkdf2-hosted-cpu-staging-probe',observed_at_utc:iso(),
 operations:{hash:Array.from({length:5},()=>sample()),verify_correct:Array.from({length:5},()=>sample(4,12)),
   verify_wrong:Array.from({length:5},()=>sample(5,15))}});
function run(record){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cpu-offline-record-'));
 try{
  const filename=path.join(dir,'private.json');fs.writeFileSync(filename,JSON.stringify(record),{mode:0o600});
  return spawnSync(process.execPath,[cli,filename],{encoding:'utf8',timeout:10000});
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
test('offline observations cannot certify Cloudflare Access or CPU provenance',async()=>{
 const {analyzeCpuEvidence}=await promise;
 const x=analyzeCpuEvidence(fixture());
 assert.equal(x.status,'OBSERVED_SAMPLES_BELOW_FREE_REFERENCE_NOT_CERTIFIED');
 assert.equal(x.observations.hash.count,5);
 assert.equal(x.observations.verify_correct.median_cpu_ms,4);
 for(const name of ['platform_log_provenance_verified','live_cloudflare_access_verified',
 'version_and_deployment_url_exposure_verified','remote_cpu_independently_verified',
 'deployment_authorized'])assert.equal(x[name],false);
});
test('Free 10ms CPU reference compares cpuTimeMs, NEVER wallTimeMs',async()=>{
 const {analyzeCpuEvidence}=await promise;
 const x=fixture();x.operations.hash[0].wallTimeMs=50000;
 assert.equal(analyzeCpuEvidence(x).limitations.includes('FREE_10MS_REFERENCE_REACHED'),false);
 x.operations.hash[0].cpuTimeMs=10;
 const y=analyzeCpuEvidence(x);
 assert.equal(y.status,'OBSERVED_CPU_RISK_NEEDS_INVESTIGATION');
 assert.equal(y.observations.hash.at_or_above_10ms,1);
 assert.equal(y.observations.hash.max_cpu_ms,10);
});
test('platform non-ok outcomes including exceededCpu block optimistic conclusion',async()=>{
 const {analyzeCpuEvidence}=await promise;
 for(const outcome of ['exception','exceededCpu','exceededMemory','canceled','unknown']){
  const x=fixture();x.operations.verify_wrong[1].outcome=outcome;
  const y=analyzeCpuEvidence(x);
  assert.equal(y.status,'OBSERVED_CPU_RISK_NEEDS_INVESTIGATION');
  assert.equal(y.observations.verify_wrong.non_ok_outcomes,1);
 }
});
test('too few samples, stale and future observations are never accepted as complete',async()=>{
 const {analyzeCpuEvidence}=await promise;
 const x=fixture();x.operations.hash.pop();
 assert.equal(analyzeCpuEvidence(x).status,'INSUFFICIENT_OR_STALE_CPU_EVIDENCE');
 x.operations.hash.push(sample());x.observed_at_utc='2020-01-01T00:00:00Z';
 assert.ok(analyzeCpuEvidence(x).limitations.includes('OBSERVED_TIME_OVER_48H'));
 x.observed_at_utc=new Date(Date.now()+3600000).toISOString().replace(/\.\d{3}Z$/,'Z');
 assert.ok(analyzeCpuEvidence(x).limitations.includes('OBSERVED_TIME_IN_FUTURE'));
});
test('incomplete, nonfinite and negative CPU measurements fail closed',async()=>{
 const {analyzeCpuEvidence}=await promise;
 for(const value of [-1,null,'3',NaN,Infinity]){
  const x=fixture();x.operations.hash[0].cpuTimeMs=value;
  assert.throws(()=>analyzeCpuEvidence(x),/E_CPU_MEASUREMENT_REQUIRED/);
 }
 const x=fixture();delete x.operations.hash[0].cpuTimeMs;
 assert.throws(()=>analyzeCpuEvidence(x),/E_CPU_RECORD_SCHEMA/);
});
test('prevent ID, URL, header, secret, extra or missing operation from entering schema',async()=>{
 const {analyzeCpuEvidence}=await promise;
 const x=fixture();x.account_id='PRIVATE_ACCOUNT';assert.throws(()=>analyzeCpuEvidence(x),/E_CPU_RECORD_SCHEMA/);
 const y=fixture();y.operations.hash[0].request_url='https://private.example';assert.throws(()=>analyzeCpuEvidence(y),/E_CPU_RECORD_SCHEMA/);
 const z=fixture();z.operations.new_op=[sample()];assert.throws(()=>analyzeCpuEvidence(z),/E_CPU_RECORD_SCHEMA/);
 const q=fixture();delete q.operations.verify_correct;assert.throws(()=>analyzeCpuEvidence(q),/E_CPU_RECORD_SCHEMA/);
});
test('invalid outcomes, excessive sample counts and spoofed sources fail closed',async()=>{
 const {analyzeCpuEvidence}=await promise;
 const x=fixture();x.operations.hash[0].outcome='success';assert.throws(()=>analyzeCpuEvidence(x),/E_CPU_OUTCOME/);
 const y=fixture();y.operations.hash=Array.from({length:101},()=>sample());assert.throws(()=>analyzeCpuEvidence(y),/E_CPU_SAMPLE_COUNT/);
 const z=fixture();z.source='local_performance_now';assert.throws(()=>analyzeCpuEvidence(z),/E_CPU_RECORD_TARGET_OR_SOURCE/);
});
test('invalid timestamps are rejected without fetching network time',async()=>{
 const {analyzeCpuEvidence}=await promise;
 for(const date of ['2026-02-31T00:00:00Z','2026-10-27T01:10:00+08:00','2026-01-01','0000-00-00T00:00:00Z']){
  const x=fixture();x.observed_at_utc=date;
  assert.throws(()=>analyzeCpuEvidence(x),/E_CPU_OBSERVED_TIME/);
 }
});
test('CLI only reads external redacted JSON; never leaks records',()=>{
 const good=run(fixture());
 assert.equal(good.status,0,good.stderr);
 assert.equal(JSON.parse(good.stdout).deployment_authorized,false);
 const bad=fixture();bad.operations.hash[0].cpuTimeMs=12;
 const result=run(bad);
 assert.equal(result.status,2,result.stderr);
 assert.equal(JSON.parse(result.stdout).status,'OBSERVED_CPU_RISK_NEEDS_INVESTIGATION');
 assert.doesNotMatch(result.stdout,/PRIVATE_ACCOUNT|password|token/i);
});
test('CLI rejects missing arguments and any repository-local record',()=>{
 const empty=spawnSync(process.execPath,[cli],{encoding:'utf8'});
 assert.equal(empty.status,1);
 assert.match(empty.stderr,/E_CPU_RECORD_PATH_REQUIRED/);
 const inRepo=spawnSync(process.execPath,[cli,path.join(__dirname,'nonexistent.json')],{encoding:'utf8'});
 assert.equal(inRepo.status,1);
 assert.match(inRepo.stderr,/E_CPU_RECORD_MUST_BE_OUTSIDE_REPO/);
});
test('CLI never contacts Cloudflare or runs subprocesses',()=>{
 const src=fs.readFileSync(cli,'utf8');
 assert.doesNotMatch(src,/api\.cloudflare\.com|fetch\s*\(|https\.request|execSync|spawnSync|CLOUDFLARE_API_TOKEN|wrangler deploy/);
 assert.match(src,/deployment_authorized:false/);
});
