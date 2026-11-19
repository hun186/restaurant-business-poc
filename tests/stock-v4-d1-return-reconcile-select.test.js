'use strict';
// Offline disposable SQLite only. Does not contact any Cloudflare database.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const load=import('../src/stock-v4-d1-return-reconcile-select.mjs');
const matcher=import('../src/stock-v4-d1-return-reconcile.mjs');
const U={req:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
 audit:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
 actor:'00000000-0000-4000-8000-000000000004',
 store:'00000000-0000-4000-8000-000000000001',
 ingredient:'00000000-0000-4000-8000-000000000003',
 po:'00000000-0000-4000-8000-000000000007'};
function db(t){
 const d=new DatabaseSync(':memory:');t.after(()=>d.close());
 d.exec('CREATE TABLE stock_moves(id TEXT PRIMARY KEY,ingredient_id TEXT,location_id TEXT,qty_delta REAL,move_type TEXT,reference_id TEXT,note TEXT,actor_id TEXT)');
 d.exec('CREATE TABLE audit_logs(id TEXT PRIMARY KEY,entity TEXT,entity_id TEXT,action TEXT,actor_id TEXT,location_id TEXT,detail TEXT)');
 return d;
}
const plan=async id=>(await load).buildSyntheticD1SupplierReturnReconcileSelects({request_id:id});
function add(d){
 d.prepare('INSERT INTO stock_moves VALUES(?,?,?,?,?,?,?,?)').run(
  U.req,U.ingredient,U.store,-2,'supplier_return',U.po,'damaged goods',U.actor);
 d.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)').run(
  U.audit,'stock_moves',U.req,'stock.supplier_return',U.actor,U.store,
  JSON.stringify({ingredient_id:U.ingredient,qty_delta:-2,reference_id:U.po}));
}
function incoming(){
 return {auth:{actor_id:U.actor,token_hash:'a'.repeat(64),csrf:'x'.repeat(16)},
  request:{request_id:U.req,action:'stock.supplier_return',data:{
   ingredient_id:U.ingredient,location_id:U.store,
   reference_id:U.po,qty:2,reason:'damaged goods'}},audit_id:U.audit};
}
function select(d,p){
 return {stock_rows:d.prepare(p.statements[0].sql).all(...p.statements[0].args),
  audit_rows:d.prepare(p.statements[1].sql).all(...p.statements[1].args)};
}
test('fixed projections have exact columns, only parameters and bounded rows',async()=>{
 const p=await plan(U.req.toUpperCase());
 assert.equal(p.statements.length,2);
 assert.deepEqual(p.statements.map(x=>x.kind),['movement','audit']);
 for(const stmt of p.statements){
  assert.deepEqual(stmt.args,[U.req]);
  assert.equal(stmt.max_rows,2);
  assert.match(stmt.sql,/^SELECT /);
  assert.match(stmt.sql,/ LIMIT 2$/);
  assert.doesNotMatch(stmt.sql,/;|\b(INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA)\b/i);
  assert(Object.isFrozen(stmt)&&Object.isFrozen(stmt.args));
 }
 assert.equal(p.sql_executed,false);
 assert.equal(p.consistent_snapshot_verified,false);
 assert.equal(p.production_write_authorized,false);
 assert(Object.isFrozen(p)&&Object.isFrozen(p.statements));
});
test('read-only SQL produces expected shapes for offline snapshot reconciliation',async t=>{
 const d=db(t);add(d);
 const p=await plan(U.req);
 d.exec('PRAGMA query_only=ON');
 const rows=select(d,p);
 assert.equal(rows.stock_rows.length,1);
 assert.equal(rows.audit_rows.length,1);
 const result=(await matcher).reconcileSyntheticD1SupplierReturnSnapshot({...incoming(),...rows});
 assert.equal(result.status,'SYNTHETIC_RETURN_MATCHED_IN_SNAPSHOT');
 assert.equal(result.transaction_committed_verified,false);
 assert.equal(result.safe_to_retry,false);
});
test('absence, partial audit and duplicates never authorize replay',async t=>{
 const d=db(t),p=await plan(U.req);
 let r=(await matcher).reconcileSyntheticD1SupplierReturnSnapshot({...incoming(),...select(d,p)});
 assert.equal(r.status,'SYNTHETIC_RETURN_ABSENT_IN_SNAPSHOT_NO_RETRY');
 add(d);
 d.prepare('DELETE FROM audit_logs').run();
 r=(await matcher).reconcileSyntheticD1SupplierReturnSnapshot({...incoming(),...select(d,p)});
 assert.equal(r.status,'SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY');
 d.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)').run(
  U.audit,'stock_moves',U.req,'stock.supplier_return',U.actor,U.store,
  JSON.stringify({ingredient_id:U.ingredient,qty_delta:-2,reference_id:U.po}));
 d.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)').run(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc','stock_moves',U.req,
  'stock.supplier_return',U.actor,U.store,'{}');
 r=(await matcher).reconcileSyntheticD1SupplierReturnSnapshot({...incoming(),...select(d,p)});
 assert.equal(r.status,'SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY');
 assert.equal(r.safe_to_retry,false);
});
test('rejects SQL injection shaped IDs, malformed objects and accessors',async()=>{
 for(const value of ['',U.req+" OR 1=1",U.req+"'",'not-a-uuid',42,null]){
  await assert.rejects(()=>plan(value),/E_STOCK_V4_D1_RECONCILE_SELECT_INVALID/);
 }
 let reads=0;
 const obj={};Object.defineProperty(obj,'request_id',{
  enumerable:true,get(){reads++;return U.req;}});
 const build=(await load).buildSyntheticD1SupplierReturnReconcileSelects;
 assert.throws(()=>build(obj),/E_STOCK_V4_D1_RECONCILE_SELECT_INVALID/);
 assert.equal(reads,0);
});
test('plan not imported by live apps or v3 migration',()=>{
 for(const p of ['src/service.js','cloudflare/worker.mjs','vercel-demo/mock.js'])
  assert.doesNotMatch(fs.readFileSync(path.join(root,p),'utf8'),/stock-v4-d1-return-reconcile-select/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,
  'cloudflare/migrations/0001_initial_v3.sql'),'utf8'),/supplier_return|scrap/);
});
