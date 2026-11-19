// Inert proposal: bounded read-only D1-shaped reconciliation projections.
// Never executes SQL or imports from any production/local/demo runtime.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=()=>{throw Error('E_STOCK_V4_D1_RECONCILE_SELECT_INVALID');};
const movementSql=[
 'SELECT id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id',
 'FROM stock_moves WHERE id=? ORDER BY id LIMIT 2'
].join(' ');
const auditSql=[
 'SELECT id,entity,entity_id,action,actor_id,location_id,detail',
 'FROM audit_logs WHERE entity_id=? ORDER BY id LIMIT 2'
].join(' ');
export function buildSyntheticD1SupplierReturnReconcileSelects(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
  ![Object.prototype,null].includes(Object.getPrototypeOf(input))||
  Object.keys(input).sort().join(',')!=='request_id')fail();
 const descriptor=Object.getOwnPropertyDescriptor(input,'request_id');
 if(!descriptor||!Object.prototype.hasOwnProperty.call(descriptor,'value'))fail();
 const id=descriptor.value;
 if(typeof id!=='string'||!UUID.test(id))fail();
 const canonical=id.toLowerCase();
 const statements=[
  Object.freeze({kind:'movement',sql:movementSql,args:Object.freeze([canonical]),max_rows:2}),
  Object.freeze({kind:'audit',sql:auditSql,args:Object.freeze([canonical]),max_rows:2})
 ];
 return Object.freeze({
  statements:Object.freeze(statements),synthetic_only:true,
  read_only_plan:true,sql_executed:false,consistent_snapshot_verified:false,
  remote_d1_verified:false,transaction_committed_verified:false,
  production_write_authorized:false
 });
}
