'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const root=path.join(__dirname,'..');
const probePath='wrangler.pbkdf2-hosted-disabled.jsonc';
const prodPath='wrangler.jsonc';
const modules=[
  'cloudflare/pbkdf2-hosted-access-worker.mjs',
  'cloudflare/pbkdf2-hosted-synthetic.mjs',
  'cloudflare/worker.mjs'
];
const preflightPromise=import('../tools/cloudflare-hosted-probe-preflight.mjs');
function clone(){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rb-probe-preflight-'));
  for(const f of [probePath,prodPath,...modules]){
    const dst=path.join(tmp,f);fs.mkdirSync(path.dirname(dst),{recursive:true});
    fs.copyFileSync(path.join(root,f),dst);
  }
  fs.mkdirSync(path.join(tmp,'.github/workflows'),{recursive:true});
  fs.copyFileSync(path.join(root,'.github/workflows/verify.yml'),path.join(tmp,'.github/workflows/verify.yml'));
  return tmp;
}
function editJson(dir,file,mutate){
  const p=path.join(dir,file);
  const obj=JSON.parse(fs.readFileSync(p,'utf8'));
  mutate(obj);
  fs.writeFileSync(p,JSON.stringify(obj,null,2));
}
function editText(dir,file,transform){
  const p=path.join(dir,file);
  fs.writeFileSync(p,transform(fs.readFileSync(p,'utf8')));
}
test('static preflight passes only with explicit pending Access/remote approval gates',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const result=inspectHostedProbeStatic(root);
  assert.equal(result.result,'HOSTED_PROBE_STATIC_PREFLIGHT_PASS');
  assert.equal(result.probe_enabled,false);
  assert.equal(result.workers_dev,false);
  assert.equal(result.preview_urls,false);
  assert.equal(result.route_configured,false);
  assert.equal(result.d1_bound,false);
  assert.equal(result.live_cloudflare_access_verified,false);
  assert.equal(result.version_and_deployment_url_exposure_verified,false);
  assert.equal(result.remote_cpu_verified,false);
  assert.equal(result.deployment_authorized,false);
  assert.equal(result.next,'MANUAL_ACCESS_EVIDENCE_REQUIRED');
  assert.doesNotMatch(JSON.stringify(result),/token|password|secret|account_id|database_id/i);
});
test('fails closed if any remote routes, bindings, values or new config keys are introduced',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const mutations=[
    x=>x.vars.PROBE_ENABLED='access-only',
    x=>x.workers_dev=true,
    x=>x.preview_urls=true,
    x=>x.routes=['example.test/*'],
    x=>x.d1_databases=[{binding:'DB'}],
    x=>x.vars.PROBE_ACCESS_AUD='placeholder',
    x=>x.observability={enabled:true},
    x=>x.name='restaurant-business-poc'
  ];
  for(const change of mutations){
    const dir=clone();
    try{
      editJson(dir,probePath,change);
      assert.throws(()=>inspectHostedProbeStatic(dir),/^Error: E_HOSTED_PROBE_/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('fails closed if production routing or auth phase changes',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  for(const change of [
    x=>x.vars.CLOUD_AUTH_PHASE='enabled',
    x=>x.previews.vars.CLOUD_AUTH_PHASE='enabled',
    x=>x.main='./cloudflare/pbkdf2-hosted-access-worker.mjs'
  ]){
    const dir=clone();
    try{
      editJson(dir,prodPath,change);
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_PROD_WORKER_ISOLATION/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('fails closed on missing Access guard, fabricated wall timings or automatic deployment workflow',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const cases=[
    dir=>editText(dir,'cloudflare/pbkdf2-hosted-access-worker.mjs',x=>x.replace(
      "if(env?.PROBE_ENABLED!=='access-only')","if(env?.PROBE_ENABLED==='access-only')")),
    dir=>editText(dir,'cloudflare/pbkdf2-hosted-synthetic.mjs',x=>x.replace(
      "  let valid;", "  const wall_ms=performance.now();\n  let valid;")),
    dir=>editText(dir,'cloudflare/worker.mjs',x=>x+
      "\nimport './pbkdf2-hosted-synthetic.mjs';\n"),
    dir=>fs.writeFileSync(path.join(dir,'.github/workflows/enable.yml'),
      'name: deploy\nrun: wrangler.pbkdf2-hosted-disabled.jsonc\n')
  ];
  const expected=[
    'E_ACCESS_RUNTIME_GUARD_MISSING','E_HOSTED_CLOCK_VALUE_UNTRUSTED',
    'E_PROD_WORKER_PROBE_IMPORT','E_HOSTED_PROBE_DEPLOY_WORKFLOW_FORBIDDEN'
  ];
  for(let i=0;i<cases.length;i++){
    const dir=clone();
    try{
      cases[i](dir);
      assert.throws(()=>inspectHostedProbeStatic(dir),new RegExp(expected[i]));
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('the preflight never accesses Cloudflare API or pretends static equals live Access approval',async()=>{
  const src=fs.readFileSync(path.join(root,'tools/cloudflare-hosted-probe-preflight.mjs'),'utf8');
  assert.doesNotMatch(src,/\bfetch\s*\(|https?:\/\/api\.cloudflare\.com|CLOUDFLARE_API_TOKEN|execSync|spawn\s*\(/);
  assert.match(src,/live_cloudflare_access_verified:false/);
  assert.match(src,/deployment_authorized:false/);
});
