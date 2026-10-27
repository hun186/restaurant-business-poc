// Offline private checklist consistency audit. Never reads Cloudflare credentials,
// contacts Cloudflare, proves actual Access state, or authorizes deployment.
// Evidence stays OUTSIDE this public repository; no evidence values are printed.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXPECTED_WORKER='restaurant-pbkdf2-hosted-cpu-staging-probe';
export const REQUIRED_CHECKS=Object.freeze([
  'correct_account_and_dedicated_worker_id',
  'destination_type_worker_not_preview_worker',
  'scope_all_traffic_not_previews_only',
  'no_bypass_everyone_or_broad_access_policy',
  'hostname_and_path_rule_precedence_checked',
  'account_level_fallback_checked',
  'routes_and_custom_domains_checked',
  'workers_dev_exposure_checked',
  'version_preview_and_deployment_urls_checked',
  'probe_disabled_and_no_public_routes_confirmed',
  'private_evidence_archived_outside_repository',
  'independent_human_review_completed'
]);

function requireExactKeys(obj,keys){
  if(!obj || typeof obj!=='object' || Array.isArray(obj) ||
     JSON.stringify(Object.keys(obj).sort())!==JSON.stringify([...keys].sort()))
    throw new Error('E_EVIDENCE_SCHEMA_KEYS');
}
export function auditPrivateAccessEvidence(record,nowMs=Date.now()){
  requireExactKeys(record,['schema_version','target_worker','observed_at_utc','checks']);
  if(record.schema_version!==1 || record.target_worker!==EXPECTED_WORKER)
    throw new Error('E_EVIDENCE_TARGET_OR_VERSION');
  requireExactKeys(record.checks,REQUIRED_CHECKS);
  if(!REQUIRED_CHECKS.every(key=>typeof record.checks[key]==='boolean'))
    throw new Error('E_EVIDENCE_BOOLEAN_REQUIRED');
  const outstanding=REQUIRED_CHECKS.filter(key=>record.checks[key]!==true);
  if(record.observed_at_utc===null){
    outstanding.push('observed_at_utc_missing');
  }else{
    const value=record.observed_at_utc;
    if(typeof value!=='string' ||
       !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) ||
       !Number.isFinite(Date.parse(value)) ||
       new Date(Date.parse(value)).toISOString().replace('.000Z','Z')!==value)
      throw new Error('E_EVIDENCE_TIMESTAMP_FORMAT');
    const at=Date.parse(value);
    if(at>nowMs+5*60*1000)outstanding.push('observed_at_utc_in_future');
    if(nowMs-at>48*60*60*1000)outstanding.push('observed_at_utc_stale');
  }
  const recordComplete=outstanding.length===0;
  return Object.freeze({
    status:recordComplete?'EVIDENCE_RECORD_COMPLETE_NOT_VERIFIED':'EVIDENCE_RECORD_INCOMPLETE',
    record_complete:recordComplete,
    outstanding_checks:outstanding,
    live_cloudflare_access_verified:false,
    version_and_deployment_url_exposure_verified:false,
    remote_cpu_verified:false,
    deployment_authorized:false,
    next:'INDEPENDENT_LIVE_CLOUDFLARE_VERIFICATION_AND_SEPARATE_AUTHORIZATION_REQUIRED'
  });
}

// On Windows, path.relative() returns an absolute path for another drive.
// That is outside the repo, NOT an inside-repo path.
export function isOutsideRepository(repo,target,platformPath=path){
  const relative=platformPath.relative(repo,target);
  return platformPath.isAbsolute(relative) || relative==='..' ||
    relative.startsWith('..'+platformPath.sep);
}

const script=fileURLToPath(import.meta.url);
if(process.argv[1] && path.resolve(process.argv[1])===script){
  try{
    if(process.argv.length!==3)throw new Error('E_EVIDENCE_FILE_ARGUMENT_REQUIRED');
    const target=path.resolve(process.argv[2]);
    const repo=path.resolve(path.dirname(script),'..');
    if(!isOutsideRepository(repo,target))
      throw new Error('E_PRIVATE_EVIDENCE_MUST_BE_OUTSIDE_REPO');
    if(path.extname(target).toLowerCase()!=='.json')
      throw new Error('E_EVIDENCE_JSON_EXTENSION_REQUIRED');
    const info=fs.lstatSync(target);
    if(!info.isFile() || info.isSymbolicLink() || info.size>16384)
      throw new Error('E_EVIDENCE_FILE_TYPE_OR_SIZE');
    // Do not allow indirection back into the public repository.
    const real=fs.realpathSync(target);
    if(!isOutsideRepository(repo,real))
      throw new Error('E_PRIVATE_EVIDENCE_MUST_BE_OUTSIDE_REPO');
    let record;
    try{record=JSON.parse(fs.readFileSync(target,'utf8'));}
    catch{throw new Error('E_EVIDENCE_INVALID_JSON');}
    const result=auditPrivateAccessEvidence(record);
    console.log(JSON.stringify(result));
    if(!result.record_complete)process.exitCode=2;
  }catch(err){
    // Never echo the JSON body, path, Access ID, or parsing-error fragments.
    const code=typeof err?.message==='string' && /^E_[A-Z_]+$/.test(err.message)
      ?err.message:'E_EVIDENCE_READ_FAILED';
    console.error('HOSTED_ACCESS_PRIVATE_RECORD_FAIL: '+code);
    process.exitCode=1;
  }
}
