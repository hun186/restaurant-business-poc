// Append-only stock usage for Native D1: debit ledger + audit in one atomic batch.
// Independently default-denied; existing purchase/stocktake/price writes are not affected.
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const changes=x=>x?.meta?.changes??x?.changes;
export const nativeStockUsageWriteEnabled=env=>nativeLoginEnabled(env)&&
  env?.CLOUD_NATIVE_STOCK_USAGE_WRITE_GATE==='operator-released';

function parse(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    Object.keys(raw).sort().join(',')!=='action,data'||raw.action!=='stock.usage')return null;
  const x=raw.data;
  if(!x||typeof x!=='object'||Array.isArray(x)||
    Object.keys(x).some(k=>!['ingredient_id','location_id','qty','note'].includes(k))||
    !UUID.test(x.ingredient_id)||!UUID.test(x.location_id))return null;
  const q=x.qty;
  if(typeof q!=='number'||!Number.isFinite(q)||q<=0||q>1000000||
    Math.abs(q*1000-Math.round(q*1000))>=0.0000001)return null;
  if(x.note!==undefined&&(typeof x.note!=='string'||
    x.note!==x.note.trim()||x.note.length>300||
    /[\u0000-\u001f\u007f]/.test(x.note)))return null;
  return {ingredientId:x.ingredient_id,locationId:x.location_id,
    qty:q,note:x.note??''};
}
const sessionSql=()=> "EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id "+
  "WHERE u.id=? AND u.role=? AND u.active=1 AND u.role IN ('owner','manager') "+
  "AND s.token_hash=? AND s.csrf_token=? "+
  "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))";
async function writeUsage(db,principal,x,ref){
  const id=crypto.randomUUID(),auditId=crypto.randomUUID();
  const insert=db.prepare(
    'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) '+
    "SELECT ?,i.id,l.id,?,'usage',?,?,? FROM locations l JOIN ingredients i ON i.id=? "+
    'WHERE l.id=? AND l.active=1 AND i.active=1 AND '+sessionSql()+
    " AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    'WHERE ul.user_id=? AND ul.location_id=l.id)) '+
    'AND COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m '+
    'WHERE m.location_id=l.id AND m.ingredient_id=i.id),0)>=? '+
    'AND NOT EXISTS(SELECT 1 FROM stock_moves used '+
    "WHERE used.move_type='usage' AND used.reference_id=? AND used.actor_id=?)"
  ).bind(id,-x.qty,ref,x.note,principal.id,x.ingredientId,x.locationId,
    principal.id,principal.role,principal.token_hash,principal.csrf,
    principal.role,principal.id,x.qty,ref,principal.id);
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    "SELECT ?,u.id,u.username,'stock.usage','stock_moves',m.id,m.location_id,? "+
    'FROM stock_moves m JOIN users u ON u.id=m.actor_id '+
    'WHERE m.id=? AND m.reference_id=? AND u.id=? AND u.active=1 '+
    "AND u.role IN ('owner','manager') AND EXISTS("+
    'SELECT 1 FROM sessions s WHERE s.user_id=u.id AND s.token_hash=? '+
    "AND s.csrf_token=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
  ).bind(auditId,JSON.stringify({ingredient_id:x.ingredientId,qty_delta:-x.qty}),
    id,ref,principal.id,principal.token_hash,principal.csrf);
  // A failed INSERT, audit or authorization forces D1 batch rollback, never
  // leaves an un-audited stock debit or a success response on zero affected rows.
  const guard=db.prepare(
    'UPDATE users SET display_name=CASE WHEN '+
    'EXISTS(SELECT 1 FROM stock_moves m WHERE m.id=? AND m.actor_id=? AND m.reference_id=?) '+
    "AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.action='stock.usage' "+
    'AND a.entity_id=?) THEN display_name ELSE NULL END WHERE id=?'
  ).bind(id,principal.id,ref,auditId,id,principal.id);
  const result=await db.batch([insert,audit,guard]);
  if(!Array.isArray(result)||result.length!==3||
    result.some(s=>changes(s)!==1))return reply(503,{code:'E_STOCK_USAGE_UNAVAILABLE'});
  return reply(200,{ok:true,result:{id,ingredient_id:x.ingredientId,
    location_id:x.locationId,qty:x.qty}});
}

export async function nativeStockUsageHttp(request,env){
  if(!nativeStockUsageWriteEnabled(env)||typeof env?.DB?.prepare!=='function'||
    typeof env?.DB?.batch!=='function')return reply(503,{code:'E_NOT_READY'});
  if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/stock/usage'||url.search||url.hash)
      return reply(400,{code:'E_INVALID_REQUEST'});
    if(request.headers.get('sec-fetch-site')!=='same-origin'||
      request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
      return reply(403,{code:'E_FORBIDDEN'});
    if(request.headers.get('content-type')!=='application/json'||
      request.headers.has('content-encoding'))return reply(415,{code:'E_INVALID_REQUEST'});
    const key=request.headers.get('x-idempotency-key');
    if(!key||!UUID.test(key))return reply(400,{code:'E_IDEMPOTENCY_KEY'});
    const declared=request.headers.get('content-length');
    if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||
      Number(declared)>2048))return reply(413,{code:'E_INVALID_REQUEST'});
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,principal,'manager'))
      return reply(403,{code:'E_FORBIDDEN'});
    const schema=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(schema?.contract_version)!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
    let raw;
    try{raw=JSON.parse(await bodyWithinLimit(request));}
    catch{return reply(400,{code:'E_INVALID_JSON'});}
    const parsed=parse(raw);
    if(!parsed)return reply(400,{code:'E_INVALID_COMMAND'});
    if(!hasAccess(principal,'manager',parsed.locationId))return reply(403,{code:'E_FORBIDDEN'});
    const [store,ing,stock]=await Promise.all([
      env.DB.prepare('SELECT active FROM locations WHERE id=?').bind(parsed.locationId).first(),
      env.DB.prepare('SELECT active FROM ingredients WHERE id=?').bind(parsed.ingredientId).first(),
      env.DB.prepare('SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves '+
        'WHERE location_id=? AND ingredient_id=?')
        .bind(parsed.locationId,parsed.ingredientId).first()
    ]);
    if(store?.active!==1||ing?.active!==1)return reply(404,{code:'E_NOT_FOUND'});
    if(!Number.isFinite(stock?.n)||stock.n<parsed.qty)
      return reply(409,{code:'E_INSUFFICIENT_STOCK'});
    return await writeUsage(env.DB,principal,parsed,key);
  }catch{return reply(503,{code:'E_STOCK_USAGE_UNAVAILABLE'});}
}
