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
const pag=(rows)=>({page:1,per_page:20,count:rows.length,total_count:rows.length,total_pages:1});
const reply=result=>({success:true,result});
function routes(){
 const projects=[{name:'pages-poc'}],vers=[{id:version}];
 return {
  [base+'/workers/scripts']:reply([{id:'restaurant-business-poc'}]),
  [script+'/settings']:reply({bindings:[{name:'DB',type:'d1',database_id:other}]}),
  [script+'/versions?page=1&per_page=50']:reply({items:vers}),
  [script+'/versions/'+version]:reply({id:version,resources:{bindings:[{name:'DB',type:'d1',database_id:other}]}}),
  [base+'/pages/projects?page=1']:{...reply(projects),result_info:pag(projects)},
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
 assert.equal(result.status,'G5_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED');
 assert.equal(result.no_direct_binding_detected,false);
 assert.equal(result.pages_deployment_bindings_verified,false);
 assert.equal(result.direct_binding_inventory_collected,false);
 assert.equal(result.direct_binding_matches,0);
 assert.equal(result.worker_scripts_checked,1);
 assert.equal(result.worker_versions_checked,1);
 assert.equal(result.pages_projects_checked,1);
 assert.equal(result.independent_human_attestation_completed,false);
 assert.equal(result.exclusive_use_verified,false);
 assert.equal(result.remote_restore_performed,false);
 assert.equal(used.length,6);
});
test('old Pages deployment may retain pinned D1 after project config has changed',async()=>{
 // Current settings have NO matching binding, but historic deployments may
 // still serve Functions with the prior D1 ID. No effective deployment
 // binding proof => fail closed instead of declaring no direct bindings.
 const data=routes();
 data[base+'/pages/projects/pages-poc'].result.deployment_configs={
  production:{d1_databases:{}},preview:{d1_databases:{}}
 };
 const {result}=await inventory(data);
 assert.equal(result.direct_binding_matches,0);
 assert.equal(result.no_direct_binding_detected,false);
 assert.equal(result.pages_deployment_bindings_verified,false);
 assert.equal(result.status,'G5_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED');
 assert.equal(result.independent_human_attestation_completed,false);
});
test('no Pages projects can complete Pages deployment coverage without deployments',async()=>{
 const data=routes();
 const url=base+'/pages/projects?page=1';
 data[url]={...reply([]),result_info:pag([])};
 delete data[base+'/pages/projects/pages-poc'];
 const {result,used}=await inventory(data);
 assert.equal(result.pages_projects_checked,0);
 assert.equal(result.pages_deployment_bindings_verified,true);
 assert.equal(result.no_direct_binding_detected,true);
 assert.equal(result.direct_binding_inventory_collected,true);
 assert.equal(result.status,'G5_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED');
 assert.ok(!used.includes(base+'/pages/projects/pages-poc'));
});
test('Pages list uses only page numbers and server per_page; Worker versions remain at 50',async()=>{
 const {result,used}=await inventory(routes());
 assert.ok(used.includes(base+'/pages/projects?page=1'));
 assert.ok(used.includes(script+'/versions?page=1&per_page=50'));
 assert.ok(!used.some(x=>x.startsWith(base+'/pages/projects?')&&x.includes('per_page=')));
 assert.ok(!used.includes(base+'/pages/projects'));
 assert.equal(result.status,'G5_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED');
});
test('21 Pages projects require both Pages listing pages with exact metadata',async()=>{
 const data=routes(),pages=Array.from({length:21},(_,i)=>({name:'pages-poc-'+i}));
 const url1=base+'/pages/projects?page=1';
 const url2=base+'/pages/projects?page=2';
 data[url1]={...reply(pages.slice(0,20)),result_info:{
  page:1,per_page:20,count:20,total_count:21,total_pages:2
 }};
 data[url2]={...reply(pages.slice(20)),result_info:{
  page:2,per_page:20,count:1,total_count:21,total_pages:2
 }};
 for(const item of pages)data[base+'/pages/projects/'+item.name]=reply({
  name:item.name,deployment_configs:{
   production:{d1_databases:{}},preview:{d1_databases:{}}
  }
 });
 delete data[base+'/pages/projects/pages-poc'];
 const {result,used}=await inventory(data);
 assert.equal(result.pages_projects_checked,21);
 assert.equal(result.no_direct_binding_detected,false);
 assert.equal(result.status,'G5_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED');
 assert.ok(used.includes(url2));
 const missing=structuredClone(data);
 delete missing[url2];
 await assert.rejects(()=>inventory(missing),/Unexpected request/);
 const drift=structuredClone(data);
 drift[url2].result_info.total_count=22;
 await assert.rejects(()=>inventory(drift),/E_G5_BINDING_READONLY_INVENTORY/);
});
test('server Pages per_page is validated, consistent and bounded; never infer completion',async()=>{
 const prefix=base+'/pages/projects?page=1';
 for(const edit of [
  x=>{delete x[prefix].result_info;},
  x=>{delete x[prefix].result_info.per_page;},
  x=>{x[prefix].result_info.per_page=0;},
  x=>{x[prefix].result_info.per_page=101;},
  x=>{x[prefix].result_info.per_page='20';},
  x=>{x[prefix].result_info.page=2;},
  x=>{x[prefix].result_info.count=0;},
  x=>{x[prefix].result_info.total_pages=2;},
  x=>{x[prefix].result_info.total_count=0;}
 ]){
  const data=routes();edit(data);
  await assert.rejects(()=>inventory(data),/E_G5_BINDING_READONLY_INVENTORY/);
 }
});
test('Pages validation failures emit only fixed field categories, never Cloudflare values',async()=>{
 const first=base+'/pages/projects?page=1';
 const cases=[
  ['PAGE_RESPONSE_INVALID',d=>{d[first].success=false;}],
  ['PAGE_RESPONSE_INVALID',d=>{d[first].result={items:[]};}],
  ['PAGE_METADATA_MISSING',d=>{delete d[first].result_info;}],
  ['PAGE_SIZE_INVALID',d=>{d[first].result_info.per_page='20';}],
  ['PAGE_SIZE_INVALID',d=>{d[first].result_info.per_page=0;}],
  ['PAGE_SIZE_EXCEEDED',d=>{d[first].result=Array.from({length:21},()=>({name:'example'}));}],
  ['PAGE_NUMBER_MISMATCH',d=>{d[first].result_info.page=2;}],
  ['PAGE_COUNT_MISMATCH',d=>{d[first].result_info.count=0;}],
  ['PAGE_TOTAL_INVALID',d=>{d[first].result_info.total_count='1';}],
  ['PAGE_TOTAL_EXCEEDS_LIMIT',d=>{d[first].result_info.total_count=501;}],
  ['PAGE_TOTAL_PAGES_INVALID',d=>{d[first].result_info.total_pages=null;}],
  ['PAGE_TOTAL_PAGES_MISMATCH',d=>{d[first].result_info.total_pages=2;}],
  ['PAGE_TOTAL_OVERFLOW',d=>{d[first].result_info.total_count=0;}],
  ['PAGE_PROJECT_NAME_INVALID',d=>{d[first].result[0].name='SENSITIVE NAME INVALID!';}],
  ['PAGE_PROJECT_NAME_DUPLICATE',d=>{
   d[first].result.push({name:'pages-poc'});
   d[first].result_info.count=2;d[first].result_info.total_count=2;
  }]
 ];
 for(const [expected,edit] of cases){
  const data=routes();edit(data);
  await assert.rejects(()=>inventory(data),err=>{
   assert.equal(err.message,'E_G5_BINDING_READONLY_INVENTORY');
   assert.equal(err.g5Validation,expected);
   assert.ok(!String(err).includes('SENSITIVE'));
   assert.ok(!JSON.stringify(err).includes('pages-poc'));
   return true;
  },expected);
 }
});
test('Pages metadata drift and incomplete multi-page enumeration have fixed safe codes',async()=>{
 const first=base+'/pages/projects?page=1',second=base+'/pages/projects?page=2';
 function twoPage(){
  const d=routes();
  d[first]={...reply([{name:'pages-poc'}]),result_info:{
   page:1,per_page:1,count:1,total_count:2,total_pages:2
  }};
  d[second]={...reply([{name:'pages-second'}]),result_info:{
   page:2,per_page:1,count:1,total_count:2,total_pages:2
  }};
  d[base+'/pages/projects/pages-second']=reply({name:'pages-second',
   deployment_configs:{production:{d1_databases:{}},preview:{d1_databases:{}}}
  });
  return d;
 }
 const cases=[
  ['PAGE_SIZE_CHANGED',d=>{d[second].result_info.per_page=2;}],
  ['PAGE_TOTAL_CHANGED',d=>{d[second].result_info.total_count=1;}],
  ['PAGE_INCOMPLETE',d=>{
   d[second].result=[];d[second].result_info.count=0;
  }]
 ];
 for(const [expected,edit] of cases){
  const d=twoPage();edit(d);
  await assert.rejects(()=>inventory(d),err=>
   err.message==='E_G5_BINDING_READONLY_INVENTORY'&&err.g5Validation===expected
  ,expected);
 }
 const healthy=twoPage();
 const {result,used}=await inventory(healthy);
 assert.equal(result.pages_projects_checked,2);
 assert.equal(result.no_direct_binding_detected,false);
 assert.ok(used.includes(second));
});
test('server per_page=10 and 11 Pages projects require exact two-page metadata',async()=>{
 const data=routes(),pages=Array.from({length:11},(_,i)=>({name:'pages-project-'+i}));
 const p1=base+'/pages/projects?page=1',p2=base+'/pages/projects?page=2';
 data[p1]={...reply(pages.slice(0,10)),result_info:{
  page:1,per_page:10,count:10,total_count:11,total_pages:2
 }};
 data[p2]={...reply(pages.slice(10)),result_info:{
  page:2,per_page:10,count:1,total_count:11,total_pages:2
 }};
 for(const x of pages)data[base+'/pages/projects/'+x.name]=reply({
  name:x.name,deployment_configs:{
   production:{d1_databases:{}},preview:{d1_databases:{}}
  }
 });
 delete data[base+'/pages/projects/pages-poc'];
 const {result,used}=await inventory(data);
 assert.equal(result.pages_projects_checked,11);
 assert.equal(result.no_direct_binding_detected,false);
 assert.ok(used.includes(p2));
 assert.ok(!used.some(x=>x.includes('per_page=')
   &&x.includes('/pages/projects?')));
 const drift=structuredClone(data);
 drift[p2].result_info.per_page=20;
 await assert.rejects(()=>inventory(drift),/E_G5_BINDING_READONLY_INVENTORY/);
 const missing=structuredClone(data);
 delete missing[p2];
 await assert.rejects(()=>inventory(missing),/Unexpected request/);
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
  d=>{delete d[script+'/versions?page=1&per_page=50'].result.items;},
  d=>{d[script+'/versions?page=1&per_page=50'].result.items=[];},
  d=>{d[base+'/pages/projects?page=1'].success=false;},
  d=>{d[base+'/pages/projects?page=1'].result_info.total_count=2;},
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
test('Cloudflare documented Worker Versions envelope has no result_info',async()=>{
 const data=routes();
 assert.equal(Object.hasOwn(data[script+'/versions?page=1&per_page=50'],'result_info'),false);
 const {result}=await inventory(data);
 assert.equal(result.worker_versions_checked,1);
 assert.equal(result.no_direct_binding_detected,false);
 assert.equal(result.status,'G5_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED');
});
test('Worker Versions full 50-item page requires a second page and checks an older binding',async()=>{
 const data=routes(),items=[];
 for(let i=0;i<50;i++){
  const id='a'+i.toString(16).padStart(7,'0')+'-1111-2222-3333-444444444444';
  items.push({id,number:51-i});
  data[script+'/versions/'+id]=reply({id,resources:{
   bindings:[{type:'d1',name:'DB',database_id:i===49?db:other}]
  }});
 }
 const older='b0000000-1111-2222-3333-444444444444';
 items[0].id=version; // original first fixture version detail remains valid
 items[0].number=51;
 delete data[script+'/versions/'+items[1].id]; // replaced below as a regression check
 data[script+'/versions/'+items[1].id]=reply({id:items[1].id,resources:{
  bindings:[{type:'d1',name:'DB',database_id:other}]
 }});
 data[script+'/versions?page=1&per_page=50']=reply({items});
 data[script+'/versions?page=2&per_page=50']=reply({items:[{id:older,number:1}]});
 data[script+'/versions/'+older]=reply({id:older,resources:{
  bindings:[{type:'d1',name:'DB',database_id:other}]
 }});
 const {result,used}=await inventory(data);
 assert.equal(result.worker_versions_checked,51);
 assert.equal(result.direct_binding_matches,1);
 assert.ok(used.includes(script+'/versions?page=2&per_page=50'));
});
test('exact 50-version boundary must request empty next page, and missing next page fails',async()=>{
 const data=routes(),items=[];
 for(let i=0;i<50;i++){
  const id='c'+i.toString(16).padStart(7,'0')+'-1111-2222-3333-444444444444';
  items.push({id,number:50-i});
  data[script+'/versions/'+id]=reply({id,resources:{bindings:[]}});
 }
 data[script+'/versions?page=1&per_page=50']=reply({items});
 await assert.rejects(()=>inventory(data),/Unexpected request/);
 data[script+'/versions?page=2&per_page=50']=reply({items:[]});
 const {result}=await inventory(data);
 assert.equal(result.worker_versions_checked,50);
});
test('Worker Versions repeated items, malformed UUIDs and unbounded pages fail closed',async()=>{
 const data=routes();
 data[script+'/versions?page=1&per_page=50'].result.items=[{id:version},{id:version}];
 await assert.rejects(()=>inventory(data),/E_G5_BINDING_READONLY_INVENTORY/);
 const invalid=routes();
 invalid[script+'/versions?page=1&per_page=50'].result.items=[{id:'bad'}];
 await assert.rejects(()=>inventory(invalid),/E_G5_BINDING_READONLY_INVENTORY/);
 const full=routes(),items=[];
 for(let i=0;i<50;i++){
  const id='d'+i.toString(16).padStart(7,'0')+'-1111-2222-3333-444444444444';
  items.push({id});
  full[script+'/versions/'+id]=reply({id,resources:{bindings:[]}});
 }
 full[script+'/versions?page=1&per_page=50']=reply({items});
 full[script+'/versions?page=2&per_page=50']=reply({items}); // replayed page
 await assert.rejects(()=>inventory(full),/E_G5_BINDING_READONLY_INVENTORY/);
});
test('invalid pinned target and Cloudflare identity rejected',async()=>{
 const m=await mod;
 assert.throws(()=>m.approvedBindingTarget({...pin,database_id:'not-a-uuid'}),/E_G5/);
 assert.throws(()=>m.approvedBindingTarget({...pin,secret:'extra'}),/E_G5/);
 assert.throws(()=>m.approvedBindingTarget(pin,'f'.repeat(32)),/E_G5/);
});
test('safe diagnostic reports only fixed stage names without exposing resource IDs',async()=>{
 const m=await mod;
 const items=[
  [base+'/workers/scripts','WORKER_LIST'],
  [script+'/settings','WORKER_SETTINGS'],
  [script+'/versions?page=1&per_page=50','WORKER_VERSION_LIST'],
  [script+'/versions/'+version,'WORKER_VERSION_DETAIL'],
  [base+'/pages/projects?page=1','PAGES_LIST'],
  [base+'/pages/projects/pages-poc','PAGES_PROJECT_DETAIL'],
  ['/unapproved/path','UNKNOWN']
 ];
 for(const [url,stage] of items){
  assert.equal(m.safeRequestStage(url),stage);
  assert.doesNotMatch(stage,/restaurant|pages-poc|[0-9a-f]{32}/i);
 }
});
test('bare Pages list is a single bounded diagnostic probe, not inventory evidence',async()=>{
 const m=await mod,seen=[],bare=base+'/pages/projects';
 const get=async path=>{
  seen.push(path);
  return reply([{name:'pages-poc'}]); // No result_info: still only diagnostic.
 };
 assert.equal(await m.probeBarePagesProjects(get),'OK');
 assert.deepEqual(seen,[bare]);
 assert.equal(await m.probeBarePagesProjects(async()=>reply({items:[]})),
  'BODY_INVALID');
 assert.equal(await m.probeBarePagesProjects(async()=>({success:false,result:[]})),
  'API_DECLINED');
 assert.equal(await m.probeBarePagesProjects(async()=>({success:true,result:null})),
  'BODY_INVALID');
 for(const reason of ['HTTP_AUTH','HTTP_BAD_REQUEST','HTTP_SERVICE','NETWORK_ERROR']){
  const error=new Error('SENSITIVE_HTTP_BODY_AND_TOKEN');
  error.g5Reason=reason;
  assert.equal(await m.probeBarePagesProjects(async()=>{throw error;}),reason);
 }
 assert.equal(await m.probeBarePagesProjects(async()=>{
  throw new Error('SENSITIVE_USER_DATA');
 }),'VALIDATION_FAILED');
});
test('first paginated Pages 400 compares bare GET once and ALWAYS fails closed',async()=>{
 const m=await mod,seen=[],outcomes=[];
 const paged=base+'/pages/projects?page=1&per_page=20';
 const bare=base+'/pages/projects';
 const original=new Error('E_G5_BINDING_READONLY_INVENTORY');
 original.g5Reason='HTTP_BAD_REQUEST';
 const get=async p=>{
  seen.push(p);
  if(p===paged)throw original;
  if([bare,bare+'?page=1',bare+'?per_page=20'].includes(p))return reply([]);
  assert.fail('unexpected GET');
 };
 await assert.rejects(
  ()=>m.readWithPagesDifferential(get,paged,v=>outcomes.push(v)),
  e=>e===original
 );
 assert.deepEqual(seen,[paged,bare,bare+'?page=1',bare+'?per_page=20']);
 assert.deepEqual(outcomes,['OK']);
 // Bare GET from the legacy diagnostic cannot substitute for a page-only
 // inventory response that is missing authoritative result_info metadata.
 const data=routes();
 data[base+'/pages/projects?page=1']=reply([]);
 await assert.rejects(()=>inventory(data),/E_G5_BINDING_READONLY_INVENTORY/);
});
test('bare Pages diagnostic keeps original paged HTTP 400 even if bare GET fails',async()=>{
 const m=await mod;
 const paged=base+'/pages/projects?page=1&per_page=20';
 const bare=base+'/pages/projects';
 const outcomes=[],calls=[];
 const original=new Error('ORIGINAL_PAGED_FAILURE');original.g5Reason='HTTP_BAD_REQUEST';
 const get=async p=>{
  calls.push(p);
  if(p===paged)throw original;
  if(p===bare){
   const err=new Error('SECRET_ERROR_BODY');err.g5Reason='HTTP_AUTH';throw err;
  }
  if(p===bare+'?page=1')return reply([]);
  if(p===bare+'?per_page=20')return reply([]);
  assert.fail('unexpected call');
 };
 await assert.rejects(
  ()=>m.readWithPagesDifferential(get,paged,v=>outcomes.push(v)),
  e=>e===original
 );
 assert.deepEqual(calls,[paged,bare,bare+'?page=1',bare+'?per_page=20']);
 assert.deepEqual(outcomes,['HTTP_AUTH']);
});
test('Pages bare probe is NOT triggered for success, other errors, or later pages',async()=>{
 const m=await mod,first=base+'/pages/projects?page=1&per_page=20',
  second=base+'/pages/projects?page=2&per_page=20';
 const calls=[],outcomes=[];
 const get=async p=>{calls.push(p);return reply([{name:'pages-poc'}]);};
 const result=await m.readWithPagesDifferential(get,first,v=>outcomes.push(v));
 assert.deepEqual(result,reply([{name:'pages-poc'}]));
 assert.deepEqual(calls,[first]);
 assert.deepEqual(outcomes,[]);
 for(const [path,why] of [
  [first,'HTTP_AUTH'],[first,'HTTP_RATE_LIMIT'],
  [second,'HTTP_BAD_REQUEST'],[script+'/settings','HTTP_BAD_REQUEST']
 ]){
  const orig=new Error('E_G5_BINDING_READONLY_INVENTORY');orig.g5Reason=why;
  const requests=[],seen=[];
  await assert.rejects(
   ()=>m.readWithPagesDifferential(async p=>{
    requests.push(p);throw orig;
   },path,v=>seen.push(v)),e=>e===orig
  );
  assert.deepEqual(requests,[path]);
  assert.deepEqual(seen,[]);
 }
});
test('Pages differential GET never uses other methods, follows redirects or leaks body',async()=>{
 const m=await mod,paged=base+'/pages/projects?page=1&per_page=20';
 const paths=[],methods=[],outcomes=[];
 const get=async p=>m.cloudflareReadOnlyGET(p,'TEST_TOKEN_123456789',
  async(url,opts)=>{
   paths.push(url);methods.push([opts.method,opts.redirect]);
   if(url.endsWith('?page=1&per_page=20')){
    return {ok:false,status:400,text:async()=>{throw Error('SENSITIVE_BODY');}};
   }
   return {ok:true,text:async()=>JSON.stringify(reply([]))};
  });
 await assert.rejects(
  ()=>m.readWithPagesDifferential(get,paged,v=>outcomes.push(v)),
  e=>e.g5Reason==='HTTP_BAD_REQUEST'&&!String(e).includes('SENSITIVE_BODY')
 );
 assert.equal(paths.length,4);
 assert.deepEqual(methods,Array(4).fill(['GET','error']));
 assert.ok(paths[0].endsWith('/pages/projects?page=1&per_page=20'));
 assert.ok(paths[1].endsWith('/pages/projects'));
 assert.ok(paths[2].endsWith('/pages/projects?page=1'));
 assert.ok(paths[3].endsWith('/pages/projects?per_page=20'));
 assert.deepEqual(outcomes,['OK']);
});
test('first paginated 400 isolates bare, page-only and per-page-only as exactly 3 bounded GETs',async()=>{
 const m=await mod,seen=[],outcomes=[];
 const paged=base+'/pages/projects?page=1&per_page=20';
 const bare=base+'/pages/projects';
 const page=bare+'?page=1';
 const perPage=bare+'?per_page=20';
 const original=new Error('ORIGINAL_400_DO_NOT_EXPOSE');
 original.g5Reason='HTTP_BAD_REQUEST';
 await assert.rejects(()=>m.readWithPagesDifferential(async p=>{
  seen.push(p);
  if(p===paged)throw original;
  if(p===bare)return reply([{name:'pages-poc'}]);
  if(p===page){const e=new Error('SECRET_BODY');e.g5Reason='HTTP_BAD_REQUEST';throw e;}
  if(p===perPage)return reply([{name:'pages-poc'}]);
  assert.fail('unexpected request');
 },paged,(...a)=>outcomes.push(a)),e=>e===original);
 assert.deepEqual(seen,[paged,bare,page,perPage]);
 assert.deepEqual(outcomes,[['OK','HTTP_BAD_REQUEST','OK']]);
});
test('diagnostic recording exception cannot replace original Pages 400',async()=>{
 const m=await mod,paged=base+'/pages/projects?page=1&per_page=20';
 const original=new Error('ORIGINAL_400');original.g5Reason='HTTP_BAD_REQUEST';
 let count=0;
 await assert.rejects(()=>m.readWithPagesDifferential(async p=>{
  count++;
  if(p===paged)throw original;
  return reply([]);
 },paged,()=>{throw new Error('SENSITIVE_RECORDING_FAILURE');}),e=>e===original);
 assert.equal(count,4);
});
test('Pages individual-query probe failures are sanitized and cannot mask first 400',async()=>{
 const m=await mod,seen=[],outcomes=[],paged=base+'/pages/projects?page=1&per_page=20';
 const original=new Error('ORIGINAL_400');original.g5Reason='HTTP_BAD_REQUEST';
 await assert.rejects(()=>m.readWithPagesDifferential(async p=>{
  seen.push(p);
  if(p===paged)throw original;
  if(p===base+'/pages/projects')return reply([]);
  if(p===base+'/pages/projects?page=1')throw Error('SENSITIVE_NETWORK_STACK');
  if(p===base+'/pages/projects?per_page=20'){
   const e=new Error('SECRET_TOKEN');e.g5Reason='HTTP_AUTH';throw e;
  }
  assert.fail('unexpected request');
 },paged,(...v)=>outcomes.push(v)),e=>e===original);
 assert.deepEqual(outcomes,[['OK','VALIDATION_FAILED','HTTP_AUTH']]);
 assert.deepEqual(seen,[paged,base+'/pages/projects',
  base+'/pages/projects?page=1',base+'/pages/projects?per_page=20']);
});
test('all Pages variants retain strict GET-only transport, no redirects or raw body',async()=>{
 const m=await mod,orig=base+'/pages/projects?page=1&per_page=20',
  bare=base+'/pages/projects',calls=[],codes=[];
 await assert.rejects(()=>m.readWithPagesDifferential(
  p=>m.cloudflareReadOnlyGET(p,'TEST_TOKEN_123456789',async(url,opts)=>{
   calls.push({url,method:opts.method,redirect:opts.redirect});
   if(url.endsWith('?page=1&per_page=20'))
    return {ok:false,status:400,text:async()=>{throw Error('SECRET_RESPONSE_BODY');}};
   if(url.endsWith('?page=1'))
    return {ok:false,status:400,text:async()=>{throw Error('SECRET_RESPONSE_BODY');}};
   return {ok:true,text:async()=>JSON.stringify(reply([]))};
  }),orig,(...out)=>codes.push(out)),
  e=>e.g5Reason==='HTTP_BAD_REQUEST'&&!String(e).includes('SECRET_RESPONSE_BODY')
 );
 assert.deepEqual(calls.map(x=>[x.method,x.redirect]),Array(4).fill(['GET','error']));
 assert.deepEqual(calls.map(x=>x.url.split('/pages/projects')[1]),[
  '?page=1&per_page=20','', '?page=1','?per_page=20'
 ]);
 assert.deepEqual(codes,[['OK','HTTP_BAD_REQUEST','OK']]);
});
test('page-only inventory HTTP 400 never falls back to bare or per_page diagnostics',async()=>{
 const m=await mod,original=new Error('ORIGINAL_HTTP_400');
 original.g5Reason='HTTP_BAD_REQUEST';
 const seen=[],recorded=[];
 const get=async p=>{
  seen.push(p);
  if(p===base+'/workers/scripts')return reply([{id:'restaurant-business-poc'}]);
  if(p===script+'/settings')return reply({bindings:[]});
  if(p===script+'/versions?page=1&per_page=50')return reply({items:[{id:version}]});
  if(p===script+'/versions/'+version)return reply({id:version,resources:{bindings:[]}});
  if(p===base+'/pages/projects?page=1')throw original;
  assert.fail('unexpected diagnostic/fallback request');
 };
 await assert.rejects(()=>m.collectBindingInventory(pin,
  p=>m.readWithPagesDifferential(get,p,(...v)=>recorded.push(v))),e=>e===original);
 assert.deepEqual(recorded,[]);
 assert.deepEqual(seen.filter(p=>p.includes('/pages/projects')),[base+'/pages/projects?page=1']);
});
test('read-only transport failures yield fixed categories, never response body',async()=>{
 const m=await mod;
 for(const [status,reason] of [
  [401,'HTTP_AUTH'],[403,'HTTP_AUTH'],[404,'HTTP_NOT_FOUND'],
  [429,'HTTP_RATE_LIMIT'],[503,'HTTP_SERVICE'],[400,'HTTP_BAD_REQUEST'],[418,'HTTP_OTHER']
 ]){
  await assert.rejects(
   ()=>m.cloudflareReadOnlyGET(base+'/workers/scripts','TEST_TOKEN_123456789',
    async()=>({ok:false,status,text:async()=>{throw Error('SENSITIVE_RESPONSE_BODY');}})),
   err=>err.g5Reason===reason&&
    !String(err.message).includes('SENSITIVE_RESPONSE_BODY')
  );
 }
 await assert.rejects(
  ()=>m.cloudflareReadOnlyGET(base+'/workers/scripts','TEST_TOKEN_123456789',
   async()=>{throw Error('SECRET_NETWORK_STACK_12345');}),
  err=>err.g5Reason==='NETWORK_ERROR'&&!String(err).includes('SECRET_NETWORK_STACK')
 );
 await assert.rejects(
  ()=>m.cloudflareReadOnlyGET(base+'/workers/scripts','TEST_TOKEN_123456789',
   async()=>({ok:true,text:async()=>'{BAD_TOKEN_VALUE_12345'})),
  err=>err.g5Reason==='BODY_INVALID'&&!String(err).includes('BAD_TOKEN_VALUE')
 );
});
test('CLI preconditions errors use sanitized stage and fixed reason',()=>{
 const out=spawnSync(process.execPath,[source,'inspect'],{
  cwd:root,encoding:'utf8',timeout:10000,
  env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main',
   G5_BINDINGS_READ_CONFIRM:'CHECK_G5_BINDINGS_READONLY',
   CLOUDFLARE_ACCOUNT_ID:acc,CLOUDFLARE_API_TOKEN:'SENSITIVE_TOKEN_123456789'}
 });
 assert.equal(out.status,1);
 assert.equal(out.stdout,'');
 assert.match(out.stderr,/G5_BINDINGS_READONLY_FAILED stage=PRECONDITIONS reason=VALIDATION_FAILED/);
 assert.doesNotMatch(out.stderr,/SENSITIVE_TOKEN|\/(accounts|workers)\//);
});
test('network client sends GET only and does not follow redirects',async()=>{
 const m=await mod,calls=[];
 const ret=await m.cloudflareReadOnlyGET(base+'/workers/scripts','TEST_TOKEN_123456789',async(url,opts)=>{
  calls.push([url,opts]);return {ok:true,text:async()=>JSON.stringify(reply([]))};
 });
 assert.deepEqual(ret,reply([]));
 assert.equal(calls[0][1].method,'GET');
 assert.equal(calls[0][1].redirect,'error');
 await assert.rejects(()=>m.cloudflareReadOnlyGET('/wrong','TEST_TOKEN_123456789',()=>{}),/E_G5/);
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
