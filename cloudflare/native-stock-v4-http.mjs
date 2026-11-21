// Default-denied Native D1 scrap / signed inventory adjustment.
// v4 schema is NOT deployed by this module. Never update/delete old ledger rows.
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
import {normalizeStockV4} from './stock-move-v4-contract.mjs';
import {stockV4MigrationReady,STOCK_V4_MIGRATION_BATCH_PREDICATE} from './native-stock-v4-migration-guard.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const changes=x=>x?.meta?.changes??x?.changes;
export const nativeStockV4WriteEnabled=env=>nativeLoginEnabled(env)&&
 env?.CLOUD_NATIVE_STOCK_V4_WRITE_GATE==='operator-released';

const balanceSql="SELECT COALESCE(SUM(round(m.qty_delta*1000)),0) FROM stock_moves m "+
 "WHERE m.location_id=l.id AND m.ingredient_id=i.id";
const valid=[
 "EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id",
 "WHERE u.id=? AND u.role=? AND u.active=1 AND u.role IN ('owner','manager')",
 "AND s.token_hash=? AND s.csrf_token=?",
 "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
 "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul",
 "WHERE ul.user_id=? AND ul.location_id=l.id))",
 "AND EXISTS(SELECT 1 FROM stock_move_kind_contract k WHERE k.id=1 AND k.kind_version=4)",
 "AND ("+STOCK_V4_MIGRATION_BATCH_PREDICATE+")",
 "AND NOT EXISTS(SELECT 1 FROM stock_moves old WHERE lower(old.id)=?)",
 "AND (SELECT COUNT(*) FROM stock_moves m WHERE m.location_id=l.id",
 "AND m.ingredient_id=i.id)<=100000",
 "AND NOT EXISTS(SELECT 1 FROM stock_moves m WHERE m.location_id=l.id",
 "AND m.ingredient_id=i.id AND (typeof(m.qty_delta) NOT IN ('real','integer')",
 "OR abs(m.qty_delta)>1000000 OR abs(m.qty_delta*1000-round(m.qty_delta*1000))>=0.0000001))",
 "AND ("+balanceSql+")>=0 AND ("+balanceSql+")<=1000000000",
 "AND ("+balanceSql+")+? BETWEEN 0 AND 1000000000"
].join(' ');
const insertSql=[
 'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id)',
 'SELECT ?,i.id,l.id,CASE WHEN '+valid+' THEN ? ELSE 0 END,?,NULL,?,?',
 'FROM locations l JOIN ingredients i ON i.id=?',
 'WHERE l.id=? AND l.active=1 AND i.active=1'
].join(' ');
const auditSql=[
 'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail)',
 "SELECT ?,u.id,u.username,?,'stock_moves',m.id,m.location_id,?",
 'FROM stock_moves m JOIN users u ON u.id=m.actor_id',
 'WHERE m.id=? AND m.move_type=? AND u.id=? AND u.active=1',
 "AND u.role IN ('owner','manager')",
 'AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=u.id',
 'AND s.token_hash=? AND s.csrf_token=?',
 "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
].join(' ');
const guardSql=[
 'UPDATE users SET display_name=CASE WHEN',
 'EXISTS(SELECT 1 FROM stock_moves m WHERE m.id=? AND m.actor_id=? AND m.move_type=?)',
 "AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='stock_moves'",
 'AND a.entity_id=? AND a.action=?)',
 'THEN display_name ELSE NULL END WHERE id=?'
].join(' ');

async function write(db,principal,move,action,key){
 const auditId=crypto.randomUUID(),milli=Math.round(move.qty_delta*1000);
 // All checks are repeated inside ONE atomic D1 batch. A failed condition
 // inserts qty_delta=0, violating the v4 CHECK, and rolls back the batch.
 // A missing location/ingredient/audit instead fails the final guard (NOT NULL).
 const movement=db.prepare(insertSql).bind(
  key,principal.id,principal.role,principal.token_hash,principal.csrf,
  principal.role,principal.id,key,milli,
  move.qty_delta,move.move_type,move.note,principal.id,
  move.ingredient_id,move.location_id);
 const audit=db.prepare(auditSql).bind(
  auditId,action,JSON.stringify({ingredient_id:move.ingredient_id,
   qty_delta:move.qty_delta}),
  key,move.move_type,principal.id,principal.token_hash,principal.csrf);
 const guard=db.prepare(guardSql).bind(
  key,principal.id,move.move_type,auditId,key,action,principal.id);
 const result=await db.batch([movement,audit,guard]);
 if(!Array.isArray(result)||result.length!==3||
    result.some(x=>changes(x)!==1))return reply(503,{code:'E_STOCK_V4_UNCERTAIN_NO_RETRY'});
 return reply(200,{ok:true,result:{id:key,move_type:move.move_type,
  ingredient_id:move.ingredient_id,location_id:move.location_id,
  qty_delta:move.qty_delta}});
}

export async function nativeStockV4Http(request,env){
 if(!nativeStockV4WriteEnabled(env)||typeof env?.DB?.prepare!=='function'||
    typeof env?.DB?.batch!=='function')return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.pathname!=='/api/stock/v4'||url.search||url.hash)
   return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||
     request.headers.has('authorization')||
     request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
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
  if(kind?.kind_version!==4)return reply(503,{code:'E_STOCK_V4_SCHEMA_NOT_READY'});
  if(!await stockV4MigrationReady(env.DB))
   return reply(503,{code:'E_STOCK_V4_SCHEMA_NOT_READY'});
  let raw;
  try{raw=JSON.parse(await bodyWithinLimit(request));}
  catch{return reply(400,{code:'E_INVALID_JSON'});}
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||
     Object.keys(raw).sort().join(',')!=='action,data'||
     !['stock.scrap','stock.adjust'].includes(raw.action))
    return reply(400,{code:'E_INVALID_COMMAND'});
  let move;
  try{move=normalizeStockV4(raw.action,raw.data);}
  catch{return reply(400,{code:'E_INVALID_COMMAND'});}
  if(!hasAccess(principal,'manager',move.location_id))
   return reply(403,{code:'E_FORBIDDEN'});
  const [store,ingredient,duplicate,stock]=await Promise.all([
   env.DB.prepare('SELECT active FROM locations WHERE id=?').bind(move.location_id).first(),
   env.DB.prepare('SELECT active FROM ingredients WHERE id=?').bind(move.ingredient_id).first(),
   env.DB.prepare('SELECT 1 AS found FROM stock_moves WHERE lower(id)=? LIMIT 1').bind(key).first(),
   env.DB.prepare('SELECT COALESCE(SUM(round(qty_delta*1000)),0) AS milli FROM stock_moves '+
    'WHERE location_id=? AND ingredient_id=?')
    .bind(move.location_id,move.ingredient_id).first()
  ]);
  if(store?.active!==1||ingredient?.active!==1)return reply(404,{code:'E_NOT_FOUND'});
  if(duplicate?.found===1)return reply(409,{code:'E_DUPLICATE_STOCK_V4'});
  const before=stock?.milli,delta=Math.round(move.qty_delta*1000);
  if(!Number.isSafeInteger(before)||before<0||before>1000000000||
     before+delta<0||before+delta>1000000000)
   return reply(409,{code:'E_STOCK_V4_BUDGET'});
  return await write(env.DB,principal,move,raw.action,key);
 }catch{return reply(503,{code:'E_STOCK_V4_UNCERTAIN_NO_RETRY'});}
}
