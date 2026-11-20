'use strict';
// Public status exposes release Gate booleans, NEVER D1 data or actual keys.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const worker=import('../cloudflare/worker.mjs');
async function status(env={},method='GET'){
 const request=new Request('https://restaurant.example.workers.dev/api/native/status',{method});
 const result=await (await worker).default.fetch(request,env);
 return {code:result.status,json:await result.json(),headers:result.headers};
}
function fixture(){
 const db={prepare(){throw Error('status must not query D1')},
  batch(){throw Error('status must not write D1')}};
 return {DB:db,CLOUD_AUTH_PHASE:'native-production',CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  NATIVE_AUTH_SOURCE_PEPPER:'synthetic-pepper-that-is-never-exposed-32-characters'};
}
test('legacy status remains available but v4 Gates are explicitly false by default',async()=>{
 const none=await status();
 assert.equal(none.code,200);assert.equal(none.json.mode,'demo');
 assert.equal(none.json.login_enabled,false);
 assert.equal(none.json.stock_v4_gate_enabled,false);
 assert.equal(none.json.supplier_return_gate_enabled,false);
 const native=await status(fixture());
 assert.equal(native.code,200);assert.equal(native.json.mode,'native');
 assert.equal(native.json.login_enabled,true);
 assert.equal(native.json.stock_v4_gate_enabled,false);
 assert.equal(native.json.supplier_return_gate_enabled,false);
 for(const key of ['task_write_enabled','catalog_write_enabled','order_write_enabled',
  'stocktake_write_enabled','repair_write_enabled','price_write_enabled','stock_usage_write_enabled'])
  assert.equal(native.json[key],false,key+' legacy status remains present');
});
test('stock adjustment and supplier-return release Gate statuses remain independent',async()=>{
 for(const [v4,ret,expected] of [
  [undefined,undefined,[false,false]],
  ['operator-released',undefined,[true,false]],
  [undefined,'operator-released',[false,true]],
  ['operator-released','operator-released',[true,true]],
  ['operator-released','disabled',[true,false]],
  ['disabled','operator-released',[false,true]]
 ]){
  const env={...fixture(),CLOUD_NATIVE_STOCK_V4_WRITE_GATE:v4,
   CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:ret};
  const res=await status(env);assert.equal(res.code,200);
  assert.equal(res.json.stock_v4_gate_enabled,expected[0]);
  assert.equal(res.json.supplier_return_gate_enabled,expected[1]);
  assert(!JSON.stringify(res.json).includes('synthetic-pepper'));
 }
});
test('disabled login always reports release Gates off and status does not claim schema readiness',async()=>{
 const env={...fixture(),CLOUD_AUTH_PHASE:'disabled',
  CLOUD_NATIVE_STOCK_V4_WRITE_GATE:'operator-released',
  CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:'operator-released'};
 const res=await status(env);
 assert.equal(res.json.mode,'demo');
 assert.equal(res.json.login_enabled,false);
 assert.equal(res.json.stock_v4_gate_enabled,false);
 assert.equal(res.json.supplier_return_gate_enabled,false);
 assert.equal(res.json.stock_v4_schema_ready,undefined);
 assert.equal(res.json.supplier_return_schema_ready,undefined);
 assert.equal((await status(env,'POST')).code,405);
 const workerSource=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
 assert.match(workerSource,/stock_v4_gate_enabled:nativeStockV4WriteEnabled\(env\)/);
 assert.match(workerSource,/supplier_return_gate_enabled:nativeStockReturnWriteEnabled\(env\)/);
});
