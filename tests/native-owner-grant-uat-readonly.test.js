'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const code=fs.readFileSync(path.join(root,'tools/native-owner-grant-uat-readonly.mjs'),'utf8');
const launcher=fs.readFileSync(path.join(root,'run-native-owner-grant-uat-readonly.bat'),'utf8');
const origin='https://restaurant-business-poc.hungyuan-chen.workers.dev';
const status={mode:'native',login_enabled:true,task_write_enabled:false,
 catalog_write_enabled:false,order_write_enabled:false,
 stocktake_write_enabled:false,repair_write_enabled:false};
const endpoints=['/api/native/status','/api/accounts','/api/accounts/grant'];
const probe=import('../tools/native-owner-grant-uat-readonly.mjs');
const fake=(bodies=[
 {status:200,body:status},
 {status:401,body:{code:'E_UNAUTHENTICATED'}},
 {status:503,body:{code:'E_NOT_READY'}}
],calls=[])=>async(url,options)=>{
 calls.push({url,options});
 const index=endpoints.findIndex(p=>url===origin+p);
 assert(index>=0,'no configurable or unrelated endpoint');
 return new Response(JSON.stringify(bodies[index].body),{
  status:bodies[index].status,
  headers:{'Content-Type':'application/json; charset=utf-8',
   ...(bodies[index].headers||{})}
 });
};

test('readonly grant UAT checks exactly three anonymous GET routes, no cookies or writes',async()=>{
 const {probeNativeOwnerGrantReadonly}=await probe;
 const calls=[];
 const result=await probeNativeOwnerGrantReadonly(fake(undefined,calls));
 assert.equal(result.status,'NATIVE_OWNER_GRANT_UAT_READONLY_PREFLIGHT_PASS');
 assert.equal(result.grant_endpoint_default_denial_observed,true);
 assert.equal(result.grant_write_gate_configuration_verified,false);
 assert.equal(result.production_write_performed,false);
 assert.equal(result.authenticated_grant_uat_verified,false);
 assert.deepEqual(calls.map(c=>c.url),endpoints.map(e=>origin+e));
 for(const c of calls){
  assert.equal(c.options.method,'GET');
  assert.equal(c.options.credentials,'omit');
  assert.equal(c.options.redirect,'manual');
  assert.equal(c.options.cache,'no-store');
  assert.equal(c.options.referrerPolicy,'no-referrer');
  assert.deepEqual(c.options.headers,{Accept:'application/json'});
  assert(c.options.signal instanceof AbortSignal);
 }
});

test('anonymous probe fail-closes on all gate, auth and response regressions',async()=>{
 const {probeNativeOwnerGrantReadonly}=await probe;
 const valid=()=>[
  {status:200,body:{...status}},
  {status:401,body:{code:'E_UNAUTHENTICATED'}},
  {status:503,body:{code:'E_NOT_READY'}}
 ];
 const cases=[
  x=>{x[0].body.login_enabled=false;},
  x=>{x[0].body.mode='demo';},
  x=>{x[0].body.task_write_enabled=true;},
  x=>{delete x[0].body.repair_write_enabled;},
  x=>{x[1].status=200;x[1].body={users:[]};},
  x=>{x[1].status=403;},
  x=>{x[2].status=405;x[2].body={code:'METHOD_NOT_ALLOWED'};},
  x=>{x[2].body.code='OK';},
  x=>{x[0].headers={'Set-Cookie':'session=unsafe'};},
  x=>{x[1].headers={'Content-Type':'text/html'};}
 ];
 for(const mutate of cases){
  const data=valid();mutate(data);
  await assert.rejects(()=>probeNativeOwnerGrantReadonly(fake(data)),
   /^Error: E_[A-Z_]+$/);
 }
 await assert.rejects(()=>probeNativeOwnerGrantReadonly(async()=>{
  throw Error('private upstream error');
 }),/^Error: E_REQUEST_UNAVAILABLE$/);
 await assert.rejects(()=>probeNativeOwnerGrantReadonly(
  async()=>new Response('x'.repeat(5000),{status:200,headers:{
   'Content-Type':'application/json'}})),/^Error: E_RESPONSE_JSON$/);
});

test('operator launcher and source cannot submit credentials or mutate production',()=>{
 assert.match(launcher,/node "%~dp0tools\\native-owner-grant-uat-readonly.mjs"/);
 assert.match(launcher,/exit \/b %RESULT%/);
 assert.doesNotMatch(launcher,/curl |wrangler |powershell|set CLOUD_|token=|password=/i);
 assert(code.includes("method:'GET'"));
 assert(code.includes("credentials:'omit'"));
 assert(!/method:\s*'POST'|fetcher\(.*\{method:'POST'/.test(code));
 assert(!/authorization|cookie:|x-csrf-token|NATIVE_AUTH_SOURCE_PEPPER/i.test(code));
 assert(code.includes('release_authorized:false'));
 assert(code.includes('authenticated_grant_uat_verified:false'));
});
