// Synthetic-only inspection of an ambiguous future D1 supplier-return result.
// No network, database handle, production runtime import or retry capability.
// A matching snapshot is NOT proof of a durable remote commit.
import {buildSyntheticD1SupplierReturnBatch} from './stock-v4-d1-synthetic-return-batch.mjs';
const err=()=>{throw Error('E_STOCK_V4_RECONCILE_INVALID');};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
 [Object.prototype,null].includes(Object.getPrototypeOf(x));
function field(row,key){
 if(!plain(row))err();
 const d=Object.getOwnPropertyDescriptor(row,key);
 if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))err();
 return d.value;
}
function rows(input){
 if(!Array.isArray(input)||input.length>2)err();
 const result=[];
 for(let i=0;i<input.length;i++){
  const d=Object.getOwnPropertyDescriptor(input,String(i));
  if(!d||!Object.prototype.hasOwnProperty.call(d,'value')||!plain(d.value))err();
  result.push(d.value);
 }
 return result;
}
const result=status=>Object.freeze({
 status,synthetic_only:true,remote_d1_verified:false,
 transaction_committed_verified:false,production_write_authorized:false,
 safe_to_retry:false
});
function matching(move,audit,plan){
 try{
  const stock=plan.statements[0].args,log=plan.statements[1].args;
  const expectedDetail=JSON.parse(log[3]);
  const detail=JSON.parse(field(audit,'detail'));
  if(!plain(detail)||Object.keys(detail).sort().join(',')!==
      'ingredient_id,qty_delta,reference_id')return false;
  return field(move,'id')===stock[0]&&
   field(move,'ingredient_id')===stock[1]&&
   field(move,'location_id')===stock[2]&&
   field(move,'actor_id')===stock[15]&&
   field(move,'qty_delta')===stock[12]&&
   field(move,'move_type')==='supplier_return'&&
   field(move,'reference_id')===stock[13]&&
   field(move,'note')===stock[14]&&
   field(audit,'id')===log[0]&&
   field(audit,'entity_id')===stock[0]&&
   field(audit,'entity')==='stock_moves'&&
   field(audit,'action')==='stock.supplier_return'&&
   field(audit,'actor_id')===log[4]&&
   field(audit,'location_id')===stock[2]&&
   detail.ingredient_id===expectedDetail.ingredient_id&&
   detail.qty_delta===expectedDetail.qty_delta&&
   detail.reference_id===expectedDetail.reference_id;
 }catch{return false;}
}
export function reconcileSyntheticD1SupplierReturnSnapshot(input){
 if(!plain(input))err();
 const keys=['auth','request','audit_id','stock_rows','audit_rows'];
 if(Object.keys(input).sort().join(',')!==keys.sort().join(','))err();
 let plan,stock,audit;
 try{
  plan=buildSyntheticD1SupplierReturnBatch({
   auth:field(input,'auth'),request:field(input,'request'),
   audit_id:field(input,'audit_id')
  });
  stock=rows(field(input,'stock_rows'));
  audit=rows(field(input,'audit_rows'));
 }catch{err();}
 if(stock.length===0&&audit.length===0)
  return result('SYNTHETIC_RETURN_ABSENT_IN_SNAPSHOT_NO_RETRY');
 if(stock.length===1&&audit.length===1&&matching(stock[0],audit[0],plan))
  return result('SYNTHETIC_RETURN_MATCHED_IN_SNAPSHOT');
 return result('SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY');
}
