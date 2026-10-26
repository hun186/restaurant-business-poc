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
const approvalPromise=import('../tools/cloudflare-hosted-probe-approved-sha256.mjs');
async function clone(){
  const approved=await approvalPromise;
  const files=[
    probePath,prodPath,...modules,
    ...Object.keys(approved.APPROVED_PROBE_SHA256),
    ...Object.keys(approved.APPROVED_WORKFLOW_SHA256),
    ...Object.keys(approved.APPROVED_LOCAL_EXEC_SHA256),
    ...Object.keys(approved.APPROVED_TRANSITIVE_DEPENDENCIES_SHA256),
    'tools/cloudflare-hosted-probe-preflight.mjs',
    'tools/cloudflare-hosted-probe-approved-sha256.mjs'
  ];
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rb-probe-preflight-'));
  try{
    for(const file of new Set(files)){
      const dst=path.join(tmp,file);fs.mkdirSync(path.dirname(dst),{recursive:true});
      fs.copyFileSync(path.join(root,file),dst);
    }
    return tmp;
  }catch(err){
    fs.rmSync(tmp,{recursive:true,force:true});
    throw err;
  }
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
    const dir=await clone();
    try{
      editJson(dir,probePath,change);
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_HOSTED_PROBE_|E_UNREVIEWED_TRANSITIVE_DEPENDENCY/);
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
    const dir=await clone();
    try{
      editJson(dir,prodPath,change);
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_PROD_WORKER_ISOLATION|E_UNREVIEWED_TRANSITIVE_DEPENDENCY/);
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
    'E_ACCESS_GUARD_SHA256_CHANGED','E_ACCESS_GUARD_SHA256_CHANGED',
    'E_UNREVIEWED_TRANSITIVE_DEPENDENCY','E_UNREVIEWED_WORKFLOW'
  ];
  for(let i=0;i<cases.length;i++){
    const dir=await clone();
    try{
      cases[i](dir);
      assert.throws(()=>inspectHostedProbeStatic(dir),new RegExp(expected[i]));
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('Git Windows CRLF checkout normalizes only line endings, not guard semantics',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const approved=await approvalPromise;
  const dir=await clone();
  try{
    const sources=[
      ...Object.keys(approved.APPROVED_PROBE_SHA256),
      ...Object.keys(approved.APPROVED_WORKFLOW_SHA256),
      ...Object.keys(approved.APPROVED_LOCAL_EXEC_SHA256)
    ];
    for(const file of sources)
      editText(dir,file,contents=>contents.replace(/\r?\n/g,'\r\n'));
    assert.equal(inspectHostedProbeStatic(dir).result,'HOSTED_PROBE_STATIC_PREFLIGHT_PASS');
    editText(dir,'cloudflare/pbkdf2-hosted-access-worker.mjs',source=>
      source.replace("if(env?.PROBE_ENABLED!=='access-only')",
        "if(false && env?.PROBE_ENABLED!=='access-only')"));
    assert.throws(()=>inspectHostedProbeStatic(dir),/E_ACCESS_GUARD_SHA256_CHANGED/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P2: retaining guard text inside false branches must FAIL via SHA-256',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const cases=[
    source=>source.replace(
      "if(env?.PROBE_ENABLED!=='access-only')",
      "if(false && env?.PROBE_ENABLED!=='access-only')"
    ),
    source=>source.replace(
      "if(!accessAudienceIsValid(env.PROBE_ACCESS_AUD) ||",
      "if(false && (!accessAudienceIsValid(env.PROBE_ACCESS_AUD) ||"
    ).replace(
      "ctx.access.aud!==env.PROBE_ACCESS_AUD)",
      "ctx.access.aud!==env.PROBE_ACCESS_AUD))"
    )
  ];
  for(const mutate of cases){
    const dir=await clone();
    try{
      editText(dir,'cloudflare/pbkdf2-hosted-access-worker.mjs',mutate);
      // The changed file retains original regex strings, but is unsafe.
      const src=fs.readFileSync(path.join(dir,'cloudflare/pbkdf2-hosted-access-worker.mjs'),'utf8');
      assert.match(src,/PROBE_ENABLED!=='access-only'/);
      assert.match(src,/ctx\.access\.aud!==env\.PROBE_ACCESS_AUD/);
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_ACCESS_GUARD_SHA256_CHANGED/);
    }finally{
      fs.rmSync(dir,{recursive:true,force:true});
    }
  }
});
test('P2: delegated deploy in new workflow and changed delegated script fail closed',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const cases=[
    dir=>{
      fs.writeFileSync(path.join(dir,'.github/workflows/deploy-probe.yml'),
        'name: deploy-probe\non: workflow_dispatch\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bash tools/deploy-probe.sh\n');
      fs.writeFileSync(path.join(dir,'tools/deploy-probe.sh'),
        'npx wrangler deploy --config wrangler.pbkdf2-hosted-disabled.jsonc\n');
    },
    dir=>editText(dir,'.github/workflows/verify.yml',text=>
      text+'\n# innocent-looking script delegation\n# run: bash tools/deploy-probe.sh\n'),
    dir=>editText(dir,'tools/cloudflare-staging-owner.mjs',text=>
      text+'\n// Delegated code changed to include remote deployment.\n'),
    dir=>{
      fs.mkdirSync(path.join(dir,'.github/actions/probe'),{recursive:true});
      fs.writeFileSync(path.join(dir,'.github/actions/probe/action.yml'),
        'name: probe\nruns:\n  using: composite\n  steps:\n    - run: echo demo\n      shell: bash\n');
    }
  ];
  const errors=[
    /E_UNREVIEWED_WORKFLOW/,
    /E_UNREVIEWED_WORKFLOW/,
    /E_UNREVIEWED_LOCAL_EXECUTABLE/,
    /E_UNREVIEWED_LOCAL_ACTION/
  ];
  for(let n=0;n<cases.length;n++){
    const dir=await clone();
    try{
      cases[n](dir);
      assert.throws(()=>inspectHostedProbeStatic(dir),errors[n]);
    }finally{
      fs.rmSync(dir,{recursive:true,force:true});
    }
  }
});
test('pinned SHA-256 manifest exactly covers present workflows and delegated tools',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const approved=await approvalPromise;
  const result=inspectHostedProbeStatic(root);
  assert.equal(result.reviewed_guard_sha256_verified,true);
  assert.equal(result.reviewed_workflow_and_executables_sha256_verified,true);
  const workflows=fs.readdirSync(path.join(root,'.github/workflows')).sort();
  assert.deepEqual(workflows,Object.keys(approved.APPROVED_WORKFLOW_SHA256)
    .map(x=>path.basename(x)).sort());
  const scripts=fs.readdirSync(path.join(root,'tools')).sort();
  assert.deepEqual(scripts,[
    ...Object.keys(approved.APPROVED_LOCAL_EXEC_SHA256).filter(x=>x.startsWith('tools/')).map(x=>path.basename(x)),
    'cloudflare-hosted-probe-preflight.mjs',
    'cloudflare-hosted-probe-approved-sha256.mjs'
  ].sort());
});
test('P2: changes only in transitive imports and tests must fail, without altering tools/workflows',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const targets=[
    'cloudflare/auth-core.mjs',
    'cloudflare/d1-readiness.mjs',
    'src/security.js',
    'tests/core.test.js',
    'tests/cloudflare-pbkdf2-hosted-access.test.js',
    'db/schema.sql',
    'vercel-demo/app.js'
  ];
  for(const target of targets){
    const dir=await clone();
    try{
      assert.equal(inspectHostedProbeStatic(dir).result,'HOSTED_PROBE_STATIC_PREFLIGHT_PASS');
      editText(dir,target,source=>source+'\n// conditionally deploy probe in imported source\n');
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_UNREVIEWED_TRANSITIVE_DEPENDENCY/,target);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('P2: new unreviewed dynamic dependency or test entry is rejected by closed inventory',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  for(const target of [
    'cloudflare/imported-deploy-helper.mjs',
    'tests/new-unreviewed.test.js',
    'src/remote-deploy.js',
    'server-helper.js'
  ]){
    const dir=await clone();
    try{
      fs.writeFileSync(path.join(dir,target),"export default 'unsafe';\n");
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_UNREVIEWED_TRANSITIVE_DEPENDENCY/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});
test('pinned manifest closes all transitive and test paths, including imported auth-core',async()=>{
  const approved=await approvalPromise;
  const {inspectHostedProbeStatic}=await preflightPromise;
  const result=inspectHostedProbeStatic(root);
  assert.equal(result.reviewed_transitive_dependencies_sha256_verified,true);
  const all={
    ...approved.APPROVED_PROBE_SHA256,
    ...approved.APPROVED_TRANSITIVE_DEPENDENCIES_SHA256
  };
  for(const folder of ['cloudflare','db','public','src','tests','vercel-demo']){
    const scan=(relative)=>fs.readdirSync(path.join(root,relative),{withFileTypes:true})
      .flatMap(item=>item.isDirectory()?scan(relative+'/'+item.name):[relative+'/'+item.name]);
    assert.deepEqual(scan(folder).sort(),Object.keys(all)
      .filter(file=>file.startsWith(folder+'/')).sort());
  }
  assert.ok(approved.APPROVED_TRANSITIVE_DEPENDENCIES_SHA256['cloudflare/auth-core.mjs']);
  assert.ok(approved.APPROVED_TRANSITIVE_DEPENDENCIES_SHA256['tests/core.test.js']);
});
test('P2: unreviewed root .npmrc must fail closed before npm/npx can read it',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const cases=[
    ['.npmrc',"node-options=--import=data:text/javascript,console.error('UNREVIEWED_NPMRC_CODE_EXECUTED')\\n"],
    ['.npmrc','script-shell=/bin/sh\\n'],
    ['.npmrc',''],
    // Windows npm reads these case variants as the same config path.
    // The Linux fixture catches a case-sensitive scanner that misses them.
    ['.NPMRC',"node-options=--import=data:text/javascript,console.error('UNREVIEWED_NPMRC_CODE_EXECUTED')\\n"],
    ['.npmRc',"node-options=--import=data:text/javascript,console.error('UNREVIEWED_NPMRC_CODE_EXECUTED')\\n"],
    ['.nPmRc','']
  ];
  for(const [name,source] of cases){
    const dir=await clone();
    try{
      assert.equal(inspectHostedProbeStatic(dir).result,'HOSTED_PROBE_STATIC_PREFLIGHT_PASS');
      fs.writeFileSync(path.join(dir,name),source);
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_UNREVIEWED_NPM_CONFIG/,name);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
});


test('P2: every Workflow job gates npm/npx behind a separate direct-node preflight step',async()=>{
  const {inspectHostedProbeStatic}=await preflightPromise;
  const name='Fail closed before npm/npx (offline Hosted probe preflight)';
  const preflightStep='      - name: '+name+'\n        run: node tools/cloudflare-hosted-probe-preflight.mjs';
  const workflowFiles=[
    '.github/workflows/verify.yml',
    '.github/workflows/d1-staging-migration.yml',
    '.github/workflows/d1-staging-owner-bootstrap.yml',
    '.github/workflows/d1-staging-incremental-0002.yml',
    '.github/workflows/pbkdf2-local-workerd.yml'
  ];
  // Split actual YAML jobs, not just matching a preflight string anywhere.
  // npm/npx commands may be at a single-line run or in a multi-line run block.
  const assertOrder=(source)=>{
    const jobs=source.slice(source.indexOf('\njobs:\n')+1);
    const jobHeaders=[...jobs.matchAll(/^  ([a-z][\w-]*):\s*$/gm)];
    assert.ok(jobHeaders.length>0,'E_MISSING_WORKFLOW_JOBS');
    let guardedJobs=0;
    for(let i=0;i<jobHeaders.length;i++){
      const start=jobHeaders[i].index;
      const end=i+1<jobHeaders.length?jobHeaders[i+1].index:jobs.length;
      const job=jobs.slice(start,end);
      const npmCommands=[...job.matchAll(/^(?:[ \t]*-?[ \t]*run:[ \t]*|[ \t]+)(?:npm|npx)[ \t]+[^\r\n]+$/gm)];
      if(npmCommands.length===0)continue;
      const guardAt=job.indexOf(preflightStep);
      assert.ok(guardAt>=0 && guardAt<npmCommands[0].index,
        'E_NPM_PREFLIGHT_ORDER: '+jobHeaders[i][1]);
      assert.equal(job.split(preflightStep).length-1,1,
        'E_MULTIPLE_OR_MISSING_PREFLIGHT_STEPS');
      guardedJobs++;
    }
    return guardedJobs;
  };
  let totalJobs=0;
  for(const file of workflowFiles){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    totalJobs+=assertOrder(source);
    const dir=await clone();
    try{
      // An unapproved config must be rejected by the very first node guard,
      // before the Workflow could start npm. No injection payload is run.
      fs.writeFileSync(path.join(dir,'.NPMRC'),'node-options=--import=./unreviewed.js\n');
      assert.throws(()=>inspectHostedProbeStatic(dir),/E_UNREVIEWED_NPM_CONFIG/);
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  }
  assert.equal(totalJobs,6,'expected all six npm/npx jobs to be covered');
  const verify=fs.readFileSync(path.join(root,workflowFiles[0]),'utf8');
  const firstGuard=verify.indexOf(preflightStep);
  const firstNpm=verify.indexOf('      - run: npm run check');
  assert.ok(firstGuard>=0 && firstNpm>firstGuard);
  const reversed=verify.replace(
    preflightStep+'\n      - run: npm run check',
    '      - run: npm run check\n'+preflightStep
  );
  assert.notEqual(reversed,verify,'fixture must actually reverse the steps');
  assert.throws(()=>assertOrder(reversed),/E_NPM_PREFLIGHT_ORDER/);
});

test('the preflight never accesses Cloudflare API or pretends static equals live Access approval',async()=>{
  const src=fs.readFileSync(path.join(root,'tools/cloudflare-hosted-probe-preflight.mjs'),'utf8');
  assert.doesNotMatch(src,/\bfetch\s*\(|https?:\/\/api\.cloudflare\.com|CLOUDFLARE_API_TOKEN|execSync|spawn\s*\(/);
  assert.match(src,/live_cloudflare_access_verified:false/);
  assert.match(src,/deployment_authorized:false/);
});
