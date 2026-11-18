// Inert supplier-return quantity safety arithmetic.
// All quantities are integer thousandths, NOT floating-point quantities.
// A backend MUST derive facts from an authorized active store/received PO
// inside the same atomic write transaction; untrusted client inputs are NOT facts.
const fail=code=>{throw Error('E_STOCK_RETURN_BUDGET_'+code);};
const valid=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const exact=(input,keys)=>input!==null&&typeof input==='object'&&!Array.isArray(input)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(input))&&
  JSON.stringify(Object.keys(input).sort())===JSON.stringify([...keys].sort());
export const RETURN_BUDGET_SCALE=1000;
export const RETURN_BUDGET_MAX_MILLI=1000000000;
export function assertSupplierReturnBudget(facts){
 if(!exact(facts,['received_milli','already_returned_milli',
    'available_stock_milli','requested_milli']))fail('FIELDS');
 const {received_milli:received,already_returned_milli:returned,
    available_stock_milli:onHand,requested_milli:request}=facts;
 if(!valid(received,RETURN_BUDGET_MAX_MILLI)||
    !valid(returned,RETURN_BUDGET_MAX_MILLI)||
    !valid(onHand,RETURN_BUDGET_MAX_MILLI)||
    !Number.isSafeInteger(request)||request<1||request>RETURN_BUDGET_MAX_MILLI)
   fail('QUANTITY');
 if(returned>received)fail('INCONSISTENT_HISTORY');
 if(request>received-returned)fail('EXCEEDS_RECEIPT');
 if(request>onHand)fail('INSUFFICIENT_STOCK');
 return Object.freeze({
   approved_milli:request,
   receipt_remaining_milli:received-returned-request,
   stock_remaining_milli:onHand-request,
   writes_performed:false,
   transaction_authorized:false,
   remote_d1_verified:false
 });
}
