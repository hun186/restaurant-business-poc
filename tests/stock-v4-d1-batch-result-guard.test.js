'use strict';
// Pure shapes only. No user secrets, production D1, Cloudflare or local files.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const modulePromise=import('../src/stock-v4-d1-batch-result-guard.mjs');
const verify=async x=>(await modulePromise).assertSyntheticD1SupplierReturnBatchResult(x);
const valid=()=>[{success:true,meta:{changes:1,rows_written:1}},
 {success:true,meta:{changes:1,rows_written:1}}];
test('valid D1-shaped response has two exact changes, but NEVER claims remote commit',async()=>{
 const result=await verify(valid());
 assert.equal(result.status,'SYNTHETIC_D1_BATCH_RESPONSE_SHAPE_PASS');
 assert.equal(result.stock_move_changes,1);
 assert.equal(result.audit_changes,1);
 assert.equal(result.transaction_committed_verified,false);
 assert.equal(result.remote_d1_verified,false);
 assert.equal(result.production_write_authorized,false);
 assert.equal(result.synthetic_only,true);
 assert(Object.isFrozen(result));
});
test('flat changes or consistent flat and nested counts are accepted',async()=>{
 assert.equal((await verify([{changes:1},{changes:1}])).audit_changes,1);
 assert.equal((await verify([
  {meta:{changes:1},changes:1},
  {meta:{changes:1},changes:1}
 ])).stock_move_changes,1);
});
test('missing/short/long/invalid batch result is always rejected',async()=>{
 for(const x of [null,undefined,{},[],[{}],[{},{}],
  [{success:true,meta:{changes:1}}],valid().concat(valid()),'success',
  0,true,{results:valid()}]){
  await assert.rejects(()=>verify(x),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 }
});
test('acceptance requires BOTH movement and audit, never audit-only',async()=>{
 for(const index of [0,1]){
  for(const bad of [0,2,-1,1.5,'1',null,undefined,NaN,Infinity]){
   const x=valid();
   x[index]={success:true,meta:{changes:bad}};
   await assert.rejects(()=>verify(x),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/,
    'Rejected index '+index+' bad '+String(bad));
  }
 }
});
test('failed/missing data and conflicting metadata cannot impersonate success',async()=>{
 const failures=[
  {success:false,meta:{changes:1}},
  {success:null,meta:{changes:1}},
  {success:undefined,meta:{changes:1}},
  {success:'true',meta:{changes:1}},
  {success:true,error:'E_INSERT',meta:{changes:1}},
  {success:true,error:{message:'bad'},meta:{changes:1}},
  {success:true,meta:{changes:1},changes:0},
  {success:true,meta:{changes:0},changes:1},
  {success:true,meta:{changed:1}},
  {success:true,meta:{changes:1},changes:undefined},
  {success:true,meta:{changes:'1'}},
  {success:true,meta:{changes:1},changes:NaN},
  {success:true,meta:null},
  {success:true,meta:[]},
  {success:true,meta:{changes:1.1}}
 ];
 for(const bad of failures){
  for(let i=0;i<2;i++){
   const response=valid();response[i]=bad;
   await assert.rejects(()=>verify(response),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
  }
 }
});
test('accessor properties and nonplain instances reject without invoking getter',async()=>{
 let read=0;
 const malicious={success:true,meta:{get changes(){read++;return 1;}}};
 await assert.rejects(()=>verify([malicious,valid()[1]]),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 assert.equal(read,0);
 const crafted=Object.create({changes:1});
 await assert.rejects(()=>verify([crafted,valid()[1]]),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 await assert.rejects(()=>verify([new Date(),valid()[1]]),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
});
test('guard and synthetic builder are not imported by any live runtime',()=>{
 for(const p of ['src/service.js','cloudflare/worker.mjs','vercel-demo/mock.js']){
  const s=fs.readFileSync(path.join(root,p),'utf8');
  assert.doesNotMatch(s,/stock-v4-d1-batch-result-guard/);
 }
 assert.doesNotMatch(fs.readFileSync(path.join(root,
   'cloudflare/migrations/0001_initial_v3.sql'),'utf8'),/supplier_return|scrap/);
});

test('sparse, inherited and accessor-backed array slots never pass or run getters',async()=>{
 const empty=new Array(2);
 await assert.rejects(()=>verify(empty),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 const sparse=new Array(2);sparse[1]=valid()[1];
 await assert.rejects(()=>verify(sparse),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 const proto=Object.create(Array.prototype);
 Object.defineProperty(proto,'0',{value:valid()[0],writable:true,configurable:true});
 Object.setPrototypeOf(sparse,proto);
 await assert.rejects(()=>verify(sparse),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 let calls=0;
 const getterBacked=valid();
 Object.defineProperty(getterBacked,'0',{get(){calls++;return valid()[0];},configurable:true});
 await assert.rejects(()=>verify(getterBacked),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 assert.equal(calls,0);
 const otherGetter=valid();
 Object.defineProperty(otherGetter,'1',{get(){calls++;return valid()[1];},configurable:true});
 await assert.rejects(()=>verify(otherGetter),/E_STOCK_V4_D1_BATCH_RESULT_INVALID/);
 assert.equal(calls,0);
});
