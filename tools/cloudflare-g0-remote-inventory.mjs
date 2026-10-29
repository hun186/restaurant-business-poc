// P0 #34 / G0: Cloudflare Worker exposure-surface read-only inventory.
// No deployments, no writes, no public HTTP probes and no authorization claim.
// The only network destination is the fixed Cloudflare API hostname.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ACCOUNT_ID} from './check-cloudflare-staging.mjs';

const WORKER='restaurant-business-poc';
const PROBE='restaurant-pbkdf2-hosted-cpu-staging-probe';
const HEX32=/^[a-f0-9]{32}$/i;
const MAX_PAGES=20;
const API='https://api.cloudflare.com/client/v4';
const fail=()=>{throw new Error('E_G0_READONLY_INVENTORY');};
function ensure(ok){if(!ok)fail();}
function rows(reply) {
  ensure(reply&&typeof reply==='object'&&!Array.isArray(reply)&&
    reply.success===true&&Array.isArray(reply.result));
  return reply.result;
}
function isPaginatedComplete(reply,page,received,expectedTotal) {
  const info=reply.result_info;
  // Both domain and zone list responses expose total_count. No metadata, no
  // success: an incomplete inventory could otherwise conceal a public route.
  ensure(info&&Number.isSafeInteger(info.page)&&info.page===page&&
    Number.isSafeInteger(info.count)&&info.count>=0&&info.count<=50&&
    Number.isSafeInteger(info.total_count)&&info.total_count>=0&&
    Number.isSafeInteger(info.total_pages)&&info.total_pages>=1&&
    info.total_pages<=MAX_PAGES&&
    (info.per_page===undefined||info.per_page===50));
  ensure(info.count===reply.result.length&&
    info.total_pages===Math.max(1,Math.ceil(info.total_count/50))&&
    (expectedTotal===null||info.total_count===expectedTotal)&&
    received<=info.total_count);
  // A terminal page cannot silently return fewer rows than the API reports;
  // nonterminal pages must leave some rows to retrieve.
  ensure(page===info.total_pages?
    received===info.total_count:received<info.total_count);
  return page===info.total_pages;
}
async function pages(getJSON,path) {
  const all=[];
  let expectedTotal=null;
  for(let page=1;page<=MAX_PAGES;page++){
    const delimiter=path.includes('?')?'&':'?';
    const reply=await getJSON(path+delimiter+'page='+page+'&per_page=50');
    const list=rows(reply);
    all.push(...list);
    if(isPaginatedComplete(reply,page,all.length,expectedTotal))return all;
    expectedTotal=reply.result_info.total_count;
  }
  fail();
}
function strictSubdomain(reply) {
  ensure(reply&&typeof reply==='object'&&reply.success===true&&
    reply.result&&typeof reply.result.enabled==='boolean'&&
    typeof reply.result.previews_enabled==='boolean');
  return reply.result;
}
function inventoryEntryCount(value){ensure(Number.isSafeInteger(value)&&value>=0);return value;}
export function assertLocalIsolation(prod,hosted,accountId) {
  ensure(accountId===ACCOUNT_ID&&HEX32.test(accountId));
  ensure(prod&&prod.name===WORKER&&prod.main==='./cloudflare/worker.mjs'&&
    prod.vars?.CLOUD_AUTH_PHASE==='disabled'&&
    prod.previews?.vars?.CLOUD_AUTH_PHASE==='preview-readonly');
  ensure(hosted&&hosted.name===PROBE&&
    hosted.main==='./cloudflare/pbkdf2-hosted-access-worker.mjs'&&
    hosted.vars?.PROBE_ENABLED==='disabled'&&
    hosted.workers_dev===false&&hosted.preview_urls===false);
  return true;
}
export function classifyInventory({scripts,domains,zones,routes,subdomains}) {
  ensure(Array.isArray(scripts)&&Array.isArray(domains)&&Array.isArray(zones)&&
    Array.isArray(routes)&&subdomains&&typeof subdomains==='object');
  const names=scripts.map(s=>s?.id);
  ensure(names.every(n=>typeof n==='string'&&n.length>0)&&new Set(names).size===names.length);
  ensure(names.includes(WORKER)); // An absent Worker means there is no deployment to certify.
  const probeExists=names.includes(PROBE);
  ensure(typeof subdomains[WORKER]?.enabled==='boolean'&&
    typeof subdomains[WORKER]?.previews_enabled==='boolean');
  if(probeExists)ensure(typeof subdomains[PROBE]?.enabled==='boolean'&&
    typeof subdomains[PROBE]?.previews_enabled==='boolean');
  const zoneIds=new Set(zones.map(z=>{ensure(HEX32.test(z?.id));return z.id;}));
  ensure(zoneIds.size===zones.length);
  const targets=new Set([WORKER,PROBE]);
  let domainsTarget=0,domainsPreview=0,domainsEnabled=0;
  for(const d of domains){
    ensure(d&&typeof d.service==='string'&&d.service&&
      typeof d.hostname==='string'&&d.hostname&&
      typeof d.enabled==='boolean'&&typeof d.previews_enabled==='boolean');
    if(targets.has(d.service)){
      domainsTarget++;
      if(d.enabled)domainsEnabled++;
      if(d.previews_enabled)domainsPreview++;
    }
  }
  let routesTarget=0;
  for(const route of routes){
    ensure(route&&typeof route.zone_id==='string'&&zoneIds.has(route.zone_id)&&
      typeof route.pattern==='string'&&route.pattern&&
      (route.script===null||route.script===undefined||typeof route.script==='string'));
    if(targets.has(route.script))routesTarget++;
  }
  const publicSurfacePresent=Boolean(subdomains[WORKER].enabled||
    subdomains[WORKER].previews_enabled||domainsEnabled||domainsPreview||routesTarget||
    (probeExists&&(subdomains[PROBE].enabled||subdomains[PROBE].previews_enabled)));
  // "No detected surface" is NOT "all entry URLs are safe". Access policy,
  // version URL probing and third-party DNS are verified separately.
  return Object.freeze({
    status:'G0_REMOTE_INVENTORY_ONLY_HUMAN_REVIEW_REQUIRED',
    inspected_worker_count:inventoryEntryCount(names.length),
    inspected_zone_count:inventoryEntryCount(zones.length),
    target_domain_assignments:inventoryEntryCount(domainsTarget),
    target_enabled_domain_assignments:inventoryEntryCount(domainsEnabled),
    target_preview_domain_assignments:inventoryEntryCount(domainsPreview),
    target_zone_routes:inventoryEntryCount(routesTarget),
    target_workers_dev_enabled:subdomains[WORKER].enabled,
    target_preview_urls_enabled:subdomains[WORKER].previews_enabled,
    probe_worker_deployed:probeExists,
    probe_workers_dev_enabled:probeExists?subdomains[PROBE].enabled:false,
    probe_preview_urls_enabled:probeExists?subdomains[PROBE].previews_enabled:false,
    public_surface_present:publicSurfacePresent,
    access_policy_verified:false,
    deployment_and_version_url_probes_verified:false,
    production_login_or_write_enabled:false,
    g0_certified:false,
    release_authorized:false
  });
}
export async function collectCloudflareInventory(getJSON){
  // API Token must have Workers metadata, Custom Domains, Zone/Routes READ.
  // Missing coverage or API failure is an error, never an "empty" inventory.
  const scripts=rows(await getJSON('/accounts/'+ACCOUNT_ID+'/workers/scripts'));
  const domains=await pages(getJSON,'/accounts/'+ACCOUNT_ID+'/workers/domains');
  const zones=await pages(getJSON,'/zones?account.id='+ACCOUNT_ID);
  const routes=[];
  for(const zone of zones){
    ensure(zone&&HEX32.test(zone.id));
    const entries=rows(await getJSON('/zones/'+zone.id+'/workers/routes'));
    routes.push(...entries.map(v=>({...v,zone_id:zone.id})));
  }
  const subdomains={};
  const names=new Set(scripts.map(s=>s?.id));
  ensure(names.has(WORKER));
  for(const script of [WORKER,PROBE]){
    if(names.has(script))subdomains[script]=strictSubdomain(
      await getJSON('/accounts/'+ACCOUNT_ID+'/workers/scripts/'+script+'/subdomain'));
  }
  return {scripts,domains,zones,routes,subdomains};
}
export async function cloudflareGet(path,token){
  ensure(typeof token==='string'&&token.length>10&&
    typeof path==='string'&&path.startsWith('/')&&!path.includes('..')&&
    !/[#\s]/.test(path));
  const url=API+path;
  // Never follow API redirects to an untrusted host; no request body or cookies.
  const response=await fetch(url,{
    method:'GET',redirect:'error',
    headers:{Authorization:'Bearer '+token,Accept:'application/json'},
    signal:AbortSignal.timeout(10000)
  });
  ensure(response.ok);
  const body=await response.text();
  ensure(body.length<=1024*1024);
  try{return JSON.parse(body);}catch{fail();}
}
const script=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===script){
  try{
    ensure(process.argv.length===3&&process.argv[2]==='inspect');
    ensure(process.env.GITHUB_ACTIONS==='true'&&
      process.env.GITHUB_REF==='refs/heads/main'&&
      process.env.G0_READONLY_CONFIRM==='CHECK_G0_READONLY');
    assertLocalIsolation(JSON.parse(fs.readFileSync('wrangler.jsonc','utf8')),
      JSON.parse(fs.readFileSync('wrangler.pbkdf2-hosted-disabled.jsonc','utf8')),
      process.env.CLOUDFLARE_ACCOUNT_ID);
    ensure(typeof process.env.CLOUDFLARE_API_TOKEN==='string'&&
      process.env.CLOUDFLARE_API_TOKEN.length>10);
    const snapshot=await collectCloudflareInventory(p=>cloudflareGet(p,process.env.CLOUDFLARE_API_TOKEN));
    console.log(JSON.stringify(classifyInventory(snapshot)));
  }catch{
    // Do not print API error responses, token, account/domain/route IDs or paths.
    console.error('G0_READONLY_INVENTORY_FAILED');
    process.exitCode=1;
  }
}
