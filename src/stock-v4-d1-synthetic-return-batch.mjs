// OFFLINE PROPOSAL ONLY. D1-shaped supplier return atomic batch, with no
// production runtime import, DB connection, network or migration access.
// All facts and authorization are checked in the INSERT SQL at write time.
import {normalizeStockV4} from './stock-move-v4-contract.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HEX=/^[0-9a-f]{64}$/;
const fail=()=>{throw Error('E_STOCK_V4_D1_PLAN_INVALID');};
const exact=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
 Object.keys(x).sort().join(',')===[...keys].sort().join(',');
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
// SQL SELECT always emits a movement row. When its guards are false, zero
// qty_delta violates v4 CHECK and aborts the *entire* D1 batch (never a
// successful zero-row no-op). Duplicate UUID fails the movement PK.
// Audit failure rolls back both statements when executed as ONE db.batch.
// Caller must check both changes=1, not treat a response as verified blindly.
export function buildSyntheticD1SupplierReturnBatch({auth,request,audit_id}={}){
 if(!exact(auth,['actor_id','token_hash','csrf'])||
    !exact(request,['request_id','action','data'])||
    !UUID.test(auth.actor_id)||!UUID.test(request.request_id)||
    !UUID.test(audit_id)||!HEX.test(auth.token_hash)||
    typeof auth.csrf!=='string'||auth.csrf.length<16||auth.csrf.length>256||
    /[\u0000-\u001f\u007f]/u.test(auth.csrf)||
    request.action!=='stock.supplier_return')fail();
 let move;
 try{move=normalizeStockV4(request.action,request.data);}catch{fail();}
 const requested=Math.round(-move.qty_delta*1000);
 if(!Number.isSafeInteger(requested)||requested<1||requested>1000000000)fail();
 const actor=auth.actor_id.toLowerCase(),id=request.request_id.toLowerCase();
 const stock=Object.freeze({sql:INSERT_STOCK,args:Object.freeze([
  id,move.ingredient_id,move.location_id,
  actor,auth.token_hash,auth.csrf,
  move.reference_id,move.location_id,move.ingredient_id,
  id,requested,requested,move.qty_delta,move.reference_id,move.note,actor
 ])});
 const audit=Object.freeze({sql:INSERT_AUDIT,args:Object.freeze([
  audit_id.toLowerCase(),id,move.location_id,JSON.stringify({
   ingredient_id:move.ingredient_id,qty_delta:move.qty_delta,
   reference_id:move.reference_id
  }),actor
 ])});
 return Object.freeze({statements:Object.freeze([stock,audit]),
  expected_changes:Object.freeze([1,1]),synthetic_only:true,
  remote_d1_verified:false,production_write_authorized:false});
}
