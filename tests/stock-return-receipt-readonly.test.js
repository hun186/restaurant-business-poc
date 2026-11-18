'use strict';
// Synthetic, in-memory SQLite only. Neither Cloudflare nor production data used.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {inspectSupplierReturnFacts:inspect}=require('../src/stock-return-receipt-facts.cjs');
const root=path.join(__dirname,'..');
const read=path=>fs.readFileSync(require('node:path').join(root,path),'utf8');
const schemas={local:read('db/schema.sql'),d1:read('cloudflare/migrations/0001_initial_v3.sql')};
const proposal=read('db/migration-proposals/0004_stock_move_kinds.sql');
const U={store:'00000000-0000-4000-8000-000000000001',
 other:'00000000-0000-4000-8000-000000000002',
 ingredient:'00000000-0000-4000-8000-000000000003',
 user:'00000000-0000-4000-8000-000000000004',
 po:'00000000-0000-4000-8000-000000000005'};
const input=Object.freeze({location_id:U.store,ingredient_id:U.ingredient,
 reference_id:U.po,requested_milli:7000});
function fixture(t,origin){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schemas[origin]);
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(U.store,'虛構店一');
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(U.other,'虛構店二');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(U.ingredient,'TEST-ING','測試食材','公斤');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
  .run(U.user,'test-owner','測試業主','owner','not-a-real-salt','not-a-real-hash');
 db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
  .run(U.po,'PO-TEST',U.store,U.ingredient,'虛構供應商',10,'received',U.user);
 for(const [id,delta,kind,ref,note] of [
  ['purchase-1',10,'purchase',U.po,'已收貨'],
  ['usage-1',-2,'usage',null,'耗用']
 ]){
  db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)')
   .run(id,U.ingredient,U.store,delta,kind,ref,note,U.user);
 }
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(proposal);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)')
  .run('return-1',U.ingredient,U.store,-1,'supplier_return',U.po,'貨損',U.user);
 return db;
}
const snapshot=db=>({
 moves:db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),
 po:db.prepare('SELECT * FROM purchase_orders ORDER BY id').all(),
 logs:db.prepare('SELECT * FROM audit_logs ORDER BY id').all()
});
for(const origin of ['local','d1']){
 test(origin+' accepts a consistent received PO, prior returns, and available stock, without writes',async t=>{
  const db=fixture(t,origin),before=snapshot(db);
  const queries=[];
  const guarded={prepare(sql){assert.match(sql,/^SELECT\b/);queries.push(sql);
   return {all:(...params)=>db.prepare(sql).all(...params)};}};
  const result=await inspect(guarded,input);
  assert.equal(result.status,'OFFLINE_RETURN_FACTS_READONLY_PASS');
  assert.equal(result.receipt_milli,10000);
  assert.equal(result.already_returned_milli,1000);
  assert.equal(result.stock_milli,7000);
  assert.equal(result.approved_milli,7000);
  assert.equal(result.receipt_remaining_milli,2000);
  assert.equal(result.stock_remaining_milli,0);
  assert.equal(result.writes_performed,false);
  assert.equal(result.transaction_authorized,false);
  assert.equal(result.remote_d1_verified,false);
  assert.equal(queries.length,6);
  assert(Object.isFrozen(result));
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' reads D1-compatible bind/all shape but never claims remote attestation',async t=>{
  const db=fixture(t,origin);
  const adapter={prepare(sql){assert.match(sql,/^SELECT\b/);
   return {bind:(...args)=>({all:async()=>({results:db.prepare(sql).all(...args)})})};}};
  const result=await inspect(adapter,input);
  assert.equal(result.stock_milli,7000);
  assert.equal(result.remote_d1_verified,false);
 });
 test(origin+' rejects non-received, inactive or mismatched PO without mutation',async t=>{
  const db=fixture(t,origin);
  db.exec("UPDATE purchase_orders SET status='requested'");
  await assert.rejects(()=>inspect(db,input),/RECEIPT_MISMATCH/);
  db.exec("UPDATE purchase_orders SET status='received',location_id='"+U.other+"'");
  await assert.rejects(()=>inspect(db,input),/RECEIPT_MISMATCH/);
  db.exec("UPDATE purchase_orders SET location_id='"+U.store+"'");
  db.exec("UPDATE locations SET active=0 WHERE id='"+U.store+"'");
  await assert.rejects(()=>inspect(db,input),/INACTIVE_SCOPE/);
  db.exec("UPDATE locations SET active=1 WHERE id='"+U.store+"'");
  db.exec("UPDATE ingredients SET active=0 WHERE id='"+U.ingredient+"'");
  await assert.rejects(()=>inspect(db,input),/INACTIVE_SCOPE/);
 });
 test(origin+' refuses missing/duplicate purchased movement and outside-store returns',async t=>{
  const db=fixture(t,origin);
  db.exec("DELETE FROM stock_moves WHERE id='purchase-1'");
  await assert.rejects(()=>inspect(db,input),/RECEIPT_LEDGER_MISMATCH/);
  db.exec("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES('purchase-1','"+U.ingredient+"','"+U.store+"',10,'purchase','"+U.po+"','收貨','"+U.user+"')");
  db.exec("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES('purchase-2','"+U.ingredient+"','"+U.store+"',10,'purchase','"+U.po+"','重複','"+U.user+"')");
  await assert.rejects(()=>inspect(db,input),/RECEIPT_LEDGER_MISMATCH/);
  db.exec("DELETE FROM stock_moves WHERE id='purchase-2'");
  db.exec("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES('return-x','"+U.ingredient+"','"+U.other+"',-1,'supplier_return','"+U.po+"','錯門市','"+U.user+"')");
  await assert.rejects(()=>inspect(db,input),/RETURN_SCOPE_MISMATCH/);
 });
 test(origin+' forbids over-returning, insufficient stock and historical precision drift',async t=>{
  const db=fixture(t,origin);
  await assert.rejects(()=>inspect(db,{...input,requested_milli:8000}),/BUDGET_REJECTED/);
  db.exec("UPDATE stock_moves SET qty_delta=-9 WHERE id='usage-1'");
  await assert.rejects(()=>inspect(db,input),/BUDGET_REJECTED/);
  db.exec("UPDATE stock_moves SET qty_delta=-2 WHERE id='usage-1'");
  db.exec("UPDATE purchase_orders SET qty=10.00000000001");
  await assert.rejects(()=>inspect(db,input),/HISTORICAL_PRECISION/);
  db.exec("UPDATE purchase_orders SET qty=10");
  db.exec("UPDATE stock_moves SET qty_delta=1e999 WHERE id='purchase-1'");
  await assert.rejects(()=>inspect(db,input),/HISTORICAL_PRECISION/);
 });
 test(origin+' rejects invalid data and absent v4 schema without leaking raw SQL',async t=>{
  const db=fixture(t,origin);
  for(const x of [
   {...input,requested_milli:0},{...input,requested_milli:0.1},
   {...input,requested_milli:Infinity},{...input,ingredient_id:'bad'},
   {...input,role:'owner'},null
  ])await assert.rejects(()=>inspect(db,x),/E_STOCK_RETURN_FACTS_/);
  db.exec('DROP TABLE stock_move_kind_contract');
  await assert.rejects(()=>inspect(db,input),/READ_FAILED/);
  const corrupt={prepare(){throw Error('PRIVATE_ACCOUNT_VALUE_LEAK');}};
  await assert.rejects(()=>inspect(corrupt,input),
    e=>e.message==='E_STOCK_RETURN_FACTS_READ_FAILED');
 });
}
