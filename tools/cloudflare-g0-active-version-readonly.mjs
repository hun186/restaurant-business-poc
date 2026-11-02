// G0: manual Cloudflare GET-only active deployment -> version -> Git build evidence.
// No deployment, no Worker URL probing, no D1 request, no secret-bearing output.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID, PROD_ID, STAGING_ID} from './check-cloudflare-staging.mjs';
const SCRIPT='restaurant-business-poc';
const API='https://api.cloudflare.com/client/v4';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{40}$/i;
function fail(stage='CONTRACT'){const e=Error('E_G0_ACTIVE_DEPLOYMENT');e.stage=stage;throw e;}
function check(ok,stage){if(!ok)fail(stage);}
function obj(v){return v!==null&&typeof v==='object'&&!Array.isArray(v);}
function result(reply,stage){check(obj(reply)&&reply.success===true&&obj(reply.result),stage);return reply.result;}
export function assertLocalGate(prod,accountId){
 check(accountId===ACCOUNT_ID&&prod?.name===SCRIPT&&
  prod.main==='./cloudflare/worker.mjs'&&prod.workers_dev===true&&
  prod.vars?.CLOUD_AUTH_PHASE==='disabled'&&
  prod.previews?.vars?.CLOUD_AUTH_PHASE==='preview-readonly'&&
  prod.d1_databases?.length===1&&prod.d1_databases[0].database_id===PROD_ID&&
  prod.previews?.d1_databases?.length===1&&
  prod.previews.d1_databases[0].database_id===STAGING_ID,
  'LOCAL_CONFIG');
}
export function inspectActiveDeployment(deployReply){
 const deployments=result(deployReply,'DEPLOYMENTS').deployments;
 check(Array.isArray(deployments)&&deployments.length>0&&deployments.length<=50,
  'DEPLOYMENTS');
 const entries=deployments.map(d=>{
  check(obj(d)&&UUID.test(d.id)&&
   typeof d.created_on==='string'&&Number.isFinite(Date.parse(d.created_on))&&
   Array.isArray(d.versions)&&d.versions.length>=1&&d.versions.length<=2,
   'DEPLOYMENT_SHAPE');
  const ids=new Set();
  let total=0;
  for(const v of d.versions){
   check(obj(v)&&UUID.test(v.version_id)&&
    typeof v.percentage==='number'&&Number.isFinite(v.percentage)&&
    v.percentage>0&&v.percentage<=100&&!ids.has(v.version_id),
    'DEPLOYMENT_SHAPE');
   total+=v.percentage;ids.add(v.version_id);
  }
  check(Math.abs(total-100)<0.0001,'DEPLOYMENT_SHAPE');
  return {timestamp:Date.parse(d.created_on),versions:d.versions};
 });
 entries.sort((a,b)=>b.timestamp-a.timestamp);
 check(entries.length===1||entries[0].timestamp!==entries[1].timestamp,
  'DEPLOYMENT_AMBIGUOUS');
 const active=entries[0];
 check(active.versions.length===1&&active.versions[0].percentage===100,
  'SPLIT_TRAFFIC');
 return active.versions[0].version_id;
}
export function verifyVersionBuild(reply,versionId,expectedCommit){
 check(UUID.test(versionId)&&SHA.test(expectedCommit),'ARGUMENTS');
 const builds=result(reply,'BUILDS').builds;
 check(obj(builds)&&Object.keys(builds).length===1&&
  Object.hasOwn(builds,versionId),'BUILDS');
 const b=builds[versionId];
 check(obj(b)&&b.build_outcome==='success'&&UUID.test(b.build_uuid),
  'BUILD_OUTCOME');
 const meta=b.build_trigger_metadata;
 check(obj(meta)&&meta.provider_type==='github'&&
  meta.repo_name==='restaurant-business-poc'&&
  meta.branch==='main'&&SHA.test(meta.commit_hash),'BUILD_SOURCE');
 check(meta.commit_hash.toLowerCase()===expectedCommit.toLowerCase(),
  'COMMIT_MISMATCH');
 return Object.freeze({
  status:'G0_ACTIVE_DEPLOYMENT_BUILD_READONLY_PASS',
  active_version_present:true,
  active_version_traffic_pct:100,
  active_version_to_build_link_verified:true,
  active_build_commit_matches_main:true,
  build_branch:'main',
  active_commit_sha:meta.commit_hash.toLowerCase(),
  active_worker_version_verified:true,
  public_hostname_version_verified:false,
  access_policy_verified:false,
  staging_live_access_verified:false,
  production_login_enabled:false,
  production_write_performed:false,
  cloudflare_write_performed:false,
  release_authorized:false
 });
}
export async function cloudflareReadOnlyGet(pathname,token,fetchImpl=globalThis.fetch){
 check(typeof token==='string'&&token.length>=16&&typeof fetchImpl==='function',
  'CREDENTIALS');
 const prefix='/accounts/'+ACCOUNT_ID+'/';
 const deployment=prefix+'workers/scripts/'+SCRIPT+'/deployments';
 const builds=prefix+'builds/builds?version_ids=';
 check(pathname===deployment||
  (pathname.startsWith(builds)&&UUID.test(pathname.slice(builds.length))),
  'URL');
 let response;
 try{
  response=await fetchImpl(API+pathname,{
   method:'GET',redirect:'error',credentials:'omit',
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},
   signal:AbortSignal.timeout(10000)
  });
 }catch{fail('NETWORK');}
 check(response?.ok===true,'HTTP_STATUS');
 let raw;
 try{
  const length=response.headers.get('content-length');
  check(length===null||(Number.isSafeInteger(Number(length))&&
    Number(length)>=0&&Number(length)<=131072),'BODY_LIMIT');
  const reader=response.body.getReader();
  const chunks=[];let size=0;
  try{
   for(;;){const {done,value}=await reader.read();if(done)break;
    size+=value.byteLength;check(size<=131072,'BODY_LIMIT');chunks.push(value);
   }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const content=new Uint8Array(size);let at=0;
  for(const chunk of chunks){content.set(chunk,at);at+=chunk.byteLength;}
  raw=new TextDecoder('utf-8',{fatal:true}).decode(content);
 }catch(e){if(e?.message==='E_G0_ACTIVE_DEPLOYMENT')throw e;fail('BODY_LIMIT');}
 try{return JSON.parse(raw);}catch{fail('JSON');}
}
export async function inspectRemoteDeployment(getJSON,expectedCommit){
 check(typeof getJSON==='function'&&SHA.test(expectedCommit),'ARGUMENTS');
 const path='/accounts/'+ACCOUNT_ID+'/';
 const version=inspectActiveDeployment(await getJSON(
  path+'workers/scripts/'+SCRIPT+'/deployments'));
 const response=await getJSON(path+'builds/builds?version_ids='+version);
 return verifyVersionBuild(response,version,expectedCommit);
}
const self=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 let stage='START';
 try{
  check(process.argv.length===3&&process.argv[2]==='inspect'&&
   process.env.GITHUB_ACTIONS==='true'&&
   process.env.GITHUB_REF==='refs/heads/main'&&
   process.env.G0_ACTIVE_CONFIRM==='CHECK_ACTIVE_WORKER_READONLY'&&
   SHA.test(process.env.GITHUB_SHA),'GATE');
  stage='LOCAL_CONFIG';
  assertLocalGate(JSON.parse(fs.readFileSync('wrangler.jsonc','utf8')),
   process.env.CLOUDFLARE_ACCOUNT_ID);
  check(typeof process.env.CLOUDFLARE_API_TOKEN==='string'&&
   process.env.CLOUDFLARE_API_TOKEN.length>=16,'CREDENTIALS');
  stage='REMOTE';
  const r=await inspectRemoteDeployment(p=>cloudflareReadOnlyGet(
   p,process.env.CLOUDFLARE_API_TOKEN),process.env.GITHUB_SHA);
  console.log(JSON.stringify(r));
 }catch(e){
  const stages=new Set(['GATE','LOCAL_CONFIG','CREDENTIALS','NETWORK','HTTP_STATUS',
   'BODY_LIMIT','JSON','DEPLOYMENTS','DEPLOYMENT_SHAPE','DEPLOYMENT_AMBIGUOUS',
   'SPLIT_TRAFFIC','BUILDS','BUILD_OUTCOME','BUILD_SOURCE','COMMIT_MISMATCH','ARGUMENTS','URL']);
  const code=stages.has(e?.stage)?e.stage:stage==='LOCAL_CONFIG'?'LOCAL_CONFIG':'UNKNOWN';
  console.error('G0_ACTIVE_DEPLOYMENT_READONLY_FAILED stage='+code);
  process.exitCode=1;
 }
}
