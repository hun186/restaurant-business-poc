'use strict';
// Deployment configuration regression: do not let CI re-disable operator-set
// Production login, and do not implicitly enable a login/write permission.
// No Cloudflare credentials, HTTP, D1 SQL or deployment actions in this test.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));

test('Wrangler preserves Dashboard-controlled Production runtime gates on future code deploys',()=>{
 assert.equal(config.name,'restaurant-business-poc');
 assert.equal(config.keep_vars,true,'do not delete Dashboard environment vars on deploy');
 assert.equal(Object.hasOwn(config,'vars'),false,
  'Production runtime gates must be operator-controlled, not hardcoded in source');
 assert.equal(config.previews?.vars?.CLOUD_AUTH_PHASE,'preview-readonly');
 assert.equal(config.previews?.d1_databases?.[0]?.database_name,'restaurant-business-staging');
 assert.equal(config.d1_databases?.[0]?.database_name,'restaurant-business-prod');
 assert.equal(config.d1_databases?.[0]?.binding,'DB');
 assert.equal(config.workers_dev,true);
});
test('missing Production gates remain fail closed even when keep_vars is enabled',async()=>{
 const {nativeLoginEnabled}=await import('../cloudflare/native-login-http.mjs');
 const {nativeTaskWriteEnabled}=await import('../cloudflare/native-task-http.mjs');
 const {nativeCatalogWriteEnabled}=await import('../cloudflare/native-catalog-http.mjs');
 const {nativeOrderWriteEnabled}=await import('../cloudflare/native-order-http.mjs');
 const {nativeStocktakeWriteEnabled}=await import('../cloudflare/native-stocktake-http.mjs');
 const {nativeRepairWriteEnabled}=await import('../cloudflare/native-repair-http.mjs');
 const funcs=[nativeLoginEnabled,nativeTaskWriteEnabled,nativeCatalogWriteEnabled,
   nativeOrderWriteEnabled,nativeStocktakeWriteEnabled,nativeRepairWriteEnabled];
 const DB={prepare:()=>{},batch:async()=>[]};
 const base={DB,NATIVE_AUTH_SOURCE_PEPPER:'p'.repeat(32)};
 for(const fn of funcs){
  assert.equal(fn(base),false,'missing gates must stay closed');
  assert.equal(fn({...base,CLOUD_AUTH_PHASE:'disabled'}),false);
  assert.equal(fn({...base,CLOUD_AUTH_PHASE:'native-production'}),false);
 }
 const open={...base,CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released'};
 assert.equal(nativeLoginEnabled(open),true);
 for(const fn of funcs.slice(1))assert.equal(fn(open),false,
  'opening login must not implicitly enable a business write');
 assert.equal(nativeCatalogWriteEnabled({...open,
  CLOUD_NATIVE_CATALOG_WRITE_GATE:'operator-released'}),true);
 assert.equal(nativeTaskWriteEnabled({...open,
  CLOUD_NATIVE_TASK_WRITE_GATE:'operator-released'}),true);
 assert.equal(nativeOrderWriteEnabled({...open,
  CLOUD_NATIVE_ORDER_WRITE_GATE:'operator-released'}),true);
 assert.equal(nativeStocktakeWriteEnabled({...open,
  CLOUD_NATIVE_STOCKTAKE_WRITE_GATE:'operator-released'}),true);
 assert.equal(nativeRepairWriteEnabled({...open,
  CLOUD_NATIVE_REPAIR_WRITE_GATE:'operator-released'}),true);
});
