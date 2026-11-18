'use strict';
// Synthetic, ephemeral SQLite transaction rehearsal for stock.scrap/stock.adjust.
// Deliberately NOT imported by any production API/Worker; file-backed DBs fail.
// Future production implementation needs its own reviewed migrations and Gates.
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
// Only DBs created by this module may be used for synthetic writes.
// DatabaseSync('') can report an empty path without being truly :memory:.
const allowedMemoryDb=new WeakSet();
function createSyntheticStockV4MemoryDb(){
 const db=new DatabaseSync(':memory:');
 allowedMemoryDb.add(db);
 return db;
}
const {normalizeStockV4}=require('./stock-move-v4-contract.mjs');
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=code=>{throw Error('E_STOCK_V4_OFFLINE_'+code);};
const shape=(x,keys)=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x))&&
  JSON.stringify(Object.keys(x).sort())===JSON.stringify([...keys].sort());
function asMilli(n){
 if(typeof n!=='number'||!Number.isFinite(n)||
   !/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]{1,3})?$/.test(String(n))||
   Math.abs(n)>1000000)fail('HISTORICAL_PRECISION');
 const units=Math.round(n*1000);
 if(!Number.isSafeInteger(units))fail('HISTORICAL_PRECISION');
 return units;
}
function query(db,sql,...args){
 try{return db.prepare(sql).all(...args);}
 catch{fail('READ_FAILED');}
}
function one(db,sql,...args){return query(db,sql,...args)[0];}
function ephemeral(db){
 if(!db||typeof db.exec!=='function'||typeof db.prepare!=='function')
   fail('INVALID_DB');
 if(!allowedMemoryDb.has(db))fail('UNTRUSTED_DB');
 // A deliberate hard wall against any real Local SQLite file or attached DB.
 const files=query(db,'PRAGMA database_list');
 // On Node/SQLite builds an in-memory main file can be '' or null, and
 // SQLite may report an empty temp schema. Insist on location() as a
 // second independent test, and never allow attached named databases.
 let location;
 try{location=db.location();}catch{fail('NON_EPHEMERAL_DB');}
 if(location!==null||!files.some(x=>x.name==='main')||
   files.some(x=>!['main','temp'].includes(x.name)||
     (x.file!==null&&x.file!==undefined&&x.file!=='')))
   fail('NON_EPHEMERAL_DB');
 if(query(db,"SELECT name FROM sqlite_temp_master WHERE type IN ('table','index','view','trigger')").length)
   fail('TEMP_SCHEMA');
 if(one(db,'PRAGMA foreign_keys')?.foreign_keys!==1)
   fail('FOREIGN_KEYS_OFF');
 const marker=one(db,'SELECT kind_version FROM stock_move_kind_contract WHERE id=1');
 if(marker?.kind_version!==4)fail('V4_SCHEMA_NOT_READY');
 const ddl=one(db,
   "SELECT sql FROM main.sqlite_master WHERE type='table' AND name='stock_moves'")?.sql;
 if(typeof ddl!=='string'||!ddl.includes("'supplier_return','scrap'")||
   !ddl.includes('qty_delta < 0')||!ddl.includes('length(trim(note))'))
   fail('V4_SCHEMA_NOT_READY');
 if(one(db,'PRAGMA quick_check(1)')?.quick_check!=='ok'||
    query(db,'PRAGMA foreign_key_check').length)fail('INTEGRITY');
}
function actorAndScope(db,actorId,locationId,ingredientId){
 const actor=one(db,
   'SELECT id,username,role,active FROM users WHERE id=?',actorId);
 if(actor?.active!==1||!['owner','manager'].includes(actor?.role))
   fail('ACTOR_NOT_ALLOWED');
 const store=one(db,'SELECT active FROM locations WHERE id=?',locationId);
 const ingredient=one(db,'SELECT active FROM ingredients WHERE id=?',ingredientId);
 if(store?.active!==1||ingredient?.active!==1)fail('INACTIVE_SCOPE');
 if(actor.role!=='owner'&&!one(db,
   'SELECT 1 AS ok FROM user_locations WHERE user_id=? AND location_id=?',
   actorId,locationId))fail('STORE_FORBIDDEN');
 return actor;
}
function balance(db,loc,ing){
 const rows=query(db,'SELECT qty_delta FROM stock_moves WHERE location_id=? AND ingredient_id=? LIMIT 100001',
   loc,ing);
 if(rows.length>100000)fail('ROW_LIMIT');
 let milli=0;
 for(const row of rows){
   milli+=asMilli(row.qty_delta);
   if(!Number.isSafeInteger(milli)||Math.abs(milli)>1000000000)
     fail('BALANCE_OVERFLOW');
 }
 if(milli<0)fail('NEGATIVE_HISTORY');
 return milli;
}
function executeSyntheticStockV4(db,request){
 ephemeral(db);
 if(!shape(request,['actor_id','request_id','action','data'])||
    typeof request.actor_id!=='string'||!UUID.test(request.actor_id)||
    typeof request.request_id!=='string'||!UUID.test(request.request_id)||
    !['stock.scrap','stock.adjust'].includes(request.action))
   fail('REQUEST');
 const requestId=request.request_id.toLowerCase();
 const actorId=request.actor_id.toLowerCase();
 let move;
 try{move=normalizeStockV4(request.action,request.data);}
 catch{fail('PAYLOAD');}
 // BEGIN IMMEDIATE serializes this test fixture. The runtime is not wired.
 try{db.exec('BEGIN IMMEDIATE');}
 catch{fail('BEGIN_FAILED');}
 try{
   const actor=actorAndScope(db,actorId,move.location_id,move.ingredient_id);
   if(one(db,'SELECT 1 AS found FROM stock_moves WHERE lower(id)=?',requestId))
     fail('DUPLICATE_REQUEST');
   const previous=balance(db,move.location_id,move.ingredient_id);
   const delta=asMilli(move.qty_delta);
   const after=previous+delta;
   if(!Number.isSafeInteger(after)||after<0||after>1000000000)
     fail('INSUFFICIENT_OR_OVERFLOW');
   const row=db.prepare(
    'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)'
   ).run(requestId,move.ingredient_id,move.location_id,
      move.qty_delta,move.move_type,null,move.note,actor.id);
   if(row.changes!==1)fail('WRITE_COUNT');
   const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?)'
   ).run(randomUUID(),actor.id,actor.username,request.action,'stock_moves',
      requestId,move.location_id,
      JSON.stringify({ingredient_id:move.ingredient_id,qty_delta:move.qty_delta}));
   if(audit.changes!==1)fail('AUDIT_COUNT');
   if(query(db,'PRAGMA foreign_key_check').length)fail('INTEGRITY');
   db.exec('COMMIT');
   return Object.freeze({status:'SYNTHETIC_V4_TRANSACTION_COMMITTED',
     id:requestId,action:request.action,stock_remaining_milli:after,
     synthetic_only:true,remote_d1_verified:false,production_write_authorized:false});
 }catch(e){
   try{db.exec('ROLLBACK');}catch{}
   if(typeof e?.message==='string'&&e.message.startsWith('E_STOCK_V4_OFFLINE_'))
     throw e;
   fail('TRANSACTION_FAILED');
 }
}
module.exports={executeSyntheticStockV4,createSyntheticStockV4MemoryDb};
