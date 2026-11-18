// Platform-neutral future v4 stock mutation contract. Validation only.
// No storage, network, authorization, schema migration or write permission.
export const STOCK_V4_CONTRACT_VERSION=4;
export const STOCK_V4_ACTIONS=Object.freeze(['stock.supplier_return','stock.scrap','stock.adjust']);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=code=>{throw Error('E_STOCK_V4_'+code);};
function exact(value,keys){
 if(!value||typeof value!=='object'||Array.isArray(value)||
   ![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail('SHAPE');
 if(JSON.stringify(Object.keys(value).sort())!==JSON.stringify([...keys].sort()))
   fail('FIELDS');
}
function id(value){
 if(typeof value!=='string'||!UUID.test(value))fail('ID');
 return value.toLowerCase();
}
function qty(value,signed=false){
 if(typeof value!=='number'||!Number.isFinite(value)||value===0||
    Math.abs(value)>1000000||(!signed&&value<0)||
    !/^-?(?:0|[1-9]\\d*)(?:\\.\\d{1,3})?$/.test(String(value)))fail('QUANTITY');
 const units=Math.round(value*1000);
 if(!Number.isSafeInteger(units)||units===0)fail('QUANTITY');
 return units/1000;
}
function reason(value){
 if(typeof value!=='string'||value.length<1||value.length>300||
    value!==value.trim()||!value.trim()||
    /[\u0000-\u001f\u007f-\u009f]/u.test(value))fail('REASON');
 return value;
}
// This canonical output is a PROPOSAL, not an authorized ledger operation.
// Backend MUST verify session/role/store, received PO, return cap, no-negative
// balance, idempotency, and atomic append-only ledger plus audit.
export function normalizeStockV4(action,data){
 if(!STOCK_V4_ACTIONS.includes(action))fail('ACTION');
 const common=['ingredient_id','location_id','reason'];
 if(action==='stock.supplier_return')exact(data,[...common,'qty','reference_id']);
 else if(action==='stock.scrap')exact(data,[...common,'qty']);
 else exact(data,[...common,'qty_delta']);
 return Object.freeze({
   ingredient_id:id(data.ingredient_id),
   location_id:id(data.location_id),
   move_type:action==='stock.supplier_return'?'supplier_return':
     action==='stock.scrap'?'scrap':'adjustment',
   qty_delta:action==='stock.adjust'?qty(data.qty_delta,true):-qty(data.qty),
   reference_id:action==='stock.supplier_return'?id(data.reference_id):null,
   note:reason(data.reason)
 });
}
