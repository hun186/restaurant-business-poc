// Static-only preflight for the dormant, Access-gated PBKDF2 CPU probe.
// This CLI NEVER calls Cloudflare, reads secrets, verifies live Access, or deploys.
// Passing is explicitly NOT deployment authorization.
import fs from 'node:fs';
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

export function inspectHostedProbeStatic(root){
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
  const codeOnly=source=>source.split('\\n').filter(line=>
    !line.trimStart().startsWith('//')).join('\\n');
  assert(!/performance\\.now\\(|wall_ms|cpu_ms/.test(codeOnly(synthetic)) &&
    !/performance\\.now\\(|wall_ms|cpu_ms/.test(codeOnly(worker)),
    'E_HOSTED_CLOCK_VALUE_UNTRUSTED');
  assert(/PBKDF2_ITERATIONS/.test(synthetic) &&
    /hashWorkerPassword/.test(synthetic) && /verifyWorkerPassword/.test(synthetic),
    'E_SYNTHETIC_HASH_NOT_REUSED');

  // Check no CI file can deploy the new probe. This check is deliberately
  // conservative: a PR that adds deploy automation must undergo separate review.
  const flows=path.join(root,'.github','workflows');
  for(const filename of fs.readdirSync(flows)){
    if(!/\.ya?ml$/.test(filename))continue;
    const yaml=fs.readFileSync(path.join(flows,filename),'utf8');
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
