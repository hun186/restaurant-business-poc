'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'tools/cloudflare-g0-remote-inventory.mjs');
const workflow=path.join(root,'.github/workflows/cloudflare-g0-readonly-inventory.yml');
const modulePromise=import('../tools/cloudflare-g0-remote-inventory.mjs');
const ZONE='a'.repeat(32);
function fixture(withProbe=true){
 const scripts=[{id:'restaurant-business-poc'}];
 if(withProbe)scripts.push({id:'restaurant-pbkdf2-hosted-cpu-staging-probe'});
 return {
  scripts,domains:[],zones:[{id:ZONE}],routes:[],
  subdomains:{
   'restaurant-business-poc':{enabled:true,previews_enabled:true},
   ...(withProbe?{'restaurant-pbkdf2-hosted-cpu-staging-probe':{enabled:false,previews_enabled:false}}:{})
  }
 };
}
function reply(result){return {success:true,result};}
function routes(){
 return {
  '/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/scripts':reply(fixture().scripts),
  '/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/domains?page=1&per_page=50':
   {...reply([]),result_info:{page:1,count:0,total_count:0,total_pages:1,per_page:50}},
  '/zones?account.id=31b409b04896d260ba0fadf6cc2bb305&page=1&per_page=50':
   {...reply([{id:ZONE}]),result_info:{page:1,count:1,total_count:1,total_pages:1,per_page:50}},
  ['/zones/'+ZONE+'/workers/routes']:reply([]),
  '/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/scripts/restaurant-business-poc/subdomain':
   reply({enabled:true,previews_enabled:true}),
  '/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/scripts/restaurant-pbkdf2-hosted-cpu-staging-probe/subdomain':
   reply({enabled:false,previews_enabled:false})
 };
}
test('valid read-only inventory is explicitly not Cloudflare Access or release certification',async()=>{
 const m=await modulePromise;
 const report=m.classifyInventory(fixture());
 assert.equal(report.public_surface_present,true);
 assert.equal(report.target_workers_dev_enabled,true);
 assert.equal(report.target_preview_urls_enabled,true);
 assert.equal(report.probe_worker_deployed,true);
 assert.equal(report.probe_workers_dev_enabled,false);
 assert.equal(report.g0_certified,false);
 assert.equal(report.release_authorized,false);
 assert.equal(report.access_policy_verified,false);
 assert.equal(report.deployment_and_version_url_probes_verified,false);
 assert.doesNotMatch(JSON.stringify(report),/workers\.dev\/|hostname|route_pattern/);
});
test('even no detected public routes never grants production release',async()=>{
 const m=await modulePromise;
 const data=fixture(false);
 data.subdomains['restaurant-business-poc']={enabled:false,previews_enabled:false};
 const result=m.classifyInventory(data);
 assert.equal(result.public_surface_present,false);
 assert.equal(result.probe_worker_deployed,false);
 assert.equal(result.g0_certified,false);
 assert.equal(result.release_authorized,false);
});
test('custom domains, preview-domain mappings, zone routes and probe exposure are detected',async()=>{
 const m=await modulePromise;
 const host='preview.example.invalid';
 const cases=[
  d=>{d.domains.push({service:'restaurant-business-poc',hostname:host,enabled:true,previews_enabled:false});},
  d=>{d.domains.push({service:'restaurant-business-poc',hostname:host,enabled:false,previews_enabled:true});},
  d=>{d.routes.push({zone_id:ZONE,script:'restaurant-business-poc',pattern:'preview.example.invalid/*'});},
  d=>{d.subdomains['restaurant-pbkdf2-hosted-cpu-staging-probe'].enabled=true;}
 ];
 for(const update of cases){
  const data=fixture();
  data.subdomains['restaurant-business-poc']={enabled:false,previews_enabled:false};
  update(data);
  assert.equal(m.classifyInventory(data).public_surface_present,true);
 }
});
test('invalid target metadata, missing Worker, route zone or conflicting scripts fail closed',async()=>{
 const m=await modulePromise;
 const tests=[
  d=>d.scripts=[],
  d=>d.scripts.push({id:'restaurant-business-poc'}),
  d=>d.domains.push({hostname:'h.example.invalid',service:'restaurant-business-poc',enabled:'true',previews_enabled:false}),
  d=>d.routes.push({zone_id:'b'.repeat(32),script:'restaurant-business-poc',pattern:'test.example/*'}),
  d=>d.subdomains['restaurant-business-poc'].enabled='false',
  d=>d.zones.push({id:ZONE})
 ];
 for(const update of tests){
  const input=fixture();update(input);
  assert.throws(()=>m.classifyInventory(input),/E_G0_READONLY_INVENTORY/);
 }
});
test('collector only asks documented GET routes and handles missing probe as un-deployed',async()=>{
 const m=await modulePromise, data=routes(),used=[];
 const collected=await m.collectCloudflareInventory(async p=>{
  used.push(p);assert.ok(Object.hasOwn(data,p),'unexpected cloudflare path '+p);
  return data[p];
 });
 assert.deepEqual(collected.scripts.map(x=>x.id),
 ['restaurant-business-poc','restaurant-pbkdf2-hosted-cpu-staging-probe']);
 assert.equal(used.length,6);
 assert.equal(m.classifyInventory(collected).g0_certified,false);
});
test('incomplete domain pagination or failed Cloudflare API read never becomes empty inventory',async()=>{
 const m=await modulePromise,data=routes();
 const dom='/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/domains?page=1&per_page=50';
 data[dom].result_info.total_pages=2;
 await assert.rejects(()=>m.collectCloudflareInventory(p=>{
  if(!Object.hasOwn(data,p))throw Error('missing next page');
  return Promise.resolve(data[p]);
 }));
 data[dom]={success:false,result:[],errors:[{message:'token_redacted'}]};
 await assert.rejects(()=>m.collectCloudflareInventory(p=>Promise.resolve(data[p])),/E_G0_READONLY_INVENTORY/);
});
test('missing or mismatched Cloudflare total_count never permits an empty inventory',async()=>{
 const m=await modulePromise;
 const dom='/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/domains?page=1&per_page=50';
 const zone='/zones?account.id=31b409b04896d260ba0fadf6cc2bb305&page=1&per_page=50';
 for(const change of [
  d=>{delete d[dom].result_info.total_count;},
  d=>{d[dom].result_info.total_count=1;}, // 0 rows but API says 1
  d=>{d[zone].result_info.total_count=2;}, // zone list misses a zone
  d=>{d[dom].result_info.total_count=-1;},
  d=>{d[dom].result_info.total_count=0.5;},
  d=>{d[dom].result_info.per_page=20;},
  d=>{d[dom].result_info.count=1;},
  d=>{d[dom].result_info.total_pages=2;}
 ]){
  const data=routes();change(data);
  await assert.rejects(
    ()=>m.collectCloudflareInventory(p=>Promise.resolve(data[p])),
    /E_G0_READONLY_INVENTORY/
  );
 }
});
test('multi-page Cloudflare data passes only with exact cross-page count',async()=>{
 const m=await modulePromise;
 const dom='/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/domains?page=1&per_page=50';
 const dom2='/accounts/31b409b04896d260ba0fadf6cc2bb305/workers/domains?page=2&per_page=50';
 const entries=Array.from({length:51},(_,i)=>({
  service:'restaurant-business-poc',hostname:'store'+i+'.example.invalid',
  enabled:false,previews_enabled:false
 }));
 function multi(){
  const d=routes();
  d[dom]={...reply(entries.slice(0,50)),
   result_info:{page:1,count:50,total_count:51,total_pages:2,per_page:50}};
  d[dom2]={...reply(entries.slice(50)),
   result_info:{page:2,count:1,total_count:51,total_pages:2,per_page:50}};
  return d;
 }
 const ok=await m.collectCloudflareInventory(p=>Promise.resolve(multi()[p]));
 assert.equal(ok.domains.length,51);
 assert.equal(m.classifyInventory(ok).g0_certified,false);
 for(const change of [
  d=>{d[dom2].result_info.total_count=52;}, // API changes count across pages
  d=>{d[dom2].result=[];d[dom2].result_info.count=0;}, // early termination
  d=>{d[dom2].result.push(entries[0]);d[dom2].result_info.count=2;},
  d=>{d[dom2].result_info.page=1;},
  d=>{delete d[dom2].result_info.total_count;}
 ]){
  const d=multi();change(d);
  await assert.rejects(
   ()=>m.collectCloudflareInventory(p=>Promise.resolve(d[p])),
   /E_G0_READONLY_INVENTORY/
  );
 }
});
test('local repository deploy isolation and read-only environment gating are required',async()=>{
 const m=await modulePromise;
 const prod=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
 const hosted=JSON.parse(fs.readFileSync(path.join(root,'wrangler.pbkdf2-hosted-disabled.jsonc'),'utf8'));
 assert.equal(m.assertLocalIsolation(prod,hosted,'31b409b04896d260ba0fadf6cc2bb305'),true);
 assert.throws(()=>m.assertLocalIsolation(prod,hosted,'f'.repeat(32)),/E_G0_READONLY_INVENTORY/);
 const altered=structuredClone(hosted);altered.vars.PROBE_ENABLED='access-only';
 assert.throws(()=>m.assertLocalIsolation(prod,altered,'31b409b04896d260ba0fadf6cc2bb305'),/E_G0_READONLY_INVENTORY/);
 const result=spawnSync(process.execPath,[source,'inspect'],{
  cwd:root,encoding:'utf8',timeout:10000,
  env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main',
    CLOUDFLARE_ACCOUNT_ID:'31b409b04896d260ba0fadf6cc2bb305',
    CLOUDFLARE_API_TOKEN:'SYNTHETIC_DO_NOT_STORE',
    G0_READONLY_CONFIRM:'CHECK_G0_READONLY'}
 });
 assert.equal(result.status,1);
 assert.equal(result.stdout,'');
 assert.match(result.stderr,/G0_READONLY_INVENTORY_FAILED/);
 assert.doesNotMatch(result.stderr,/SYNTHETIC_DO_NOT_STORE/);
});
test('main-only manual GitHub workflow has no deployment, write methods or body uploads',()=>{
 const wf=fs.readFileSync(workflow,'utf8');
 assert.match(wf,/^on:\s*$/m);
 assert.match(wf,/^  workflow_dispatch:/m);
 assert.doesNotMatch(wf,/^\s*(push|pull_request|schedule):/m);
 assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
 assert.match(wf,/inputs\.confirm == 'CHECK_G0_READONLY'/);
 assert.match(wf,/environment: cloudflare-g0-readonly/);
 assert.match(wf,/node tools\/cloudflare-hosted-probe-preflight\.mjs/);
 assert.match(wf,/node tools\/cloudflare-g0-remote-inventory\.mjs inspect/);
 assert.match(wf,/secrets\.CLOUDFLARE_G0_READONLY_TOKEN/);
 assert.doesNotMatch(wf,/wrangler deploy|d1 migrations|npm install|npx|curl\s+-X|artifact|d1 execute/);
 const src=fs.readFileSync(source,'utf8');
 assert.match(src,/method:'GET',redirect:'error'/);
 assert.match(src,/AbortSignal\.timeout\(10000\)/);
 assert.match(src,/api\.cloudflare\.com\/client\/v4/);
 assert.doesNotMatch(src,/method:'POST'|method:'PUT'|method:'DELETE'|console\.log\(body\)/);
});
