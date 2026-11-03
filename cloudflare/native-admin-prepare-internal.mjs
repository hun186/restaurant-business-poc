// Synthetic-only native admin prepare sequence. No public Worker import/route.
// Nothing here dispatches a command, mutates D1 or approves a production release.
import {preflightNativeAdminV1} from './native-admin-admission-internal.mjs';
import {readAdminRequestV1,MAX_ADMIN_READ_MS} from './native-admin-request-internal.mjs';
const unavailable=()=>({status:503,code:'E_ADMIN_PREPARE_UNAVAILABLE'});
const invalid=()=>({status:400,code:'E_INVALID_INPUT'});
const statuses=Object.freeze({
  E_NOT_READY:503,E_ADMIN_PREFLIGHT_UNAVAILABLE:503,
  E_INVALID_INPUT:400,E_FORBIDDEN:403,
  E_UNAUTHENTICATED:401,E_RATE_LIMITED:429
});

// Preserve quota-before-body ordering even for malformed JSON. A successful
// prepare is NOT a transaction authorization: future D1 mutations must
// independently re-check Owner/Session/CSRF in an atomic D1 transaction.
export async function prepareNativeAdminCommandV1(request,env,quota,options=undefined){
  // Only a reviewed server-side caller may choose a smaller budget; never
  // forward HTTP parameters into this internal options object.
  let budgetMs;
  try{
    budgetMs=options===undefined?MAX_ADMIN_READ_MS:options?.budgetMs;
    if(!Number.isSafeInteger(budgetMs)||budgetMs<1||
       budgetMs>MAX_ADMIN_READ_MS)return unavailable();
  }catch{return unavailable();}
  const started=performance.now();
  let admission;
  try{admission=await preflightNativeAdminV1(request,env,quota);}
  catch{return unavailable();}
  if(!admission||typeof admission.code!=='string')return unavailable();
  if(admission.status!==200){
    if(!Object.hasOwn(statuses,admission.code)||
       statuses[admission.code]!==admission.status)return unavailable();
    return {status:admission.status,code:admission.code};
  }
  if(admission.code!=='OK'||typeof admission.actorId!=='string'||
     !admission.actorId)return unavailable();
  // Both stages draw from the same monotonic budget; a slow preflight cannot
  // grant a fresh 2s to the JSON stream reader.
  const remaining=Math.floor(budgetMs-(performance.now()-started));
  if(remaining<1)return unavailable();
  let parsed;
  try{parsed=await readAdminRequestV1(request,{readTimeoutMs:remaining});}
  catch{return invalid();}
  if(performance.now()-started>=budgetMs)return unavailable();
  if(parsed?.ok!==true||!parsed.input)return invalid();
  // Parsed input can include a password: caller MUST NOT log this object.
  return {status:200,code:'OK',actorId:admission.actorId,input:parsed.input};
}
