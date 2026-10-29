// P0 #34: private synthetic D1 purchasing transaction experiment.
// This module is deliberately NOT wired to the public Worker router.
// Both guarded phases must be explicitly configured by an internal caller.
import { loadPrincipal, authorizedMutation } from './auth-core.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['order.approve','order.receive']);
const headers={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const response=(status,data)=>new Response(JSON.stringify(data),{status,headers});

function changed(result) {
  const n=result?.meta?.changes ?? result?.changes;
  if(!Number.isSafeInteger(n)||n<0) throw Error('E_D1_RESULT');
  return n;
}
async function parse(request) {
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||'')) return null;
  const len=Number(request.headers.get('content-length')||0);
  if(!Number.isSafeInteger(len)||len<0||len>4096) return null;
  const raw=await request.text();
  if(raw.length>4096) return null;
  try {
    const v=JSON.parse(raw);
    if(!v||typeof v!=='object'||Array.isArray(v)||
       !ACTIONS.has(v.action)||Object.keys(v).some(k=>k!=='action'&&k!=='data')||
       !v.data||typeof v.data!=='object'||Array.isArray(v.data)||
       Object.keys(v.data).length!==1||!Object.hasOwn(v.data,'id')||
       typeof v.data.id!=='string'||!UUID.test(v.data.id)) return null;
    return {action:v.action,id:v.data.id};
  } catch {return null;}
}

// This SQL is repeated in every statement in a D1.batch transaction.
// The database, not a browser role flag, rechecks the live user, session,
// store grant, active store/ingredient and precise prior order state.
function condition(principal,expected,expiryCutoff,{noLedger=false}={}) {
  let sql="o.id=? AND o.status=? AND o.qty>0 AND o.number NOT LIKE 'POB-%' "+
    'AND EXISTS (SELECT 1 FROM locations l JOIN ingredients i ON i.id=o.ingredient_id '+
    'WHERE l.id=o.location_id AND l.active=1 AND i.active=1) '+
    'AND EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id '+
    "WHERE u.id=? AND u.active=1 AND u.role=? AND u.role IN ('owner','manager') "+
    'AND s.token_hash=? AND s.expires_at>?)';
  const args=[principal.id,principal.role,principal.token_hash,expiryCutoff];
  if(principal.role!=='owner'){
    sql+=' AND EXISTS (SELECT 1 FROM user_locations ul JOIN locations l '+
      'ON l.id=ul.location_id WHERE ul.user_id=? AND ul.location_id=o.location_id AND l.active=1)';
    args.push(principal.id);
  }
  if(noLedger)
    sql+=" AND NOT EXISTS (SELECT 1 FROM stock_moves m WHERE m.reference_id=o.id AND m.move_type='purchase')";
  return {sql,args};
}

export async function internalOrderMutation(request,env) {
  // No environment default or request field can turn on public writes.
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly'||
     env?.ORDER_WRITE_STAGE!=='internal-test-only'||
     typeof env.DB?.prepare!=='function'||typeof env.DB?.batch!=='function')
    return response(503,{code:'E_NOT_READY'});
  if(request.method!=='POST') return response(405,{code:'METHOD_NOT_ALLOWED'});
  try {
    const p=await loadPrincipal(env.DB,request);
    if(!p) return response(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,p,'manager')) return response(403,{code:'E_FORBIDDEN'});
    const cmd=await parse(request);
    if(!cmd) return response(400,{code:'E_INVALID_COMMAND'});
    const schema=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(schema?.contract_version)!==3) return response(503,{code:'E_SCHEMA_NOT_READY'});
    const o=await env.DB.prepare(
      'SELECT o.id,o.number,o.location_id,o.ingredient_id,o.qty,o.status,l.active AS store_active,i.active AS ingredient_active '+
      'FROM purchase_orders o JOIN locations l ON l.id=o.location_id '+
      'JOIN ingredients i ON i.id=o.ingredient_id WHERE o.id=? LIMIT 1'
    ).bind(cmd.id).first();
    if(!o||o.store_active!==1||o.ingredient_active!==1||
       (p.role!=='owner'&&!p.locations.includes(o.location_id)))
      return response(404,{code:'E_ORDER_NOT_FOUND'});
    const expected=cmd.action==='order.approve'?'requested':'approved';
    if(o.number.startsWith('POB-')) return response(409,{code:'E_GROUP_ORDER_REQUIRED'});
    if(o.status!==expected) return response(409,{code:'E_ORDER_STATE'});
    const isReceive=cmd.action==='order.receive';
    // Capture the session-validity cutoff ONCE for every statement in this
    // D1 batch. Otherwise expiry between statement construction may commit
    // stock/audit writes while the final status update affects zero rows.
    const expiryCutoff=new Date().toISOString();
    const guard=condition(p,expected,expiryCutoff,{noLedger:isReceive});
    const params=[cmd.id,expected,...guard.args];
    const auditId=crypto.randomUUID();
    const detail=JSON.stringify({from:expected,to:isReceive?'received':'approved'});
    const audit=env.DB.prepare(
      'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
      'SELECT ?,?,?,?,\'purchase_orders\',o.id,o.location_id,? FROM purchase_orders o WHERE '+guard.sql
    ).bind(auditId,p.id,p.username,cmd.action,detail,...params);
    if(!isReceive){
      const approval=env.DB.prepare('UPDATE purchase_orders AS o SET status=\'approved\',approved_by=? WHERE '+guard.sql)
        .bind(p.id,...params);
      const results=await env.DB.batch([audit,approval]);
      if(!Array.isArray(results)||results.length!==2||results.some(r=>changed(r)!==1))
        return response(409,{code:'E_CONCURRENT_CHANGE'});
      return response(200,{ok:true,result:{id:cmd.id,status:'approved'}});
    }

    // Fresh movement UUID ties the final state transition to exactly THIS
    // successful insert; a pre-existing ledger row cannot authorize receiving.
    const moveId=crypto.randomUUID();
    const movement=env.DB.prepare(
      'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) '+
      "SELECT ?,o.ingredient_id,o.location_id,o.qty,'purchase',o.id,?,? "+
      'FROM purchase_orders o WHERE '+guard.sql
    ).bind(moveId,'叫貨單驗收入庫',p.id,...params);
    const after=condition(p,expected,expiryCutoff);
    const update=env.DB.prepare(
      "UPDATE purchase_orders AS o SET status='received',received_at=CURRENT_TIMESTAMP "+
      'WHERE '+after.sql+
      " AND EXISTS (SELECT 1 FROM stock_moves m WHERE m.id=? AND m.reference_id=o.id AND m.move_type='purchase')"
    ).bind(cmd.id,expected,...after.args,moveId);
    // D1.batch is transactional; SQL errors abort the entire batch. Every
    // predicate is stable during the serialized transaction; no 0-row batch
    // can turn into a partial business success.
    const results=await env.DB.batch([audit,movement,update]);
    if(!Array.isArray(results)||results.length!==3||results.some(r=>changed(r)!==1))
      return response(409,{code:'E_CONCURRENT_CHANGE'});
    return response(200,{ok:true,result:{id:cmd.id,status:'received'}});
  } catch {
    // Do not reveal SQL, credentials or store existence on driver failures.
    return response(503,{code:'E_OPERATIONS_UNAVAILABLE'});
  }
}
