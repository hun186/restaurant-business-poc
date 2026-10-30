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
const MAX_SCRIPTS=100, MAX_VERSIONS=500, MAX_PROJECTS=500, PAGE=50;
const fail=()=>{throw Error('E_G5_BINDING_READONLY_INVENTORY');};
function need(ok){if(!ok)fail();}
function obj(x){return x!==null&&typeof x==='object'&&!Array.isArray(x);}
function result(r){need(obj(r)&&r.success===true&&r.result!==null&&typeof r.result==='object');return r.result;}
function pagination(r,page,perPage,count){
 const i=r.result_info;
 need(obj(i)&&i.page===page&&i.per_page===perPage&&i.count===count&&
  Number.isSafeInteger(i.total_count)&&i.total_count>=0&&
  Number.isSafeInteger(i.total_pages)&&i.total_pages>=1&&
  i.total_pages===Math.max(1,Math.ceil(i.total_count/perPage)));
 return i;
}
async function paged(get,path,extract,max){
 let all=[],total=null;
 for(let page=1;page<=Math.ceil(max/PAGE);page++){
  const r=await get(path+'?page='+page+'&per_page='+PAGE);
  const entries=extract(result(r));
  need(Array.isArray(entries)&&entries.length<=PAGE&&
   all.length+entries.length<=max);
  const info=pagination(r,page,PAGE,entries.length);
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
 const projects=await paged(get,prefix+'/pages/projects',r=>r,MAX_PROJECTS);
 const projectNames=projects.map(p=>p?.name);
 need(projectNames.every(n=>typeof n==='string'&&NAME_RE.test(n))&&
  new Set(projectNames).size===projectNames.length);
 for(const name of projectNames){
  const p=result(await get(prefix+'/pages/projects/'+name));
  need(obj(p)&&p.name===name);
  bindingsFound+=checkPagesConfig(p,id);
 }
 return Object.freeze({
  status:bindingsFound?'G5_DISPOSABLE_D1_DIRECT_BINDING_FOUND':
   'G5_DISPOSABLE_D1_NO_DIRECT_BINDING_DETECTED_MANUAL_REVIEW_REQUIRED',
  worker_scripts_checked:names.length,
  worker_versions_checked:versionsChecked,
  pages_projects_checked:projectNames.length,
  direct_binding_matches:bindingsFound,
  no_direct_binding_detected:bindingsFound===0,
  direct_binding_inventory_collected:true,
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
 const response=await fetchImpl(API+p,{
  method:'GET',redirect:'error',
  headers:{Authorization:'Bearer '+token,Accept:'application/json'},
  signal:AbortSignal.timeout(15000)
 });
 need(response?.ok===true);
 const raw=await response.text();
 need(typeof raw==='string'&&raw.length>0&&raw.length<=2*1024*1024);
 try{return JSON.parse(raw);}catch{fail();}
}
const file=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===file){
 try{
  need(process.argv.length===3&&process.argv[2]==='inspect'&&
   process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REF==='refs/heads/main'&&
   process.env.G5_BINDINGS_READ_CONFIRM==='CHECK_G5_BINDINGS_READONLY'&&
   process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID);
  const token=process.env.CLOUDFLARE_API_TOKEN;
  need(typeof token==='string'&&token.length>12);
  const pin=JSON.parse(fs.readFileSync(TARGET,'utf8'));
  console.log(JSON.stringify(await collectBindingInventory(pin,
   p=>cloudflareReadOnlyGET(p,token))));
 }catch{
  console.error('G5_BINDINGS_READONLY_FAILED');
  process.exitCode=1;
 }
}
