'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const source=path.join(root,'tools/cloudflare-g5-binding-inventory.mjs');
const workflow=path.join(root,'.github/workflows/d1-disposable-binding-inventory-g5.yml');
const mod=import('../tools/cloudflare-g5-binding-inventory.mjs');
const acc='31b409b04896d260ba0fadf6cc2bb305';
const db='cc3fe86d-1c46-4c2f-a399-0ec3c46d5198';
const other='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
const version='a0000000-1111-2222-3333-444444444444';
const base='/accounts/'+acc,script=base+'/workers/scripts/restaurant-business-poc';
const pin={database_name:'restaurant-business-g5-disposable-recovery-drill',database_id:db};
const pag=(rows)=>({page:1,per_page:50,count:rows.length,total_count:rows.length,total_pages:1});
const reply=result=>({success:true,result});
function routes(){
 const projects=[{name:'pages-poc'}],vers=[{id:version}];
 return {
  [base+'/workers/scripts']:reply([{id:'restaurant-business-poc'}]),
  [script+'/settings']:reply({bindings:[{name:'DB',type:'d1',database_id:other}]}),
  [script+'/versions?page=1&per_page=50']:{...reply({items:vers}),result_info:pag(vers)},
  [script+'/versions/'+version]:reply({id:version,resources:{bindings:[{name:'DB',type:'d1',database_id:other}]}}),
  [base+'/pages/projects?page=1&per_page=50']:{...reply(projects),result_info:pag(projects)},
  [base+'/pages/projects/pages-poc']:reply({name:'pages-poc',deployment_configs:{
   production:{d1_databases:{DB:{id:other}}},preview:{d1_databases:{}}
  }})
 };
}
async function inventory(map){
 const m=await mod;
 const used=[];
 const result=await m.collectBindingInventory(pin,async url=>{
  used.push(url);
  assert.ok(Object.hasOwn(map,url),'Unexpected request '+url);
  return structuredClone(map[url]);
 });
 return {result,used};
}
test('full GET-only worker versions + Pages inventory is NOT independent signoff',async()=>{
 const {result,used}=await inventory(routes());
 assert.deepEqual(result.status,'G5_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED');
 assert.equal(result.no_direct_binding_detected,true);
 assert.equal(result.direct_binding_matches,0);
 assert.equal(result.worker_scripts_checked,1);
 assert.equal(result.worker_versions_checked,1);
 assert.equal(result.pages_projects_checked,1);
 assert.equal(result.independent_human_attestation_completed,false);
 assert.equal(result.exclusive_use_verified,false);
 assert.equal(result.remote_restore_performed,false);
 assert.equal(used.length,6);
});
test('D1 binding on current Worker, older/preview version, or Pages phase fails no-binding claim',async()=>{
 for(const edit of [
  d=>{d[script+'/settings'].result.bindings[0].database_id=db;},
  d=>{d[script+'/versions/'+version].result.resources.bindings[0].database_id=db;},
  d=>{d[base+'/pages/projects/pages-poc'].result.deployment_configs.preview.d1_databases={DB:{id:db}};}
 ]){
  const data=routes();edit(data);
  const {result}=await inventory(data);
  assert.equal(result.no_direct_binding_detected,false);
  assert.equal(result.direct_binding_matches,1);
  assert.equal(result.status,'G5_DISPOSABLE_D1_DIRECT_BINDING_FOUND');
 }
});
test('missing pages permission, incomplete pagination, unknown bindings, and hidden versions fail closed',async()=>{
 for(const edit of [
  d=>{delete d[script+'/versions?page=1&per_page=50'].result_info;},
  d=>{d[base+'/pages/projects?page=1&per_page=50'].success=false;},
  d=>{d[base+'/pages/projects?page=1&per_page=50'].result_info.total_count=2;},
  d=>{delete d[base+'/pages/projects/pages-poc'].result.deployment_configs.preview;},
  d=>{d[script+'/settings'].result.bindings=[{type:'d1',name:'DB'}];},
  d=>{d[script+'/versions/'+version].result.resources.bindings=null;},
  d=>{d[base+'/workers/scripts'].result=[];},
  d=>{d[script+'/versions?page=1&per_page=50'].result.items.push({id:version});}
 ]){
  const data=routes();edit(data);
  await assert.rejects(()=>inventory(data),/E_G5_BINDING_READONLY_INVENTORY/);
 }
});
test('invalid pinned target and Cloudflare identity rejected',async()=>{
 const m=await mod;
 assert.throws(()=>m.approvedBindingTarget({...pin,database_id:'not-a-uuid'}),/E_G5/);
 assert.throws(()=>m.approvedBindingTarget({...pin,secret:'extra'}),/E_G5/);
 assert.throws(()=>m.approvedBindingTarget(pin,'f'.repeat(32)),/E_G5/);
});
test('network client sends GET only and does not follow redirects',async()=>{
 const m=await mod,calls=[];
 const ret=await m.cloudflareReadOnlyGET(base+'/workers/scripts','TEST_TOKEN_123456789',async(url,opts)=>{
  calls.push([url,opts]);return {ok:true,text:async()=>JSON.stringify(reply([]))};
 });
 assert.deepEqual(ret,reply([]));
 assert.equal(calls[0][1].method,'GET');
 assert.equal(calls[0][1].redirect,'error');
 assert.throws(()=>m.cloudflareReadOnlyGET('/wrong','TEST_TOKEN_123456789',()=>{}),/E_G5/);
});
test('CLI and manual workflow reject missing authorization and cannot write',()=>{
 const wf=fs.readFileSync(workflow,'utf8');
 const src=fs.readFileSync(source,'utf8');
 assert.match(wf,/workflow_dispatch:/);
 assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
 assert.match(wf,/CHECK_G5_BINDINGS_READONLY/);
 assert.match(wf,/environment: d1-recovery-drill-binding-readonly/);
 assert.match(wf,/cloudflare-hosted-probe-preflight\.mjs/);
 assert.doesNotMatch(wf,/(?:^|\n)\s*(?:push|schedule|pull_request):|restore|wrangler deploy|d1 migrations/);
 assert.match(src,/method:'GET',redirect:'error'/);
 assert.doesNotMatch(src,/method:'POST'|method:'PUT'|method:'DELETE'/);
 const out=spawnSync(process.execPath,[source,'inspect'],{
  cwd:root,encoding:'utf8',timeout:10000,
  env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main',
   G5_BINDINGS_READ_CONFIRM:'CHECK_G5_BINDINGS_READONLY',
   CLOUDFLARE_ACCOUNT_ID:acc,CLOUDFLARE_API_TOKEN:'TEST_TOKEN_123456789'}
 });
 assert.equal(out.status,1);
 assert.equal(out.stdout,'');
 assert.match(out.stderr,/G5_BINDINGS_READONLY_FAILED/);
 assert.doesNotMatch(out.stderr,/TEST_TOKEN_123456789/);
});
