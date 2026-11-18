'use strict';
// Offline in-memory SQLite fixtures only. Never opens operator/customer DBs.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {executeSyntheticStockV4:execute,createSyntheticStockV4MemoryDb:createMemory}=require('../src/stock-v4-offline-scrap-adjust.cjs');
const root=path.join(__dirname,'..'),read=x=>fs.readFileSync(path.join(root,x),'utf8');
const schemas={local:read('db/schema.sql'),d1:read('cloudflare/migrations/0001_initial_v3.sql')};
const sql=read('db/migration-proposals/0004_stock_move_kinds.sql');
const IDS={store:'00000000-0000-4000-8000-000000000001',
 second:'00000000-0000-4000-8000-000000000002',
 ing:'00000000-0000-4000-8000-000000000003',
 owner:'00000000-0000-4000-8000-000000000004',
 manager:'00000000-0000-4000-8000-000000000005',
 staff:'00000000-0000-4000-8000-000000000006',
 key:'00000000-0000-4000-8000-000000000007',
 key2:'00000000-0000-4000-8000-000000000008',
 key3:'00000000-0000-4000-8000-000000000009'};
function setup(t,origin){
 const db=createMemory();
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schemas[origin]);
 for(const [id,name] of [[IDS.store,'假店A'],[IDS.second,'假店B']])
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(IDS.ing,'DEMO-ONLY','虛構食材','公斤');
 for(const [id,role] of [[IDS.owner,'owner'],[IDS.manager,'manager'],[IDS.staff,'staff']])
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(id,role+'-test','虛構'+role,role,'salt','hash');
 db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
  .run(IDS.manager,IDS.store);
 for(const [id,delta,kind] of [['initial',10,'purchase'],['consumed',-3,'usage']])
  db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
   .run(id,IDS.ing,IDS.store,delta,kind,IDS.owner);
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(sql);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 return db;
}
const payload=(action,qty,reason='過期')=>({
 action,actor_id:IDS.owner,request_id:IDS.key,
 data:action==='stock.scrap'?{ingredient_id:IDS.ing,location_id:IDS.store,qty,reason}:
  {ingredient_id:IDS.ing,location_id:IDS.store,qty_delta:qty,reason}
});
const snapshot=db=>({
 moves:db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),
 audits:db.prepare('SELECT * FROM audit_logs ORDER BY id').all()
});
const onHand=db=>db.prepare('SELECT SUM(qty_delta) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?')
 .get(IDS.ing,IDS.store).n;
test('runtime Local API, D1 Worker and Vercel Demo do not import synthetic writer',()=>{
 for(const file of ['src/service.js','cloudflare/worker.mjs','vercel-demo/mock.js'])
  assert.doesNotMatch(read(file),/stock-v4-offline-scrap-adjust/);
 assert.doesNotMatch(read('cloudflare/migrations/0001_initial_v3.sql'),/supplier_return|scrap/);
});
for(const origin of ['local','d1']){
 test(origin+' atomically appends debit/adjust movements and exactly matched audits',t=>{
  const db=setup(t,origin),before=snapshot(db);
  const scrap=execute(db,payload('stock.scrap',1.25));
  assert.equal(scrap.status,'SYNTHETIC_V4_TRANSACTION_COMMITTED');
  assert.equal(scrap.stock_remaining_milli,5750);
  assert.equal(scrap.production_write_authorized,false);
  assert.equal(scrap.remote_d1_verified,false);
  assert.equal(scrap.synthetic_only,true);
  assert.equal(onHand(db),5.75);
  let result=execute(db,{...payload('stock.adjust',-0.75,'盤點'),request_id:IDS.key2});
  assert.equal(result.stock_remaining_milli,5000);
  result=execute(db,{...payload('stock.adjust',2,'盤點增加'),request_id:IDS.key3});
  assert.equal(result.stock_remaining_milli,7000);
  assert.equal(onHand(db),7);
  const after=snapshot(db);
  assert.equal(after.moves.length,before.moves.length+3);
  assert.equal(after.audits.length,before.audits.length+3);
  assert.deepEqual(after.moves.filter(x=>[IDS.key,IDS.key2,IDS.key3].includes(x.id)).map(x=>x.move_type).sort(),
   ['adjustment','adjustment','scrap'].sort());
  const audits=after.audits.map(x=>({action:x.action,entity_id:x.entity_id}));
  assert.deepEqual(audits.sort((x,y)=>x.entity_id.localeCompare(y.entity_id)),
   [{action:'stock.scrap',entity_id:IDS.key},
    {action:'stock.adjust',entity_id:IDS.key2},
    {action:'stock.adjust',entity_id:IDS.key3}]);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 });
 test(origin+' replays a previous request id without adding ledger or audit',t=>{
  const db=setup(t,origin);
  execute(db,payload('stock.scrap',1));
  const before=snapshot(db);
  assert.throws(()=>execute(db,payload('stock.scrap',1)),/DUPLICATE_REQUEST/);
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' rejects insufficient stock and invalid payload with no writes',t=>{
  const db=setup(t,origin),before=snapshot(db);
  assert.throws(()=>execute(db,payload('stock.scrap',8)),/INSUFFICIENT_OR_OVERFLOW/);
  assert.throws(()=>execute(db,payload('stock.adjust',-8)),/INSUFFICIENT_OR_OVERFLOW/);
  assert.throws(()=>execute(db,payload('stock.scrap',0.00001)),/PAYLOAD/);
  assert.throws(()=>execute(db,payload('stock.adjust',0)),/PAYLOAD/);
  assert.throws(()=>execute(db,{...payload('stock.scrap',1),scope:'owner'}),/REQUEST/);
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' enforces active DB role, store scope and catalog status',t=>{
  const db=setup(t,origin),before=snapshot(db);
  assert.throws(()=>execute(db,{...payload('stock.scrap',1),actor_id:IDS.staff}),/ACTOR_NOT_ALLOWED/);
  db.prepare('DELETE FROM user_locations WHERE user_id=?').run(IDS.manager);
  assert.throws(()=>execute(db,{...payload('stock.scrap',1),actor_id:IDS.manager}),/STORE_FORBIDDEN/);
  db.prepare('UPDATE locations SET active=0 WHERE id=?').run(IDS.store);
  assert.throws(()=>execute(db,payload('stock.scrap',1)),/INACTIVE_SCOPE/);
  db.prepare('UPDATE locations SET active=1 WHERE id=?').run(IDS.store);
  db.prepare('UPDATE ingredients SET active=0 WHERE id=?').run(IDS.ing);
  assert.throws(()=>execute(db,payload('stock.scrap',1)),/INACTIVE_SCOPE/);
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' rollback after an audit insertion failure preserves both tables',t=>{
  const db=setup(t,origin),before=snapshot(db);
  db.exec("CREATE TRIGGER synthetic_fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  assert.throws(()=>execute(db,payload('stock.scrap',1)),/TRANSACTION_FAILED/);
  assert.deepEqual(snapshot(db),before);
  db.exec('DROP TRIGGER synthetic_fail_audit');
  const result=execute(db,payload('stock.scrap',1));
  assert.equal(result.stock_remaining_milli,6000);
 });
 test(origin+' treats uppercase and lowercase UUID request IDs as the same movement',t=>{
  const db=setup(t,origin);
  const key='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const first=execute(db,{...payload('stock.scrap',1),request_id:key.toUpperCase()});
  assert.equal(first.id,key);
  const before=snapshot(db);
  assert.throws(()=>execute(db,{...payload('stock.scrap',1),request_id:key}),
    /DUPLICATE_REQUEST/);
  assert.deepEqual(snapshot(db),before);
 });
 test(origin+' rejects synthetic historical non-grid quantity and unready schema',t=>{
  const db=setup(t,origin);
  db.exec("UPDATE stock_moves SET qty_delta=-0.00000000001 WHERE id='consumed'");
  assert.throws(()=>execute(db,payload('stock.scrap',1)),/HISTORICAL_PRECISION/);
  db.exec("UPDATE stock_moves SET qty_delta=-3 WHERE id='consumed'");
  db.exec('DROP TABLE stock_move_kind_contract');
  assert.throws(()=>execute(db,payload('stock.scrap',1)),/READ_FAILED|V4_SCHEMA_NOT_READY/);
 });
}
test('disk-backed and attached databases are rejected before any write',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'rbp-v4-offline-'));
 const disk=new DatabaseSync(path.join(tmp,'fixture.sqlite'));
 t.after(()=>{disk.close();fs.rmSync(tmp,{recursive:true,force:true});});
 assert.throws(()=>execute(disk,payload('stock.scrap',1)),/UNTRUSTED_DB/);
 const unnamed=new DatabaseSync('');
 t.after(()=>unnamed.close());
 assert.throws(()=>execute(unnamed,payload('stock.scrap',1)),/UNTRUSTED_DB/);
 const externalMemory=new DatabaseSync(':memory:');
 t.after(()=>externalMemory.close());
 assert.throws(()=>execute(externalMemory,payload('stock.scrap',1)),/UNTRUSTED_DB/);
 const db=setup(t,'local');
 db.exec("ATTACH DATABASE ':memory:' AS extras");
 assert.throws(()=>execute(db,payload('stock.scrap',1)),/NON_EPHEMERAL_DB/);
});
