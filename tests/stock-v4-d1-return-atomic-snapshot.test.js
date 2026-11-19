'use strict';
// Disposable in-memory SQLite only; one SELECT is used for both row kinds.
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const moduleReady=import('../src/stock-v4-d1-return-atomic-snapshot.mjs');
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
function addMovement(d){
 d.prepare('INSERT INTO stock_moves VALUES(?,?,?,?,?,?,?,?)').run(
  U.req,U.ingredient,U.store,-2,'supplier_return',U.po,'damaged goods',U.actor);
}
function addAudit(d,id=U.audit,detail=JSON.stringify({
 ingredient_id:U.ingredient,qty_delta:-2,reference_id:U.po
 })){
 d.prepare('INSERT INTO audit_logs VALUES(?,?,?,?,?,?,?)').run(
  id,'stock_moves',U.req,'stock.supplier_return',U.actor,U.store,detail);
}
function request(){
 return {auth:{actor_id:U.actor,token_hash:'a'.repeat(64),csrf:'x'.repeat(16)},
  request:{request_id:U.req,action:'stock.supplier_return',data:{
   ingredient_id:U.ingredient,location_id:U.store,
   reference_id:U.po,qty:2,reason:'damaged goods'}},audit_id:U.audit};
}
function rows(d,plan){return d.prepare(plan.statement.sql).all(...plan.statement.args);}
test('one bounded parameterized SELECT spans stock and audit without writes',async()=>{
 const {buildSyntheticD1SupplierReturnAtomicSnapshotSelect:build}=await moduleReady;
 const p=build({request_id:U.req.toUpperCase()});
 assert.equal(p.single_statement_plan,true);
 assert.equal(p.consistent_snapshot_verified,false);
 assert.equal(p.production_write_authorized,false);
 assert.deepEqual(p.statement.args,[U.req,U.req]);
 assert.equal(p.statement.max_rows,4);
 assert.match(p.statement.sql,/^WITH movements AS /);
 assert.match(p.statement.sql,/ UNION ALL /);
 assert.equal((p.statement.sql.match(/\?/g)||[]).length,2);
 assert.doesNotMatch(p.statement.sql,/;|\b(INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA)\b/i);
 assert(Object.isFrozen(p)&&Object.isFrozen(p.statement)&&Object.isFrozen(p.statement.args));
});
test('single SQLite SELECT reconciles matching ledger and audit read-only',async t=>{
 const d=db(t);addMovement(d);addAudit(d);
 const {buildSyntheticD1SupplierReturnAtomicSnapshotSelect:build,
  reconcileSyntheticD1SupplierReturnAtomicRows:reconcile}=await moduleReady;
 const p=build({request_id:U.req});
 d.exec('PRAGMA query_only=ON');
 const found=rows(d,p);
 assert.equal(found.length,2);
 assert.deepEqual(found.map(x=>x.row_kind),['audit','movement']);
 const result=reconcile({...request(),rows:found});
 assert.equal(result.status,'SYNTHETIC_RETURN_MATCHED_IN_SNAPSHOT');
 assert.equal(result.safe_to_retry,false);
 assert.equal(result.transaction_committed_verified,false);
 assert.equal(result.remote_d1_verified,false);
});
test('absence, missing audit, duplicate audit and mismatched detail are fail-closed',async t=>{
 const d=db(t),m=await moduleReady,p=m.buildSyntheticD1SupplierReturnAtomicSnapshotSelect({request_id:U.req});
 const inspect=()=>m.reconcileSyntheticD1SupplierReturnAtomicRows({...request(),rows:rows(d,p)});
 assert.equal(inspect().status,'SYNTHETIC_RETURN_ABSENT_IN_SNAPSHOT_NO_RETRY');
 addMovement(d);
 assert.equal(inspect().status,'SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY');
 addAudit(d);
 assert.equal(inspect().status,'SYNTHETIC_RETURN_MATCHED_IN_SNAPSHOT');
 addAudit(d,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','{}');
 assert.equal(inspect().status,'SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY');
 d.prepare('DELETE FROM audit_logs').run();
 addAudit(d,U.audit,'{"qty_delta":-9}');
 assert.equal(inspect().status,'SYNTHETIC_RETURN_INDETERMINATE_NO_RETRY');
});
test('rejects SQL injection identifiers, accessor rows, extra columns and oversized results',async()=>{
 const m=await moduleReady,payload=request();
 for(const id of ['',U.req+" OR 1=1",U.req+"'",'not-a-uuid',null,19])
  assert.throws(()=>m.buildSyntheticD1SupplierReturnAtomicSnapshotSelect({request_id:id}),
   /E_STOCK_V4_ATOMIC_SNAPSHOT_INVALID/);
 const getters={};let count=0;
 Object.defineProperty(getters,'request_id',{enumerable:true,get(){count++;return U.req;}});
 assert.throws(()=>m.buildSyntheticD1SupplierReturnAtomicSnapshotSelect(getters),
  /E_STOCK_V4_ATOMIC_SNAPSHOT_INVALID/);
 assert.equal(count,0);
 const basic={row_kind:'movement',id:U.req,ingredient_id:U.ingredient,location_id:U.store,
  qty_delta:-2,move_type:'supplier_return',reference_id:U.po,note:'damaged goods',
  actor_id:U.actor,entity:null,entity_id:null,action:null,detail:null};
 for(const x of [[{...basic,extra:'unsafe'}],[{...basic,entity:'bad'}],
  Array.from({length:5},()=>({...basic}))])
  assert.throws(()=>m.reconcileSyntheticD1SupplierReturnAtomicRows({...payload,rows:x}),
   /E_STOCK_V4_ATOMIC_SNAPSHOT_INVALID/);
 const bad={...basic};Object.defineProperty(bad,'id',{enumerable:true,get(){count++;return U.req;}});
 assert.throws(()=>m.reconcileSyntheticD1SupplierReturnAtomicRows({...payload,rows:[bad]}),
  /E_STOCK_V4_ATOMIC_SNAPSHOT_INVALID/);
 assert.equal(count,0);
});
test('inert helper is absent from all live runtimes and v3 migration',()=>{
 for(const f of ['src/service.js','cloudflare/worker.mjs','vercel-demo/mock.js'])
  assert.doesNotMatch(fs.readFileSync(path.join(root,f),'utf8'),
   /stock-v4-d1-return-atomic-snapshot/);
 assert.doesNotMatch(fs.readFileSync(path.join(root,
  'cloudflare/migrations/0001_initial_v3.sql'),'utf8'),
  /supplier_return|scrap/);
});
