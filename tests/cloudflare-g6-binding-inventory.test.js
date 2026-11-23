'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const G6='909037ca-bb9d-45d3-b090-bc2af0e5951f';
const G5='04566a27-cd95-4415-9bd7-c3e19d60ab6c';
const PROD='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
const STAGING='2c355bed-d9c3-449c-aa9b-1018f3bc1177';
const ACC='31b409b04896d260ba0fadf6cc2bb305';
const pin={database_name:'restaurant-business-stock-v4-disposable',database_id:G6};
const mod=import('../tools/cloudflare-g6-binding-inventory.mjs');
const core=import('../tools/cloudflare-g5-binding-inventory.mjs');
const prefix='/accounts/'+ACC;
const worker=prefix+'/workers/scripts/restaurant-business-poc';
const vid='a0000000-1111-2222-3333-444444444444';
const reply=result=>({success:true,result});
const page=arr=>({...reply(arr),result_info:{
 page:1,per_page:20,count:arr.length,total_count:arr.length,
 total_pages:arr.length>0?1:0
}});
function fixtures(){
 return {
  [prefix+'/workers/scripts']:reply([{id:'restaurant-business-poc'}]),
  [worker+'/settings']:reply({bindings:[{name:'DB',type:'d1',database_id:PROD}]}),
  [worker+'/versions?page=1&per_page=50']:reply({items:[{id:vid}]}),
  [worker+'/versions/'+vid]:reply({id:vid,resources:{
   bindings:[{name:'DB',type:'d1',database_id:PROD}]}}),
  [prefix+'/pages/projects?page=1']:page([])
 };
}
function capture(map){
 const seen=[];
 return {seen,get:async p=>{
  seen.push(p);
  assert.ok(Object.hasOwn(map,p),'unexpected GET '+p);
  return structuredClone(map[p]);
 }};
}
test('G6 current pin is fixed and cannot alias Production, Staging, or G5',async()=>{
 const m=await core;
 assert.equal(m.approvedG6BindingTarget(pin),G6);
 for(const id of [PROD,STAGING,G5,'cc3fe86d-1c46-4c2f-a399-0ec3c46d5198',
  'PENDING_SEPARATE_REVIEWED_TARGET_PR']){
  assert.throws(()=>m.approvedG6BindingTarget({...pin,database_id:id}),
   /E_G5_BINDING_READONLY_INVENTORY/);
 }
 for(const p of [{...pin,database_name:'restaurant-business-prod'},
  {...pin,extra:'bad'}])assert.throws(()=>m.approvedG6BindingTarget(p),
   /E_G5_BINDING_READONLY_INVENTORY/);
});
test('exhaustive G6 Workers/Pages GET-only scan passes with manual-review caveats',async()=>{
 const m=await mod;
 const {seen,get}=capture(fixtures());
 const data=await m.checkG6Bindings(pin,get);
 assert.equal(data.status,
  'G6_STOCK_V4_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED');
 assert.equal(data.worker_scripts_checked,1);
 assert.equal(data.worker_versions_checked,1);
 assert.equal(data.pages_projects_checked,0);
 assert.equal(data.direct_binding_matches,0);
 assert.equal(data.no_direct_binding_detected,true);
 assert.equal(data.independent_human_attestation_completed,false);
 assert.equal(data.no_indirect_service_access_certified,false);
 assert.equal(data.exclusive_use_verified,false);
 assert.equal(data.remote_v4_migration_performed,false);
 assert.equal(data.release_authorized,false);
 assert.equal(seen.length,5);
 assert.ok(seen.every(p=>p.startsWith(prefix+'/')));
 assert.ok(seen.every(p=>!p.includes('/query')&&!p.includes('restore')));
 assert.doesNotMatch(JSON.stringify(data),new RegExp(G6));
});
test('detecting any G6 Worker binding denies a clean result',async()=>{
 const m=await mod,data=fixtures();
 data[worker+'/settings'].result.bindings[0].database_id=G6;
 const inventory=await (await core).collectG6BindingInventory(pin,capture(data).get);
 assert.equal(inventory.status,'G6_STOCK_V4_DISPOSABLE_D1_DIRECT_BINDING_FOUND');
 assert.equal(inventory.no_direct_binding_detected,false);
 await assert.rejects(()=>m.checkG6Bindings(pin,capture(data).get),
  /G6_BINDINGS_READONLY_FAILED/);
});
test('any Pages project denies certification without deployed-version evidence',async()=>{
 const m=await mod,data=fixtures();
 data[prefix+'/pages/projects?page=1']=page([{name:'pages-poc'}]);
 data[prefix+'/pages/projects/pages-poc']=reply({
  name:'pages-poc',deployment_configs:{
   production:{d1_databases:{}},preview:{d1_databases:{}}
  }
 });
 const inventory=await (await core).collectG6BindingInventory(pin,capture(data).get);
 assert.equal(inventory.pages_projects_checked,1);
 assert.equal(inventory.no_direct_binding_detected,false);
 assert.equal(inventory.status,'G6_STOCK_V4_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED');
 await assert.rejects(()=>m.checkG6Bindings(pin,capture(data).get),
  /G6_BINDINGS_READONLY_FAILED/);
});
test('missing/incomplete Worker version pagination fails closed',async()=>{
 const m=await mod,data=fixtures();
 delete data[worker+'/versions/'+vid];
 await assert.rejects(()=>m.checkG6Bindings(pin,capture(data).get));
});
test('G6 CLI rejects missing Main-only authorization before a network call',()=>{
 const script=path.join(root,'tools/cloudflare-g6-binding-inventory.mjs');
 const result=spawnSync(process.execPath,[script,'inspect'],{
  cwd:root,encoding:'utf8',
  env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main',
   G6_BINDINGS_READ_CONFIRM:'CHECK_G6_BINDINGS_READONLY',
   CLOUDFLARE_ACCOUNT_ID:ACC,
   CLOUDFLARE_API_TOKEN:'synthetic_only_never_live_1234567890'}
 });
 assert.equal(result.status,1);assert.equal(result.stdout,'');
 assert.match(result.stderr,/G6_BINDINGS_READONLY_FAILED/);
 assert.doesNotMatch(result.stderr,/synthetic_only|909037ca|\/accounts\//);
});
test('manual G6 workflow is preflighted, protected and strictly GET-only',()=>{
 const src=fs.readFileSync(path.join(root,
  '.github/workflows/d1-stock-v4-disposable-binding-readonly.yml'),'utf8');
 assert.match(src,/workflow_dispatch/);
 assert.match(src,/refs\/heads\/main/);
 assert.match(src,/CHECK_G6_BINDINGS_READONLY/);
 assert.match(src,/environment: d1-recovery-drill-binding-readonly/);
 assert.match(src,/CLOUDFLARE_G5_BINDINGS_READ_TOKEN/);
 assert.match(src,/cloudflare-hosted-probe-preflight\.mjs/);
 assert.ok(src.indexOf('cloudflare-hosted-probe-preflight.mjs')<
  src.indexOf('CLOUDFLARE_G5_BINDINGS_READ_TOKEN'));
 assert.doesNotMatch(src,/WRITE_TOKEN|migrations apply|restore\?|wrangler d1/);
});
