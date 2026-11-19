'use strict';
// Explicit-operator-release Local SQLite stock v4 command: no automatic migration.
// MUST run inside src/service.js inTransaction() with an authenticated session.
const {randomUUID}=require('node:crypto');
const {normalizeStockV4}=require('./stock-move-v4-contract.mjs');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
function reject(code,status=409){
 const e=new Error('E_LOCAL_STOCK_V4_'+code);e.status=status;throw e;
}
const exact=(o,keys)=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(o))&&
 JSON.stringify(Object.keys(o).sort())===JSON.stringify([...keys].sort());
const units=v=>{
 if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1000000||
  Math.abs(v*1000-Math.round(v*1000))>=0.0000001)reject('HISTORICAL_PRECISION');
 return Math.round(v*1000);
};
function capability(db){
 if(process.env.LOCAL_STOCK_V4_WRITE_GATE!=='operator-released')return false;
 const version=db.prepare('PRAGMA user_version').get().user_version;
 if(version!==4)return false;
 try{
  const kind=db.prepare('SELECT kind_version FROM stock_move_kind_contract WHERE id=1').get();
  return kind?.kind_version===4;
 }catch{return false;}
}
function append(db,principal,action,input){
 if(!capability(db))reject('NOT_READY',503);
 if(!['stock.scrap','stock.adjust','stock.supplier_return'].includes(action))
  reject('ACTION',400);
 const keys=action==='stock.supplier_return'?
  ['request_id','ingredient_id','location_id','reference_id','qty','reason']:
  action==='stock.scrap'?
  ['request_id','ingredient_id','location_id','qty','reason']:
  ['request_id','ingredient_id','location_id','qty_delta','reason'];
 if(!exact(input,keys)||typeof input.request_id!=='string'||
    !UUID.test(input.request_id))reject('REQUEST',400);
 const id=input.request_id.toLowerCase();
 const data={...input};delete data.request_id;
 let move;try{move=normalizeStockV4(action,data);}catch{reject('PAYLOAD',400);}
 const actor=db.prepare('SELECT id,username,role,active FROM users WHERE id=?').get(principal?.id);
 if(actor?.active!==1||actor.role!==principal?.role||!['owner','manager'].includes(actor.role))
  reject('ROLE',403);
 if(!db.prepare('SELECT 1 FROM sessions WHERE user_id=? AND token_hash=? AND csrf_token=? AND expires_at>?').get(
  actor.id,principal.token_hash,principal.csrf_token,new Date().toISOString()))
  reject('SESSION',401);
 if(!db.prepare('SELECT 1 FROM locations WHERE id=? AND active=1').get(move.location_id)||
    !db.prepare('SELECT 1 FROM ingredients WHERE id=? AND active=1').get(move.ingredient_id))
  reject('INACTIVE_SCOPE',404);
 if(actor.role!=='owner'&&!db.prepare(
  'SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?').get(actor.id,move.location_id))
  reject('STORE',403);
 if(db.prepare('SELECT 1 FROM stock_moves WHERE lower(id)=? LIMIT 1').get(id))
  reject('DUPLICATE',409);
 const rows=db.prepare(
  'SELECT qty_delta,location_id,ingredient_id,move_type,reference_id FROM stock_moves WHERE location_id=? AND ingredient_id=? LIMIT 100001'
 ).all(move.location_id,move.ingredient_id);
 if(rows.length>100000)reject('ROW_LIMIT');
 let total=0;
 for(const row of rows){
  total+=units(row.qty_delta);
  if(!Number.isSafeInteger(total)||Math.abs(total)>1000000000)reject('HISTORICAL_BUDGET');
 }
 if(total<0||total>1000000000)reject('NEGATIVE_HISTORY');
 const delta=units(move.qty_delta),after=total+delta;
 if(!Number.isSafeInteger(after)||after<0||after>1000000000)
  reject('STOCK_BUDGET');
 if(action==='stock.supplier_return'){
  const po=db.prepare(
   'SELECT location_id,ingredient_id,status,qty FROM purchase_orders WHERE id=?'
  ).get(move.reference_id);
  if(!po||po.status!=='received'||po.location_id!==move.location_id||
     po.ingredient_id!==move.ingredient_id)reject('RECEIPT');
  const received=units(po.qty);
  if(received<1)reject('RECEIPT');
  const history=db.prepare(
   "SELECT location_id,ingredient_id,qty_delta,move_type FROM stock_moves "+
   "WHERE reference_id=? AND move_type IN ('purchase','supplier_return') LIMIT 100002"
  ).all(move.reference_id);
  if(history.length>100001)reject('RETURN_HISTORY_LIMIT');
  const purchased=history.filter(x=>x.move_type==='purchase');
  if(purchased.length!==1||
     purchased[0].location_id!==move.location_id||
     purchased[0].ingredient_id!==move.ingredient_id||
     units(purchased[0].qty_delta)!==received)reject('PURCHASE_MISMATCH');
  let returned=0;
  for(const x of history.filter(x=>x.move_type==='supplier_return')){
   const amount=units(x.qty_delta);
   if(x.location_id!==move.location_id||x.ingredient_id!==move.ingredient_id||
      amount>=0)reject('BAD_RETURN_HISTORY');
   returned-=amount;
   if(!Number.isSafeInteger(returned)||returned>received)reject('BAD_RETURN_HISTORY');
  }
  if(returned-delta>received)reject('RETURN_CAP');
 }
 const movement=db.prepare(
  'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)'
 ).run(id,move.ingredient_id,move.location_id,move.qty_delta,
  move.move_type,move.reference_id,move.note,actor.id);
 if(movement.changes!==1)reject('LEDGER_WRITE');
 const audit=db.prepare(
  'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?)'
 ).run(randomUUID(),actor.id,actor.username,action,'stock_moves',id,move.location_id,
  JSON.stringify({ingredient_id:move.ingredient_id,qty_delta:move.qty_delta,
   reference_id:move.reference_id}));
 if(audit.changes!==1)reject('AUDIT_WRITE');
 return Object.freeze({id,move_type:move.move_type,qty_delta:move.qty_delta,
  stock_remaining_milli:after});
}
module.exports={appendLocalStockV4:append,localStockV4WriteEnabled:capability};
