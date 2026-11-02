// Strict no-token GET/HEAD-only checks against the known public Worker host.
// Synthetic tests and live HTTP are separate evidence; no deployment actions.
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export const HOST='https://restaurant-business-poc.hungyuan-chen.workers.dev';
const MAX=8192,REQUEST_MS=8000;
function fail(stage,detail){const e=Error('E_PUBLIC_WORKER_READONLY');e.stage=stage;e.detail=detail;throw e;}
async function bounded(response){
 const reader=response.body?.getReader();if(!reader)return '';
 let size=0;const chunks=[];
 try{
  for(;;){
   const item=await reader.read();if(item.done)break;
   if(!(item.value instanceof Uint8Array))throw Error('E_STREAM');
   size+=item.value.byteLength;
   if(size>MAX)throw Error('E_SIZE');
   chunks.push(item.value);
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const data=new Uint8Array(size);let at=0;
 for(const c of chunks){data.set(c,at);at+=c.length;}
 return new TextDecoder('utf-8',{fatal:true}).decode(data);
}
async function check(fetchImpl,route,method='GET',html=false){
 const stage=(route==='/'?'ASSETS':route.slice(1).replaceAll('/','_').toUpperCase())+
  (method==='HEAD'?'_HEAD':'');
 let response;
 try{
  response=await fetchImpl(HOST+route,{method,redirect:'manual',
   credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(REQUEST_MS),
   headers:{Accept:html?'text/html':'application/json'}});
 }catch{fail(stage,'REQUEST_UNAVAILABLE');}
 if(!response||!Number.isInteger(response.status))fail(stage,'RESPONSE_INVALID');
 if(response.status>=300&&response.status<400)fail(stage,'REDIRECT_BLOCKED');
 if(response.status!==(route==='/'||route==='/api/health'?200:503))
  fail(stage,'HTTP_STATUS');
 if(method==='HEAD'){
  if(response.body!==null)fail(stage,'HEAD_BODY');
  return null;
 }
 const type=response.headers?.get('content-type')?.toLowerCase()||'';
 if(!type.startsWith(html?'text/html':'application/json'))
  fail(stage,'MIME');
 let body;try{body=await bounded(response);}catch{fail(stage,'BODY_LIMIT_OR_INVALID');}
 if(html){
  if(!body.includes('公開示範版')||!body.includes('虛構資料'))
   fail(stage,'DEMO_ASSETS_MISSING');
  return null;
 }
 let parsed;
 try{parsed=JSON.parse(body);}catch{fail(stage,'JSON_INVALID');}
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))
  fail(stage,'JSON_SHAPE');
 if(route==='/api/health'){
  if(!response.headers.get('cache-control')?.includes('no-store'))
   fail(stage,'CACHE_CONTROL');
  if(parsed.status!=='demo_only'||parsed.api!=='not_implemented'||
     parsed.production_ready!==false)fail(stage,'PROD_GUARD');
  if(parsed.database!=='schema_only')fail(stage,'SCHEMA_NOT_READY');
 }else if(parsed.code!=='E_NOT_READY')fail(stage,'ROUTE_NOT_CLOSED');
 return parsed;
}
export async function inspectPublicRuntime({fetchImpl=globalThis.fetch}={}){
 if(typeof fetchImpl!=='function')fail('CONFIG','FETCH_MISSING');
 const health=await check(fetchImpl,'/api/health');
 await check(fetchImpl,'/api/health','HEAD');
 for(const route of ['/api/command','/api/login','/api/data','/api/me'])
  await check(fetchImpl,route);
 await check(fetchImpl,'/','GET',true);
 return Object.freeze({status:'PUBLIC_WORKER_READONLY_HTTP_PASS',
  demo_http_verified:true,production_ready:false,
  d1_schema_contract_visible:health.database==='schema_only',
  mutation_routes_fail_closed:true,request_methods:'GET_AND_HEAD_ONLY',
  token_used:false,production_write_performed:false,
  active_worker_version_verified:false,deployed_commit_verified:false,
  access_policy_verified:false,staging_login_verified:false,
  recovery_signoff_granted:false});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('CLI','ARGS');
  console.log(JSON.stringify(await inspectPublicRuntime()));
 }catch(e){
  const stages=new Set(['CONFIG','CLI','ASSETS','API_HEALTH','API_HEALTH_HEAD',
   'API_COMMAND','API_LOGIN','API_DATA','API_ME']);
  const details=new Set(['FETCH_MISSING','ARGS','REQUEST_UNAVAILABLE','RESPONSE_INVALID',
   'REDIRECT_BLOCKED','HTTP_STATUS','HEAD_BODY','MIME','BODY_LIMIT_OR_INVALID',
   'DEMO_ASSETS_MISSING','JSON_INVALID','JSON_SHAPE','CACHE_CONTROL','PROD_GUARD',
   'SCHEMA_NOT_READY','ROUTE_NOT_CLOSED']);
  console.error('PUBLIC_WORKER_READONLY_FAIL stage='+
   (stages.has(e?.stage)?e.stage:'UNKNOWN')+' detail='+
   (details.has(e?.detail)?e.detail:'UNKNOWN'));
  process.exitCode=1;
 }
}
