'use strict';
// Synthetic pure domain safety: never opens SQLite, Cloudflare or live inventory.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const modules=['src/stock-return-budget.mjs','cloudflare/stock-return-budget.mjs',
 'vercel-demo/stock-return-budget.mjs'];
test('all three planned backend budget validators share exact bytes and cannot write',()=>{
 for(const name of modules.slice(1))assert.equal(read(name),read(modules[0]));
 assert.doesNotMatch(read(modules[0]),/\b(?:fetch|DatabaseSync|localStorage|sessionStorage)\b/);
 assert.match(read('cloudflare/migration-proposals/0004_stock_move_kinds.sql'),/supplier_return/);
 assert.doesNotMatch(read('cloudflare/migrations/0001_initial_v3.sql'),/supplier_return/);
});
for(const name of modules){
 test(name+' validates exact 0.001 integer quantities and cumulative receipt limit',async()=>{
  const {assertSupplierReturnBudget:f,RETURN_BUDGET_SCALE,RETURN_BUDGET_MAX_MILLI}=
    await import('../'+name);
  assert.equal(RETURN_BUDGET_SCALE,1000);
  assert.equal(RETURN_BUDGET_MAX_MILLI,1000000000);
  const result=f({received_milli:300,already_returned_milli:100,
   available_stock_milli:200,requested_milli:200});
  assert.equal(result.approved_milli,200);
  assert.equal(result.receipt_remaining_milli,0);
  assert.equal(result.stock_remaining_milli,0);
  assert.equal(result.writes_performed,false);
  assert.equal(result.transaction_authorized,false);
  assert.equal(result.remote_d1_verified,false);
  assert(Object.isFrozen(result));
  assert.equal(f({received_milli:1000000000,already_returned_milli:999999999,
    available_stock_milli:1,requested_milli:1}).receipt_remaining_milli,0);
 });
 test(name+' rejects overspend, negative balance, duplicate and untrusted shape',async()=>{
  const {assertSupplierReturnBudget:f}=await import('../'+name);
  const input={received_milli:300,already_returned_milli:100,
    available_stock_milli:200,requested_milli:200};
  const invalid=[
    [{...input,requested_milli:201},/EXCEEDS_RECEIPT/],
    [{...input,already_returned_milli:301},/INCONSISTENT_HISTORY/],
    [{...input,available_stock_milli:199},/INSUFFICIENT_STOCK/],
    [{...input,requested_milli:0},/QUANTITY/],
    [{...input,requested_milli:-1},/QUANTITY/],
    [{...input,requested_milli:0.001},/QUANTITY/],
    [{...input,requested_milli:'1'},/QUANTITY/],
    [{...input,received_milli:Infinity},/QUANTITY/],
    [{...input,available_stock_milli:-1},/QUANTITY/],
    [{...input,received_milli:1000000001},/QUANTITY/],
    [{...input,requested_milli:1000000001},/QUANTITY/],
    [{...input,role:'owner'},/FIELDS/],
    [{...input,reference_id:'bad'},/FIELDS/],
    [JSON.parse('{"received_milli":300,"already_returned_milli":100,"available_stock_milli":200,"requested_milli":100,"__proto__":{"admin":true}}'),/FIELDS/],
    [[],/FIELDS/],[null,/FIELDS/]
  ];
  for(const [payload,reason] of invalid)assert.throws(()=>f(payload),reason);
 });
}
