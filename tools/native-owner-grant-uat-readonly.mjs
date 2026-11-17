// Anonymous GET-only production admission check for Owner grant UAT.
// Never sends credentials, invokes a write method or changes Worker/D1 settings.
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ORIGIN='https://restaurant-business-poc.hungyuan-chen.workers.dev';
const ROUTES=Object.freeze(['/api/native/status','/api/accounts','/api/accounts/grant']);
const WRITE_KEYS=Object.freeze(['task_write_enabled','catalog_write_enabled',
  'order_write_enabled','stocktake_write_enabled','repair_write_enabled']);
const fail=code=>{throw Error(code);};

async function readJsonBounded(response){
 const reader=response.body?.getReader?.();
 if(!reader)fail('E_RESPONSE_BODY');
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let bytes=0,chunks=0,body='';
 try{
  for(;;){
   const next=await reader.read();
   if(next.done)break;
   if(!(next.value instanceof Uint8Array)||++chunks>32||
      (bytes+=next.value.byteLength)>4096)fail('E_RESPONSE_SIZE');
   body+=decoder.decode(next.value,{stream:true});
  }
  body+=decoder.decode();
  return JSON.parse(body);
 }catch{
  fail('E_RESPONSE_JSON');
 }finally{
  try{await reader.cancel();}catch{}
 }
}

export async function probeNativeOwnerGrantReadonly(fetcher=globalThis.fetch){
 if(typeof fetcher!=='function')fail('E_FETCH_UNAVAILABLE');
 const data=[];
 for(const route of ROUTES){
  let response;
  try{
   response=await fetcher(ORIGIN+route,{
    method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',
    referrerPolicy:'no-referrer',signal:AbortSignal.timeout(8000),
    headers:{Accept:'application/json'}
   });
  }catch{fail('E_REQUEST_UNAVAILABLE');}
  if(!response||!Number.isInteger(response.status)||
     !response.headers||typeof response.headers.get!=='function'||
     response.headers.get('set-cookie')!==null)fail('E_RESPONSE_HEADERS');
  const mime=response.headers.get('content-type');
  if(typeof mime!=='string'||
     !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(mime))
    fail('E_RESPONSE_CONTENT_TYPE');
  data.push({status:response.status,body:await readJsonBounded(response)});
 }
 const [status,accounts,grant]=data;
 if(status.status!==200||!status.body||Array.isArray(status.body)||
    status.body.mode!=='native'||status.body.login_enabled!==true||
    WRITE_KEYS.some(key=>status.body[key]!==false))
  fail('E_LOGIN_OR_BUSINESS_GATE');
 if(accounts.status!==401||accounts.body?.code!=='E_UNAUTHENTICATED')
  fail('E_ANONYMOUS_ACCOUNTS_EXPOSURE');
 if(grant.status!==503||grant.body?.code!=='E_NOT_READY')
  fail('E_GRANT_GATE_NOT_CLOSED');
 return Object.freeze({
  status:'NATIVE_OWNER_GRANT_UAT_READONLY_PREFLIGHT_PASS',
  anonymous_account_access_denied:true,grant_write_gate_closed:true,
  login_gate_observed:true,five_business_write_gates_closed:true,
  requests:'3 GET_ONLY',cookie_sent:false,credentials_sent:false,
  owner_login_uat_verified:false,authenticated_grant_uat_verified:false,
  production_write_performed:false,cloudflare_write_performed:false,
  release_authorized:false
 });
}

const file=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===file){
 try{
  if(process.argv.length!==2)fail('E_NO_ARGS_ALLOWED');
  console.log(JSON.stringify(await probeNativeOwnerGrantReadonly()));
 }catch(error){
  const code=String(error?.message||'E_UNKNOWN');
  const safe=/^E_[A-Z_]+$/.test(code)?code:'E_UNKNOWN';
  console.error('NATIVE_OWNER_GRANT_UAT_READONLY_PREFLIGHT_FAIL code='+safe);
  process.exitCode=1;
 }
}
