'use strict';
// This suite is synthetic and offline only. It NEVER opens customer SQLite or D1.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const LOCAL=fs.readFileSync(path.join(root,'db/schema.sql'),'utf8');
const D1=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const proposalLocal=fs.readFileSync(path.join(root,'db/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
const proposalCloud=fs.readFileSync(path.join(root,'cloudflare/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
const KINDS=['purchase','usage','adjustment','supplier_return','scrap'];
const LEDGER_FIELDS='id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at';
const oldKinds=db=>db.prepare('SELECT '+LEDGER_FIELDS+' FROM stock_moves ORDER BY id').all();
const schemaObject=db=>db.prepare("SELECT type,name,sql FROM sqlite_master WHERE (type='table' OR type='index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
const integrity=db=>{
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
};
function seed(db){
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('loc-A','測試店');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run('ingredient-A','TEST-PRICE','米','公斤');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run('user-A','test-owner','測試業主','owner','test-salt','test-hash');
 for(const [id,qty,kind,ref,note,date] of [
   ['m1',10,'purchase','po-1','已核准叫貨驗收','2025-01-01 08:00:00'],
   ['m2',-2,'usage',null,'每日耗用','2025-01-02 09:00:00'],
   ['m3',-0.125,'adjustment','stocktake-1','盤點差額','2025-01-03 10:00:00'],
   ['m4',0.1,'adjustment',null,'期初補登','2025-01-04 11:00:00']
 ])db.prepare(
   'INSERT INTO stock_moves('+LEDGER_FIELDS+') VALUES(?,?,?,?,?,?,?,?,?)')
   .run(id,'ingredient-A','loc-A',qty,kind,ref,note,'user-A',date);
 db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?)")
   .run('audit-A','user-A','測試業主','stock.usage','stock_moves','m2','loc-A','{}');
 db.prepare("INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_by) VALUES(?,?,?,?,?,?,?,?,?)")
   .run('price-A','ingredient-A','loc-A','2025-01-01',6500,'公斤','示範供應商','manual','user-A');
}
function fixture(type){
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec(type==='d1'?D1:LOCAL);
 seed(db);
 return db;
}
function inTransaction(db,sql){
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(sql);db.exec('COMMIT');}
 catch(e){db.exec('ROLLBACK');throw e;}
}
function newMove(db,id,kind,qty,note='',referenceId=null){
 return db.prepare(
   'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)')
   .run(id,'ingredient-A','loc-A',qty,kind,referenceId,note,'user-A');
}

test('proposal is copy-identical between Local and D1; never active or auto-applied',()=>{
 assert.equal(proposalLocal,proposalCloud);
 assert.match(proposalLocal,/OFFLINE PROPOSAL ONLY/);
 assert.doesNotMatch(proposalLocal,/\b(?:DELETE FROM|UPDATE)\s+stock_moves\b/i);
 assert.doesNotMatch(proposalLocal,/\b(?:INSERT\s+INTO\s+(?:users|audit_logs)|DROP\s+TABLE\s+(?:users|audit_logs))\b/i);
 assert.match(proposalLocal,/INSERT INTO stock_moves_v4/);
 assert.match(proposalLocal,/SELECT id,ingredient_id,location_id,qty_delta,move_type/);
 assert.match(proposalLocal,/CREATE INDEX stock_moves_stock/);
 const migrations=fs.readdirSync(path.join(root,'cloudflare/migrations')).filter(n=>n.endsWith('.sql'));
 assert.deepEqual(migrations.sort(),[
  '0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'
 ]);
 assert.doesNotMatch(LOCAL,/supplier_return|scrap/);
 assert.doesNotMatch(D1,/supplier_return|scrap/);
 assert.match(LOCAL,/PRAGMA user_version=3/);
 assert.match(D1,/CHECK\(contract_version=3\)/);
});

for(const type of ['local','d1']){
 test(type+' migration preserves every existing ledger field, other records, contract and indexes',()=>{
  const db=fixture(type);
  try{
   const old=oldKinds(db);
   const priorBalance=db.prepare("SELECT SUM(qty_delta) AS n FROM stock_moves").get().n;
   const audits=db.prepare('SELECT * FROM audit_logs ORDER BY id').all();
   const prices=db.prepare('SELECT * FROM ingredient_prices ORDER BY id').all();
   const priorVersion=db.prepare('PRAGMA user_version').get().user_version;
   integrity(db);
   inTransaction(db,type==='d1'?proposalCloud:proposalLocal);
   assert.deepEqual(oldKinds(db),old);
   assert.equal(db.prepare("SELECT SUM(qty_delta) AS n FROM stock_moves").get().n,priorBalance);
   assert.deepEqual(db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),audits);
   assert.deepEqual(db.prepare('SELECT * FROM ingredient_prices ORDER BY id').all(),prices);
   assert.equal(db.prepare('PRAGMA user_version').get().user_version,priorVersion);
   if(type==='d1')assert.equal(
     db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').get().contract_version,3);
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='stock_moves_v4'").get().n,0);
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='index' AND name='stock_moves_stock'").get().n,1);
   assert.deepEqual(
     db.prepare('PRAGMA index_info(stock_moves_stock)').all().map(r=>r.name),
     ['ingredient_id','location_id']);
   integrity(db);
  }finally{db.close();}
 });
 test(type+' accepts distinct supplier_return and scrap, rejects wrong direction or missing reason',()=>{
  const db=fixture(type);
  try{
   inTransaction(db,type==='d1'?proposalCloud:proposalLocal);
   newMove(db,'m-ret','supplier_return',-1,'退回供應商：包裝損壞','po-1');
   newMove(db,'m-scrap','scrap',-0.5,'逾期報廢');
   assert.equal(db.prepare("SELECT SUM(qty_delta) AS n FROM stock_moves WHERE move_type IN ('supplier_return','scrap')").get().n,-1.5);
   for(const [kind,qty,note,ref] of [
     ['supplier_return',1,'退貨','po-1'],
     ['scrap',1,'報廢',null],
     ['supplier_return',-1,'退貨',null],
     ['supplier_return',-1,' ', 'po-1'],
     ['scrap',-1,'',null],
     ['scrap',-1,'x'.repeat(301),null],
     ['other',-1,'錯誤類別',null],
     ['usage',0,'零異動',null]
   ])assert.throws(()=>newMove(db,'bad-'+kind+'-'+qty+'-'+String(note.length),kind,qty,note,ref),
     /constraint/i,kind+' qty='+qty+' note='+note.slice(0,20));
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM stock_moves").get().n,6);
   integrity(db);
  }finally{db.close();}
 });
 test(type+' rolls back complete schema+history on an injected migration fault',()=>{
  const db=fixture(type);
  try{
   const priorSchema=schemaObject(db),priorMoves=oldKinds(db);
   const bad=(type==='d1'?proposalCloud:proposalLocal).replace(
     'DROP TABLE stock_moves;',
     'INSERT INTO deliberately_missing_table(value) VALUES (1);\nDROP TABLE stock_moves;');
   assert.notEqual(bad,type==='d1'?proposalCloud:proposalLocal);
   assert.throws(()=>inTransaction(db,bad),/no such table/i);
   assert.deepEqual(schemaObject(db),priorSchema);
   assert.deepEqual(oldKinds(db),priorMoves);
   assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='stock_moves_v4'").get().n,0);
   integrity(db);
  }finally{db.close();}
 });
 test(type+' rejects replay of this proposal and keeps already migrated content intact',()=>{
  const db=fixture(type);
  try{
   inTransaction(db,type==='d1'?proposalCloud:proposalLocal);
   newMove(db,'m-ret','supplier_return',-1,'有來源的退貨','po-1');
   const previous=oldKinds(db),before=schemaObject(db);
   assert.throws(()=>inTransaction(db,type==='d1'?proposalCloud:proposalLocal),
     /already exists/i);
   assert.deepEqual(oldKinds(db),previous);
   assert.deepEqual(schemaObject(db),before);
   integrity(db);
  }finally{db.close();}
 });
}
