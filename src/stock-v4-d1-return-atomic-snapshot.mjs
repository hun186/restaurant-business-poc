// Offline-only single-statement proposal for supplier-return reconciliation.
// A single SQLite SELECT uses one read snapshot. This module never connects to D1,
// executes SQL, authorizes a write, or decides whether a request can be replayed.
import {reconcileSyntheticD1SupplierReturnSnapshot} from './stock-v4-d1-return-reconcile.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const FIELDS=['row_kind','id','ingredient_id','location_id','qty_delta','move_type',
  'reference_id','note','actor_id','entity','entity_id','action','detail'];
const MOVE=['id','ingredient_id','location_id','qty_delta','move_type','reference_id',
  'note','actor_id'];
const AUDIT=['id','entity','entity_id','action','actor_id','location_id','detail'];
const fail=()=>{throw Error('E_STOCK_V4_ATOMIC_SNAPSHOT_INVALID');};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
const read=(x,k)=>{
  if(!plain(x))fail();
  const d=Object.getOwnPropertyDescriptor(x,k);
  if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))fail();
  return d.value;
};
const exact=(x,keys)=>plain(x)&&
  Object.keys(x).sort().join(',')===[...keys].sort().join(',');

// Both ledger and audit are projected from ONE statement, not two .all() calls.
// Per-table LIMIT 2 catches duplicates; the outer result never exceeds 4 rows.
// SQL has no interpolated user input and does not inspect unrelated entities.
const SQL=[
  'WITH movements AS (SELECT id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id',
  'FROM stock_moves WHERE id=? ORDER BY id LIMIT 2),',
  'audits AS (SELECT id,entity,entity_id,action,actor_id,location_id,detail',
  'FROM audit_logs WHERE entity_id=? ORDER BY id LIMIT 2)',
  "SELECT 'movement' AS row_kind,id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,",
  'NULL AS entity,NULL AS entity_id,NULL AS action,NULL AS detail FROM movements',
  'UNION ALL',
  "SELECT 'audit' AS row_kind,id,NULL AS ingredient_id,location_id,NULL AS qty_delta,",
  'NULL AS move_type,NULL AS reference_id,NULL AS note,actor_id,entity,entity_id,action,detail FROM audits',
  'ORDER BY row_kind,id'
].join(' ');

export function buildSyntheticD1SupplierReturnAtomicSnapshotSelect(input){
  if(!exact(input,['request_id']))fail();
  const id=read(input,'request_id');
  if(typeof id!=='string'||!UUID.test(id))fail();
  const canonical=id.toLowerCase();
  return Object.freeze({
    statement:Object.freeze({sql:SQL,args:Object.freeze([canonical,canonical]),
      max_rows:4,read_only:true}),
    synthetic_only:true,sql_executed:false,
    single_statement_plan:true,consistent_snapshot_verified:false,
    remote_d1_verified:false,production_write_authorized:false
  });
}

function parseRows(rows){
  if(!Array.isArray(rows)||rows.length>4||
    Object.keys(rows).length!==rows.length)fail();
  const stock_rows=[],audit_rows=[];
  for(let i=0;i<rows.length;i++){
    const d=Object.getOwnPropertyDescriptor(rows,String(i));
    if(!d||!Object.prototype.hasOwnProperty.call(d,'value'))fail();
    const row=d.value;
    if(!exact(row,FIELDS))fail();
    const kind=read(row,'row_kind');
    if(kind!=='movement'&&kind!=='audit')fail();
    const expectedNull=kind==='movement'?
      ['entity','entity_id','action','detail']:
      ['ingredient_id','qty_delta','move_type','reference_id','note'];
    for(const key of expectedNull)if(read(row,key)!==null)fail();
    const projected=Object.create(null);
    for(const key of kind==='movement'?MOVE:AUDIT)
      projected[key]=read(row,key);
    if(kind==='movement')stock_rows.push(projected);
    else audit_rows.push(projected);
    if(stock_rows.length>2||audit_rows.length>2)fail();
  }
  return {stock_rows,audit_rows};
}

// Caller must supply rows from the above SELECT; this function cannot prove
// provenance, authenticated scope or remote commit. Every verdict is no-retry.
export function reconcileSyntheticD1SupplierReturnAtomicRows(input){
  if(!exact(input,['auth','request','audit_id','rows']))fail();
  const request=read(input,'request');
  if(!plain(request))fail();
  buildSyntheticD1SupplierReturnAtomicSnapshotSelect({
    request_id:read(request,'request_id')
  });
  const parsed=parseRows(read(input,'rows'));
  try{
    return reconcileSyntheticD1SupplierReturnSnapshot({
      auth:read(input,'auth'),request,audit_id:read(input,'audit_id'),...parsed
    });
  }catch{fail();}
}
