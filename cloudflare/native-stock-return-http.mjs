// Default-denied Native D1 supplier return: one original received PO, no stock overdraft.
// The reviewed SQL predicates match the isolated #224 proposal; this file is
// the live adapter, NOT an import of a synthetic writer. Production v4 remains
// unapplied; the independent operator Gate stays OFF unless explicitly enabled.
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
import {normalizeStockV4} from './stock-move-v4-contract.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const changes=x=>x?.meta?.changes??x?.changes;
export const nativeStockReturnWriteEnabled=env=>nativeLoginEnabled(env)&&
 env?.CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE==='operator-released';

// Reviewed SQL is copied byte-for-byte from the inert #224 proposal.
const grid=x=>'abs('+x+'*1000-round('+x+'*1000))<0.0000001';
const rawStock="SELECT COALESCE(SUM(round(m.qty_delta*1000)),0) "+
 "FROM stock_moves m WHERE m.location_id=po.location_id AND m.ingredient_id=po.ingredient_id";
const rawReturned="SELECT COALESCE(SUM(-round(m.qty_delta*1000)),0) "+
 "FROM stock_moves m WHERE m.reference_id=po.id AND m.move_type='supplier_return'";
// No untrusted SQL interpolation: every fragment is a literal or generated
// from the fixed internal, non-user-supplied grid expressions.
const validity=[
 "EXISTS (SELECT 1 FROM purchase_orders po",
 "JOIN locations l ON l.id=po.location_id AND l.active=1",
 "JOIN ingredients i ON i.id=po.ingredient_id AND i.active=1",
 "JOIN users u ON u.id=? AND u.active=1 AND u.role IN ('owner','manager')",
 "JOIN sessions s ON s.user_id=u.id AND s.token_hash=? AND s.csrf_token=?",
 "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
 "WHERE po.id=? AND po.location_id=? AND po.ingredient_id=? AND po.status='received'",
 "AND (u.role='owner' OR EXISTS (SELECT 1 FROM user_locations ul WHERE ul.user_id=u.id AND ul.location_id=l.id))",
 "AND po.qty>0 AND po.qty<=1000000 AND typeof(po.qty) IN ('integer','real') AND "+grid('po.qty'),
 "AND EXISTS(SELECT 1 FROM stock_move_kind_contract k WHERE k.id=1 AND k.kind_version=4) AND NOT EXISTS(SELECT 1 FROM stock_moves old WHERE lower(old.id)=?)",
 "AND (SELECT COUNT(*) FROM stock_moves p WHERE p.reference_id=po.id AND p.move_type='purchase')=1",
 "AND EXISTS (SELECT 1 FROM stock_moves p WHERE p.reference_id=po.id",
 "AND p.move_type='purchase' AND p.ingredient_id=po.ingredient_id",
 "AND p.location_id=po.location_id AND p.qty_delta>0 AND abs(p.qty_delta)<=1000000 AND typeof(p.qty_delta) IN ('integer','real')",
 "AND "+grid('p.qty_delta')+" AND round(p.qty_delta*1000)=round(po.qty*1000))",
 "AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.reference_id=po.id",
 "AND m.move_type='supplier_return' AND (m.location_id<>po.location_id",
 "OR m.ingredient_id<>po.ingredient_id OR m.qty_delta>=0",
 "OR abs(m.qty_delta)>1000000 OR typeof(m.qty_delta) NOT IN ('integer','real') OR NOT ("+grid('m.qty_delta')+")))",
 "AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.location_id=po.location_id",
 "AND m.ingredient_id=po.ingredient_id AND (abs(m.qty_delta)>1000000 OR typeof(m.qty_delta) NOT IN ('integer','real')",
 "OR NOT ("+grid('m.qty_delta')+")))",
 "AND (SELECT COUNT(*) FROM stock_moves m WHERE m.location_id=po.location_id",
 "AND m.ingredient_id=po.ingredient_id)<=100000",
 "AND (SELECT COUNT(*) FROM stock_moves m WHERE m.reference_id=po.id",
 "AND m.move_type='supplier_return')<=100000",
 "AND ("+rawReturned+")>=0 AND ("+rawReturned+")<=round(po.qty*1000)",
 "AND ("+rawReturned+")+?<=round(po.qty*1000)",
 "AND ("+rawStock+")>=? AND ("+rawStock+")<=1000000000)"
].join(' ');
const INSERT_STOCK=[
 'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id)',
 'SELECT ?,?,?,CASE WHEN '+validity+" THEN ? ELSE 0 END,'supplier_return',?,?,?"
].join(' ');
const INSERT_AUDIT=[
 'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail)',
 "SELECT ?,u.id,u.username,'stock.supplier_return','stock_moves',?,?,?",
 "FROM users u WHERE u.id=? AND u.active=1 AND u.role IN ('owner','manager')"
].join(' ');

// Unlike the inert two-statement plan, enforce an extra matched-audit/ledger
// sentinel in the same atomic batch. Any missing row fails the NOT NULL check.
const GUARD=[
 'UPDATE users SET display_name=CASE WHEN',
 "EXISTS(SELECT 1 FROM stock_moves m WHERE m.id=? AND m.actor_id=? AND m.move_type='supplier_return')",
 "AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='stock_moves'",
 "AND a.entity_id=? AND a.action='stock.supplier_return' AND a.actor_id=?)",
 'THEN display_name ELSE NULL END WHERE id=?'
].join(' ');

async function writeReturn(db,principal,move,key){
 const id=key.toLowerCase(),actor=principal.id.toLowerCase(),auditId=crypto.randomUUID();
 const requested=Math.round(-move.qty_delta*1000);
 const stock=db.prepare(INSERT_STOCK).bind(
  id,move.ingredient_id,move.location_id,
  actor,principal.token_hash,principal.csrf,
  move.reference_id,move.location_id,move.ingredient_id,
  id,requested,requested,move.qty_delta,move.reference_id,move.note,actor);
 const audit=db.prepare(INSERT_AUDIT).bind(
  auditId,id,move.location_id,JSON.stringify({
   ingredient_id:move.ingredient_id,qty_delta:move.qty_delta,
   reference_id:move.reference_id}),actor);
 const sentinel=db.prepare(GUARD).bind(id,actor,auditId,id,actor,actor);
 const results=await db.batch([stock,audit,sentinel]);
 if(!Array.isArray(results)||results.length!==3||results.some(s=>changes(s)!==1))
  return reply(503,{code:'E_STOCK_RETURN_UNCERTAIN_NO_RETRY'});
 return reply(200,{ok:true,result:{id,ingredient_id:move.ingredient_id,
  location_id:move.location_id,reference_id:move.reference_id,qty:-move.qty_delta}});
}

export async function nativeStockReturnHttp(request,env){
 if(!nativeStockReturnWriteEnabled(env)||typeof env?.DB?.prepare!=='function'||
    typeof env?.DB?.batch!=='function')return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.pathname!=='/api/stock/return'||url.search||url.hash)
   return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||
    request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
   return reply(403,{code:'E_FORBIDDEN'});
  if(request.headers.get('content-type')!=='application/json'||
    request.headers.has('content-encoding'))return reply(415,{code:'E_INVALID_REQUEST'});
  const rawKey=request.headers.get('x-idempotency-key');
  if(!rawKey||!UUID.test(rawKey))return reply(400,{code:'E_IDEMPOTENCY_KEY'});
  const key=rawKey.toLowerCase();
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||
    Number(declared)>2048))return reply(413,{code:'E_INVALID_REQUEST'});
  const principal=await loadPrincipal(env.DB,request);
  if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(!authorizedMutation(request,principal,'manager'))return reply(403,{code:'E_FORBIDDEN'});
  const schema=await env.DB.prepare(
   'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  const kind=await env.DB.prepare(
   'SELECT kind_version FROM stock_move_kind_contract WHERE id=1').first();
  if(kind?.kind_version!==4)return reply(503,{code:'E_STOCK_RETURN_SCHEMA_NOT_READY'});
  let raw;
  try{raw=JSON.parse(await bodyWithinLimit(request));}
  catch{return reply(400,{code:'E_INVALID_JSON'});}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
    Object.keys(raw).sort().join(',')!=='action,data'||
    raw.action!=='stock.supplier_return')return reply(400,{code:'E_INVALID_COMMAND'});
  let move;
  try{move=normalizeStockV4(raw.action,raw.data);}
  catch{return reply(400,{code:'E_INVALID_COMMAND'});}
  if(!hasAccess(principal,'manager',move.location_id))return reply(403,{code:'E_FORBIDDEN'});
  const [store,ingredient,duplicate,po]=await Promise.all([
   env.DB.prepare('SELECT active FROM locations WHERE id=?').bind(move.location_id).first(),
   env.DB.prepare('SELECT active FROM ingredients WHERE id=?').bind(move.ingredient_id).first(),
   env.DB.prepare('SELECT 1 AS found FROM stock_moves WHERE lower(id)=? LIMIT 1').bind(key).first(),
   env.DB.prepare('SELECT location_id,ingredient_id,status FROM purchase_orders WHERE id=?')
     .bind(move.reference_id).first()
  ]);
  if(store?.active!==1||ingredient?.active!==1)return reply(404,{code:'E_NOT_FOUND'});
  if(duplicate?.found===1)return reply(409,{code:'E_DUPLICATE_STOCK_RETURN'});
  if(!po||po.status!=='received'||po.location_id!==move.location_id||
     po.ingredient_id!==move.ingredient_id)
   return reply(409,{code:'E_STOCK_RETURN_RECEIPT'});
  // All authorization and receipt/budget checks are repeated by the SQL
  // in the db.batch transaction; this read is UX-only, not permission.
  return await writeReturn(env.DB,principal,move,key);
 }catch{return reply(503,{code:'E_STOCK_RETURN_UNCERTAIN_NO_RETRY'});}
}
