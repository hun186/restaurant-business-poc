'use strict';
// Exercising the REAL Local command() on disposable in-memory SQLite only.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const service=require('../src/service.js');
const {localStockV4WriteEnabled}=require('../src/local-stock-v4-command.cjs');
const root=path.join(__dirname,'..');
const schema=fs.readFileSync(path.join(root,'db/schema.sql'),'utf8');
const v4=fs.readFileSync(path.join(root,'db/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
function fixture(t,{migrated=true}={}){
 const old=process.env.LOCAL_STOCK_V4_WRITE_GATE;
 process.env.LOCAL_STOCK_V4_WRITE_GATE='operator-released';
 t.after(()=>{if(old===undefined)delete process.env.LOCAL_STOCK_V4_WRITE_GATE;
  else process.env.LOCAL_STOCK_V4_WRITE_GATE=old;});
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema);
 const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),store:randomUUID(),
  other:randomUUID(),ing:randomUUID(),po:randomUUID()};
 for(const [id,name] of [[ids.store,'Synthetic store'],[ids.other,'Other store']])
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run(ids.ing,'STOCK-V4-MOCK','Synthetic ingredient','kg');
 for(const role of ['owner','manager','staff']){
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(ids[role],role,'Synthetic '+role,role,'salt','hash');
  if(role!=='owner')db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
   .run(ids[role],ids.store);
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run(role.padEnd(64,'a'),role+'-csrf-value',ids[role],'2999-01-01T00:00:00.000Z');
 }
 db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
  .run(ids.po,'PO-SYNTH-V4',ids.store,ids.ing,'Mock supplier',10,'received',ids.owner);
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,actor_id) VALUES(?,?,?,?,?,?,?)')
  .run(randomUUID(),ids.ing,ids.store,10,'purchase',ids.po,ids.owner);
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
  .run(randomUUID(),ids.ing,ids.store,-2,'usage',ids.owner);
 if(migrated){
  db.exec('BEGIN IMMEDIATE');
  try{db.exec(v4);db.exec('PRAGMA user_version=4; COMMIT');}
  catch(e){db.exec('ROLLBACK');throw e;}
 }
 const who=role=>({id:ids[role],role,username:role,
  token_hash:role.padEnd(64,'a'),csrf_token:role+'-csrf-value'});
 const cmd=(role,action,body)=>service.command(db,who(role),action,
  {request_id:randomUUID(),ingredient_id:ids.ing,location_id:ids.store,
   reason:'Synthetic test operation',...body});
 const scrap=(qty=2)=>cmd('owner','stock.scrap',{qty});
 const adjust=(qty_delta)=>cmd('owner','stock.adjust',{qty_delta});
 const ret=(qty,other={})=>cmd('owner','stock.supplier_return',{
  qty,reference_id:ids.po,...other});
 const stock=()=>db.prepare('SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?')
  .get(ids.ing,ids.store).n;
 const count=()=>db.prepare("SELECT COUNT(*) AS n FROM stock_moves WHERE move_type IN ('scrap','supplier_return','adjustment')").get().n;
 const audit=()=>db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action IN ('stock.scrap','stock.adjust','stock.supplier_return')").get().n;
 return {db,ids,who,cmd,scrap,adjust,ret,stock,count,audit};
}
test('Gate OFF and missing v4 schema refuse new Local operations without writes',t=>{
 const f=fixture(t),old=process.env.LOCAL_STOCK_V4_WRITE_GATE;
 process.env.LOCAL_STOCK_V4_WRITE_GATE='disabled';
 assert.equal(localStockV4WriteEnabled(f.db),false);
 assert.throws(()=>f.scrap(),{status:503});
 process.env.LOCAL_STOCK_V4_WRITE_GATE=old;
 const pre=fixture(t,{migrated:false});
 assert.equal(localStockV4WriteEnabled(pre.db),false);
 assert.throws(()=>pre.scrap(),{status:503});
 assert.equal(f.count(),0);assert.equal(pre.count(),0);
});
test('Owner and Manager append scrap, plus/minus adjustment and one audit each',t=>{
 const f=fixture(t),original=f.db.prepare("SELECT * FROM stock_moves WHERE move_type='purchase'").get();
 assert.equal(f.scrap(2.125).stock_remaining_milli,5875);
 assert.equal(f.adjust(-1.25).stock_remaining_milli,4625);
 assert.equal(f.cmd('manager','stock.adjust',{qty_delta:2.375}).stock_remaining_milli,7000);
 assert.equal(f.stock(),7);assert.equal(f.count(),3);assert.equal(f.audit(),3);
 assert.deepEqual(f.db.prepare("SELECT * FROM stock_moves WHERE move_type='purchase'").get(),original);
 assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('received PO supplier return respects receipt cap and store stock budget',t=>{
 const f=fixture(t);
 assert.equal(f.ret(2).stock_remaining_milli,6000);
 assert.equal(f.ret(6).stock_remaining_milli,0);
 assert.throws(()=>f.ret(0.001),{status:409});
 assert.equal(f.stock(),0);assert.equal(f.count(),2);assert.equal(f.audit(),2);
});
test('failed replay, scope, auth, extra fields, invalid quantities never add ledger/audit',t=>{
 const f=fixture(t),key=randomUUID();
 const body={request_id:key,ingredient_id:f.ids.ing,location_id:f.ids.store,
  reason:'Defective product',qty:1};
 assert.equal(service.command(f.db,f.who('owner'),'stock.scrap',body).qty_delta,-1);
 assert.throws(()=>service.command(f.db,f.who('owner'),'stock.scrap',body),{status:409});
 assert.throws(()=>f.cmd('staff','stock.scrap',{qty:1}),{status:403});
 assert.throws(()=>f.cmd('manager','stock.scrap',{qty:1,location_id:f.ids.other}),{status:403});
 assert.throws(()=>f.scrap(0),{status:400});
 assert.throws(()=>f.adjust(0.0001),{status:400});
 assert.throws(()=>f.cmd('owner','stock.scrap',{qty:1,role:'owner'}),{status:400});
 const stale={...f.who('owner'),csrf_token:'bad-csrf'};
 assert.throws(()=>service.command(f.db,stale,'stock.scrap',
  {...body,request_id:randomUUID()}),{status:401});
 assert.equal(f.count(),1);assert.equal(f.audit(),1);assert.equal(f.stock(),7);
});
test('invalid receipt, wrong original purchase amount and exhausted returned cap refuse',t=>{
 const f=fixture(t),po=f.ids.po;
 f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(po);
 assert.throws(()=>f.ret(1),{status:409});
 f.db.prepare("UPDATE purchase_orders SET status='received' WHERE id=?").run(po);
 f.db.prepare("UPDATE stock_moves SET qty_delta=9 WHERE move_type='purchase'").run();
 assert.throws(()=>f.ret(1),{status:409});
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('audit failure aborts entire Local transaction with no partial debit',t=>{
 const f=fixture(t);
 f.db.exec("CREATE TRIGGER reject_stock_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'INJECTED'); END");
 assert.throws(()=>f.scrap(2));
 assert.equal(f.count(),0);assert.equal(f.audit(),0);assert.equal(f.stock(),8);
 f.db.exec('DROP TRIGGER reject_stock_audit');
 assert.equal(f.scrap(2).stock_remaining_milli,6000);
});
test('old v3 actions unchanged; Local gate never auto-enables or migrates schema',t=>{
 const f=fixture(t,{migrated:false});
 assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,3);
 assert.throws(()=>f.adjust(1),{status:503});
 assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,3);
 const serviceCode=fs.readFileSync(path.join(root,'src/service.js'),'utf8'),
  mainCode=fs.readFileSync(path.join(root,'src/db.js'),'utf8');
 assert.match(serviceCode,/appendLocalStockV4/);
 assert.doesNotMatch(mainCode,/db\.exec\([^)]*0004_stock_move_kinds/);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
