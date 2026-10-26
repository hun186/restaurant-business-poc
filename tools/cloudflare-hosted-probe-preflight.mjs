// Static-only preflight for the dormant, Access-gated PBKDF2 CPU probe.
// This CLI NEVER calls Cloudflare, reads secrets, verifies live Access, or deploys.
// Passing is explicitly NOT deployment authorization.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import {
  APPROVED_PROBE_SHA256,
  APPROVED_WORKFLOW_SHA256,
  APPROVED_LOCAL_EXEC_SHA256
} from './cloudflare-hosted-probe-approved-sha256.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROBE_CONFIG='wrangler.pbkdf2-hosted-disabled.jsonc';
const PROD_CONFIG='wrangler.jsonc';
const KEYS=['compatibility_date','main','name','preview_urls','send_metrics','vars','workers_dev'];
const exactKeys=(obj,keys)=>!!obj && typeof obj==='object' &&
  !Array.isArray(obj) && JSON.stringify(Object.keys(obj).sort())===JSON.stringify([...keys].sort());
const readJson=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const read=(root,file)=>fs.readFileSync(path.join(root,file),'utf8');
function assert(ok,code){if(!ok)throw new Error(code);}

function assertReviewedSHA256(root,relative,expected,code){
  const file=path.join(root,relative);
  // No symlinks or directories: fingerprint exactly the executable contents.
  assert(fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink(),code);
  // Git's Windows checkout may convert LF to CRLF. Canonicalize only
  // line endings, not whitespace/comments/control flow or executable source.
  const canonical=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
  const actual=createHash('sha256').update(canonical,'utf8').digest('hex');
  assert(actual===expected,code);
}
function assertClosedInventory(root,folder,allowed,code){
  const entries=fs.readdirSync(path.join(root,folder)).sort();
  assert(JSON.stringify(entries)===JSON.stringify(Object.keys(allowed)
    .map(x=>path.basename(x)).sort()),code);
}
function assertReviewedExecutableGraph(root){
  // Exact SHA-256 guard fingerprints, rather than matching strings that may
  // survive inside an unreachable if(false && ...) branch.
  for(const [relative,digest] of Object.entries(APPROVED_PROBE_SHA256))
    assertReviewedSHA256(root,relative,digest,'E_ACCESS_GUARD_SHA256_CHANGED');

  // Every approved workflow is pinned byte-for-byte; a newly added reusable
  // workflow, local action invocation, or "bash tools/deploy-probe.sh" delegate
  // changes these digests or the closed workflow inventory.
  assertClosedInventory(root,'.github/workflows',APPROVED_WORKFLOW_SHA256,
    'E_UNREVIEWED_WORKFLOW');
  for(const [relative,digest] of Object.entries(APPROVED_WORKFLOW_SHA256))
    assertReviewedSHA256(root,relative,digest,'E_UNREVIEWED_WORKFLOW');

  // Existing workflow delegates and npm check entrypoints are pinned as well:
  // changing the script behind an unchanged workflow fails closed.
  const toolsAllowed={
    ...Object.fromEntries(Object.entries(APPROVED_LOCAL_EXEC_SHA256)
      .filter(([name])=>name.startsWith('tools/'))),
    'tools/cloudflare-hosted-probe-preflight.mjs':'self-reviewed',
    'tools/cloudflare-hosted-probe-approved-sha256.mjs':'manifest-reviewed'
  };
  assertClosedInventory(root,'tools',toolsAllowed,'E_UNREVIEWED_LOCAL_EXECUTABLE');
  for(const [relative,digest] of Object.entries(APPROVED_LOCAL_EXEC_SHA256))
    assertReviewedSHA256(root,relative,digest,'E_UNREVIEWED_LOCAL_EXECUTABLE');

  const actions=path.join(root,'.github/actions');
  assert(!fs.existsSync(actions) || fs.readdirSync(actions).length===0,
    'E_UNREVIEWED_LOCAL_ACTION');
}


export function inspectHostedProbeStatic(root){
  assertReviewedExecutableGraph(root);
  const probe=readJson(root,PROBE_CONFIG);
  const prod=readJson(root,PROD_CONFIG);
  assert(exactKeys(probe,KEYS),'E_HOSTED_PROBE_CONFIG_KEYS');
  assert(probe.name==='restaurant-pbkdf2-hosted-cpu-staging-probe' &&
    probe.main==='./cloudflare/pbkdf2-hosted-access-worker.mjs' &&
    probe.compatibility_date==='2026-10-25' &&
    probe.workers_dev===false && probe.preview_urls===false &&
    probe.send_metrics===false &&
    exactKeys(probe.vars,['PROBE_ENABLED']) &&
    probe.vars.PROBE_ENABLED==='disabled','E_HOSTED_PROBE_NOT_DORMANT');
  assert(probe.name!==prod.name &&
    prod.main==='./cloudflare/worker.mjs' &&
    prod.vars?.CLOUD_AUTH_PHASE==='disabled' &&
    prod.previews?.vars?.CLOUD_AUTH_PHASE==='preview-readonly',
    'E_PROD_WORKER_ISOLATION');

  const worker=read(root,'cloudflare/pbkdf2-hosted-access-worker.mjs');
  const synthetic=read(root,'cloudflare/pbkdf2-hosted-synthetic.mjs');
  const prodWorker=read(root,'cloudflare/worker.mjs');
  assert(!/pbkdf2-hosted-access-worker|pbkdf2-hosted-synthetic|PROBE_ENABLED/.test(prodWorker),
    'E_PROD_WORKER_PROBE_IMPORT');
  assert(/PROBE_ENABLED!=='access-only'/.test(worker) &&
    /ctx\.access\.aud!==env\.PROBE_ACCESS_AUD/.test(worker) &&
    /typeof ctx\.access\.getIdentity!=='function'/.test(worker) &&
    /probe_id/.test(worker) && /cpu_verified:false/.test(worker),
    'E_ACCESS_RUNTIME_GUARD_MISSING');
  const codeOnly=source=>source.split(String.fromCharCode(10)).filter(line=>
    !line.trimStart().startsWith('//')).join(String.fromCharCode(10));
  assert(!/performance\.now\(|wall_ms|cpu_ms/.test(codeOnly(synthetic)) &&
    !/performance\.now\(|wall_ms|cpu_ms/.test(codeOnly(worker)),
    'E_HOSTED_CLOCK_VALUE_UNTRUSTED');
  assert(/PBKDF2_ITERATIONS/.test(synthetic) &&
    /hashWorkerPassword/.test(synthetic) && /verifyWorkerPassword/.test(synthetic),
    'E_SYNTHETIC_HASH_NOT_REUSED');

  // Defense in depth. The SHA-256 allowlist above is the real gate:
  // delegates in unchanged workflows must also match approved script hashes.
  for(const relative of Object.keys(APPROVED_WORKFLOW_SHA256)){
    const yaml=read(root,relative);
    assert(!/wrangler\.pbkdf2-hosted-disabled\.jsonc|restaurant-pbkdf2-hosted-cpu-staging-probe/.test(yaml),
      'E_HOSTED_PROBE_DEPLOY_WORKFLOW_FORBIDDEN');
  }
  return Object.freeze({
    result:'HOSTED_PROBE_STATIC_PREFLIGHT_PASS',
    worker:probe.name,
    probe_enabled:false,
    workers_dev:false,
    preview_urls:false,
    route_configured:false,
    d1_bound:false,
    access_runtime_guard_present:true,
    reviewed_guard_sha256_verified:true,
    reviewed_workflow_and_executables_sha256_verified:true,
    live_cloudflare_access_verified:false,
    version_and_deployment_url_exposure_verified:false,
    remote_cpu_verified:false,
    deployment_authorized:false,
    next:'MANUAL_ACCESS_EVIDENCE_REQUIRED'
  });
}
const script=fileURLToPath(import.meta.url);
if(process.argv[1] && path.resolve(process.argv[1])===script){
  try{
    if(process.argv.length!==2)throw new Error('E_NO_ARGS_ALLOWED');
    const root=path.resolve(path.dirname(script),'..');
    console.log(JSON.stringify(inspectHostedProbeStatic(root)));
  }catch(err){
    console.error('HOSTED_PROBE_STATIC_PREFLIGHT_FAIL: '+String(err?.message||'E_UNKNOWN'));
    process.exitCode=1;
  }
}
