'use strict';
// Synthetic, in-memory SQLite only. This never calls Cloudflare or opens customer data.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const SCHEMA={local:read('db/schema.sql'),d1:read('cloudflare/migrations/0001_initial_v3.sql')};
const localProposal=read('db/migration-proposals/0004_stock_move_kinds.sql');
const d1Proposal=read('cloudflare/migration-proposals/0004_stock_move_kinds.sql');
const stripComments=sql=>sql.replace(/^\s*--.*$/gm,'');
const statements=sql=>stripComments(sql).split(';').map(x=>x.trim()).filter(Boolean);
function fixture(t,origin){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(SCHEMA[origin]);
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-a','測試門市');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run('ingredient-a','FAKE-A','測試食材','公斤');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)')
   .run('owner-a','owner-test','測試業主','owner','salt','hash','2025-01-01 01:00:00');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run('move-a','ingredient-a','store-a',4,'purchase','order-a','已驗收','owner-a','2025-01-01 02:00:00');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
   .run('move-b','ingredient-a','store-a',-0.125,'usage',null,'備料耗用','owner-a','2025-01-02 02:00:00');
 db.prepare('INSERT INTO audit_logs(id,at,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?,?)')
   .run('audit-a','2025-01-03 03:00:00','owner-a','測試業主','stock.usage','stock_moves','move-b','store-a','{}');
 db.prepare('INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .run('price-a','ingredient-a','store-a','2025-01-01',10000,'公斤','測試供應商','manual','owner-a','2025-01-01 03:00:00');
 return db;
}
const rows=(db,sql)=>db.prepare(sql).all();
const snapshot=db=>({
 schema:rows(db,"SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name"),
 moves:rows(db,'SELECT * FROM stock_moves ORDER BY id'),
 audit:rows(db,'SELECT * FROM audit_logs ORDER BY id'),
 prices:rows(db,'SELECT * FROM ingredient_prices ORDER BY id'),
 users:rows(db,'SELECT * FROM users ORDER BY id'),
 stores:rows(db,'SELECT * FROM locations ORDER BY id'),
 ingredients:rows(db,'SELECT * FROM ingredients ORDER BY id'),
 version:rows(db,'PRAGMA user_version')
});
function integrity(db){
 assert.equal(rows(db,'PRAGMA quick_check(1)')[0]?.quick_check,'ok');
 assert.deepEqual(rows(db,'PRAGMA foreign_key_check'),[]);
 assert.equal(rows(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('stock_move_kind_contract','stock_moves_v4')")[0].n,0);
 assert.equal(rows(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='stock_moves_stock'")[0].n,1);
}
test('inactive SQL proposals remain byte-identical and contain 7 controlled stages',()=>{
 assert.equal(localProposal,d1Proposal);
 const steps=statements(localProposal);
 assert.equal(steps.length,7);
 assert.match(steps[0],/^CREATE TABLE stock_move_kind_contract/);
 assert.match(steps[2],/^CREATE TABLE stock_moves_v4/);
 assert.match(steps[3],/^INSERT INTO stock_moves_v4/);
 assert.match(steps[4],/^DROP TABLE stock_moves/);
 assert.match(steps[5],/^ALTER TABLE stock_moves_v4/);
 assert.match(steps[6],/^CREATE INDEX stock_moves_stock/);
 assert.doesNotMatch(SCHEMA.local,/supplier_return|scrap/);
 assert.doesNotMatch(SCHEMA.d1,/supplier_return|scrap/);
});
for(const origin of ['local','d1']){
 test(origin+' rolls back every injected failure boundary without touching historical rows',t=>{
  const steps=statements(origin==='local'?localProposal:d1Proposal);
  for(let stop=0;stop<=steps.length;stop++){
   const db=fixture(t,origin),before=snapshot(db);
   db.exec('BEGIN IMMEDIATE');
   try{
    // Prefix must complete before the deliberate sentinel error can count.
    if(stop)assert.doesNotThrow(
      ()=>db.exec(steps.slice(0,stop).join(';\n')+';'),
      'unexpected migration prefix failure at boundary '+stop);
    assert.throws(
      ()=>db.exec('INSERT INTO deliberately_missing_atomicity_sentinel(x) VALUES(1);'),
      /no such table: (?:main\.)?deliberately_missing_atomicity_sentinel/i,
      'expected sentinel fault at boundary '+stop);
   }finally{
    db.exec('ROLLBACK');
   }
   assert.deepEqual(snapshot(db),before,'full rollback failed at stage '+stop);
   integrity(db);
  }
 });
 test(origin+' demonstrates why unguarded multi-statement migration is unsafe',t=>{
  const db=fixture(t,origin),before=snapshot(db),steps=statements(origin==='local'?localProposal:d1Proposal);
  assert.throws(()=>db.exec(steps.slice(0,3).join(';\n')+';\nINSERT INTO deliberately_missing_atomicity_sentinel(x) VALUES(1);'),/no such table/i);
  // The disposable fixture now contains partial schema; production must NEVER run unguarded.
  assert.notDeepEqual(snapshot(db).schema,before.schema);
  assert.equal(rows(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='stock_move_kind_contract'")[0].n,1);
  assert.equal(rows(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='stock_moves_v4'")[0].n,1);
 });
}
