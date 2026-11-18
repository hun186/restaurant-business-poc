// Pure fail-closed verification of a proposed supplier-return D1 batch result.
// Synthetic-only helper. No D1 calls, Worker import, database or network.
// Exactly one new stock movement and one matching audit are required.
// This verifies a RESULT SHAPE, never remote commit/transaction durability.
const fail=()=>{throw Error('E_STOCK_V4_D1_BATCH_RESULT_INVALID');};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const own=(x,k)=>Object.prototype.hasOwnProperty.call(x,k);
const value=(x,k)=>{
 const d=Object.getOwnPropertyDescriptor(x,k);
 if(!d||!own(d,'value'))fail();
 return d.value;
};
function changes(result){
 if(!plain(result))fail();
 const success=own(result,'success')?value(result,'success'):undefined;
 if(success!==undefined&&success!==true)fail();
 if(own(result,'error')&&value(result,'error')!==null)fail();
 const hasMeta=own(result,'meta');
 const meta=hasMeta?value(result,'meta'):null;
 if(hasMeta&&!plain(meta))fail();
 const hasNested=hasMeta&&own(meta,'changes');
 const hasFlat=own(result,'changes');
 if(!hasNested&&!hasFlat)fail();
 const nested=hasNested?value(meta,'changes'):undefined;
 const flat=hasFlat?value(result,'changes'):undefined;
 if(hasNested&&nested!==1)fail();
 if(hasFlat&&flat!==1)fail();
 return 1;
}
export function assertSyntheticD1SupplierReturnBatchResult(result){
 if(!Array.isArray(result)||result.length!==2)fail();
 const movement=changes(result[0]),audit=changes(result[1]);
 if(movement!==1||audit!==1)fail();
 return Object.freeze({
  status:'SYNTHETIC_D1_BATCH_RESPONSE_SHAPE_PASS',
  stock_move_changes:1,audit_changes:1,
  synthetic_only:true,remote_d1_verified:false,
  transaction_committed_verified:false,production_write_authorized:false
 });
}
