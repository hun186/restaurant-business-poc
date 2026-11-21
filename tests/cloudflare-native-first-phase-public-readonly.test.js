'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const loaded=import('../tools/cloudflare-native-first-phase-public-readonly.mjs');
const base=()=>({
 mode:'native',login_enabled:true,
 task_write_enabled:true,catalog_write_enabled:true,order_write_enabled:true,
 stocktake_write_enabled:true,repair_write_enabled:true,
 price_write_enabled:false,stock_usage_write_enabled:false,
 stock_v4_gate_enabled:false,supplier_return_gate_enabled:false
});
const json=(value,status=200)=>new Response(JSON.stringify(value),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}
});
const html=()=>new Response(
 '<title>正式業主工作台</title>'+
 '<meta name="robots" content="noindex,nofollow">'+
 "<meta content=\"script-src 'self'; form-action 'self'\">"+
 '<script src="/owner-app.js"></script>',{
 status:200,headers:{'content-type':'text/html'}
});
function fixture(overrides={}){
 const calls=[],replies={
  '/api/native/status':json(base()),
  '/api/login':json({code:'METHOD_NOT_ALLOWED'},405),
  '/api/me':json({error:'請先登入'},401),
  '/owner-app.html':html(),
  ...overrides
 };
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});
  return replies[new URL(url).pathname];
 };
 return {calls,fetchImpl};
}
test('Native public first-phase check uses four credential-free GET requests',async()=>{
 const m=await loaded,f=fixture();
 const result=await m.inspectNativeFirstPhasePublic({fetchImpl:f.fetchImpl});
 assert.equal(result.status,'NATIVE_FIRST_PHASE_PUBLIC_READONLY_PASS');
 assert.equal(result.all_five_core_gates_open,true);
 assert.equal(result.second_stage_v4_gates_closed,true);
 assert.equal(result.five_business_writes_executed,false);
 assert.equal(result.authenticated_owner_uat_verified,false);
 assert.equal(result.backup_freshness_verified,false);
 assert.equal(result.release_authorized,false);
 assert.deepEqual(f.calls.map(c=>new URL(c.url).pathname),
  ['/api/native/status','/api/login','/api/me','/owner-app.html']);
 for(const c of f.calls){
  assert.equal(new URL(c.url).origin,m.HOST);
  assert.equal(c.options.method,'GET');
  assert.equal(c.options.redirect,'manual');
  assert.equal(c.options.credentials,'omit');
  assert.equal(c.options.body,undefined);
 }
});
test('Strict status shape, core gates and v4 defaults fail closed',async()=>{
 const m=await loaded;
 for(const key of ['login_enabled','task_write_enabled','catalog_write_enabled',
  'order_write_enabled','stocktake_write_enabled','repair_write_enabled']){
  const input=base();input[key]=false;
  await assert.rejects(m.inspectNativeFirstPhasePublic({
   fetchImpl:fixture({'/api/native/status':json(input)}).fetchImpl}),
   /E_NATIVE_FIRST_PHASE_READONLY/);
 }
 for(const name of ['stock_v4_gate_enabled','supplier_return_gate_enabled']){
  const input=base();input[name]=true;
  await assert.rejects(m.inspectNativeFirstPhasePublic({
   fetchImpl:fixture({'/api/native/status':json(input)}).fetchImpl}),
   /E_NATIVE_FIRST_PHASE_READONLY/);
 }
 const changed=base();changed.mode='demo';
 await assert.rejects(m.attestNativeFirstPhaseStatus(changed));
});
test('Leaked anonymous identity, unknown HTML and login GET bypass are rejected',async()=>{
 const m=await loaded;
 const broken=[
  {'/api/login':json({code:'OK'},200)},
  {'/api/me':json({user:{role:'owner'},csrf:'secret'},401)},
  {'/owner-app.html':new Response('wrong markup',{
   status:200,headers:{'content-type':'text/html'}})}
 ];
 for(const override of broken)
  await assert.rejects(m.inspectNativeFirstPhasePublic({
   fetchImpl:fixture(override).fetchImpl}),/E_NATIVE_FIRST_PHASE_READONLY/);
});
test('No network exception or malformed response may masquerade as public PASS',async()=>{
 const m=await loaded;
 await assert.rejects(m.inspectNativeFirstPhasePublic({
  fetchImpl:async()=>{throw Error('synthetic private diagnostic');}
 }),/E_NATIVE_FIRST_PHASE_READONLY/);
 for(const response of [
  new Response('{broken',{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store'}}),
  new Response('x'.repeat(17000),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store'}}),
  new Response(JSON.stringify(base()),{status:200,headers:{
   'content-type':'application/json','cache-control':'no-store','set-cookie':'bad'}})
 ]){
  await assert.rejects(m.inspectNativeFirstPhasePublic({
   fetchImpl:fixture({'/api/native/status':response}).fetchImpl
  }),/E_NATIVE_FIRST_PHASE_READONLY/);
 }
});
test('New workflow is credential-free and limited to successful main push / manual opt-in',()=>{
 const root=path.join(__dirname,'..');
 const workflow=fs.readFileSync(path.join(root,
  '.github/workflows/cloudflare-native-first-phase-public-readonly.yml'),'utf8');
 assert.match(workflow,/workflow_run:/);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/head_branch == 'main'/);
 assert.match(workflow,/conclusion == 'success'/);
 assert.match(workflow,/event == 'push'/);
 assert.match(workflow,/cloudflare-hosted-probe-preflight.mjs/);
 assert.doesNotMatch(workflow,/secrets[.]|CLOUDFLARE_API_TOKEN|wrangler deploy|d1 execute/);
});
