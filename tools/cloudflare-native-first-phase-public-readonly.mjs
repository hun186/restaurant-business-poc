// First-phase Owner handoff: fixed public Worker, anonymous GET-only attestations.
// Does not read credentials, access D1 directly, deploy, enable Gates or write data.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const HOST='https://restaurant-business-poc.hungyuan-chen.workers.dev';
const REQUEST_MS=8000,MAX_BYTES=16384;
const CORE=Object.freeze(['task_write_enabled','catalog_write_enabled',
 'order_write_enabled','stocktake_write_enabled','repair_write_enabled']);
const OPTIONAL=Object.freeze(['price_write_enabled','stock_usage_write_enabled']);
const SECOND_STAGE=Object.freeze(['stock_v4_gate_enabled','supplier_return_gate_enabled']);
const STATUS_KEYS=Object.freeze(['mode','login_enabled',...CORE,...OPTIONAL,...SECOND_STAGE]);
const isObj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const fail=(stage,reason)=>{const e=Error('E_NATIVE_FIRST_PHASE_READONLY');e.stage=stage;e.reason=reason;throw e;};
const exactKeys=(o,keys)=>isObj(o)&&JSON.stringify(Object.keys(o).sort())===
 JSON.stringify([...keys].sort());

export function attestNativeFirstPhaseStatus(o){
 if(!exactKeys(o,STATUS_KEYS)||o.mode!=='native'||
  [...STATUS_KEYS.slice(1)].some(k=>typeof o[k]!=='boolean'))
  fail('STATUS','INVALID_SHAPE');
 if(o.login_enabled!==true)fail('STATUS','LOGIN_NOT_READY');
 if(CORE.some(k=>o[k]!==true))fail('STATUS','CORE_WRITE_GATE_NOT_READY');
 if(SECOND_STAGE.some(k=>o[k]!==false))fail('STATUS','V4_GATE_UNEXPECTEDLY_OPEN');
 return Object.freeze({
  mode:'native',login_enabled:true,all_five_core_gates_open:true,
  second_stage_v4_gates_closed:true,
  price_write_gate_open:o.price_write_enabled,
  stock_usage_write_gate_open:o.stock_usage_write_enabled
 });
}

async function bounded(response,stage){
 const reader=response.body?.getReader();
 if(!reader)fail(stage,'RESPONSE_EMPTY');
 const chunks=[];let total=0;
 try{
  for(;;){
   const item=await reader.read();
   if(item.done)break;
   if(!(item.value instanceof Uint8Array))fail(stage,'BODY_INVALID');
   total+=item.value.byteLength;
   if(total>MAX_BYTES)fail(stage,'BODY_LIMIT');
   chunks.push(item.value);
  }
 }finally{
  try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
  try{reader.releaseLock();}catch{}
 }
 const data=new Uint8Array(total);let i=0;
 for(const chunk of chunks){data.set(chunk,i);i+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true}).decode(data);}
 catch{fail(stage,'BODY_INVALID');}
}
async function get(fetchImpl,route,status,mime){
 const stage=route.replaceAll('/','_').replaceAll('.','_').toUpperCase();
 let response;
 try{
  response=await fetchImpl(HOST+route,{
   method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',
   headers:{Accept:mime},
   signal:AbortSignal.timeout(REQUEST_MS)
  });
 }catch{fail(stage,'NETWORK_UNAVAILABLE');}
 if(!response||!Number.isInteger(response.status))fail(stage,'HTTP_INVALID');
 if(response.status!==status)fail(stage,'HTTP_STATUS');
 if(response.headers?.has('set-cookie')||
    response.headers?.has('location'))fail(stage,'UNEXPECTED_HEADER');
 if(!response.headers?.get('cache-control')?.toLowerCase().includes('no-store')&&
    mime==='application/json')fail(stage,'CACHE_CONTROL');
 if(!response.headers?.get('content-type')?.toLowerCase().startsWith(mime))
  fail(stage,'MIME');
 const body=await bounded(response,stage);
 if(!body)fail(stage,'RESPONSE_EMPTY');
 return body;
}
async function json(fetchImpl,route,status){
 let result;
 const body=await get(fetchImpl,route,status,'application/json');
 try{result=JSON.parse(body);}catch{fail('JSON','PARSE_ERROR');}
 if(!isObj(result))fail('JSON','INVALID_SHAPE');
 return result;
}
// Only a real, reviewed CSP <meta> inside <head> can pass: never accept
// directive strings in comments, body text, or an unenforcing element.
const APPROVED_META_CSP="default-src 'none'; script-src 'self'; "+
 "style-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'";
function ownerAppMarkupValid(html){
 if(typeof html!=='string')return false;
 const clean=html.replace(/<!--[\s\S]*?-->/g,'');
 const head=clean.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
 if(!head)return false;
 const policies=[...head.matchAll(
  /<meta\b[^>]*\bhttp-equiv\s*=\s*(?:"Content-Security-Policy"|'Content-Security-Policy')[^>]*>/gi
 )].map(x=>x[0]);
 const expectedCsp='<meta http-equiv="Content-Security-Policy" content="'+
  APPROVED_META_CSP+'">';
 if(policies.length!==1||policies[0]!==expectedCsp)return false;
 // Meta CSP only takes effect in the live HTML head. A literal matching
 // <meta> within <template>, <noscript>, script text etc. is inert. Keep
 // the approved pre-CSP head structure explicit and fail closed on drift.
 const expectedPrelude=/^\s*<meta charset="utf-8">\s*<meta name="viewport" content="width=device-width,initial-scale=1">\s*<meta name="theme-color" content="#102f43">\s*$/;
 const position=head.indexOf(expectedCsp);
 if(position<0||!expectedPrelude.test(head.slice(0,position)))return false;
 return head.includes('<meta name="robots" content="noindex,nofollow">')&&
  clean.includes('正式業主工作台')&&
  clean.includes('<script type="module" src="/owner-app.js"></script>')&&
  !clean.includes('/mock.js');
}

export async function inspectNativeFirstPhasePublic({fetchImpl=globalThis.fetch}={}){
 if(typeof fetchImpl!=='function')fail('CONFIG','FETCH_UNAVAILABLE');
 const status=attestNativeFirstPhaseStatus(await json(fetchImpl,'/api/native/status',200));
 const login=await json(fetchImpl,'/api/login',405);
 if(!exactKeys(login,['code'])||login.code!=='METHOD_NOT_ALLOWED')
  fail('ANONYMOUS','LOGIN_GET_NOT_BLOCKED');
 const me=await json(fetchImpl,'/api/me',401);
 if(Object.hasOwn(me,'user')||Object.hasOwn(me,'csrf'))
  fail('ANONYMOUS','IDENTITY_LEAK');
 // Cloudflare redirects the .html suffix: request the canonical URL.
 const html=await get(fetchImpl,'/owner-app',200,'text/html');
 if(!ownerAppMarkupValid(html))fail('ASSETS','OWNER_APP_CONTRACT');
 return Object.freeze({
  status:'NATIVE_FIRST_PHASE_PUBLIC_READONLY_PASS',
  ...status,
  public_hostname_native_status_verified:true,
  anonymous_login_get_blocked:true,
  anonymous_identity_data_hidden:true,
  owner_app_asset_served:true,
  request_methods:'GET_ONLY',credentials_sent:false,
  cloudflare_token_used:false,production_sql_write_performed:false,
  deployed_worker_build_version_verified:false,
  authenticated_owner_uat_verified:false,
  five_business_writes_executed:false,
  backup_freshness_verified:false,
  production_v4_migration_authorized:false,
  release_authorized:false
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('CLI','ARGS');
  console.log(JSON.stringify(await inspectNativeFirstPhasePublic()));
 }catch(e){
  const stages=new Set(['CONFIG','CLI','_API_NATIVE_STATUS','_API_LOGIN','_API_ME',
   '_OWNER-APP','STATUS','JSON','ANONYMOUS','ASSETS']);
  const reasons=new Set(['ARGS','FETCH_UNAVAILABLE','NETWORK_UNAVAILABLE',
   'HTTP_INVALID','HTTP_STATUS','UNEXPECTED_HEADER','CACHE_CONTROL','MIME',
   'BODY_INVALID','BODY_LIMIT','RESPONSE_EMPTY','INVALID_SHAPE','PARSE_ERROR',
   'LOGIN_NOT_READY','CORE_WRITE_GATE_NOT_READY','V4_GATE_UNEXPECTEDLY_OPEN',
   'LOGIN_GET_NOT_BLOCKED','IDENTITY_LEAK','OWNER_APP_CONTRACT']);
  console.error('NATIVE_FIRST_PHASE_READONLY_FAIL stage='+
   (stages.has(e?.stage)?e.stage:'UNKNOWN')+' reason='+
   (reasons.has(e?.reason)?e.reason:'UNKNOWN')+
   '; NO AUTHENTICATED UAT; NO PRODUCTION SQL WRITE');
  process.exitCode=1;
 }
}
