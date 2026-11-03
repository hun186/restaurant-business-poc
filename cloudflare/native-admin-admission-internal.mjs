// Dormant native account-admin v1 admission gate. NOT imported by public Worker.
// Synthetic-only: it makes no mutations, dispatches no account actions, and
// does not consume a request body. Real release needs a separate security gate.
import {loadPrincipal, authorizedMutation, sameOrigin} from './auth-core.mjs';
import {validAdminBodyHeadersV1} from './native-admin-request-internal.mjs';

const unavailable=()=>({status:503,code:'E_NOT_READY'});
const error=()=>({status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
const validDb=db=>!!db && typeof db.prepare==='function' &&
  typeof db.batch==='function';

// The quota service must be supplied by the caller. Never replace it with a
// per-isolate Map or derive trusted identity from spoofable forwarding headers.
// No quota implementation or production binding is provided in this module.
// An end-to-end deadline only bounds the response. A provider must honor the
// optional AbortSignal to cancel its own outstanding work.
async function consumeQuota(quota,scope,actorId=undefined,signal=undefined){
  try{
    const result=await quota.consume(
      actorId===undefined?{scope}:{scope,actorId}, {signal});
    return result===true?null:result===false?
      {status:429,code:'E_RATE_LIMITED'}:error();
  }catch{return error();}
}

// Admission is deliberately separate from parsing and D1 transactions.
// A future handler must still re-check the Owner/session/CSRF predicates
// inside its atomic D1 transaction; admission alone is not authorization.
// Covers the two quota stages and identity reads as a single admission budget.
// When the deadline fires, later async completions must not advance stages.
// D1 access is read-only here; an unfinished external operation may still need
// cancellation by its provider. This is NOT a production admission SLA.
const ADMISSION_DEADLINE_MS=2000;
export async function preflightNativeAdminV1(request,env,quota){
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly' ||
     env?.ACCOUNT_SECURITY_STAGE!=='internal-test-only' ||
     !validDb(env?.DB) || !quota || typeof quota.consume!=='function')
    return unavailable();
  if(request?.method!=='POST'||!request.headers ||
     typeof request.headers.get!=='function')
    return {status:400,code:'E_INVALID_INPUT'};
  // Bind to the candidate v1 route before quota and D1 authorization work.
  let url;
  try{url=new URL(request.url);}catch{return {status:400,code:'E_INVALID_INPUT'};}
  if(url.pathname!=='/api/admin/account'||url.search||url.hash)
    return {status:400,code:'E_INVALID_INPUT'};
  try{
    if(!sameOrigin(request))return {status:403,code:'E_FORBIDDEN'};
  }catch{return {status:403,code:'E_FORBIDDEN'};}
  // Cheap header-envelope checks before any quota consumption or D1 read.
  // This does not replace the bounded body parser that follows admission.
  if(!validAdminBodyHeadersV1(request.headers))
    return {status:400,code:'E_INVALID_INPUT'};

  const controller=new AbortController();
  let expired=false,timeoutId;
  const work=(async()=>{
    const preauth=await consumeQuota(quota,'native-admin-preauth',undefined,controller.signal);
    if(expired)return error();
    if(preauth)return preauth;
    let principal;
    try{principal=await loadPrincipal(env.DB,request);}
    catch{return error();}
    if(expired)return error();
    if(!principal)return {status:401,code:'E_UNAUTHENTICATED'};
    try{
      if(principal.role!=='owner' ||
         !authorizedMutation(request,principal,'owner'))
        return {status:403,code:'E_FORBIDDEN'};
    }catch{return {status:403,code:'E_FORBIDDEN'};}
    if(typeof principal.id!=='string'||!principal.id)
      return error();
    const ownerQuota=await consumeQuota(quota,'native-admin-owner',principal.id,controller.signal);
    if(expired)return error();
    if(ownerQuota)return ownerQuota;
    // Actor ID is internal, not a token or cookie. Admission is not a D1 write.
    return {status:200,code:'OK',actorId:principal.id};
  })();
  const deadline=new Promise(resolve=>{
    timeoutId=setTimeout(()=>{
      expired=true;
      controller.abort();
      resolve(error());
    },ADMISSION_DEADLINE_MS);
  });
  try{return await Promise.race([work,deadline]);}
  finally{
    clearTimeout(timeoutId);
    controller.abort();
  }
}
