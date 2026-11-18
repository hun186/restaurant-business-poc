'use strict';
// Only synthetic Local/D1-shaped SQLite fixtures, never production D1.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {createSyntheticStockV4MemoryDb:createMemory,
 executeSyntheticSupplierReturn:execute}=require('../src/stock-v4-offline-scrap-adjust.cjs');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const schema={local:read('db/schema.sql'),d1:read('cloudflare/migrations/0001_initial_v3.sql')};
const proposal=read('db/migration-proposals/0004_stock_move_kinds.sql');
const U={store:'00000000-0000-4000-8000-000000000001',
 other:'00000000-0000-4000-8000-000000000002',
 ingredient:'00000000-0000-4000-8000-000000000003',
 owner:'00000000-0000-4000-8000-000000000004',
 manager:'00000000-0000-4000-8000-000000000005',
 staff:'00000000-0000-4000-8000-000000000006',
 po:'00000000-0000-4000-8000-000000000007',
 req:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 req2:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
function fixture(t,origin){
 const db=createMemory();t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema[origin]);
 for(const [id,name] of [[U.store,'假店A'],[U.other,'假店B']])
   db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run(U.ingredient,'SYNTHETIC-ONLY','假食材','kg');
 for(const [id,role] of [[U.owner,'owner'],[U.manager,'manager'],[U.staff,'staff']])
   db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
     .run(id,role+'-demo','假'+role,role,'salt','hash');
 db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(U.manager,U.store);
 db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
   .run(U.po,'PO-SYNTH',U.store,U.ingredient,'假供應商',10,'received',U.owner);
 for(const [id,qty,kind,ref] of [
   ['initial-purchase',10,'purchase',U.po],
   ['original-usage',-2,'usage',null]
 ]){
   db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,actor_id) VALUES(?,?,?,?,?,?,?)')
     .run(id,U.ingredient,U.store,qty,kind,ref,U.owner);
 }
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(proposal);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)')
   .run('historical-return',U.ingredient,U.store,-1,'supplier_return',U.po,'已退',U.owner);
 return db;
}
const payload=(qty=2,overrides={})=>({
 action:'stock.supplier_return',actor_id:U.owner,request_id:U.req,
 data:{location_id:U.store,ingredient_id:U.ingredient,
  reference_id:U.po,qty,reason:'退回損壞原料'},...overrides
});
const snapshot=db=>({
 stock:db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),
 audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
 purchase:db.prepare('SELECT * FROM purchase_orders ORDER BY id').all()
});
const onHand=db=>db.prepare('SELECT SUM(qty_delta) AS qty FROM stock_moves WHERE location_id=? AND ingredient_id=?')
 .get(U.store,U.ingredient).qty;
test('runtime modules and live migrations do not import or enable synthetic supplier return',()=>{
 for(const f of ['src/service.js','cloudflare/worker.mjs','vercel-demo/mock.js'])
  assert.doesNotMatch(read(f),/stock-v4-offline-scrap-adjust/);
 assert.doesNotMatch(read('cloudflare/migrations/0001_initial_v3.sql'),/supplier_return|scrap/);
});
for(const origin of ['local','d1']){
 test(origin+' commits verified received-PO supplier debit and matching audit atomically',async t=>{
  const db=fixture(t,origin),before=snapshot(db);
  const result=await execute(db,payload());
  assert.deepEqual({status:result.status,stock:result.stock_remaining_milli,
   receipt:result.receipt_remaining_milli,production:result.production_write_authorized,
   remote:result.remote_d1_verified,synthetic:result.synthetic_only},
   {status:'SYNTHETIC_V4_RETURN_COMMITTED',stock:5000,
    receipt:7000,production:false,remote:false,synthetic:true});
  const after=snapshot(db);
  assert.equal(onHand(db),5);
  assert.equal(after.stock.length,before.stock.length+1);
  assert.equal(after.audit.length,before.audit.length+1);
  assert.deepEqual(after.stock.find(row=>row.id===U.req),
   {...after.stock.find(row=>row.id===U.req)});
  const row=after.stock.find(x=>x.id===U.req);
  assert.equal(row.move_type,'supplier_return');
  assert.equal(row.qty_delta,-2);
  assert.equal(row.reference_id,U.po);
  assert.equal(row.actor_id,U.owner);
  const audit=after.audit.find(x=>x.entity_id===U.req);
  assert.equal(audit.action,'stock.supplier_return');
  assert.equal(audit.location_id,U.store);
  assert.equal(JSON.parse(audit.detail).reference_id,U.po);
  assert.deepEqual(after.purchase,before.purchase);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 });
 test(origin+' enforces idempotence incl UUID case; no ledger or audit on replay',async t=>{
  const db=fixture(t,origin);
  await execute(db,payload(1,{request_id:U.req.toUpperCase()}));
  const after=snapshot(db);
  await assert.rejects(()=>execute(db,payload(3,{request_id:U.req})),/DUPLICATE_REQUEST/);
  assert.deepEqual(snapshot(db),after);
 });
 test(origin+' checks receipt cap AND current stock again on each serialized return',async t=>{
  const db=fixture(t,origin);
  await execute(db,payload(5));
  await execute(db,payload(2,{request_id:U.req2}));
  assert.equal(onHand(db),0);
  const before=snapshot(db);
  await assert.rejects(()=>execute(db,payload(.001,{
   request_id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  })),/BUDGET_REJECTED/);
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' rejects over-receipt, insufficient stock and malformed quantity',async t=>{
  const db=fixture(t,origin),before=snapshot(db);
  await assert.rejects(()=>execute(db,payload(9.001)),/BUDGET_REJECTED/);
  await assert.rejects(()=>execute(db,payload(8)),/BUDGET_REJECTED/);
  await assert.rejects(()=>execute(db,payload(.00001)),/PAYLOAD/);
  await assert.rejects(()=>execute(db,payload(0)),/PAYLOAD/);
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' rejects wrong order, wrong store and missing receipt ledger',async t=>{
  const db=fixture(t,origin);
  const before=snapshot(db);
  await assert.rejects(()=>execute(db,payload(1,{data:{
   ...payload().data,location_id:U.other}})),/RECEIPT_MISMATCH/);
  await assert.rejects(()=>execute(db,payload(1,{data:{
   ...payload().data,reference_id:U.req2}})),/RECEIPT_MISMATCH/);
  assert.deepEqual(snapshot(db),before);
  db.prepare("UPDATE purchase_orders SET status='requested' WHERE id=?").run(U.po);
  await assert.rejects(()=>execute(db,payload()),/RECEIPT_MISMATCH/);
  db.prepare("UPDATE purchase_orders SET status='received' WHERE id=?").run(U.po);
  db.prepare("DELETE FROM stock_moves WHERE id='initial-purchase'").run();
  const erased=snapshot(db);
  await assert.rejects(()=>execute(db,payload()),/RECEIPT_LEDGER_MISMATCH/);
  assert.deepEqual(snapshot(db),erased);
 });
 test(origin+' enforces actor role, store grants and active entities in-transaction',async t=>{
  const db=fixture(t,origin),before=snapshot(db);
  await assert.rejects(()=>execute(db,payload(1,{actor_id:U.staff})),/ACTOR_NOT_ALLOWED/);
  db.prepare('DELETE FROM user_locations WHERE user_id=?').run(U.manager);
  await assert.rejects(()=>execute(db,payload(1,{actor_id:U.manager})),/STORE_FORBIDDEN/);
  db.prepare('UPDATE users SET active=0 WHERE id=?').run(U.owner);
  await assert.rejects(()=>execute(db,payload(1)),/ACTOR_NOT_ALLOWED/);
  db.prepare('UPDATE users SET active=1 WHERE id=?').run(U.owner);
  db.prepare('UPDATE locations SET active=0 WHERE id=?').run(U.store);
  await assert.rejects(()=>execute(db,payload(1)),/INACTIVE_SCOPE/);
  db.prepare('UPDATE locations SET active=1 WHERE id=?').run(U.store);
  db.prepare('UPDATE ingredients SET active=0 WHERE id=?').run(U.ingredient);
  await assert.rejects(()=>execute(db,payload(1)),/INACTIVE_SCOPE/);
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' rolls back stock debit on audit failure then supports safe retry',async t=>{
  const db=fixture(t,origin),before=snapshot(db);
  db.exec("CREATE TRIGGER reject_synthetic_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'SYNTH_ONLY_FAILURE'); END");
  await assert.rejects(()=>execute(db,payload(2)),/TRANSACTION_FAILED/);
  assert.deepEqual(snapshot(db),before);
  db.exec('DROP TRIGGER reject_synthetic_audit');
  const result=await execute(db,payload(2));
  assert.equal(result.stock_remaining_milli,5000);
 });
 test(origin+' concurrent same-connection submissions cannot double debit',async t=>{
  const db=fixture(t,origin);
  const results=await Promise.allSettled([execute(db,payload(3)),execute(db,payload(3))]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected').length,1);
  assert.equal(onHand(db),4);
  assert.equal(snapshot(db).audit.length,1);
 });
 test(origin+' rejects inconsistent quantity history and unavailable v4 contract',async t=>{
  const db=fixture(t,origin);
  db.prepare("UPDATE stock_moves SET qty_delta=0.00001 WHERE id='initial-purchase'").run();
  await assert.rejects(()=>execute(db,payload(1)),/HISTORICAL_PRECISION/);
  db.prepare("UPDATE stock_moves SET qty_delta=10 WHERE id='initial-purchase'").run();
  db.exec('DROP TABLE stock_move_kind_contract');
  await assert.rejects(()=>execute(db,payload(1)),/READ_FAILED|V4_SCHEMA_NOT_READY/);
 });
}
test('disk, external-memory and attached DBs cannot enter supplier-return executor',async t=>{
 const disk=new DatabaseSync('');t.after(()=>disk.close());
 await assert.rejects(()=>execute(disk,payload()),/UNTRUSTED_DB/);
 const external=new DatabaseSync(':memory:');t.after(()=>external.close());
 await assert.rejects(()=>execute(external,payload()),/UNTRUSTED_DB/);
 const db=fixture(t,'local');
 db.exec("ATTACH DATABASE ':memory:' AS foreign_schema");
 await assert.rejects(()=>execute(db,payload()),/NON_EPHEMERAL_DB/);
});
