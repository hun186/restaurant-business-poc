'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const modulePromise=import('../tools/cloudflare-g0-active-version-readonly.mjs');
const SHA='a'.repeat(40),VERSION='11111111-2222-4333-8444-555555555555';
const SECOND='22222222-3333-4444-8555-666666666666';
const DEPLOY='33333333-4444-4555-8666-777777777777';
const BUILD='44444444-5555-4666-8777-888888888888';
const account='31b409b04896d260ba0fadf6cc2bb305';
const dPath='/accounts/'+account+'/workers/scripts/restaurant-business-poc/deployments';
const bPath='/accounts/'+account+'/builds/builds?version_ids='+VERSION;
const deployment=(versions=[{version_id:VERSION,percentage:100}])=>({
 success:true,result:{deployments:[{id:DEPLOY,created_on:'2026-11-02T08:00:00Z',
 source:'api',strategy:'percentage',versions}]}
});
const build=(commit=SHA,override={})=>({success:true,result:{builds:{[VERSION]:{
 build_outcome:'success',build_uuid:BUILD,
 build_trigger_metadata:{
  provider_type:'github',repo_name:'restaurant-business-poc',
  provider_account_name:'hun186',branch:'main',commit_hash:commit,...override
 }}}}});
function config(){return {name:'restaurant-business-poc',
 main:'./cloudflare/worker.mjs',workers_dev:true,
 vars:{CLOUD_AUTH_PHASE:'disabled'},
 previews:{vars:{CLOUD_AUTH_PHASE:'preview-readonly'},
  d1_databases:[{database_id:'2c355bed-d9c3-449c-aa9b-1018f3bc1177'}]},
 d1_databases:[{database_id:'b882a6e8-0e56-49a6-bd41-1a6cadd726c9'}]};}
test('active version matched with exact github main commit, still NO release authorization',async()=>{
 const m=await modulePromise;assert.doesNotThrow(()=>m.assertLocalGate(config(),account));
 const paths=[];
 const result=await m.inspectRemoteDeployment(path=>{
  paths.push(path);return path===dPath?deployment():path===bPath?build():null;
 },SHA);
 assert.deepEqual(paths,[dPath,bPath]);
 assert.equal(result.status,'G0_ACTIVE_DEPLOYMENT_BUILD_READONLY_PASS');
 assert.equal(result.active_version_traffic_pct,100);
 assert.equal(result.active_version_to_build_link_verified,true);
 assert.equal(result.active_build_commit_matches_main,true);
 assert.equal(result.active_commit_sha,SHA);
 assert.equal(result.public_hostname_version_verified,false);
 assert.equal(result.access_policy_verified,false);
 assert.equal(result.staging_live_access_verified,false);
 assert.equal(result.production_write_performed,false);
 assert.equal(result.release_authorized,false);
});
test('latest timestamp selected regardless of API list ordering',async()=>{
 const m=await modulePromise;
 const x=deployment(),older={
  id:'55555555-6666-4777-8888-999999999999',
  created_on:'2026-11-01T01:00:00Z',
  versions:[{version_id:SECOND,percentage:100}]
 };
 x.result.deployments.unshift(older);
 assert.equal(m.inspectActiveDeployment(x),VERSION);
});
test('reject missing/incompatible/split/ambiguous deployment data',async()=>{
 const m=await modulePromise;
 const cases=[
  {success:false,result:deployment().result},
  {success:true,result:{deployments:[]}},
  {success:true,result:{deployments:[{}]}},
  deployment([{version_id:VERSION,percentage:60},{version_id:SECOND,percentage:40}]),
  deployment([{version_id:VERSION,percentage:50}]),
  deployment([{version_id:VERSION,percentage:100},{version_id:VERSION,percentage:0}]),
  {success:true,result:{deployments:[
   deployment().result.deployments[0],
   {...deployment().result.deployments[0],id:'55555555-6666-4777-8888-999999999999'}
  ]}}
 ];
 for(const value of cases)assert.throws(()=>m.inspectActiveDeployment(value),/E_G0_ACTIVE_DEPLOYMENT/);
});
test('reject failed, stale and untrusted version build metadata',async()=>{
 const m=await modulePromise;
 const cases=[
  {success:false,result:build().result},
  {success:true,result:{builds:{}}},
  {success:true,result:{builds:{[SECOND]:build().result.builds[VERSION]}}},
  build('b'.repeat(40)),
  build(SHA,{branch:'develop'}),
  build(SHA,{provider_type:'gitlab'}),
  build(SHA,{repo_name:'wrong-repo'}),
  build(SHA,{provider_account_name:'untrusted-owner'}),
  build(SHA,{provider_account_name:undefined}),
  {success:true,result:{builds:{[VERSION]:{
   ...build().result.builds[VERSION],build_outcome:'fail'
  }}}}
 ];
 for(const response of cases)
  assert.throws(()=>m.verifyVersionBuild(response,VERSION,SHA),/E_G0_ACTIVE_DEPLOYMENT/);
});
test('fixed-account, fixed-worker GET-only fetch: no token/redirect leakage or writes',async()=>{
 const m=await modulePromise,calls=[];
 const fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  return new Response(JSON.stringify(url.endsWith('/deployments')?deployment():build()),{
   status:200,headers:{'content-type':'application/json'}
  });
 };
 const getter=p=>m.cloudflareReadOnlyGet(p,'X'.repeat(48),fetchImpl);
 const r=await m.inspectRemoteDeployment(getter,SHA);
 assert.equal(r.status,'G0_ACTIVE_DEPLOYMENT_BUILD_READONLY_PASS');
 assert.equal(calls.length,2);
 assert.deepEqual(calls.map(x=>new URL(x.url).pathname),
  ['/client/v4'+dPath,'/client/v4'+bPath.split('?')[0]]);
 for(const x of calls){
  assert.equal(x.opts.method,'GET');
  assert.equal(x.opts.redirect,'error');
  assert.equal(x.opts.credentials,'omit');
  assert.equal(x.opts.body,undefined);
  assert.equal(x.opts.headers.Authorization,'Bearer '+'X'.repeat(48));
  assert.ok(x.url.startsWith('https://api.cloudflare.com/client/v4/'));
 }
 await assert.rejects(getter('/accounts/'+account+'/d1/database'),/E_G0_ACTIVE_DEPLOYMENT/);
 await assert.rejects(getter(dPath+'?delete=true'),/E_G0_ACTIVE_DEPLOYMENT/);
});
test('Cloudflare transport and oversized responses never become false PASS',async()=>{
 const m=await modulePromise,token='X'.repeat(48);
 await assert.rejects(m.cloudflareReadOnlyGet(dPath,token,async()=>{throw Error('Secret token or URL');}),
  e=>e.stage==='NETWORK'&&!e.message.includes('Secret'));
 await assert.rejects(m.cloudflareReadOnlyGet(dPath,token,async()=>new Response('x'.repeat(131073),{
  headers:{'content-type':'application/json'}})),/E_G0_ACTIVE_DEPLOYMENT/);
 await assert.rejects(m.cloudflareReadOnlyGet(dPath,token,async()=>new Response(
  '{"success":false}',{status:403})),/E_G0_ACTIVE_DEPLOYMENT/);
});
test('manual protected read-only workflow, preflight and closed production gate',()=>{
 const root=path.join(__dirname,'..');
 const workflow=fs.readFileSync(path.join(root,
  '.github/workflows/cloudflare-g0-active-version-readonly.yml'),'utf8');
 const source=fs.readFileSync(path.join(root,'tools/cloudflare-g0-active-version-readonly.mjs'),'utf8');
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/refs\/heads\/main/);
 assert.match(workflow,/environment: cloudflare-g0-readonly/);
 assert.match(workflow,/cloudflare-hosted-probe-preflight.mjs/);
 assert.match(workflow,/G0_ACTIVE_CONFIRM/);
 assert.match(workflow,/CLOUDFLARE_G0_READONLY_TOKEN/);
 assert.match(workflow,/cloudflare-g0-active-version-readonly.mjs inspect/);
 assert.doesNotMatch(workflow,/wrangler deploy|d1 execute|--remote|write-token/);
 assert.match(source,/cloudflareReadOnlyGet/);
 assert.match(source,/method:'GET'/);
 assert.doesNotMatch(source,/method:'POST'|method:'PUT'|method:'DELETE'|method:'PATCH'/);
 assert.doesNotMatch(source,/console\.log\([^\n]*(token|response)/);
});
