// P0 Issue #34: internal-only D1 grouped purchase-order pilot.
// Not imported by cloudflare/worker.mjs; no public route or production writes.
import { loadPrincipal, authorizedMutation } from './auth-core.mjs';

const GROUP=/^POB-[A-F0-9]{32}$/;
const ACTIONS=new Map([
  ['order.batch-approve',{before:'requested',after:'approved'}],
  ['order.batch-receive',{before:'approved',after:'received'}]
]);
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff'};
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const numChanges=x=>{
  const n=x?.meta?.changes ?? x?.changes;
  if(!Number.isSafeInteger(n)||n<0) throw Error('E_D1_BATCH_RESULT');
  return n;
};
async function input(request){
  if(!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type')||'')) return null;
  const len=Number(request.headers.get('content-length')||0);
  if(!Number.isSafeInteger(len)||len<0||len>4096) return null;
  const body=await request.text();
  if(body.length>4096) return null;
  try{
    const v=JSON.parse(body);
    if(!v||typeof v!=='object'||Array.isArray(v)||
      Object.keys(v).length!==2||!ACTIONS.has(v.action)||!v.data||
      typeof v.data!=='object'||Array.isArray(v.data)||
      Object.keys(v.data).length!==1||!Object.hasOwn(v.data,'number')||
      typeof v.data.number!=='string'||!GROUP.test(v.data.number)) return null;
    return {action:v.action,number:v.data.number,...ACTIONS.get(v.action)};
  }catch{return null;}
}
const groupPattern=number=>number+'-[0-9][0-9][0-9]';

// Aggregates are evaluated again INSIDE the D1.batch transaction. Group
// integrity, expected state, active ingredients/stores, immutable membership
// and live authorization are enforced by a NOT NULL constraint failure, not
// by a 0-row UPDATE (which D1.batch would otherwise commit).
const aggregateSql=`
SELECT COUNT(*) AS n, MIN(o.number) AS first_no, MAX(o.number) AS last_no,
 MIN(o.location_id) AS location_id, MIN(o.supplier) AS supplier,
 COUNT(DISTINCT o.location_id) AS stores, COUNT(DISTINCT o.supplier) AS suppliers,
 COALESCE(SUM(CASE WHEN o.status=? AND o.qty>0
   AND EXISTS(SELECT 1 FROM locations l WHERE l.id=o.location_id AND l.active=1)
   AND EXISTS(SELECT 1 FROM ingredients i WHERE i.id=o.ingredient_id AND i.active=1)
  THEN 1 ELSE 0 END),0) AS valid_lines
FROM purchase_orders o WHERE o.number GLOB ?`;

function gateSql(){
  return `INSERT INTO audit_logs
 (id,actor_id,actor_name,action,entity,entity_id,location_id,detail)
 SELECT ?,?,?,?,'purchase_orders',?,g.location_id,
 CASE WHEN
   g.n=? AND g.n BETWEEN 1 AND 60
   AND g.valid_lines=g.n AND g.stores=1 AND g.suppliers=1
   AND g.location_id=? AND g.supplier=?
   AND g.first_no=? AND g.last_no=(? || '-' || printf('%03d',g.n))
   AND (?=0 OR NOT EXISTS(
      SELECT 1 FROM stock_moves m JOIN purchase_orders o ON o.id=m.reference_id
      WHERE o.number GLOB ? AND m.move_type='purchase'))
   AND EXISTS(
      SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE u.id=? AND u.active=1 AND u.role=?
      AND u.role IN ('owner','manager') AND s.token_hash=? AND s.expires_at>?
      AND (u.role='owner' OR EXISTS(
          SELECT 1 FROM user_locations ul JOIN locations l ON l.id=ul.location_id
          WHERE ul.user_id=u.id AND ul.location_id=g.location_id AND l.active=1)))
   THEN ? ELSE NULL END
 FROM (${aggregateSql}) g`;
}

const receiptUuid="lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))";

// Final constraint assertion is executed INSIDE the SAME D1 transaction.
// If any item status/movement is unexpectedly absent, the NOT NULL audit
// constraint throws and rolls back *all* earlier statements, including stock.
const assertSql=`UPDATE audit_logs SET detail=CASE WHEN
 (SELECT COUNT(*) FROM purchase_orders WHERE number GLOB ?)=?
 AND NOT EXISTS(SELECT 1 FROM purchase_orders WHERE number GLOB ? AND status<>?)
 AND (?=0 OR (
   SELECT COUNT(*) FROM stock_moves m JOIN purchase_orders o ON o.id=m.reference_id
   WHERE o.number GLOB ? AND m.move_type='purchase'
 )=?)
 THEN detail ELSE NULL END WHERE id=?`;

export async function internalGroupedOrderMutation(request,env){
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly'||
    env?.GROUP_ORDER_WRITE_STAGE!=='internal-test-only'||
    typeof env.DB?.prepare!=='function'||typeof env.DB?.batch!=='function')
    return json(503,{code:'E_NOT_READY'});
  if(request.method!=='POST') return json(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const principal=await loadPrincipal(env.DB,request);
    if(!principal) return json(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,principal,'manager')) return json(403,{code:'E_FORBIDDEN'});
    const cmd=await input(request);
    if(!cmd) return json(400,{code:'E_INVALID_COMMAND'});
    const marker=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(marker?.contract_version)!==3) return json(503,{code:'E_SCHEMA_NOT_READY'});

    const pattern=groupPattern(cmd.number);
    const snap=await env.DB.prepare(aggregateSql).bind(cmd.before,pattern).first();
    const n=Number(snap?.n);
    if(!Number.isInteger(n)||n<1||n>60) return json(404,{code:'E_ORDER_NOT_FOUND'});
    if(snap.stores!==1||snap.suppliers!==1||snap.valid_lines!==n||
       snap.first_no!==cmd.number+'-001'||
       snap.last_no!==cmd.number+'-'+String(n).padStart(3,'0'))
      return json(409,{code:'E_INVALID_GROUP'});
    if(principal.role!=='owner'&&!principal.locations.includes(snap.location_id))
      return json(404,{code:'E_ORDER_NOT_FOUND'});

    const receipt=cmd.action==='order.batch-receive';
    const cutoff=new Date().toISOString();
    const auditId=crypto.randomUUID();
    const auditDetail=JSON.stringify({number:cmd.number,count:n,supplier:snap.supplier,
      from:cmd.before,to:cmd.after});
    const gate=env.DB.prepare(gateSql()).bind(
      auditId,principal.id,principal.username,cmd.action,
      // Audit uses a representative first-line ID; the full group is in detail.
      (await env.DB.prepare('SELECT id FROM purchase_orders WHERE number=?').bind(snap.first_no).first())?.id||null,
      n,snap.location_id,snap.supplier,snap.first_no,cmd.number,Number(receipt),
      pattern,principal.id,principal.role,principal.token_hash,cutoff,
      auditDetail,cmd.before,pattern);

    const statements=[gate];
    if(receipt){
      // One INSERT...SELECT inserts ALL lines; no per-item partial loop.
      statements.push(env.DB.prepare(`
INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id)
 SELECT ${receiptUuid},o.ingredient_id,o.location_id,o.qty,'purchase',o.id,?,?
 FROM purchase_orders o WHERE o.number GLOB ?`)
        .bind('多品項叫貨單 '+cmd.number,principal.id,pattern));
      statements.push(env.DB.prepare(
        "UPDATE purchase_orders SET status='received',received_at=CURRENT_TIMESTAMP WHERE number GLOB ?"
      ).bind(pattern));
    }else{
      statements.push(env.DB.prepare(
        "UPDATE purchase_orders SET status='approved',approved_by=? WHERE number GLOB ?"
      ).bind(principal.id,pattern));
    }
    statements.push(env.DB.prepare(assertSql).bind(pattern,n,pattern,cmd.after,
      Number(receipt),pattern,receipt?n:0,auditId));

    const results=await env.DB.batch(statements);
    if(!Array.isArray(results)||results.length!==statements.length||
      numChanges(results[0])!==1||numChanges(results.at(-1))!==1||
      results.slice(1,-1).some(x=>numChanges(x)!==n))
      return json(409,{code:'E_CONCURRENT_CHANGE'});
    return json(200,{ok:true,result:{number:cmd.number,item_count:n,status:cmd.after}});
  }catch{
    return json(503,{code:'E_OPERATIONS_UNAVAILABLE'});
  }
}
