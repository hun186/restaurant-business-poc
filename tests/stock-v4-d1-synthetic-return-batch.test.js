'use strict';
// No Cloudflare network/credentials; SQLite synthetic D1 v3->proposed v4 only.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const loader=import('../src/stock-v4-d1-synthetic-return-batch.mjs');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const schema=read('cloudflare/migrations/0001_initial_v3.sql');
const proposal=read('cloudflare/migration-proposals/0004_stock_move_kinds.sql');
const U={store:'00000000-0000-4000-8000-000000000001',
 other:'00000000-0000-4000-8000-000000000002',
 ingredient:'00000000-0000-4000-8000-000000000003',
 owner:'00000000-0000-4000-8000-000000000004',
 manager:'00000000-0000-4000-8000-000000000005',
 staff:'00000000-0000-4000-8000-000000000006',
 po:'00000000-0000-4000-8000-000000000007',
 key:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 key2:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 audit:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'};
const token='a'.repeat(64),csrf='a_fake_csrf_for_test_only';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema);
 for(const [id,name] of [[U.store,'虛構店A'],[U.other,'虛構店B']])
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(U.ingredient,'FICT-001','虛構食材','kg');
 for(const [id,role] of [[U.owner,'owner'],[U.manager,'manager'],[U.staff,'staff']])
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(id,role+'-test','合成'+role,role,'salt','hash');
 db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(U.manager,U.store);
 db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
  .run(token,csrf,U.owner,'2999-01-01T00:00:00.000Z');
 db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
  .run(U.po,'PO-FAKE',U.store,U.ingredient,'假供應商',10,'received',U.owner);
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,actor_id) VALUES(?,?,?,?,?,?,?)')
  .run('historical-purchase',U.ingredient,U.store,10,'purchase',U.po,U.owner);
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
  .run('historical-usage',U.ingredient,U.store,-2,'usage',U.owner);
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(proposal);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)')
  .run('historical-return',U.ingredient,U.store,-1,'supplier_return',U.po,'過去退貨',U.owner);
 return db;
}
function payload(qty=2,overrides={}){
 return {auth:{actor_id:U.owner,token_hash:token,csrf},
  request:{request_id:U.key,action:'stock.supplier_return',data:{
   ingredient_id:U.ingredient,location_id:U.store,
   reference_id:U.po,qty,reason:'瑕疵品退回'}},
  audit_id:U.audit,...overrides};
}
const snapshot=db=>({
 moves:db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),
 audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),
 po:db.prepare('SELECT * FROM purchase_orders ORDER BY id').all()
});
function batch(db,plan,{before,failAt}={}){
 if(before)before();
 db.exec('BEGIN IMMEDIATE');
 try{
  const result=[];
  for(let i=0;i<plan.statements.length;i++){
   if(failAt===i)throw Error('INJECTED_AUDIT_FAILURE');
   const s=plan.statements[i];
   result.push(db.prepare(s.sql).run(...s.args).changes);
  }
  assert.deepEqual(result,plan.expected_changes);
  db.exec('COMMIT');return result;
 }catch(err){db.exec('ROLLBACK');throw err;}
}
const build=async x=>(await loader).buildSyntheticD1SupplierReturnBatch(x);
test('plan has NO runtime imports and active D1 schema is unchanged',()=>{
 for(const p of ['src/service.js','cloudflare/worker.mjs','vercel-demo/mock.js'])
  assert.doesNotMatch(read(p),/stock-v4-d1-synthetic-return-batch/);
 assert.doesNotMatch(read('cloudflare/migrations/0001_initial_v3.sql'),/supplier_return|scrap/);
});
test('proposed D1 SQL atomically inserts exact negative movement and matching audit',async t=>{
 const db=fixture(t),before=snapshot(db),plan=await build(payload());
 assert.equal(plan.synthetic_only,true);assert.equal(plan.remote_d1_verified,false);
 assert.equal(plan.production_write_authorized,false);assert(Object.isFrozen(plan));
 assert.equal(plan.statements.length,2);assert.deepEqual(plan.expected_changes,[1,1]);
 assert.deepEqual(batch(db,plan),[1,1]);
 const after=snapshot(db),move=after.moves.find(x=>x.id===U.key);
 assert.equal(after.moves.length,before.moves.length+1);
 assert.equal(after.audit.length,before.audit.length+1);
 assert.equal(move.qty_delta,-2);assert.equal(move.move_type,'supplier_return');
 assert.equal(move.reference_id,U.po);assert.equal(move.actor_id,U.owner);
 const audit=after.audit.find(x=>x.entity_id===U.key);
 assert.equal(audit.action,'stock.supplier_return');
 assert.equal(JSON.parse(audit.detail).reference_id,U.po);
 assert.deepEqual(before.po,after.po);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
});
test('duplicate and uppercase UUID replay cannot double debit',async t=>{
 const db=fixture(t),first=payload();
 first.request.request_id=U.key.toUpperCase();
 batch(db,await build(first));
 const before=snapshot(db),second=payload();
 second.audit_id=U.key2;
 const replayPlan=await build(second);
 assert.throws(()=>batch(db,replayPlan),/constraint/i);
 assert.deepEqual(snapshot(db),before);
});

test('prior supplier return cap, available stock and late stock debits fail closed',async t=>{
 const db=fixture(t),q=await build(payload(2)),before=snapshot(db);
 assert.throws(()=>batch(db,q,{before:()=>{
  db.prepare("UPDATE stock_moves SET qty_delta=-7 WHERE id='historical-usage'").run();
 }}),/constraint/i);
 assert.equal(snapshot(db).moves.length,before.moves.length);
 assert.equal(snapshot(db).audit.length,0);
 const onHand=db.prepare('SELECT SUM(qty_delta) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?')
  .get(U.ingredient,U.store).n;
 assert.equal(onHand,2);
});
test('invalid received PO, mismatched history and cross-store returns reject with rollback',async t=>{
 const db=fixture(t),q=await build(payload());
 db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(U.po);
 const b=snapshot(db);assert.throws(()=>batch(db,q),/constraint/i);assert.deepEqual(snapshot(db),b);
 db.prepare("UPDATE purchase_orders SET status='received' WHERE id=?").run(U.po);
 db.prepare("UPDATE stock_moves SET qty_delta=9 WHERE id='historical-purchase'").run();
 const c=snapshot(db);assert.throws(()=>batch(db,q),/constraint/i);assert.deepEqual(snapshot(db),c);
 db.prepare("UPDATE stock_moves SET qty_delta=10 WHERE id='historical-purchase'").run();
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note) VALUES(?,?,?,?,?,?,?)')
  .run('wrong-store-return',U.ingredient,U.other,-1,'supplier_return',U.po,'wrong store');
 const d=snapshot(db);assert.throws(()=>batch(db,q),/constraint/i);assert.deepEqual(snapshot(db),d);
});
test('expired session, wrong CSRF, disabled actor and denied Manager reject',async t=>{
 const db=fixture(t),original=await build(payload());
 const badCsrf=payload();badCsrf.auth.csrf='wrong-but-long-csrf';
 const before=snapshot(db),invalidPlan=await build(badCsrf);
 assert.throws(()=>batch(db,invalidPlan),/constraint/i);
 db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();
 assert.throws(()=>batch(db,original),/constraint/i);
 db.prepare("UPDATE sessions SET expires_at='2999-01-01T00:00:00.000Z'").run();
 db.prepare("UPDATE users SET active=0 WHERE id=?").run(U.owner);
 assert.throws(()=>batch(db,original),/constraint/i);
 db.prepare("UPDATE users SET active=1 WHERE id=?").run(U.owner);
 db.prepare('UPDATE sessions SET user_id=?').run(U.manager);
 const manager=payload();manager.auth.actor_id=U.manager;
 db.prepare('DELETE FROM user_locations WHERE user_id=?').run(U.manager);
 const managerPlan=await build(manager);
 assert.throws(()=>batch(db,managerPlan),/constraint/i);
 assert.deepEqual(snapshot(db),before);
});
test('bad audit insert rolls back valid movement and preserves original purchase order',async t=>{
 const db=fixture(t),q=await build(payload()),before=snapshot(db);
 db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'SYNTH_FAIL'); END");
 assert.throws(()=>batch(db,q),/SYNTH_FAIL/);
 assert.deepEqual(snapshot(db),before);
 db.exec('DROP TRIGGER reject_audit');
 assert.deepEqual(batch(db,q),[1,1]);
});
test('bad payload, fake auth, missing v4 marker fail before or during atomic batch',async t=>{
 const db=fixture(t),bad=payload();
 bad.request.data.qty=0;
 await assert.rejects(()=>build(bad),/E_STOCK_V4_D1_PLAN_INVALID/);
 const invalid=payload();invalid.auth.csrf='short';
 await assert.rejects(()=>build(invalid),/E_STOCK_V4_D1_PLAN_INVALID/);
 const q=await build(payload());
 db.exec('DROP TABLE stock_move_kind_contract');
 const before=snapshot(db);
 assert.throws(()=>batch(db,q),/no such table/i);
 assert.deepEqual(snapshot(db),before);
});
