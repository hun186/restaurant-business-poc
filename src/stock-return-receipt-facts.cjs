'use strict';
// Inert, SELECT-only source-of-facts reader for a future supplier return.
// No imports from the production Local API or Cloudflare Worker.
// Caller MUST perform authenticated scope checks and all queries again inside
// the same atomic write transaction; preflight output is NOT an authorization.
const {assertSupplierReturnBudget}=require('./stock-return-budget.mjs');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=code=>{throw Error('E_STOCK_RETURN_FACTS_'+code);};
function input(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||
   ![Object.prototype,null].includes(Object.getPrototypeOf(value))||
   JSON.stringify(Object.keys(value).sort())!==JSON.stringify(
    ['ingredient_id','location_id','reference_id','requested_milli'].sort()))fail('FIELDS');
 for(const k of ['ingredient_id','location_id','reference_id'])
   if(typeof value[k]!=='string'||!UUID.test(value[k]))fail('ID');
 if(!Number.isSafeInteger(value.requested_milli)||value.requested_milli<1||
    value.requested_milli>1000000000)fail('QUANTITY');
 return value;
}
function asMilli(value){
 // Refuse old non-grid, nonfinite or malformed historical quantities:
 // silently rounding imported v3 ledger values would corrupt return budgets.
 if(typeof value!=='number'||!Number.isFinite(value)||
   !/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]{1,3})?$/.test(String(value))||
   Math.abs(value)>1000000)fail('HISTORICAL_PRECISION');
 const units=Math.round(value*1000);
 if(!Number.isSafeInteger(units))fail('HISTORICAL_PRECISION');
 return units;
}
async function read(db,sql,...args){
 if(!/^SELECT\b/.test(sql))fail('NOT_READONLY');
 try{
   const stmt=db.prepare(sql);
   const out=typeof stmt.bind==='function'?
     await stmt.bind(...args).all():await stmt.all(...args);
   const rows=Array.isArray(out)?out:out?.results;
   if(!Array.isArray(rows))fail('READ_SHAPE');
   return rows;
 }catch{fail('READ_FAILED');}
}
async function inspectSupplierReturnFacts(db,payload){
 if(!db||typeof db.prepare!=='function')fail('INVALID_DB');
 const x=input(payload);
 // Unmigrated v3 cannot represent a truthful supplier_return ledger kind.
 const contract=await read(db,
   'SELECT kind_version FROM stock_move_kind_contract WHERE id=1');
 if(contract.length!==1||contract[0].kind_version!==4)fail('SCHEMA_NOT_READY');
 const stores=await read(db,'SELECT active FROM locations WHERE id=?',x.location_id);
 const ingredients=await read(db,'SELECT active FROM ingredients WHERE id=?',x.ingredient_id);
 if(stores.length!==1||stores[0].active!==1||
    ingredients.length!==1||ingredients[0].active!==1)fail('INACTIVE_SCOPE');
 const orders=await read(db,
   'SELECT id,location_id,ingredient_id,status,qty FROM purchase_orders WHERE id=?',
   x.reference_id);
 if(orders.length!==1||orders[0].status!=='received'||
    orders[0].location_id!==x.location_id||
    orders[0].ingredient_id!==x.ingredient_id)fail('RECEIPT_MISMATCH');
 const received=asMilli(orders[0].qty);
 if(received<=0)fail('RECEIPT_MISMATCH');
 const purchase=await read(db,
   "SELECT qty_delta,location_id,ingredient_id FROM stock_moves WHERE move_type='purchase' AND reference_id=? LIMIT 3",
   x.reference_id);
 if(purchase.length!==1||purchase[0].location_id!==x.location_id||
    purchase[0].ingredient_id!==x.ingredient_id||
    asMilli(purchase[0].qty_delta)!==received)fail('RECEIPT_LEDGER_MISMATCH');
 const returned=await read(db,
   "SELECT qty_delta,location_id,ingredient_id FROM stock_moves WHERE move_type='supplier_return' AND reference_id=? LIMIT 100001",
   x.reference_id);
 if(returned.length>100000)fail('ROW_LIMIT');
 let already=0;
 for(const row of returned){
   if(row.location_id!==x.location_id||row.ingredient_id!==x.ingredient_id)
     fail('RETURN_SCOPE_MISMATCH');
   const q=asMilli(row.qty_delta);
   if(q>=0)fail('RETURN_SIGN');
   already-=q;
   if(!Number.isSafeInteger(already)||already>1000000000)fail('RETURN_OVERFLOW');
 }
 const stock=await read(db,
   'SELECT qty_delta FROM stock_moves WHERE location_id=? AND ingredient_id=? LIMIT 100001',
   x.location_id,x.ingredient_id);
 if(stock.length>100000)fail('ROW_LIMIT');
 let available=0;
 for(const row of stock){
   available+=asMilli(row.qty_delta);
   if(!Number.isSafeInteger(available)||Math.abs(available)>1000000000)
     fail('STOCK_OVERFLOW');
 }
 let budget;
 try{
   budget=assertSupplierReturnBudget({received_milli:received,
     already_returned_milli:already,available_stock_milli:available,
     requested_milli:x.requested_milli});
 }catch{fail('BUDGET_REJECTED');}
 return Object.freeze({
   status:'OFFLINE_RETURN_FACTS_READONLY_PASS',
   receipt_milli:received,already_returned_milli:already,
   stock_milli:available,approved_milli:budget.approved_milli,
   receipt_remaining_milli:budget.receipt_remaining_milli,
   stock_remaining_milli:budget.stock_remaining_milli,
   writes_performed:false,transaction_authorized:false,
   remote_d1_verified:false
 });
}
module.exports={inspectSupplierReturnFacts};
