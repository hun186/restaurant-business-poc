// Authenticated, read-only availability of proposed stock v4 operations.
// UI hints only. Every POST repeats all authorization and D1 guards.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal,hasAccess} from './auth-core.mjs';
import {nativeStockV4WriteEnabled} from './native-stock-v4-http.mjs';
import {nativeStockReturnWriteEnabled} from './native-stock-return-http.mjs';

const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'
}});
const disabled=()=>({scrap_adjust_enabled:false,supplier_return_enabled:false});
export async function nativeStockOperationsCapabilityHttp(request,env){
 if(!nativeLoginEnabled(env)||typeof env?.DB?.prepare!=='function')
  return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.pathname!=='/api/stock/capability'||url.search||url.hash)
   return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
   return reply(403,{code:'E_FORBIDDEN'});
  const principal=await loadPrincipal(env.DB,request);
  if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(!hasAccess(principal,'manager'))return reply(200,disabled());
  if(!nativeStockV4WriteEnabled(env)&&!nativeStockReturnWriteEnabled(env))
   return reply(200,disabled());
  const schema=await env.DB.prepare(
   'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(200,disabled());
  let version;
  try{
   version=await env.DB.prepare(
    'SELECT kind_version FROM stock_move_kind_contract WHERE id=1').first();
  }catch{return reply(200,disabled());}
  if(version?.kind_version!==4)return reply(200,disabled());
  return reply(200,{
   scrap_adjust_enabled:nativeStockV4WriteEnabled(env),
   supplier_return_enabled:nativeStockReturnWriteEnabled(env)
  });
 }catch{return reply(503,{code:'E_STOCK_CAPABILITY_UNAVAILABLE'});}
}
