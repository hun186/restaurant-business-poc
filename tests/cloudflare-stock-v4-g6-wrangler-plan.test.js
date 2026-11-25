'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const imported=import('../tools/cloudflare-stock-v4-g6-wrangler-plan.mjs');
const model=import('../tools/cloudflare-stock-v4-g6-migration-plan.mjs');
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
test('fixed Wrangler inputs are deterministic, immutable, and receipts expose no SQL or target',async()=>{
 const m=await imported,plan=m.buildG6WranglerInputs();
 assert.deepEqual(plan.map(x=>[x.order,x.kind,x.files.map(f=>f.name)]),[
  [1,'migrations',['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql']],
  [2,'synthetic-seed',['v3-synthetic-history.sql']],
  [3,'migrations',['0004_stock_move_kinds.sql']],
  [4,'synthetic-seed',['v4-synthetic-history.sql']]
 ]);
 assert.deepEqual(plan,m.buildG6WranglerInputs());
 assert.ok(Object.isFrozen(plan));
 for(const p of plan){
  assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.files));
  for(const f of p.files){
   assert.ok(Object.isFrozen(f));assert.equal(f.sha256,hash(f.sql));
   assert.equal(f.bytes,Buffer.byteLength(f.sql,'utf8'));
   assert.doesNotMatch(f.sql.replace(/^--.*$/gm,''),/\b(?:BEGIN IMMEDIATE|COMMIT|CREATE TEMP TABLE)\b/i);
   assert.doesNotMatch(f.sql,/INSERT INTO d1_migrations/i);
  }
 }
 const r=m.g6WranglerInputReceipt();
 assert.equal(r.remote_execution_authorized,false);
 assert.equal(r.cloudflare_requests_made,0);
 assert.equal(r.exclusive_use_verified,false);
 assert.doesNotMatch(JSON.stringify(r),/909037ca|g6-fixture|CREATE TABLE|INSERT INTO|CLOUDFLARE_API_TOKEN/);
 assert.deepEqual(r.stages.map(p=>p.files.map(f=>f.sha256)),plan.map(p=>p.files.map(f=>f.sha256)));
 for(const x of [undefined,null,{},'remote',plan]){
  assert.throws(()=>m.buildG6WranglerInputs(x),/E_G6_WRANGLER_INPUT_CONTRACT/);
  assert.throws(()=>m.g6WranglerInputReceipt(x),/E_G6_WRANGLER_INPUT_CONTRACT/);
 }
});
test('same v4 input preserves full reviewed precondition and never self-records receipt',async t=>{
 const p=(await imported).buildG6WranglerInputs(),local=(await model).buildG6SyntheticPlan();
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec(local[0].sql);
 const upgrade=p[2].files[0].sql;
 assert.match(upgrade,/CREATE TABLE g6_v3_before_upgrade_guard/);
 assert.match(upgrade,/DROP TABLE g6_v3_before_upgrade_guard;/);
 db.exec('BEGIN IMMEDIATE;');
 assert.throws(()=>db.exec(upgrade),/CHECK constraint failed/);
 db.exec('ROLLBACK;');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='stock_move_kind_contract'").get().n,0);
 db.exec(p[1].files[0].sql);
 db.exec('BEGIN IMMEDIATE;');db.exec(upgrade);db.exec('COMMIT;');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM d1_migrations').get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_moves').get().n,2);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='g6_v3_before_upgrade_guard'").get().n,0);
 db.exec(p[3].files[0].sql);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM stock_moves').get().n,5);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
