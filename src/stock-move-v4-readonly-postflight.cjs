'use strict';
// Offline proposal postflight: NEVER opens files, sends requests, or writes SQL.
// Caller supplies independent, already-open SQLite v3 and proposed-v4 snapshots.
// This does not attest remote D1 semantics or grant migration permission.
const {inspectStockMoveV3}=require('./stock-move-v3-readonly-preflight.cjs');
const APPROVED_LEDGER_SQL="CREATE TABLE \"stock_moves\" (\n id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),\n location_id TEXT NOT NULL REFERENCES locations(id),\n qty_delta REAL NOT NULL CHECK(qty_delta != 0),\n move_type TEXT NOT NULL CHECK(move_type IN ('purchase','usage','adjustment','supplier_return','scrap')),\n reference_id TEXT, note TEXT NOT NULL DEFAULT '', actor_id TEXT REFERENCES users(id),\n created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,\n CHECK(move_type NOT IN ('supplier_return','scrap') OR\n       (qty_delta < 0 AND length(trim(note)) BETWEEN 1 AND 300)),\n CHECK(move_type != 'supplier_return' OR\n       (reference_id IS NOT NULL AND length(trim(reference_id)) BETWEEN 1 AND 100))\n)";
const APPROVED_MARKER_SQL="CREATE TABLE stock_move_kind_contract (\n id INTEGER PRIMARY KEY CHECK(id=1),\n kind_version INTEGER NOT NULL CHECK(kind_version=4),\n created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP\n)";
const APPROVED_INDEX_SQL="CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id)";
// SQLite preserves the source migration SQL line endings in sqlite_master.
// Windows checkout may use CRLF; canonicalize EOL only, never SQL semantics.
const normalizedEol=sql=>typeof sql==='string'?sql.replace(/\r\n/g,'\n'):sql;
const fail=code=>{throw Error('E_STOCK_V4_POSTFLIGHT_'+code);};
const query=(db,sql)=>{
 try{
  if(!/^\s*(?:SELECT|PRAGMA)\b/i.test(sql))fail('NOT_READONLY');
  const out=db.prepare(sql).all();
  if(!Array.isArray(out))fail('BAD_READ_RESULT');
  return out;
 }catch{fail('SQL_READ_FAILED');}
};
const one=(db,sql)=>query(db,sql)[0];
const quote=n=>'"'+n.replace(/"/g,'""')+'"';
const names=db=>query(db,"SELECT name FROM main.sqlite_master WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").map(x=>x.name);
const schema=db=>query(db,"SELECT type,name,sql FROM main.sqlite_master WHERE sql IS NOT NULL AND name NOT GLOB 'sqlite_*' AND type IN ('table','index') ORDER BY type,name")
 .filter(x=>!['stock_moves','stock_moves_stock','stock_move_kind_contract'].includes(x.name));
function noTemp(db){
 if(query(db,"SELECT name FROM sqlite_temp_master WHERE type IN ('table','view','index','trigger')").length)
   fail('TEMP_SCHEMA');
}
function sameRows(a,b,name){
 if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z_0-9]*$/.test(name))
   fail('TABLE_IDENTIFIER');
 const cols=query(a,'PRAGMA main.table_info('+quote(name)+')').map(x=>x.name);
 if(!cols.length||cols.some(x=>/^__smpf_type_[0-9]+$/.test(x)))
   fail('UNSAFE_COLUMNS');
 const typed=cols.map((x,i)=>'typeof('+quote(x)+') AS '+quote('__smpf_type_'+i));
 const sql='SELECT *, '+typed.join(',')+' FROM main.'+quote(name);
 const encode=db=>query(db,sql).map(row=>{
   // SQLite REAL +/-Infinity and NaN cannot be represented by JSON faithfully.
   if(Object.values(row).some(value=>typeof value==='number'&&!Number.isFinite(value)))
     fail('NONFINITE_NUMBER');
   try{return JSON.stringify(row);}catch{fail('UNSAFE_ROW_ENCODING');}
 }).sort();
 if(JSON.stringify(encode(a))!==JSON.stringify(encode(b)))
   fail('HISTORICAL_ROW_MISMATCH');
}
function checkStockV4OfflinePostflight(beforeDb,afterDb,origin){
 if(!beforeDb||!afterDb||beforeDb===afterDb||
   typeof beforeDb.prepare!=='function'||typeof afterDb.prepare!=='function'||
   !['local','d1'].includes(origin))fail('INVALID_INPUT');
 // A valid historical baseline is mandatory. This check only reads it.
 noTemp(beforeDb);noTemp(afterDb);
 const original=inspectStockMoveV3(beforeDb,origin);
 if(one(afterDb,'PRAGMA main.quick_check(1)')?.quick_check!=='ok')fail('INTEGRITY');
 if(query(afterDb,'PRAGMA main.foreign_key_check').length)fail('FOREIGN_KEY');
 if(one(afterDb,'PRAGMA main.user_version')?.user_version!==(origin==='local'?3:0))
   fail('VERSION_DRIFT');
 if(origin==='d1'&&one(afterDb,'SELECT contract_version FROM main.cloud_schema_contract WHERE id=1')?.contract_version!==3)
   fail('D1_VERSION_DRIFT');
 const beforeTables=names(beforeDb),afterTables=names(afterDb);
 if(JSON.stringify([...beforeTables,'stock_move_kind_contract'].sort())!==
   JSON.stringify(afterTables.sort()))fail('TABLE_INVENTORY');
 const marker=query(afterDb,'SELECT id,kind_version FROM main.stock_move_kind_contract ORDER BY id');
 if(marker.length!==1||marker[0].id!==1||marker[0].kind_version!==4)
   fail('MARKER');
 if(query(afterDb,"SELECT name FROM main.sqlite_master WHERE lower(name)='stock_moves_v4'").length)
   fail('PARTIAL_MIGRATION');
 const ddl=one(afterDb,"SELECT sql FROM main.sqlite_master WHERE type='table' AND name='stock_moves'")?.sql;
 if(normalizedEol(ddl)!==APPROVED_LEDGER_SQL&&
    normalizedEol(ddl)!==APPROVED_LEDGER_SQL.replace('CREATE TABLE "stock_moves" (','CREATE TABLE stock_moves ('))
   fail('V4_DDL');
 const markerDdl=one(afterDb,
   "SELECT sql FROM main.sqlite_master WHERE type='table' AND name='stock_move_kind_contract'")?.sql;
 if(normalizedEol(markerDdl)!==APPROVED_MARKER_SQL)fail('MARKER_DDL');
 const info=query(afterDb,'PRAGMA table_info(stock_moves)').map(x=>x.name);
 if(JSON.stringify(info)!==JSON.stringify([
  'id','ingredient_id','location_id','qty_delta','move_type',
  'reference_id','note','actor_id','created_at']))fail('V4_COLUMNS');
 const indexes=query(afterDb,"SELECT name,sql FROM main.sqlite_master WHERE type='index' AND tbl_name='stock_moves' AND sql IS NOT NULL");
 if(indexes.length!==1||indexes[0].name!=='stock_moves_stock'||normalizedEol(indexes[0].sql)!==APPROVED_INDEX_SQL)
   fail('INDEX_DDL');
 if(JSON.stringify(query(afterDb,'PRAGMA index_info(stock_moves_stock)').map(x=>x.name))!==
   JSON.stringify(['ingredient_id','location_id']))fail('INDEX_COLUMNS');
 const extras=query(afterDb,"SELECT name FROM main.sqlite_master WHERE type IN ('view','trigger')");
 if(extras.length)fail('UNEXPECTED_DEPENDENCIES');
 if(JSON.stringify(schema(beforeDb))!==JSON.stringify(schema(afterDb)))
   fail('OTHER_SCHEMA_DRIFT');
 for(const name of beforeTables)sameRows(beforeDb,afterDb,name);
 return Object.freeze({
  status:'OFFLINE_STOCK_V4_POSTFLIGHT_PASS',origin,
  original_ledger_rows:original.stock_move_rows,
  preserved_tables:beforeTables.length,
  migration_authorized:false,remote_d1_verified:false,
  writes_performed:false
 });
}
module.exports={checkStockV4OfflinePostflight};
