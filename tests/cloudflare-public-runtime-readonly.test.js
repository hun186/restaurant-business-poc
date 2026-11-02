'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const loaded=import('../tools/cloudflare-public-runtime-readonly.mjs');
const goodHealth={status:'demo_only',api:'not_implemented',
 database:'schema_only',production_ready:false};
const json=(o,status=200,h={})=>new Response(JSON.stringify(o),{
 status,headers:{'content-type':'application/json; charset=utf-8',...h}});
function fixture(overrides={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
  const route=new URL(url).pathname,key=opts.method+' '+route;
  calls.push({url,opts});
  if(Object.hasOwn(overrides,key))return overrides[key];
  if(key==='GET /api/health')return json(goodHealth,200,{'cache-control':'no-store'});
  if(key==='HEAD /api/health')return new Response(null,{status:200});
  if(key==='GET /')return new Response('<html>公開示範版 · 全部為虛構資料</html>',{
   status:200,headers:{'content-type':'text/html; charset=utf-8'}});
  return json({code:'E_NOT_READY'},503);
 };
 return {fetchImpl,calls};
}
test('fixed Worker URL, only seven GET/HEAD public requests, no credentials or mutation',async()=>{
 const m=await loaded,f=fixture(),out=await m.inspectPublicRuntime({fetchImpl:f.fetchImpl});
 assert.equal(out.status,'PUBLIC_WORKER_READONLY_HTTP_PASS');
 assert.equal(out.demo_http_verified,true);
 assert.equal(out.d1_schema_contract_visible,true);
 assert.equal(out.production_ready,false);
 assert.equal(out.active_worker_version_verified,false);
 assert.equal(out.deployed_commit_verified,false);
 assert.equal(out.access_policy_verified,false);
 assert.equal(out.staging_login_verified,false);
 assert.equal(out.recovery_signoff_granted,false);
 assert.deepEqual(f.calls.map(x=>x.opts.method),
  ['GET','HEAD','GET','GET','GET','GET','GET']);
 for(const c of f.calls){
  assert.ok(c.url.startsWith(m.HOST+'/'));
  assert.equal(c.opts.redirect,'manual');
  assert.equal(c.opts.credentials,'omit');
  assert.equal(c.opts.cache,'no-store');
  assert.equal(c.opts.body,undefined);
  assert.deepEqual(Object.keys(c.opts.headers),['Accept']);
 }
});
test('schema missing, unexpected production enablement, redirects and wrong responses block PASS',async()=>{
 const m=await loaded;
 for(const overrides of [
  {'GET /api/health':json({...goodHealth,database:'not_configured'},200,{'cache-control':'no-store'})},
  {'GET /api/health':json({...goodHealth,production_ready:true},200,{'cache-control':'no-store'})},
  {'GET /api/health':new Response(null,{status:302,headers:{location:'https://example.invalid'}})},
  {'GET /api/health':new Response('<html>blocked</html>',{status:200,headers:{'content-type':'text/html'}})},
  {'GET /api/command':json({code:'NOT_READY'},503)},
  {'GET /api/login':json({code:'OK'},200)},
  {'GET /':new Response('<html>unexpected content</html>',{status:200,headers:{'content-type':'text/html'}})},
  {'HEAD /api/health':new Response('unexpected',{status:200})}
 ]){
  const f=fixture(overrides);
  await assert.rejects(m.inspectPublicRuntime({fetchImpl:f.fetchImpl}),/E_PUBLIC_WORKER_READONLY/);
 }
});
test('network failure does not become a false deployment PASS; error redacted',async()=>{
 const m=await loaded;
 await assert.rejects(m.inspectPublicRuntime({fetchImpl:async()=>{throw Error('SECRET_PRIVATE_ENDPOINT')}}),
  e=>e.message==='E_PUBLIC_WORKER_READONLY'&&e.stage==='API_HEALTH'&&
    e.detail==='REQUEST_UNAVAILABLE'&&!e.message.includes('SECRET'));
});
test('oversized and invalid JSON are rejected with bounded body',async()=>{
 const m=await loaded;
 for(const body of ['X'.repeat(9000),'{invalid']){
  const f=fixture({'GET /api/health':new Response(body,{status:200,
   headers:{'content-type':'application/json','cache-control':'no-store'}})});
  await assert.rejects(m.inspectPublicRuntime({fetchImpl:f.fetchImpl}),
   /E_PUBLIC_WORKER_READONLY/);
 }
});
test('manual workflow and Windows BAT have no tokens, shell deployment or write methods',()=>{
 const root=path.join(__dirname,'..');
 const source=fs.readFileSync(path.join(root,'tools/cloudflare-public-runtime-readonly.mjs'),'utf8');
 const bat=fs.readFileSync(path.join(root,'run-cloudflare-public-readonly.bat'),'utf8');
 const workflow=fs.readFileSync(path.join(root,'.github/workflows/cloudflare-public-runtime-readonly.yml'),'utf8');
 assert.match(source,/method='GET'/);
 assert.match(source,/credentials:'omit'/);
 assert.doesNotMatch(source,/method:'POST'|method:'PUT'|method:'PATCH'|method:'DELETE'|wrangler deploy/);
 assert.match(bat,/cloudflare-public-runtime-readonly\.mjs/);
 assert.doesNotMatch(bat,/CLOUDFLARE_API_TOKEN|wrangler deploy|--export/);
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/refs\/heads\/main/);
 assert.match(workflow,/cloudflare-public-runtime-readonly.mjs/);
 assert.doesNotMatch(workflow,/secrets\.|wrangler deploy|CLOUDFLARE_API_TOKEN/);
});
