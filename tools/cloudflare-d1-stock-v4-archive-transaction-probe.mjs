// OFFLINE ONLY. Exercise proposed v4 ledger constraints on an already verified
// disposable SQLite :memory: clone, then ROLLBACK all synthetic data.
// Never accept a file path, token, D1 binding or actual tenant row identifiers.
import {randomUUID} from 'node:crypto';
import {stockV4MigrationReceiptsValid} from '../cloudflare/native-stock-v4-migration-guard.mjs';

const error=()=>{throw Error('E_STOCK_V4_ARCHIVE_PROBE');};
const must=v=>{if(!v)error();};
export function runMemoryOnlyStockV4Probe(db){
 must(db&&typeof db.prepare==='function'&&typeof db.exec==='function');
 const databases=db.prepare('PRAGMA database_list').all();
 must(databases.length>=1&&databases.some(x=>x.name==='main')&&
  databases.every(x=>x.file===''));
 must(db.prepare('PRAGMA temp_store').get()?.temp_store===2);
 must(db.prepare('PRAGMA foreign_keys').get()?.foreign_keys===1);
 must(db.prepare('SELECT kind_version FROM stock_move_kind_contract WHERE id=1')
  .get()?.kind_version===4);
 must(stockV4MigrationReceiptsValid(db.prepare(
  'SELECT id,name FROM d1_migrations ORDER BY id LIMIT 4').all()));

 const suffix=randomUUID(),actor=randomUUID(),store=randomUUID(),ingredient=randomUUID();
 const po=randomUUID(),allMovementIds=[],allAuditIds=[];
 let started=false;
 try{
  db.exec('BEGIN IMMEDIATE');started=true;
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(actor,'probe_'+suffix.slice(0,12),'Synthetic probe','staff','a'.repeat(32),'b'.repeat(64));
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)')
   .run(store,'STOCK_V4_OFFLINE_PROBE_'+suffix);
  db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run(ingredient,'V4PROBE_'+suffix,'Synthetic-only ingredient','kg');
  db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by) VALUES(?,?,?,?,?,?,?,?)')
   .run(po,'V4PROBE_PO_'+suffix,store,ingredient,'Synthetic-only vendor',12.125,'received',actor);

  const insert=db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)');
  const audit=db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?)');
  const move=(kind,delta,reference,note)=>{
   const id=randomUUID(),log=randomUUID();
   insert.run(id,ingredient,store,delta,kind,reference,note,actor);
   audit.run(log,actor,'synthetic-v4-probe','stock.'+kind,'stock_moves',id,store,'{}');
   allMovementIds.push(id);allAuditIds.push(log);
  };
  move('purchase',12.125,po,'');
  move('supplier_return',-2.125,po,'synthetic supplier return');
  move('scrap',-1,null,'synthetic expired item');
  move('adjustment',-0.5,null,'synthetic negative adjustment');
  move('adjustment',0.75,null,'synthetic positive adjustment');

  const balance=db.prepare('SELECT COALESCE(SUM(round(qty_delta*1000)),0) AS milli FROM stock_moves WHERE ingredient_id=? AND location_id=?')
   .get(ingredient,store)?.milli;
  must(balance===9250);
  must(db.prepare('SELECT COUNT(*) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?')
   .get(ingredient,store)?.n===5);
  must(db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE actor_name='synthetic-v4-probe' AND location_id=?")
   .get(store)?.n===5);
  // Check DB-enforced schema constraints, without claiming this models
  // the complete Native API Session/CSRF/PO-budget authorization.
  const invalid=[
   ['scrap',-1,null,''],
   ['supplier_return',-1,null,'reason without receipt'],
   ['adjustment',0,null,'zero delta'],
   ['not_approved_kind',-1,null,'invalid kind']
  ];
  for(const [kind,delta,reference,note] of invalid){
   let rejected=false;
   try{insert.run(randomUUID(),ingredient,store,delta,kind,reference,note,actor);}
   catch(e){// Node's DatabaseSync uses ERR_SQLITE_ERROR + extended SQLite errcode.
    if(e?.code==='ERR_SQLITE_ERROR'&&Number.isInteger(e.errcode)&&
       (e.errcode&255)===19)rejected=true;else throw e;}
   must(rejected);
  }
  must(db.prepare('SELECT COUNT(*) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?')
   .get(ingredient,store)?.n===5);
  must(db.prepare('PRAGMA quick_check').get()?.quick_check==='ok');
  must(db.prepare('PRAGMA foreign_key_check').all().length===0);
 }finally{
  if(started)db.exec('ROLLBACK');
 }
 // Every synthetic INSERT must be absent after ROLLBACK. The caller also
 // checks identical fingerprints for all real historical tables.
 must(db.prepare('SELECT 1 FROM users WHERE id=?').get(actor)===undefined);
 must(db.prepare('SELECT 1 FROM locations WHERE id=?').get(store)===undefined);
 must(db.prepare('SELECT 1 FROM ingredients WHERE id=?').get(ingredient)===undefined);
 must(db.prepare('SELECT 1 FROM purchase_orders WHERE id=?').get(po)===undefined);
 for(const id of allMovementIds)must(db.prepare('SELECT 1 FROM stock_moves WHERE id=?').get(id)===undefined);
 for(const id of allAuditIds)must(db.prepare('SELECT 1 FROM audit_logs WHERE id=?').get(id)===undefined);
 must(db.prepare('PRAGMA quick_check').get()?.quick_check==='ok');
 must(db.prepare('PRAGMA foreign_key_check').all().length===0);
 return Object.freeze({synthetic_movement_kinds_checked:4,
  synthetic_v4_positive_and_negative_schema_checks:true,
  synthetic_transaction_rolled_back:true,actual_business_rows_modified:false});
}
