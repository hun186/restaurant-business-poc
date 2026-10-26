// RB-035: Offline ONLY. Reads manually redacted Workers invocation measurements;
// NEVER connects to Cloudflare, authenticates log provenance or authorizes deployment.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isOutsideRepository} from './hosted-access-evidence-audit.mjs';

const WORKER='restaurant-pbkdf2-hosted-cpu-staging-probe';
const SOURCE='workers_invocation_logs_manually_redacted';
const OPS=Object.freeze(['hash','verify_correct','verify_wrong']);
const OUTCOMES=new Set(['ok','exception','exceededCpu','exceededMemory','canceled','unknown']);
const MIN_PER_OPERATION=5;
const FREE_CPU_REFERENCE_MS=10;
function fail(code){throw new Error(code);}
function exactKeys(value,keys){
  if(!value || typeof value!=='object' || Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))
    fail('E_CPU_RECORD_SCHEMA');
}
function timestamp(iso,now){
  if(typeof iso!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(iso))
    fail('E_CPU_OBSERVED_TIME');
  const n=Date.parse(iso);
  if(!Number.isFinite(n)||new Date(n).toISOString()!==iso.replace(/Z$/,'.000Z'))
    fail('E_CPU_OBSERVED_TIME');
  return {future:n>now+300000,stale:now-n>48*3600000};
}
function stat(values){
  const sorted=[...values].sort((a,b)=>a-b);
  const mid=Math.floor(sorted.length/2);
  const median=sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;
  return {median_cpu_ms:Number(median.toFixed(3)),
    p95_cpu_ms:sorted[Math.ceil(.95*sorted.length)-1],
    max_cpu_ms:sorted.at(-1)};
}
export function analyzeCpuEvidence(record,now=Date.now()){
  exactKeys(record,['schema_version','source','target_worker','observed_at_utc','operations']);
  if(record.schema_version!==1 || record.source!==SOURCE ||record.target_worker!==WORKER)
    fail('E_CPU_RECORD_TARGET_OR_SOURCE');
  const time=timestamp(record.observed_at_utc,now);
  exactKeys(record.operations,OPS);
  let failures=0,atLimit=0,insufficient=false;
  const summary={};
  for(const op of OPS){
    const entries=record.operations[op];
    if(!Array.isArray(entries) || entries.length>100 || entries.length===0)
      fail('E_CPU_SAMPLE_COUNT');
    if(entries.length<MIN_PER_OPERATION)insufficient=true;
    let nFailures=0,nAtLimit=0;
    const values=[],wall=[];
    for(const row of entries){
      exactKeys(row,['cpuTimeMs','wallTimeMs','outcome']);
      if(!Number.isFinite(row.cpuTimeMs)||row.cpuTimeMs<0||
         !Number.isFinite(row.wallTimeMs)||row.wallTimeMs<0)
        fail('E_CPU_MEASUREMENT_REQUIRED');
      if(typeof row.outcome!=='string'||!OUTCOMES.has(row.outcome))
        fail('E_CPU_OUTCOME');
      values.push(row.cpuTimeMs);
      wall.push(row.wallTimeMs);
      if(row.outcome!=='ok')nFailures++;
      if(row.cpuTimeMs>=FREE_CPU_REFERENCE_MS)nAtLimit++;
    }
    failures+=nFailures;atLimit+=nAtLimit;
    summary[op]={count:values.length,...stat(values),max_wall_ms:Math.max(...wall),
      non_ok_outcomes:nFailures,at_or_above_10ms:nAtLimit};
  }
  const limitations=[];
  if(time.future)limitations.push('OBSERVED_TIME_IN_FUTURE');
  if(time.stale)limitations.push('OBSERVED_TIME_OVER_48H');
  if(insufficient)limitations.push('TOO_FEW_SAMPLES');
  if(failures)limitations.push('NON_OK_INVOCATION_OUTCOMES');
  if(atLimit)limitations.push('FREE_10MS_REFERENCE_REACHED');
  const hasRisk=failures>0||atLimit>0;
  const status=hasRisk?'OBSERVED_CPU_RISK_NEEDS_INVESTIGATION':
    limitations.length?'INSUFFICIENT_OR_STALE_CPU_EVIDENCE':
    'OBSERVED_SAMPLES_BELOW_FREE_REFERENCE_NOT_CERTIFIED';
  return Object.freeze({
    status,free_cpu_reference_ms:FREE_CPU_REFERENCE_MS,
    source_is_manually_transcribed:true,
    sample_record_complete:!insufficient&&!time.future&&!time.stale,
    observations:summary,
    limitations,
    platform_log_provenance_verified:false,
    live_cloudflare_access_verified:false,
    version_and_deployment_url_exposure_verified:false,
    remote_cpu_independently_verified:false,
    deployment_authorized:false,
    next:'INDEPENDENT_CLOUDFLARE_LOG_AND_ACCESS_REVIEW_REQUIRED'
  });
}
const script=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===script){
  try{
    if(process.argv.length!==3)fail('E_CPU_RECORD_PATH_REQUIRED');
    const target=path.resolve(process.argv[2]);
    const root=path.resolve(path.dirname(script),'..');
    if(!isOutsideRepository(root,target))fail('E_CPU_RECORD_MUST_BE_OUTSIDE_REPO');
    if(path.extname(target).toLowerCase()!=='.json')
      fail('E_CPU_RECORD_JSON_REQUIRED');
    const st=fs.lstatSync(target);
    if(!st.isFile()||st.isSymbolicLink()||st.size>65536)
      fail('E_CPU_RECORD_FILE_TYPE_OR_SIZE');
    if(!isOutsideRepository(root,fs.realpathSync(target)))
      fail('E_CPU_RECORD_MUST_BE_OUTSIDE_REPO');
    let record;
    try{record=JSON.parse(fs.readFileSync(target,'utf8'));}
    catch{fail('E_CPU_INVALID_JSON');}
    const report=analyzeCpuEvidence(record);
    console.log(JSON.stringify(report));
    if(report.status!=='OBSERVED_SAMPLES_BELOW_FREE_REFERENCE_NOT_CERTIFIED')
      process.exitCode=2;
  }catch(err){
    // Do not output paths, request data, URLs, IDs or arbitrary exception text.
    const code=typeof err?.message==='string'&&/^E_[A-Z_]+$/.test(err.message)
      ?err.message:'E_CPU_RECORD_READ_FAILED';
    console.error('HOSTED_CPU_OFFLINE_ANALYSIS_FAIL: '+code);
    process.exitCode=1;
  }
}
