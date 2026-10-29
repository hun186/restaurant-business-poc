// Internal Cloudflare D1 stocktake confirmation pilot (P0 Issue #34).
// Deliberately NOT imported by the public Worker; production mutations remain 503.
import { loadPrincipal, authorizedMutation } from './auth-core.mjs';

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EPS=0.000001; // Matches the existing local SQLite stocktake contract.
const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
function changes(result) {
  const n=result?.meta?.changes ?? result?.changes;
  if(!Number.isSafeInteger(n)||n<0) throw Error('E_D1_BATCH_RESULT');
  return n;
}
async function parse(request) {
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||'')) return null;
  const length=Number(request.headers.get('content-length')||0);
  if(!Number.isSafeInteger(length)||length<0||length>4096) return null;
  const raw=await request.text();
  if(raw.length>4096) return null;
  try{
    const value=JSON.parse(raw);
    if(!value||typeof value!=='object'||Array.isArray(value)||
       Object.keys(value).length!==2||value.action!=='stocktake.confirm'||
       !value.data||typeof value.data!=='object'||Array.isArray(value.data)||
       Object.keys(value.data).length!==1||!ID.test(value.data.id)) return null;
    return value.data.id;
  }catch{return null;}
}
const balanceSql='COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m '+
  'WHERE m.ingredient_id=s.ingredient_id AND m.location_id=s.location_id),0)';
const adjustmentCount='(SELECT COUNT(*) FROM stock_moves m '+
  "WHERE m.reference_id=s.id AND m.move_type='adjustment')";
const guardSql=[
  'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail)',
  "SELECT ?,?,?,'stocktake.confirm','stocktakes',s.id,s.location_id,",
  'CASE WHEN',
  "s.status='pending' AND s.location_id=? AND s.ingredient_id=?",
  'AND s.expected_qty=? AND s.counted_qty=?',
  'AND EXISTS(SELECT 1 FROM locations l WHERE l.id=s.location_id AND l.active=1)',
  'AND EXISTS(SELECT 1 FROM ingredients i WHERE i.id=s.ingredient_id AND i.active=1)',
  'AND ABS(('+balanceSql+')-s.expected_qty)<=?',
  'AND '+adjustmentCount+'=0',
  'AND EXISTS (SELECT 1 FROM users u JOIN sessions se ON se.user_id=u.id',
  "WHERE u.id=? AND u.active=1 AND u.role=? AND u.role IN ('owner','manager')",
  'AND se.token_hash=? AND se.expires_at>?',
  'AND (?=1 OR EXISTS (SELECT 1 FROM user_locations ul JOIN locations l',
  'ON l.id=ul.location_id WHERE ul.user_id=u.id',
  'AND ul.location_id=s.location_id AND l.active=1)))',
  'THEN ? ELSE NULL END FROM stocktakes s WHERE s.id=?'
].join(' ');

const insertMoveSql=[
  'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id)',
  "SELECT ?,s.ingredient_id,s.location_id,(s.counted_qty-s.expected_qty),'adjustment',s.id,?,?",
  "FROM stocktakes s WHERE s.id=? AND s.status='pending'",
  'AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=?)'
].join(' ');

// Final assertion runs INSIDE D1.batch; an unmet predicate deliberately sets
// audit_logs.detail=NULL (NOT NULL constraint), forcing rollback of ALL writes.
// Checking batch meta.changes AFTER batch() alone cannot undo a partial commit.
function finalAssertSql(hasDelta) {
  const movement=hasDelta ? [
    'AND EXISTS(SELECT 1 FROM stock_moves m WHERE m.id=? AND m.reference_id=s.id',
    "AND m.move_type='adjustment' AND m.ingredient_id=s.ingredient_id",
    'AND m.location_id=s.location_id AND ABS(m.qty_delta-?)<=?)',
    'AND '+adjustmentCount+'=1'
  ].join(' ') : 'AND '+adjustmentCount+'=0';
  return [
    'UPDATE audit_logs SET detail=CASE WHEN EXISTS(',
    "SELECT 1 FROM stocktakes s WHERE s.id=? AND s.status='confirmed'",
    'AND s.confirmed_by=? AND s.location_id=? AND s.ingredient_id=?',
    'AND s.expected_qty=? AND s.counted_qty=?',
    'AND ABS(('+balanceSql+')-s.counted_qty)<=?',
    movement,
    ') THEN detail ELSE NULL END WHERE id=?'
  ].join(' ');
}
export async function internalStocktakeConfirm(request,env) {
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly'||
     env?.STOCKTAKE_WRITE_STAGE!=='internal-test-only'||
     typeof env.DB?.prepare!=='function'||typeof env.DB?.batch!=='function')
    return reply(503,{code:'E_NOT_READY'});
  if(request.method!=='POST') return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try {
    const p=await loadPrincipal(env.DB,request);
    if(!p) return reply(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,p,'manager')) return reply(403,{code:'E_FORBIDDEN'});
    const id=await parse(request);
    if(!id) return reply(400,{code:'E_INVALID_COMMAND'});
    const contract=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(contract?.contract_version)!==3) return reply(503,{code:'E_SCHEMA_NOT_READY'});
    const s=await env.DB.prepare([
      'SELECT s.id,s.location_id,s.ingredient_id,s.expected_qty,s.counted_qty,s.status,',
      'l.active AS location_active,i.active AS ingredient_active,',
      balanceSql+' AS current_qty',
      'FROM stocktakes s JOIN locations l ON l.id=s.location_id',
      'JOIN ingredients i ON i.id=s.ingredient_id WHERE s.id=? LIMIT 1'
    ].join(' ')).bind(id).first();
    if(!s||s.location_active!==1||s.ingredient_active!==1||
       (p.role!=='owner'&&!p.locations.includes(s.location_id)))
      return reply(404,{code:'E_STOCKTAKE_NOT_FOUND'});
    if(s.status!=='pending') return reply(409,{code:'E_ALREADY_CONFIRMED'});
    const expected=Number(s.expected_qty), counted=Number(s.counted_qty);
    const current=Number(s.current_qty);
    if(![expected,counted,current].every(Number.isFinite)||counted<0)
      return reply(409,{code:'E_INVALID_QUANTITY'});
    if(Math.abs(current-expected)>EPS) return reply(409,{code:'E_STALE_STOCKTAKE'});
    const delta=counted-expected;
    const hasDelta=Math.abs(delta)>EPS;
    // One UTC cutoff per entire transactional batch. The live session, role,
    // store and stock balance are rechecked INSIDE its first SQL statement.
    const cutoff=new Date().toISOString();
    const auditId=crypto.randomUUID(), movementId=hasDelta?crypto.randomUUID():null;
    const detail=JSON.stringify({expected,counted,delta:hasDelta?delta:0});
    const statements=[
      env.DB.prepare(guardSql).bind(auditId,p.id,p.username,
        s.location_id,s.ingredient_id,expected,counted,EPS,
        p.id,p.role,p.token_hash,cutoff,Number(p.role==='owner'),detail,id)
    ];
    if(hasDelta) statements.push(env.DB.prepare(insertMoveSql)
      .bind(movementId,'盤點確認',p.id,id,auditId));
    const updateSql=[
      "UPDATE stocktakes SET status='confirmed',confirmed_by=?",
      "WHERE id=? AND status='pending'",
      'AND EXISTS(SELECT 1 FROM audit_logs WHERE id=?)',
      hasDelta?"AND EXISTS(SELECT 1 FROM stock_moves WHERE id=? AND reference_id=? AND move_type='adjustment')":''
    ].join(' ');
    statements.push(env.DB.prepare(updateSql).bind(p.id,id,auditId,
      ...(hasDelta?[movementId,id]:[])));
    const assertionArgs=[id,p.id,s.location_id,s.ingredient_id,expected,counted,EPS,
      ...(hasDelta?[movementId,delta,EPS]:[]),auditId];
    statements.push(env.DB.prepare(finalAssertSql(hasDelta)).bind(...assertionArgs));
    const result=await env.DB.batch(statements);
    if(!Array.isArray(result)||result.length!==statements.length||
       result.some(q=>changes(q)!==1))
      return reply(409,{code:'E_CONCURRENT_CHANGE'});
    return reply(200,{ok:true,result:{id,status:'confirmed',delta:hasDelta?delta:0}});
  } catch {
    return reply(503,{code:'E_OPERATIONS_UNAVAILABLE'});
  }
}
