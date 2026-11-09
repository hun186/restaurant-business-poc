'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const load=import('../src/catalog-crud-contract.mjs');
const source=f=>fs.readFileSync(path.join(root,f),'utf8');
test('one contract defines stable, non-destructive catalog actions for all deployments',async()=>{
 const {CATALOG_RESOURCES,CATALOG_COMMANDS,operationFor}=await load;
 assert.deepEqual(Object.keys(CATALOG_RESOURCES),['ingredients','locations']);
 assert.deepEqual(CATALOG_COMMANDS,[
  'ingredient.create','ingredient.update','ingredient.active',
  'location.create','location.update','location.active']);
 assert(!CATALOG_COMMANDS.some(x=>/delete|drop|remove/i.test(x)));
 for(const type of ['ingredients','locations']){
  assert.equal(CATALOG_RESOURCES[type].deletion,'deactivate');
  assert.equal(operationFor(type,'setActive'),CATALOG_RESOURCES[type].setActive);
 }
 assert.throws(()=>operationFor('users','setActive'),/E_CATALOG_ACTION/);
});
test('shared contract validates exact keys, immutable SKU, CAS snapshot and active transition',async()=>{
 const {normalizeCatalogCommand:n}=await load;
 const ingredient={sku:' A-01 ',name:' 烏龍茶 ',unit:'包',min_stock:0};
 assert.deepEqual(n('ingredient.create',ingredient),
  {sku:'A-01',name:'烏龍茶',unit:'包',min_stock:0});
 assert.deepEqual(n('ingredient.update',{
  id:'i-1',expected:ingredient,changes:{name:'紅茶',unit:'包',min_stock:2}
 }),{id:'i-1',expected:{sku:'A-01',name:'烏龍茶',unit:'包',min_stock:0},
  changes:{name:'紅茶',unit:'包',min_stock:2}});
 assert.deepEqual(n('location.update',{
  id:'l-1',expected:{name:'A店'},changes:{name:' B店 '}
 }),{id:'l-1',expected:{name:'A店'},changes:{name:'B店'}});
 assert.deepEqual(n('ingredient.active',{id:'i-1',expected_active:1,active:0}),
  {id:'i-1',expected_active:1,active:0});
 assert.throws(()=>n('ingredient.update',{
  id:'i-1',expected:ingredient,changes:{sku:'EDIT',name:'紅茶',unit:'包',min_stock:2}
 }),/E_CATALOG_FIELDS/);
 for(const payload of [
  {sku:'T',name:'X',unit:'kg',min_stock:-1},
  {sku:'T',name:'X',unit:'kg',min_stock:Infinity},
  {sku:'T',name:'X',unit:'kg',min_stock:'2'},
  {sku:'T',name:'X',unit:'kg',min_stock:0,active:1},
  JSON.parse('{"sku":"T","name":"X","unit":"kg","min_stock":0,"__proto__":{"admin":true}}')
 ])assert.throws(()=>n('ingredient.create',payload));
 assert.throws(()=>n('ingredient.active',{id:'i-1',expected_active:1,active:1}),/E_CATALOG_NO_CHANGE/);
 assert.throws(()=>n('location.active',{id:'l-1',expected_active:false,active:true}),/E_CATALOG_ACTIVE/);
 assert.throws(()=>n('location.delete',{id:'l-1'}),/E_CATALOG_ACTION/);
});
test('three deployed surfaces are distinct; baseline must not spoof D1 or silently enable writes',()=>{
 const local=source('src/service.js'),demo=source('vercel-demo/mock.js'),
  worker=source('cloudflare/native-catalog-http.mjs'),
  native=source('vercel-demo/owner-app.js'),
  cfg=source('wrangler.jsonc');
 for(const text of [local,demo,worker])assert.match(text,/ingredient\.create/);
 assert.match(local,/location\.create/);
 assert.match(demo,/location\.create/);
 assert.match(worker,/location\.create/);
 assert.match(worker,/CLOUD_NATIVE_CATALOG_WRITE_GATE==='operator-released'/);
 assert.match(native,/catalogWriteEnabled=status\.catalog_write_enabled===true/);
 assert.doesNotMatch(native,/mock\.js|sessionStorage|localStorage/);
 assert.match(cfg,/"CLOUD_AUTH_PHASE": "disabled"/);
});

test('Cloudflare-only catalog mirror is byte-identical to canonical source',()=>{
 assert.equal(source('cloudflare/catalog-crud-contract.mjs'),source('src/catalog-crud-contract.mjs'));
});
