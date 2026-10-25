'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const { pathToFileURL }=require('node:url');
const root=path.resolve(__dirname,'..');

function fixture(){
  const worker=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  const stage=JSON.parse(fs.readFileSync(path.join(root,'wrangler.preview-migrations.jsonc'),'utf8'));
  return [worker,stage];
}
const wrapped=results=>[{success:true,results}];
test('staging guard allows only expected D1 and rejects prod-ID substitution',async()=>{
  const mod=await import(pathToFileURL(path.join(root,'tools/check-cloudflare-staging.mjs')).href);
  const [worker,staging]=fixture();
  assert.equal(mod.verifyStagingConfig(worker,staging),true);
  assert.notEqual(mod.PROD_ID,mod.STAGING_ID);
  const wrong=structuredClone(staging);
  wrong.d1_databases[0].database_id=mod.PROD_ID;
  assert.throws(()=>mod.verifyStagingConfig(worker,wrong),/E_D1_STAGING/);
  const wrongPreview=structuredClone(worker);
  wrongPreview.previews.d1_databases[0].database_id=mod.PROD_ID;
  assert.throws(()=>mod.verifyStagingConfig(wrongPreview,staging),/E_D1_STAGING/);
});

test('staging preflight rejects any prior business table, migration ledger or bad JSON',async()=>{
  const mod=await import(pathToFileURL(path.join(root,'tools/check-cloudflare-staging.mjs')).href);
  assert.doesNotThrow(()=>mod.assertEmptyTarget(wrapped([])));
  for(const tableName of ['users','d1_migrations','stock_moves']){
    assert.throws(()=>mod.assertEmptyTarget(wrapped([{name:tableName}])),/already contains tables/);
  }
  assert.throws(()=>mod.assertEmptyTarget({error:'unauthorized'}),/unexpected Wrangler JSON/);
  assert.throws(()=>mod.assertEmptyTarget([{success:false,results:[]}]),/unexpected Wrangler JSON/);
});

test('staging post-migration verification requires complete schema, ledger, zero owners, zero FK errors',async()=>{
  const mod=await import(pathToFileURL(path.join(root,'tools/check-cloudflare-staging.mjs')).href);
  const ddl=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
  const names=[...ddl.matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(x=>x[1]);
  const all=wrapped([...names,'d1_migrations'].map(name=>({name})));
  const contract=wrapped([{contract_version:3}]);
  const fk=wrapped([]);
  const owner=wrapped([{count:0}]);
  assert.equal(mod.assertInstalledSchema(all,contract,fk,owner),true);
  assert.throws(()=>mod.assertInstalledSchema(wrapped([{name:'d1_migrations'}]),contract,fk,owner),/missing migrated table/);
  assert.throws(()=>mod.assertInstalledSchema(all,contract,wrapped([{table:'users'}]),owner),/foreign key/);
  assert.throws(()=>mod.assertInstalledSchema(all,wrapped([{contract_version:2}]),fk,owner),/contract mismatch/);
  assert.throws(()=>mod.assertInstalledSchema(all,contract,fk,wrapped([{count:1}])),/unexpectedly created users/);
});

test('manual GitHub staging workflow has no PR/push trigger and never invokes PROD migration',()=>{
  const yml=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-migration.yml'),'utf8');
  assert.match(yml,/workflow_dispatch:/);
  assert.doesNotMatch(yml,/^\s*(push|pull_request):/m);
  assert.match(yml,/github\.ref == 'refs\/heads\/main'/);
  assert.match(yml,/inputs\.confirm == 'APPLY_STAGING_ONLY'/);
  assert.match(yml,/environment: d1-staging/);
  assert.match(yml,/node tools\/check-cloudflare-staging\.mjs preflight/);
  assert.match(yml,/migrations apply STAGING_DB --remote --config wrangler\.preview-migrations\.jsonc/);
  assert.doesNotMatch(yml,/migrations apply DB\s/);
  assert.doesNotMatch(yml,/--config wrangler\.jsonc/);
});
