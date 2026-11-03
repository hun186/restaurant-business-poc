// Dormant native account-admin v1 admission gate. NOT imported by public Worker.
// Synthetic-only: it makes no mutations, dispatches no account actions, and
// does not consume a request body. Real release needs a separate security gate.
import {loadPrincipal, authorizedMutation, sameOrigin} from './auth-core.mjs';

const unavailable=()=>({status:503,code:'E_NOT_READY'});
const error=()=>({status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
const validDb=db=>!!db && typeof db.prepare==='function' &&
  typeof db.batch==='function';

// The quota service must be supplied by the caller. Never replace it with a
// per-isolate Map or derive trusted identity from spoofable forwarding headers.
// No quota implementation or production binding is provided in this module.
async function consumeQuota(quota,scope,actorId=undefined){
  try{
    const result=await quota.consume(
      actorId===undefined?{scope}:{scope,actorId});
    return result===true?null:result===false?
      {status:429,code:'E_RATE_LIMITED'}:error();
  }catch{return error();}
}

// Admission is deliberately separate from parsing and D1 transactions.
// A future handler must still re-check the Owner/session/CSRF predicates
// inside its atomic D1 transaction; admission alone is not authorization.
export async function preflightNativeAdminV1(request,env,quota){
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly' ||
     env?.ACCOUNT_SECURITY_STAGE!=='internal-test-only' ||
     !validDb(env?.DB) || !quota || typeof quota.consume!=='function')
    return unavailable();
  if(request?.method!=='POST'||!request.headers ||
     typeof request.headers.get!=='function')
    return {status:400,code:'E_INVALID_INPUT'};
  try{
    if(!sameOrigin(request))return {status:403,code:'E_FORBIDDEN'};
  }catch{return {status:403,code:'E_FORBIDDEN'};}
  const preauth=await consumeQuota(quota,'native-admin-preauth');
  if(preauth)return preauth;
  let principal;
  try{principal=await loadPrincipal(env.DB,request);}
  catch{return error();}
  if(!principal)return {status:401,code:'E_UNAUTHENTICATED'};
  try{
    if(principal.role!=='owner' ||
       !authorizedMutation(request,principal,'owner'))
      return {status:403,code:'E_FORBIDDEN'};
  }catch{return {status:403,code:'E_FORBIDDEN'};}
  if(typeof principal.id!=='string'||!principal.id)
    return error();
  const ownerQuota=await consumeQuota(quota,'native-admin-owner',principal.id);
  if(ownerQuota)return ownerQuota;
  // Actor ID is an internal subject identifier, not a token or cookie.
  // Never serialize an authenticated principal or request payload to a client.
  return {status:200,code:'OK',actorId:principal.id};
}
