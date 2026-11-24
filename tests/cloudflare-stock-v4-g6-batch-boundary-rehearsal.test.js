'use strict';
// Offline experiment only. No remote runner, tokens, transport, payload export,
// or external DB inputs. Local BEGIN/COMMIT belong to the test harness only.
// Cloudflare Worker batch rollback is documented; REST rollback is NOT proven.
const test=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const imported=import('../tools/cloudflare-stock-v4-g6-migration-plan.mjs');
const GUARD='g6_v3_before_upgrade_guard';
const deliberateFailure="INSERT INTO d1_migrations(id,name) VALUES(1,'g6-deliberate-failure');";
const rows=(db,sql)=>db.prepare(sql).all().map(r=>({...r}));
function fixture(t,plan,history=true){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec(plan[0].sql);
 if(history)db.exec(plan[1].sql);
 return db;
}
// Test-only adaptation of the exact pinned Stage 3 proposal. Use a normal
// guard table created and dropped within the SAME transaction, rather than
// assuming TEMP support. No arbitrary SQL splitting API is provided.
function statements(plan){
 const sql=plan[2].sql;
 assert.ok(sql.startsWith('BEGIN IMMEDIATE;\n'));
 assert.ok(sql.endsWith('COMMIT;\n'));
 let body=sql.slice('BEGIN IMMEDIATE;\n'.length,-'COMMIT;\n'.length);
 const substitutions=[
  ['CREATE TEMP TABLE '+GUARD+' (','CREATE TABLE '+GUARD+' ('],
  ['INSERT INTO temp.'+GUARD+'(','INSERT INTO '+GUARD+'('],
  ['DROP TABLE temp.'+GUARD+';','DROP TABLE '+GUARD+';']
 ];
 for(const [from,to] of substitutions){
  assert.equal(body.split(from).length,2,'exact reviewed guard boundary');
  body=body.replace(from,to);
 }
 // Known pinned SQL contains no embedded semicolon-newline in strings.
 // Assert exact statement inventory so a source revision fails closed.
 assert.ok(body.endsWith(';\n'));
 const batch=body.slice(0,-2).split(';\n').map(s=>s.trim()+';');
 assert.equal(batch.length,11);
 const kinds=[
  /^CREATE TABLE g6_v3_before_upgrade_guard /,
  /^INSERT INTO g6_v3_before_upgrade_guard\(/,
  /^DROP TABLE g6_v3_before_upgrade_guard;/,
  /CREATE TABLE stock_move_kind_contract \(/,
  /^INSERT INTO stock_move_kind_contract\(/,
  /^CREATE TABLE stock_moves_v4 \(/,
  /^INSERT INTO stock_moves_v4 \(/,
  /^DROP TABLE stock_moves;/,
  /^ALTER TABLE stock_moves_v4 RENAME TO stock_moves;/,
  /^CREATE INDEX stock_moves_stock /,
  /^INSERT INTO d1_migrations\(id,name\) VALUES\(3,'0004_stock_move_kinds.sql'\);$/
 ];
 batch.forEach((s,i)=>assert.match(s,kinds[i]));
 assert.doesNotMatch(batch.join('\n'),/\b(?:BEGIN IMMEDIATE|COMMIT|CREATE TEMP TABLE|temp\.)\b/i);
 return batch;
}
function snapshot(db){
 const schema=rows(db,'SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
 const data=schema.filter(s=>s.type==='table').map(s=>{
  const id='"'+s.name.replaceAll('"','""')+'"';
  const contents=rows(db,'SELECT * FROM '+id).map(r=>JSON.stringify(r)).sort();
  return [s.name,contents];
 });
 return {schema,data,foreignKeys:rows(db,'PRAGMA foreign_key_check'),
  integrity:rows(db,'PRAGMA quick_check')};
}
// Only SQLite :memory: is used; this is a local model, not a D1 response.
function localBatch(db,batch){
 db.exec('BEGIN IMMEDIATE;');
 try{
  for(const sql of batch)db.exec(sql);
  db.exec('COMMIT;');
 }catch(error){
  db.exec('ROLLBACK;');
  throw error;
 }
}
test('G6 Stage 3 local batch experiment preserves v3 ledger and matches reviewed schema',async t=>{
 const plan=(await imported).buildG6SyntheticPlan();
 const db=fixture(t,plan),reference=fixture(t,plan);
 const before=rows(db,'SELECT * FROM stock_moves ORDER BY id');
 const audit=rows(db,'SELECT * FROM audit_logs ORDER BY id');
 const price=rows(db,'SELECT * FROM ingredient_prices ORDER BY id');
 const batch=statements(plan);
 localBatch(db,batch);
 reference.exec(plan[2].sql);
 assert.deepEqual(snapshot(db).schema,snapshot(reference).schema);
 assert.deepEqual(rows(db,'SELECT * FROM stock_moves ORDER BY id'),before);
 assert.deepEqual(rows(db,'SELECT * FROM audit_logs ORDER BY id'),audit);
 assert.deepEqual(rows(db,'SELECT * FROM ingredient_prices ORDER BY id'),price);
 assert.deepEqual(rows(db,'SELECT id,name FROM d1_migrations ORDER BY id'),rows(reference,'SELECT id,name FROM d1_migrations ORDER BY id'));
 assert.equal(rows(db,'SELECT kind_version FROM stock_move_kind_contract')[0].kind_version,4);
 assert.deepEqual(rows(db,'PRAGMA foreign_key_check'),[]);
 assert.equal(rows(db,'PRAGMA quick_check')[0].quick_check,'ok');
 assert.equal(snapshot(db).schema.some(s=>s.name===GUARD||s.name==='stock_moves_v4'),false);
 const committed=snapshot(db);
 assert.throws(()=>localBatch(db,batch));
 assert.deepEqual(snapshot(db),committed,'no mutation on replay rejection');
});
test('G6 local rollback restores full schema and data at every Stage 3 statement boundary',async t=>{
 const plan=(await imported).buildG6SyntheticPlan(),batch=statements(plan);
 // Includes failure immediately before first statement and after final
 // migration receipt, before COMMIT. The duplicate PK is a real DML error.
 for(let boundary=0;boundary<=batch.length;boundary++){
  const db=fixture(t,plan),before=snapshot(db);
  assert.throws(()=>localBatch(db,[...batch.slice(0,boundary),deliberateFailure,...batch.slice(boundary)]),
   /UNIQUE constraint failed: d1_migrations.id/i,'boundary '+boundary);
  assert.deepEqual(snapshot(db),before,'all schema/data restored at boundary '+boundary);
 }
});
test('G6 persistent transaction-local guard rejects missing or changed v3 history without mutation',async t=>{
 const plan=(await imported).buildG6SyntheticPlan(),batch=statements(plan);
 const changes=[
  [false,()=>{}],
  [true,db=>db.exec("UPDATE stock_moves SET note='tampered' WHERE id='g6-m02';")],
  [true,db=>db.exec("UPDATE audit_logs SET at='1999-01-01 00:00:00' WHERE id='g6-audit-01';")],
  [true,db=>db.exec("DELETE FROM d1_migrations WHERE id=2;")]
 ];
 for(const [history,change] of changes){
  const db=fixture(t,plan,history);change(db);
  const before=snapshot(db);
  assert.throws(()=>localBatch(db,batch),/CHECK constraint failed/i);
  assert.deepEqual(snapshot(db),before);
 }
});
