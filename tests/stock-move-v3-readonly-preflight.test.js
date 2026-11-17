'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {inspectStockMoveV3}=require('../src/stock-move-v3-readonly-preflight.cjs');
const root=path.join(__dirname,'..');
const oldLocal=fs.readFileSync(path.join(root,'db/schema.sql'),'utf8');
const oldD1=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
function setup(t,origin){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(origin==='d1'?oldD1:oldLocal);
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-a','假設門市');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run('ing-a','NO_REAL_DATA','虛構原料','公斤');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run('owner-a','test','虛構業主','owner','salt','hash');
 for(const [id,qty,kind] of [['m1',3,'purchase'],['m2',-1.25,'usage'],['m3',-0.25,'adjustment']])
   db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
     .run(id,'ing-a','store-a',qty,kind,'owner-a');
 return db;
}
const dump=db=>({
  schema:db.prepare("SELECT type,name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").all(),
  ledger:db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),
  users:db.prepare('SELECT id,username,role FROM users').all(),
});
for(const origin of ['local','d1']){
 test(origin+' clean synthetic v3 snapshot is inspected with SELECT/PRAGMA only',t=>{
  const db=setup(t,origin),before=dump(db),queries=[];
  const readonly={
    prepare(sql){
      assert.match(sql,/^(?:SELECT|PRAGMA)\b/i,'preflight must never issue a write: '+sql);
      queries.push(sql);
      return db.prepare(sql);
    }
  };
  const result=inspectStockMoveV3(readonly,origin);
  assert.equal(result.status,'V3_STOCK_MOVE_SOURCE_READONLY_PASS');
  assert.equal(result.existing_contract_version,3);
  assert.equal(result.stock_move_rows,3);
  assert.equal(result.movement_counts.purchase,1);
  assert.equal(result.movement_counts.usage,1);
  assert.equal(result.movement_counts.adjustment,1);
  assert.equal(result.writes_performed,false);
  assert.equal(result.migration_authorized,false);
  assert.equal(result.remote_d1_verified,false);
  assert(queries.length>=8);
  assert.deepEqual(dump(db),before);
 });
 test(origin+' fails closed on schema drift, unexpected indexes and partial migration',t=>{
  const db=setup(t,origin);
  db.exec('ALTER TABLE stock_moves ADD COLUMN unsafe_extra TEXT');
  assert.throws(()=>inspectStockMoveV3(db,origin),/STOCK_SCHEMA_DRIFT/);
 });
 test(origin+' rejects SQL token-boundary and quoted-literal DDL drift even when empty',t=>{
  const baseline=origin==='d1'?oldD1:oldLocal;
  for(const [from,to] of [
    ["note TEXT NOT NULL DEFAULT ''","note TEXT NOT NULL DEFAULT ' '"],
    ["note TEXT NOT NULL DEFAULT ''","note TEXTNOTNULL DEFAULT ''"],
    ["move_type IN ('purchase','usage','adjustment')",
     "move_type IN ('PURCHASE','usage','adjustment')"]
  ]){
    const altered=baseline.replace(from,to);
    assert.notEqual(altered,baseline);
    const db=new DatabaseSync(':memory:');t.after(()=>db.close());
    db.exec(altered);
    assert.throws(()=>inspectStockMoveV3(db,origin),/STOCK_SCHEMA_DRIFT/,
      'source DDL with changed literal must be denied: '+from);
  }
 });
 test(origin+' refuses nonstandard index or preexisting v4 marker',t=>{
  const db=setup(t,origin);
  db.exec('DROP INDEX stock_moves_stock');
  assert.throws(()=>inspectStockMoveV3(db,origin),/STOCK_INDEX_DRIFT/);
  db.exec('CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id)');
  db.exec('CREATE TABLE stock_move_kind_contract(id INTEGER PRIMARY KEY,kind_version INTEGER)');
  db.exec('INSERT INTO stock_move_kind_contract(id,kind_version) VALUES(1,4)');
  assert.throws(()=>inspectStockMoveV3(db,origin),/PARTIAL_OR_ALREADY_MIGRATED/);
 });
 test(origin+' rejects mixed-case partial migration marker table names',t=>{
  const db=setup(t,origin);
  db.exec('CREATE TABLE STOCK_MOVE_KIND_CONTRACT(id INTEGER PRIMARY KEY,kind_version INTEGER)');
  assert.throws(()=>inspectStockMoveV3(db,origin),/PARTIAL_OR_ALREADY_MIGRATED/);
  db.exec('DROP TABLE STOCK_MOVE_KIND_CONTRACT');
  db.exec('CREATE TABLE StoCk_MoVeS_v4(id TEXT PRIMARY KEY)');
  assert.throws(()=>inspectStockMoveV3(db,origin),/PARTIAL_OR_ALREADY_MIGRATED/);
 });
 test(origin+' fails closed when view or index collides with the v4 migration marker',t=>{
  for(const sql of [
    'CREATE VIEW stock_move_kind_contract AS SELECT 1 AS id',
    'CREATE INDEX stock_move_kind_contract ON locations(id)',
    'CREATE VIEW StoCk_MoVeS_v4 AS SELECT 1 AS id',
    'CREATE INDEX StoCk_MoVeS_v4 ON locations(id)'
  ]){
    const db=setup(t,origin);
    db.exec(sql);
    assert.throws(()=>inspectStockMoveV3(db,origin),/PARTIAL_OR_ALREADY_MIGRATED/);
  }
 });
 test(origin+' rejects sqliteX prefixed tables that refer to stock_moves via FK',t=>{
  const db=setup(t,origin);
  db.exec('CREATE TABLE sqliteX_links(move_id TEXT REFERENCES stock_moves(id))');
  assert.throws(()=>inspectStockMoveV3(db,origin),/INCOMING_FOREIGN_KEY/);
 });
 test(origin+' refuses dependent views, triggers and incoming foreign keys',t=>{
  const db=setup(t,origin);
  db.exec('CREATE VIEW suspicious AS SELECT * FROM stock_moves');
  assert.throws(()=>inspectStockMoveV3(db,origin),/STOCK_VIEWS/);
  db.exec('DROP VIEW suspicious');
  db.exec('CREATE TRIGGER suspicious AFTER INSERT ON stock_moves BEGIN SELECT 1; END');
  assert.throws(()=>inspectStockMoveV3(db,origin),/STOCK_TRIGGERS/);
  db.exec('DROP TRIGGER suspicious');
  db.exec('CREATE TRIGGER dependent AFTER UPDATE ON locations BEGIN SELECT COUNT(*) FROM stock_moves; END');
  assert.throws(()=>inspectStockMoveV3(db,origin),/STOCK_TRIGGERS/);
  db.exec('DROP TRIGGER dependent');
  db.exec('CREATE TABLE linked(move_id TEXT NOT NULL REFERENCES stock_moves(id))');
  assert.throws(()=>inspectStockMoveV3(db,origin),/INCOMING_FOREIGN_KEY/);
 });
 test(origin+' rejects orphan foreign keys without changing the snapshot',t=>{
  const db=setup(t,origin);
  db.exec('PRAGMA foreign_keys=OFF');
  db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)')
    .run('orphan','missing-ingredient','store-a',-1,'usage');
  db.exec('PRAGMA foreign_keys=ON');
  const before=dump(db);
  assert.throws(()=>inspectStockMoveV3(db,origin),/FOREIGN_KEY/);
  assert.deepEqual(dump(db),before);
 });
}
test('Local source requires exact schema v3, D1 must have valid contract marker',t=>{
 const local=setup(t,'local');
 assert.throws(()=>inspectStockMoveV3(local,'d1'),/D1_USER_VERSION/);
 local.exec('PRAGMA user_version=5');
 assert.throws(()=>inspectStockMoveV3(local,'local'),/LOCAL_SCHEMA_VERSION/);
 const d1=setup(t,'d1');
 assert.throws(()=>inspectStockMoveV3(d1,'local'),/LOCAL_SCHEMA_VERSION/);
 d1.exec('DELETE FROM cloud_schema_contract WHERE id=1');
 assert.throws(()=>inspectStockMoveV3(d1,'d1'),/D1_SCHEMA_VERSION/);
});
test('invalid arguments do not throw raw SQL errors or expose business data',t=>{
 const db=setup(t,'local');
 assert.throws(()=>inspectStockMoveV3(null,'local'),/INVALID_INPUT/);
 assert.throws(()=>inspectStockMoveV3(db,'not-production'),/INVALID_INPUT/);
 assert.throws(()=>inspectStockMoveV3({prepare(){throw Error('sensitive secret');}},'d1'),
   e=>e.message==='E_STOCK_MOVE_PREFLIGHT_SQL_READ_FAILED'&&!e.message.includes('sensitive'));
 assert.throws(()=>inspectStockMoveV3({prepare(){return {all(){return null;}};}},'local'),
   /SQL_READ_FAILED/);
});
