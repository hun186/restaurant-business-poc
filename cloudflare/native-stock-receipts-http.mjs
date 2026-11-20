// Read-only, authenticated, scope-fenced search of ALL received PO lines.
// Unlike the 500-row dashboard listing, this endpoint supports older returns.
// It never authorizes or writes a return; POST revalidates the full D1 ledger.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {nativeStockReturnWriteEnabled} from './native-stock-return-http.mjs';
import {loadPrincipal,hasAccess} from './auth-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const NUMBER=/^[a-zA-Z0-9_.-]{0,64}$/;
const HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'
});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
export async function nativeStockReceiptsHttp(request,env){
 if(!nativeLoginEnabled(env)||!nativeStockReturnWriteEnabled(env)||
    typeof env?.DB?.prepare!=='function')return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.pathname!=='/api/stock/receipts'||
     url.hash||url.search.length>220)return reply(400,{code:'E_BAD_QUERY'});
  if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
   return reply(403,{code:'E_FORBIDDEN'});
  const keys=[...url.searchParams.keys()];
  if(keys.length<2||keys.length>3||new Set(keys).size!==keys.length||
     !keys.includes('location_id')||!keys.includes('ingredient_id')||
     keys.some(k=>!['location_id','ingredient_id','q'].includes(k)))
   return reply(400,{code:'E_BAD_QUERY'});
  const lid=url.searchParams.get('location_id'),iid=url.searchParams.get('ingredient_id');
  const q=url.searchParams.get('q')||'';
  if(!UUID.test(lid||'')||!UUID.test(iid||'')||!NUMBER.test(q))
   return reply(400,{code:'E_BAD_QUERY'});
  const principal=await loadPrincipal(env.DB,request);
  if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(!hasAccess(principal,'manager',lid))return reply(403,{code:'E_FORBIDDEN'});
  const schema=await env.DB.prepare(
   'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  let version;
  try{version=await env.DB.prepare(
   'SELECT kind_version FROM stock_move_kind_contract WHERE id=1').first();}
  catch{return reply(503,{code:'E_SCHEMA_NOT_READY'});}
  if(version?.kind_version!==4)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  const sql="SELECT o.id,o.number,o.supplier,o.qty,o.location_id,o.ingredient_id "+
    "FROM purchase_orders o JOIN locations l ON l.id=o.location_id AND l.active=1 "+
    "JOIN ingredients i ON i.id=o.ingredient_id AND i.active=1 "+
    "WHERE o.location_id=? AND o.ingredient_id=? AND o.status='received' "+
    "AND instr(upper(o.number),upper(?))>0 "+
    "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    "WHERE ul.user_id=? AND ul.location_id=o.location_id)) "+
    "ORDER BY o.received_at DESC,o.id DESC LIMIT 51";
  const result=await env.DB.prepare(sql).bind(lid,iid,q,principal.role,principal.id).all();
  if(!Array.isArray(result?.results)||result.results.length>51||
    !result.results.every(x=>typeof x?.id==='string'&&UUID.test(x.id)&&
     typeof x?.number==='string'&&typeof x?.supplier==='string'&&
     x?.location_id===lid&&x?.ingredient_id===iid))
   throw Error('E_D1_RECEIPT_ROWS');
  return reply(200,{mode:'native_d1',rows:result.results.slice(0,50),
   truncated:result.results.length>50});
 }catch{return reply(503,{code:'E_RECEIPT_SEARCH_UNAVAILABLE'});}
}
