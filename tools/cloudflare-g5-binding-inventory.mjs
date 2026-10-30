// G5: read-only Cloudflare Worker versions and Pages D1 binding inventory.
// Inventory detects direct D1 bindings; it cannot certify indirect access or
// prevent simultaneous external writes. No Cloudflare mutation or Restore.
import {fileURLToPath} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import {ACCOUNT_ID,PROD_ID,STAGING_ID} from './check-cloudflare-staging.mjs';

const API='https://api.cloudflare.com/client/v4';
const TARGET='cloudflare/recovery-drill-target.json';
const NAME='restaurant-business-g5-disposable-recovery-drill';
const NAME_RE=/^[a-zA-Z0-9_-]{1,120}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MAX_SCRIPTS=100, MAX_VERSIONS=500, MAX_PROJECTS=500, PAGE=50, PAGES_PAGE=20;
const fail=()=>{throw Error('E_G5_BINDING_READONLY_INVENTORY');};
// Diagnostic codes are intentionally fixed strings: never emit HTTP response
// bodies, request URLs, Worker names, database IDs, credentials or exceptions.
const SAFE_REASONS=new Set([
 'VALIDATION_FAILED','API_DECLINED','HTTP_AUTH','HTTP_BAD_REQUEST','HTTP_NOT_FOUND',
 'HTTP_RATE_LIMIT','HTTP_SERVICE','HTTP_OTHER','NETWORK_ERROR','BODY_INVALID'
]);
export function safeRequestStage(p){
 if(typeof p!=='string')return 'UNKNOWN';
 const prefix='/accounts/'+ACCOUNT_ID+'/';
 if(!p.startsWith(prefix))return 'UNKNOWN';
 const suffix=p.slice(prefix.length);
 if(suffix==='workers/scripts')return 'WORKER_LIST';
 if(/^workers\/scripts\/[^/?]+\/settings$/.test(suffix))return 'WORKER_SETTINGS';
 if(/^workers\/scripts\/[^/?]+\/versions\?page=[0-9]+&per_page=[0-9]+$/.test(suffix))return 'WORKER_VERSION_LIST';
 if(/^workers\/scripts\/[^/?]+\/versions\/[^/?]+$/.test(suffix))return 'WORKER_VERSION_DETAIL';
 if(/^pages\/projects\?page=[0-9]+&per_page=[0-9]+$/.test(suffix))return 'PAGES_LIST';
 if(/^pages\/projects\/[^/?]+$/.test(suffix))return 'PAGES_PROJECT_DETAIL';
 return 'UNKNOWN';
}
function safeTransportFailure(reason){
 const err=new Error('E_G5_BINDING_READONLY_INVENTORY');
 err.g5Reason=SAFE_REASONS.has(reason)?reason:'HTTP_OTHER';
 throw err;
}
function httpReason(status){
 if(status===400)return 'HTTP_BAD_REQUEST';
 if(status===401||status===403)return 'HTTP_AUTH';
 if(status===404)return 'HTTP_NOT_FOUND';
 if(status===429)return 'HTTP_RATE_LIMIT';
 if(Number.isInteger(status)&&status>=500)return 'HTTP_SERVICE';
 return 'HTTP_OTHER';
}
function need(ok){if(!ok)fail();}
function obj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
// Diagnostic ONLY: one extra Pages List GET without query parameters if and
// only if the first paginated request fails with HTTP 400. The bare response
// must never be used as a substitute for strict, complete pagination.
// Returned categories are hard-coded and disclose no API response content.
const BARE_PAGES_PATH='/accounts/'+ACCOUNT_ID+'/pages/projects';
const FIRST_PAGED_PAGES_PATH=BARE_PAGES_PATH+'?page=1&per_page='+PAGES_PAGE;
export async function probeBarePagesProjects(get){
 need(typeof get==='function');
 try{
  const response=await get(BARE_PAGES_PATH);
  if(!obj(response)||response.success!==true)
   return obj(response)&&response.success===false?'API_DECLINED':'BODY_INVALID';
  return Array.isArray(response.result)?'OK':'BODY_INVALID';
 }catch(err){
  return SAFE_REASONS.has(err?.g5Reason)?err.g5Reason:'VALIDATION_FAILED';
 }
}
export async function readWithPagesDifferential(get,p,record){
 need(typeof get==='function'&&typeof record==='function');
 try{return await get(p);}catch(err){
  if(p===FIRST_PAGED_PAGES_PATH&&err?.g5Reason==='HTTP_BAD_REQUEST'){
   const outcome=await probeBarePagesProjects(get);
   record(outcome);
  }
  throw err; // Always fail closed; a successful bare GET is NOT a full scan.
 }
}
function result(r){need(obj(r)&&r.success===true&&r.result!==null&&typeof r.result==='object');return r.result;}
function pagination(r,page,perPage,count){
 const i=r.result_info;
 need(obj(i)&&i.page===page&&i.per_page===perPage&&i.count===count&&
  Number.isSafeInteger(i.total_count)&&i.total_count>=0&&
  Number.isSafeInteger(i.total_pages)&&i.total_pages>=1&&
  i.total_pages===Math.max(1,Math.ceil(i.total_count/perPage)));
 return i;
}
async function paged(get,path,extract,max,perPage=PAGE){
 need(Number.isSafeInteger(perPage)&&perPage>=1&&perPage<=PAGE);
 let all=[],total=null;
 for(let page=1;page<=Math.ceil(max/perPage);page++){
  const r=await get(path+'?page='+page+'&per_page='+perPage);
  const entries=extract(result(r));
  need(Array.isArray(entries)&&entries.length<=perPage&&
   all.length+entries.length<=max);
  const info=pagination(r,page,perPage,entries.length);
  need(total===null||total===info.total_count);
  total=info.total_count;
  all.push(...entries);
  need(all.length<=total);
  if(page===info.total_pages){need(all.length===total);return all;}
  need(all.length<total);
 }
 fail();
}
// Worker Script Versions response uses {result:{items:[...]}} and does NOT
// document result_info. Enumerate page/per_page until a short page appears.
// Full-page final boundaries require another request. Duplicates, exhaustion,
// missing pages and inconsistent optional version numbers fail closed.
// Without total_count this cannot prove consistency under concurrent changes.
async function workerVersions(get,base){
 const versions=[],ids=new Set();
 let lastNumber=null;
 for(let page=1;page<=Math.ceil(MAX_VERSIONS/PAGE)+1;page++){
  const response=await get(base+'/versions?page='+page+'&per_page='+PAGE);
  const data=result(response);
  need(obj(data)&&Array.isArray(data.items)&&data.items.length<=PAGE);
  const list=data.items;
  need(page!==1||list.length>0);
  for(const item of list){
   need(obj(item)&&typeof item.id==='string'&&UUID.test(item.id)&&
    !ids.has(item.id));
   ids.add(item.id);
   if(item.number!==undefined){
    need(Number.isSafeInteger(item.number)&&item.number>=1&&
      (lastNumber===null||lastNumber>item.number));
    lastNumber=item.number;
   } else {
    // Optional version numbers cannot establish page stability.
    lastNumber=null;
   }
   versions.push(item);
  }
  need(versions.length<=MAX_VERSIONS);
  if(list.length<PAGE)return versions;
 }
 fail();
}
function checkBindings(bindings,id){
 need(Array.isArray(bindings));
 let found=0;
 for(const b of bindings){
  need(obj(b)&&typeof b.type==='string'&&typeof b.name==='string');
  if(b.type!=='d1')continue;
  const db=b.database_id??b.id;
  need(typeof db==='string'&&UUID.test(db)&&
   (b.database_id===undefined||b.id===undefined||b.database_id===b.id));
  if(db===id)found++;
 }
 return found;
}
function checkPagesConfig(project,id){
 need(obj(project)&&obj(project.deployment_configs));
 let found=0;
 for(const phase of ['production','preview']){
  const c=project.deployment_configs[phase];
  need(obj(c));
  const map=c.d1_databases===undefined?{}:c.d1_databases;
  need(obj(map));
  for(const entry of Object.values(map)){
   need(obj(entry)&&typeof entry.id==='string'&&UUID.test(entry.id));
   if(entry.id===id)found++;
  }
 }
 return found;
}
export function approvedBindingTarget(pin,account=ACCOUNT_ID){
 need(obj(pin)&&Object.keys(pin).sort().join(',')==='database_id,database_name'&&
  pin.database_name===NAME&&UUID.test(pin.database_id)&&account===ACCOUNT_ID&&
  pin.database_id!==PROD_ID&&pin.database_id!==STAGING_ID);
 return pin.database_id;
}
export async function collectBindingInventory(pin,get){
 const id=approvedBindingTarget(pin);
 need(typeof get==='function');
 const prefix='/accounts/'+ACCOUNT_ID;
 const scripts=result(await get(prefix+'/workers/scripts'));
 need(Array.isArray(scripts)&&scripts.length>0&&scripts.length<=MAX_SCRIPTS);
 const names=scripts.map(s=>s?.id);
 need(names.every(n=>typeof n==='string'&&NAME_RE.test(n))&&
  new Set(names).size===names.length&&names.includes('restaurant-business-poc'));
 let versionsChecked=0,bindingsFound=0;
 for(const script of names){
  const base=prefix+'/workers/scripts/'+script;
  const settings=result(await get(base+'/settings'));
  need(obj(settings));
  bindingsFound+=checkBindings(settings.bindings,id);
  const versions=await workerVersions(get,base);
  for(const v of versions){
    need(obj(v)&&typeof v.id==='string'&&UUID.test(v.id));
    const detail=result(await get(base+'/versions/'+v.id));
    need(obj(detail)&&detail.id===v.id&&obj(detail.resources));
    bindingsFound+=checkBindings(detail.resources.bindings,id);
    versionsChecked++;
  }
 }
 // Cloudflare Pages project pagination is independent of Workers Versions.
 // Use the documented 20-item Pages response shape instead of requesting 50.
 const projects=await paged(get,prefix+'/pages/projects',r=>r,MAX_PROJECTS,PAGES_PAGE);
 const projectNames=projects.map(p=>p?.name);
 need(projectNames.every(n=>typeof n==='string'&&NAME_RE.test(n))&&
  new Set(projectNames).size===projectNames.length);
 for(const name of projectNames){
  const p=result(await get(prefix+'/pages/projects/'+name));
  need(obj(p)&&p.name===name);
  bindingsFound+=checkPagesConfig(p,id);
 }
 // Current Pages deployment_configs are NOT the immutable bindings of
 // already-serving Pages deployments. A project can have no *current* D1
 // binding while a deployed Functions version still uses the disposable D1.
 // Cloudflare Pages Read does not establish effective per-deployment binding
 // coverage here: never emit a "no direct binding" result when ANY Pages
 // project exists. Manual deployed-version evidence is a separate gate.
 const pagesDeploymentsVerified=projectNames.length===0;
 const noDirectBindingDetected=bindingsFound===0&&pagesDeploymentsVerified;
 return Object.freeze({
  status:bindingsFound?'G5_DISPOSABLE_D1_DIRECT_BINDING_FOUND':
   !pagesDeploymentsVerified?'G5_DISPOSABLE_D1_PAGES_DEPLOYMENTS_UNVERIFIED':
   'G5_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED',
  worker_scripts_checked:names.length,
  worker_versions_checked:versionsChecked,
  pages_projects_checked:projectNames.length,
  pages_deployment_bindings_verified:pagesDeploymentsVerified,
  direct_binding_matches:bindingsFound,
  no_direct_binding_detected:noDirectBindingDetected,
  direct_binding_inventory_collected:pagesDeploymentsVerified,
  no_indirect_service_access_certified:false,
  independent_human_attestation_completed:false,
  exclusive_use_verified:false,
  remote_restore_performed:false,
  production_restore_performed:false,
  production_ready:false
 });
}
export async function cloudflareReadOnlyGET(p,token,fetchImpl=fetch){
 need(typeof token==='string'&&token.length>12&&typeof fetchImpl==='function'&&
  p.startsWith('/accounts/'+ACCOUNT_ID+'/')&&!p.includes('..')&&
  !/[\\#\s]/.test(p));
 let response;
 try{
  response=await fetchImpl(API+p,{
   method:'GET',redirect:'error',
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},
   signal:AbortSignal.timeout(15000)
  });
 }catch{safeTransportFailure('NETWORK_ERROR');}
 if(response?.ok!==true)safeTransportFailure(httpReason(response?.status));
 let raw;
 try{raw=await response.text();}catch{safeTransportFailure('NETWORK_ERROR');}
 if(typeof raw!=='string'||raw.length===0||raw.length>2*1024*1024)
  safeTransportFailure('BODY_INVALID');
 try{return JSON.parse(raw);}catch{safeTransportFailure('BODY_INVALID');}
}
const file=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===file){
 let stage='PRECONDITIONS',reason='VALIDATION_FAILED',bareProbe=null;
 try{
  need(process.argv.length===3&&process.argv[2]==='inspect'&&
   process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REF==='refs/heads/main'&&
   process.env.G5_BINDINGS_READ_CONFIRM==='CHECK_G5_BINDINGS_READONLY'&&
   process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID);
  const token=process.env.CLOUDFLARE_API_TOKEN;
  need(typeof token==='string'&&token.length>12);
  const pin=JSON.parse(fs.readFileSync(TARGET,'utf8'));
  console.log(JSON.stringify(await collectBindingInventory(pin,async p=>{
   stage=safeRequestStage(p);
   reason='VALIDATION_FAILED';
   try{
    const r=await readWithPagesDifferential(
     q=>cloudflareReadOnlyGET(q,token),p,outcome=>{bareProbe=outcome;});
    if(r?.success!==true)reason='API_DECLINED';
    return r;
   }catch(err){
    reason=SAFE_REASONS.has(err?.g5Reason)?err.g5Reason:'VALIDATION_FAILED';
    throw err;
   }
  })));
 }catch{
  console.error('G5_BINDINGS_READONLY_FAILED stage='+stage+' reason='+reason+
   (bareProbe===null?'':' bare_probe='+bareProbe));
  process.exitCode=1;
 }
}
