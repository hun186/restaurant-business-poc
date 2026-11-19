'use strict';
// All fixtures in-memory; never opens a customer file or calls Cloudflare.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const load=p=>fs.readFileSync(path.join(root,p),'utf8');
const {checkStockV4OfflinePostflight:check}=require('../src/stock-move-v4-readonly-postflight.cjs');
const schema={local:load('db/schema.sql'),d1:load('cloudflare/migrations/0001_initial_v3.sql')};
const proposal=load('db/migration-proposals/0004_stock_move_kinds.sql');
assert.equal(proposal,load('cloudflare/migration-proposals/0004_stock_move_kinds.sql'));
function fixture(t,origin){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema[origin]);
 // D1 bootstrap marker uses CURRENT_TIMESTAMP. Two independent fixtures can
 // straddle a one-second boundary on slower Windows CI; pin synthetic time.
 if(origin==='d1')db.exec("UPDATE cloud_schema_contract SET created_at='2025-01-01 00:00:00' WHERE id=1");
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-a','測試門市');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('ingredient-a','FAKE-A','虛構品項','公斤');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)')
  .run('owner-a','fake-owner','測試業主','owner','salt','hash','2025-01-01 01:00:00');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('move-a','ingredient-a','store-a',3.5,'purchase','po-a','進貨','owner-a','2025-01-01 02:00:00');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('move-b','ingredient-a','store-a',-0.5,'usage',null,'已耗用','owner-a','2025-01-01 03:00:00');
 db.prepare('INSERT INTO audit_logs(id,at,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('audit-a','2025-01-01 04:00:00','owner-a','測試業主','stock.usage','stock_moves','move-b','store-a','{}');
 db.prepare('INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('price-a','ingredient-a','store-a','2025-01-01',5000,'公斤','假供應商','manual','owner-a','2025-01-01 04:00:00');
 return db;
}
function migrate(db,sql=proposal){
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(sql);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
}
const snapshot=db=>({
  audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
  prices:db.prepare('SELECT * FROM ingredient_prices ORDER BY id').all(),
  ledger:db.prepare('SELECT * FROM stock_moves ORDER BY id').all()
});
for(const origin of ['local','d1']){
 test(origin+' postflight proves every legacy row unchanged, with only count metadata',t=>{
  const before=fixture(t,origin),after=fixture(t,origin),prior=snapshot(after);
  migrate(after);
  const wrapped=db=>({prepare(sql){
    assert.match(sql,/^(?:SELECT|PRAGMA)\b/i);
    return db.prepare(sql);
  }});
  const r=check(wrapped(before),wrapped(after),origin);
  assert.equal(r.status,'OFFLINE_STOCK_V4_POSTFLIGHT_PASS');
  assert.equal(r.origin,origin);assert.equal(r.original_ledger_rows,2);
  assert.equal(r.writes_performed,false);
  assert.equal(r.migration_authorized,false);
  assert.equal(r.remote_d1_verified,false);
  assert(!Object.hasOwn(r,'rows')&&!Object.hasOwn(r,'user'));
  assert.deepEqual(snapshot(after),prior);
 });
 test(origin+' accepts CRLF source SQL as semantically identical without weakening DDL',t=>{
  const before=fixture(t,origin),after=fixture(t,origin);
  const windowsSql=proposal.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n');
  migrate(after,windowsSql);
  assert.equal(check(before,after,origin).status,'OFFLINE_STOCK_V4_POSTFLIGHT_PASS');
 });
 test(origin+' detects historical ledger, audit and price changes',t=>{
  const before=fixture(t,origin),after=fixture(t,origin);migrate(after);
  after.exec("UPDATE stock_moves SET note='改過' WHERE id='move-a'");
  assert.throws(()=>check(before,after,origin),/HISTORICAL_ROW_MISMATCH/);
  after.exec("UPDATE stock_moves SET note='進貨' WHERE id='move-a'");
  after.exec("UPDATE audit_logs SET detail='changed' WHERE id='audit-a'");
  assert.throws(()=>check(before,after,origin),/HISTORICAL_ROW_MISMATCH/);
  after.exec("UPDATE audit_logs SET detail='{}' WHERE id='audit-a'");
  after.exec("UPDATE ingredient_prices SET price_cents=9999 WHERE id='price-a'");
  assert.throws(()=>check(before,after,origin),/HISTORICAL_ROW_MISMATCH/);
 });
 test(origin+' rejects absent/modified markers, schema drift and remaining v4 table',t=>{
  const before=fixture(t,origin),after=fixture(t,origin);
  assert.throws(()=>check(before,after,origin),/TABLE_INVENTORY/);
  migrate(after);
  after.exec('DELETE FROM stock_move_kind_contract WHERE id=1');
  assert.throws(()=>check(before,after,origin),/MARKER/);
  after.exec('INSERT INTO stock_move_kind_contract(id,kind_version) VALUES(1,4)');
  after.exec('DROP INDEX stock_moves_stock');
  assert.throws(()=>check(before,after,origin),/INDEX/);
  after.exec('CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id)');
  after.exec('CREATE TABLE stock_moves_v4(id TEXT PRIMARY KEY)');
  assert.throws(()=>check(before,after,origin),/TABLE_INVENTORY|PARTIAL_MIGRATION/);
 });
 test(origin+' rejects unverified historical schema rather than reporting success',t=>{
  const before=fixture(t,origin),after=fixture(t,origin);
  before.exec('ALTER TABLE stock_moves ADD COLUMN unsafe TEXT');
  migrate(after);
  assert.throws(()=>check(before,after,origin),/E_STOCK_MOVE_PREFLIGHT_/);
  assert.throws(()=>check(after,after,origin),/INVALID_INPUT/);
  assert.throws(()=>check(null,after,origin),/INVALID_INPUT/);
 });
 test(origin+' rejects weaker ledger CHECK, altered marker DDL and partial index',t=>{
  const mutations=[
    [proposal.replace('qty_delta < 0 AND length(trim(note)) BETWEEN 1 AND 300',
      '(qty_delta < 0 AND length(trim(note)) BETWEEN 1 AND 300 OR 1)'),/V4_DDL/],
    [proposal.replace('kind_version INTEGER NOT NULL CHECK(kind_version=4),',
      'kind_version INTEGER NOT NULL CHECK(kind_version=4), extra TEXT,'),/MARKER_DDL/],
    [proposal.replace('CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id);',
      'CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id) WHERE qty_delta>0;'),/INDEX_DDL/]
  ];
  for(const [mutated,error] of mutations){
    assert.notEqual(mutated,proposal);
    const before=fixture(t,origin),after=fixture(t,origin);
    migrate(after,mutated);
    assert.throws(()=>check(before,after,origin),error);
  }
 });
 test(origin+' rejects TEMP shadowing of main history before comparison',t=>{
  const before=fixture(t,origin),after=fixture(t,origin);migrate(after);
  after.exec('CREATE TEMP TABLE audit_logs AS SELECT * FROM main.audit_logs');
  after.exec("UPDATE main.audit_logs SET detail='tampered' WHERE id='audit-a'");
  assert.throws(()=>check(before,after,origin),/TEMP_SCHEMA/);
 });
 test(origin+' refuses Infinity rather than collapsing it to JSON null',t=>{
  const before=fixture(t,origin),after=fixture(t,origin);
  before.exec("UPDATE main.stock_moves SET qty_delta=1e999 WHERE id='move-a'");
  after.exec("UPDATE main.stock_moves SET qty_delta=1e999 WHERE id='move-a'");
  migrate(after);
  after.exec("UPDATE main.stock_moves SET qty_delta=-1e999 WHERE id='move-a'");
  assert.throws(()=>check(before,after,origin),/NONFINITE_NUMBER/);
 });
 test(origin+' masks underlying SQL exceptions from client-facing result',t=>{
  const before=fixture(t,origin),after=fixture(t,origin);migrate(after);
  const unsafe={prepare(){throw Error('CONFIDENTIAL_MARKER_FROM_DB');}};
  assert.throws(()=>check(before,unsafe,origin),
    e=>e.message==='E_STOCK_V4_POSTFLIGHT_SQL_READ_FAILED'&&!e.message.includes('CONFIDENTIAL'));
 });
}
