'use strict';
// Synthetic shapes only. No Cloudflare credential, production database or write.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const loader=import('../src/stock-v4-d1-return-reconcile.mjs');
const reconcile=async x=>(await loader).reconcileSyntheticD1SupplierReturnSnapshot(x);
const U={
 actor:'00000000-0000-4000-8000-000000000004',
 store:'00000000-0000-4000-8000-000000000001',
 ingredient:'00000000-0000-4000-8000-000000000003',
 po:'00000000-0000-4000-8000-000000000007',
 req:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 audit:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
};
function fixture(){
 const stock={id:U.req,ingredient_id:U.ingredient,location_id:U.store,
  qty_delta:-2,move_type:'supplier_return',reference_id:U.po,
  note:'damaged goods',actor_id:U.actor};
 const audit={id:U.audit,entity:'stock_moves',entity_id:U.req,
  action:'stock.supplier_return',actor_id:U.actor,location_id:U.store,
  detail:JSON.stringify({ingredient_id:U.ingredient,qty_delta:-2,reference_id:U.po})};
 return {auth:{actor_id:U.actor,token_hash:'a'.repeat(64),csrf:'x'.repeat(16)},
  request:{request_id:U.req,action:'stock.supplier_return',
   data:{ingredient_id:U.ingredient,location_id:U.store,
    reference_id:U.po,qty:2,reason:'damaged goods'}},
  audit_id:U.audit,stock_rows:[stock],audit_rows:[audit]};
}
test('matching ledger and audit are snapshot evidence, never remote commit proof',async()=>{
 const result=await reconcile(fixture());
 assert.equal(result.status,'SYNTHETIC_RETURN_MATCHED_IN_SNAPSHOT');
 assert.equal(result.transaction_committed_verified,false);
 assert.equal(result.remote_d1_verified,false);
 assert.equal(result.safe_to_retry,false);
 assert.equal(result.production_write_authorized,false);
 assert(Object.isFrozen(result));
});
test('absence never authorizes automatic retry of an ambiguous batch',async()=>{
 const x=fixture();x.stock_rows=[];x.audit_rows=[];
 const result=await reconcile(x);
 assert.equal(result.status,'SYNTHETIC_RETURN_ABSENT_IN_SNAPSHOT_NO_RETRY');
 assert.equal(result.safe_to_retry,false);
});
test('partial ledger/audit, duplicates and unrelated rows are indeterminate',async()=>{
 for(const change of [
  x=>{x.audit_rows=[];},
  x=>{x.stock_rows=[];},
  x=>{x.stock_rows.push({...x.stock_rows[0]});},
  x=>{x.audit_rows.push({...x.audit_rows[0]});},
  x=>{x.stock_rows[0].id=U.audit;},
  x=>{x.audit_rows[0].entity_id=U.audit;},
  x=>{x.stock_rows[0].qty_delta=-3;},
  x=>{x.stock_rows[0].reference_id=U.req;},
  x=>{x.stock_rows[0].actor_id=U.store;},
  x=>{x.stock_rows[0].move_type='usage';},
  x=>{x.audit_rows[0].action='stock.usage';},
  x=>{x.audit_rows[0].actor_id=U.store;},
  x=>{x.audit_rows[0].detail='not-json';},
  x=>{x.audit_rows[0].detail=JSON.stringify({ingredient_id:U.ingredient,qty_delta:-1,reference_id:U.po});}
 ]){
  const x=fixture();change(x);
  const result=await reconcile(x);
  assert.equal(result.status,'SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY');
  assert.equal(result.safe_to_retry,false);
 }
});
test('malformed snapshots and payloads fail closed without reading accessors',async()=>{
 for(const change of [
  x=>{x.stock_rows=null;},
  x=>{x.audit_rows=new Array(1);},
  x=>{x.stock_rows=[{}, {}, {}];},
  x=>{x.request.action='stock.usage';},
  x=>{x.auth.csrf='bad';},
  x=>{x.extra='unexpected';}
 ]){
  const x=fixture();change(x);
  await assert.rejects(()=>reconcile(x),/E_STOCK_V4_RECONCILE_INVALID/);
 }
 let called=0;
 const x=fixture();
 Object.defineProperty(x,'stock_rows',{get(){called++;throw Error('leak');}});
 await assert.rejects(()=>reconcile(x),/E_STOCK_V4_RECONCILE_INVALID/);
 assert.equal(called,0);
});
test('future reconciliation is absent from all active runtimes and schema',()=>{
 for(const p of ['src/service.js','cloudflare/worker.mjs','vercel-demo/mock.js']){
  assert.doesNotMatch(fs.readFileSync(path.join(root,p),'utf8'),/stock-v4-d1-return-reconcile/);
 }
 assert.doesNotMatch(fs.readFileSync(path.join(root,
  'cloudflare/migrations/0001_initial_v3.sql'),'utf8'),/supplier_return|scrap/);
});
