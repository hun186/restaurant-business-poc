'use strict';
// Synthetic D1 SQL exports only. This test NEVER contacts Cloudflare,
// opens a real database, imports credentials or executes a live migration.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..'),mod=import('../tools/cloudflare-prod-d1-encrypted-backup.mjs');
const initial=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const indexes=fs.readFileSync(path.join(root,'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8');
const upgrade=fs.readFileSync(path.join(root,'cloudflare/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
assert.equal(upgrade,fs.readFileSync(path.join(root,'db/migration-proposals/0004_stock_move_kinds.sql'),'utf8'));
assert.equal(upgrade,fs.readFileSync(path.join(root,'cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql'),'utf8'));
const legacy=initial+'\n'+indexes+'\n'+[
 'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL);',
 "INSERT INTO d1_migrations(id,name) VALUES(1,'0001_initial_v3.sql');",
 "INSERT INTO d1_migrations(id,name) VALUES(2,'0002_login_attempts_window_indexes.sql');",
 "INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES('owner-id','owner','Synthetic Owner','owner','"+'b'.repeat(32)+"','pbkdf2-sha256$100000$"+'a'.repeat(64)+"',1);",
 "INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail) VALUES('bootstrap','production-bootstrap','auth.owner_bootstrap','users','owner-id','{\"hash_version\":\"pbkdf2-sha256$100000\"}');",
 "INSERT INTO locations(id,name,active) VALUES('store1','Fake store',1);",
 "INSERT INTO ingredients(id,sku,name,unit,min_stock,active) VALUES('item1','FAKE-ITEM','Fake ingredient','kg',0,1);",
 "INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES('purchase1','item1','store1',10,'purchase','owner-id');",
 "INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES('usage1','item1','store1',-2,'usage','owner-id');",
 "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,detail) VALUES('synthetic-login','owner-id','owner','auth.login','sessions','{}');",
 "INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES('synthetic-token','synthetic-csrf','owner-id','2030-01-01');"
].join('\n');
const migrated=legacy+'\n'+upgrade+'\n'+[
 "INSERT INTO d1_migrations(id,name) VALUES(3,'0004_stock_move_kinds.sql');",
 "INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,note,actor_id) VALUES('scrap1','item1','store1',-1,'scrap','spoiled stock','owner-id');",
 "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES('stock-scrap-audit','owner-id','owner','stock.scrap','stock_moves','scrap1','store1','{}');"
].join('\n');
const password='synthetic-operational-backup-password-123';
test('D1 v3 operational backup behavior remains unchanged and initial archive stays strict',async()=>{
 const m=await mod;
 const v3=m.verifyLocalSql(legacy,{operational:true});
 assert.equal(v3.schema_version,3);
 assert.equal(v3.stock_ledger_version,3);
 assert.equal(v3.applied_migrations,2);
 assert.equal(v3.owner_count,1);
 assert.equal(v3.business_data_present,true);
 assert.throws(()=>m.verifyLocalSql(migrated),e=>e.message==='E_PRODUCTION_D1_BACKUP',
  'a v4 export must never become valid as a legacy/initial-only snapshot');
});
test('D1 v4 operational backup accepts exact operator-migrated stock ledger and verifies both independent archives',async t=>{
 const m=await mod,checked=m.verifyLocalSql(migrated,{operational:true});
 assert.equal(checked.schema_version,3,'underlying cloud_schema_contract stays at 3');
 assert.equal(checked.stock_ledger_version,4);
 assert.equal(checked.applied_migrations,3);
 assert.equal(checked.operational_backup,true);
 assert.equal(checked.owner_count,1);
 assert.equal(checked.business_data_present,true);
 assert.equal(checked.production_restore_performed,false);
 const bytes=m.encryptSql(migrated,password,{operational:true});
 assert.equal(m.decryptSql(bytes,password),migrated);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-d1-stock-backup-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const source=path.join(dir,'synthetic-original.sql.aes'),copy=path.join(dir,'synthetic-copy.sql.aes');
 fs.writeFileSync(source,bytes,{flag:'wx',mode:0o600});fs.copyFileSync(source,copy);
 const first=m.verifyArchive(source,password);
 assert.equal(first.stock_ledger_version,4);
 assert.equal(first.local_sqlite_replay_verified,true);
 assert.equal(first.production_write_performed,false);
 const independent=m.verifyIndependentCopy(source,copy,password);
 assert.equal(independent.stock_ledger_version,4);
 assert.equal(independent.copy_matches_source,true);
 assert.equal(independent.remote_restore_rehearsal_verified,false);
 assert.equal(independent.external_storage_attestation_required,true);
});
test('D1 v4 partial schema, weakened CHECKs and forged marker are rejected',async()=>{
 const m=await mod;
 const bogusMarker=legacy+'\n'+[
  "CREATE TABLE stock_move_kind_contract (id INTEGER PRIMARY KEY CHECK(id=1),kind_version INTEGER NOT NULL CHECK(kind_version=4),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);",
  "INSERT INTO stock_move_kind_contract(id,kind_version) VALUES(1,4);"
 ].join('\n');
 const weaker=upgrade.replace('qty_delta < 0 AND length(trim(note)) BETWEEN 1 AND 300',
  '(qty_delta < 0 AND length(trim(note)) BETWEEN 1 AND 300 OR 1)');
 const weakerIndex=upgrade.replace('CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id);',
  'CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id) WHERE qty_delta>0;');
 const alteredMarker=upgrade.replace(
  'kind_version INTEGER NOT NULL CHECK(kind_version=4),',
  'kind_version INTEGER NOT NULL CHECK(kind_version=4), extra TEXT,');
 for(const [name,sql] of [
  ['marker-without-v4',bogusMarker],
  ['weaker-stock-check',legacy+'\n'+weaker],
  ['partial-index',legacy+'\n'+weakerIndex],
  ['marker-schema-drift',legacy+'\n'+alteredMarker],
  ['extra-unrecognized-table',migrated+'\nCREATE TABLE unauthorized_table(id INTEGER);'],
  ['missing-marker-row',migrated+'\nDELETE FROM stock_move_kind_contract;'],
  ['missing-migration-receipt',migrated+'\nDELETE FROM d1_migrations WHERE id=3;'],
  ['wrong-migration-receipt',migrated.replace('0004_stock_move_kinds.sql','0004_fake_migration.sql')],
  ['duplicate-migration-receipt',migrated+'\nINSERT INTO d1_migrations(id,name) VALUES(4,\'0004_stock_move_kinds.sql\');'],
  ['v3-proposal-without-versioned-apply',legacy+'\n'+upgrade],
  ['wrong-d1-user-version',migrated+'\nPRAGMA user_version=4;']
 ]){
  assert.throws(()=>m.verifyLocalSql(sql,{operational:true}),
   e=>e.message==='E_PRODUCTION_D1_BACKUP','fail closed: '+name);
 }
});
test('reject v4 schema with deleted index and without authentic exact D1 migration ledger',async()=>{
 const m=await mod;
 for(const sql of [
  migrated+'\nDROP INDEX stock_moves_stock;',
  migrated.replace("VALUES(2,'0002_login_attempts_window_indexes.sql')",
   "VALUES(2,'fake_migration.sql')"),
  legacy+"\nINSERT INTO d1_migrations(id,name) VALUES(3,'0004_stock_move_kinds.sql');", // v3 schema cannot claim v4
  migrated.replace("CHECK(move_type IN ('purchase','usage','adjustment','supplier_return','scrap'))",
   "CHECK(move_type IN ('purchase','usage','adjustment','supplier_return','scrap','fake'))")
 ]){
  assert.throws(()=>m.verifyLocalSql(sql,{operational:true}),/E_PRODUCTION_D1_BACKUP/);
 }
});
