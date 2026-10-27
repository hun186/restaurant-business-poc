'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));

test('Workers D1 production and PR Preview are bound to different existing databases',()=>{
  const config=read('wrangler.jsonc');
  const [prod]=config.d1_databases||[];
  const [stage]=config.previews?.d1_databases||[];
  assert.equal(config.d1_databases.length,1);
  assert.equal(config.previews.d1_databases.length,1);
  assert.equal(prod.binding,'DB');
  assert.equal(prod.database_name,'restaurant-business-prod');
  assert.equal(stage.binding,'DB');
  assert.equal(stage.database_name,'restaurant-business-staging');
  const isUuid=id=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
  assert.ok(isUuid(prod.database_id),'production must have an actual D1 UUID');
  assert.ok(isUuid(stage.database_id),'Preview must have an actual D1 UUID');
  assert.notEqual(prod.database_id,stage.database_id,
    'PR Previews must NEVER point at owner production data');
  assert.equal(prod.migrations_dir,'cloudflare/migrations');
  assert.equal(config.assets.directory,'./vercel-demo');
  assert.deepEqual(config.assets.run_worker_first,['/api/*']);
  assert.equal(config.main,'./cloudflare/worker.mjs');
  assert.equal(config.previews.d1_databases[0].migrations_dir,undefined,
    'staging migrations must be performed separately, not by Preview Builds');
});

test('dedicated staging migration config can never target production D1',()=>{
  const live=read('wrangler.jsonc');
  const helper=read('wrangler.preview-migrations.jsonc');
  assert.equal(helper.d1_databases?.length,1);
  const [db]=helper.d1_databases;
  const [preview]=live.previews.d1_databases;
  const [production]=live.d1_databases;
  assert.equal(db.binding,'STAGING_DB');
  assert.equal(db.database_name,'restaurant-business-staging');
  assert.equal(db.database_id,preview.database_id);
  assert.notEqual(db.database_id,production.database_id);
  assert.equal(db.migrations_dir,'cloudflare/migrations');
  assert.ok(!('previews' in helper));
});
