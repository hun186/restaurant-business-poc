'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..');
const file=p=>fs.readFileSync(path.join(root,p),'utf8');
const sources=['src/stock-move-v4-contract.mjs',
 'cloudflare/stock-move-v4-contract.mjs','vercel-demo/stock-move-v4-contract.mjs'];
const ids={location_id:'00000000-0000-4000-8000-000000000001',
 ingredient_id:'00000000-0000-4000-8000-000000000002',
 reference_id:'00000000-0000-4000-8000-000000000003'};
test('future v4 validation remains inert, byte-identical on all platforms',()=>{
 for(const name of sources.slice(1))assert.equal(file(name),file(sources[0]));
 assert.doesNotMatch(file(sources[0]),/\b(?:fetch|DatabaseSync|localStorage|sessionStorage)\b/);
 assert.match(file('cloudflare/migration-proposals/0004_stock_move_kinds.sql'),/supplier_return/);
 assert.doesNotMatch(file('cloudflare/migrations/0001_initial_v3.sql'),/supplier_return|scrap/);
});
for(const source of sources){
 test(source+' canonicalizes return, scrap and signed adjustments',async()=>{
  const {normalizeStockV4:n,STOCK_V4_ACTIONS,STOCK_V4_CONTRACT_VERSION}=await import('../'+source);
  assert.equal(STOCK_V4_CONTRACT_VERSION,4);
  assert.deepEqual(STOCK_V4_ACTIONS,['stock.supplier_return','stock.scrap','stock.adjust']);
  assert.deepEqual(n('stock.supplier_return',{...ids,qty:0.001,reason:'已驗收品退回供應商'}),{
   ingredient_id:ids.ingredient_id,location_id:ids.location_id,
   move_type:'supplier_return',qty_delta:-0.001,reference_id:ids.reference_id,
   note:'已驗收品退回供應商'});
  assert.deepEqual(n('stock.scrap',{ingredient_id:ids.ingredient_id,
   location_id:ids.location_id,qty:0.3,reason:'過期'}),{
    ingredient_id:ids.ingredient_id,location_id:ids.location_id,
    move_type:'scrap',qty_delta:-0.3,reference_id:null,note:'過期'});
  for(const qty_delta of [-0.2,0.2,1000000,-1000000]){
   const normalized=n('stock.adjust',{ingredient_id:ids.ingredient_id,
     location_id:ids.location_id,qty_delta,reason:'實地盤點'});
   assert.equal(normalized.qty_delta,qty_delta);
   assert.equal(normalized.move_type,'adjustment');
   assert(Object.isFrozen(normalized));
  }
 });
 test(source+' fail-closes invalid inputs with no silent truncation or extra fields',async()=>{
  const {normalizeStockV4:n}=await import('../'+source);
  const good={...ids,qty:1,reason:'破損'};
  const invalid=[
    {...good,role:'owner'}, {...good,reason:''}, {...good,reason:'  '},
    {...good,reason:' 不可留白'}, {...good,reason:'x'.repeat(301)},
    {...good,reason:'line\nbreak'}, {...good,reference_id:null},
    {...good,qty:0},{...good,qty:-1},{...good,qty:0.0001},
    {...good,qty:1000000.001},{...good,qty:'1'},{...good,qty:Infinity},
    {...good,ingredient_id:'not-uuid'}, JSON.parse('{"location_id":"00000000-0000-4000-8000-000000000001","ingredient_id":"00000000-0000-4000-8000-000000000002","reference_id":"00000000-0000-4000-8000-000000000003","qty":1,"reason":"ok","__proto__":{"role":"owner"}}')
  ];
  for(const payload of invalid)assert.throws(
    ()=>n('stock.supplier_return',payload),/E_STOCK_V4_/);
  assert.throws(()=>n('stock.scrap',good),/E_STOCK_V4_FIELDS/);
  assert.throws(()=>n('stock.adjust',{...ids,qty_delta:1,reason:'盤點'}),/E_STOCK_V4_FIELDS/);
  for(const qty_delta of [0,0.0001,-0.0001,1000000.001,-1000000.001,'1',NaN]){
    assert.throws(()=>n('stock.adjust',{ingredient_id:ids.ingredient_id,
      location_id:ids.location_id,qty_delta,reason:'盤點'}),/E_STOCK_V4_QUANTITY/);
  }
  assert.throws(()=>n('stock.return',good),/E_STOCK_V4_ACTION/);
 });
}
