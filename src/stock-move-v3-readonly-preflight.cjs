'use strict';
// Pure, local, read-only preflight for an OFFLINE v3 snapshot only.
// No network access, no file opening, no SQL writes, no migration runner.
const EXPECTED_STOCK_MOVES_DDL=String.raw`CREATE TABLE stock_moves (
 id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),
 location_id TEXT NOT NULL REFERENCES locations(id), qty_delta REAL NOT NULL CHECK(qty_delta != 0),
 move_type TEXT NOT NULL CHECK(move_type IN ('purchase','usage','adjustment')),
 reference_id TEXT, note TEXT NOT NULL DEFAULT '', actor_id TEXT REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;
const OLD_KINDS=Object.freeze(['purchase','usage','adjustment']);
const FIELD_NAMES=Object.freeze([
 'id','ingredient_id','location_id','qty_delta','move_type',
 'reference_id','note','actor_id','created_at'
]);
const fail=code=>{const e=new Error('E_STOCK_MOVE_PREFLIGHT_'+code);e.code='E_STOCK_MOVE_PREFLIGHT';throw e;};
const norm=sql=>String(sql||'').replace(/\bIF\s+NOT\s+EXISTS\b/gi,'')
  .replace(/;\s*$/,'').replace(/\s+/g,'').toUpperCase();
const quote=name=>'"'+name.replace(/"/g,'""')+'"';
function inspectStockMoveV3(db,origin){
 if(!db||typeof db.prepare!=='function'||!['local','d1'].includes(origin))
   fail('INVALID_INPUT');
 const rows=sql=>{
   try{return db.prepare(sql).all();}catch{fail('SQL_READ_FAILED');}
 };
 const first=sql=>rows(sql)[0];
 if(first('PRAGMA quick_check(1)')?.quick_check!=='ok')fail('INTEGRITY');
 if(rows('PRAGMA foreign_key_check').length)fail('FOREIGN_KEY');
 const version=first('PRAGMA user_version')?.user_version;
 if(origin==='local'){
   if(version!==3)fail('LOCAL_SCHEMA_VERSION');
   if(rows("SELECT name FROM sqlite_master WHERE type='table' AND name='cloud_schema_contract'").length)
     fail('UNEXPECTED_D1_MARKER');
 }else{
   if(version!==0)fail('D1_USER_VERSION');
   if(first('SELECT contract_version FROM cloud_schema_contract WHERE id=1')?.contract_version!==3)
     fail('D1_SCHEMA_VERSION');
 }
 if(rows("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stock_moves_v4','stock_move_kind_contract')").length)
   fail('PARTIAL_OR_ALREADY_MIGRATED');
 const actual=first("SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_moves'")?.sql;
 if(norm(actual)!==norm(EXPECTED_STOCK_MOVES_DDL))fail('STOCK_SCHEMA_DRIFT');
 const fields=rows('PRAGMA table_info(stock_moves)').map(x=>x.name);
 if(JSON.stringify(fields)!==JSON.stringify(FIELD_NAMES))fail('STOCK_FIELDS');
 const indexes=rows("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='stock_moves' AND sql IS NOT NULL");
 if(indexes.length!==1||indexes[0].name!=='stock_moves_stock'||
    norm(indexes[0].sql)!==norm('CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id)'))
   fail('STOCK_INDEX_DRIFT');
 const indexColumns=rows('PRAGMA index_info(stock_moves_stock)').map(x=>x.name);
 if(JSON.stringify(indexColumns)!==JSON.stringify(['ingredient_id','location_id']))
   fail('STOCK_INDEX_COLUMNS');
 // Rebuilding a referenced parent can silently break unrelated schema.
 if(rows("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='stock_moves'").length)
   fail('STOCK_TRIGGERS');
 if(rows("SELECT name FROM sqlite_master WHERE type='view' AND sql LIKE '%stock_moves%'").length)
   fail('STOCK_VIEWS');
 const tables=rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
 if(tables.length>200)fail('UNEXPECTED_TABLE_INVENTORY');
 for(const item of tables){
   if(typeof item.name!=='string'||!/^[A-Za-z_][A-Za-z_0-9]*$/.test(item.name))
     fail('UNEXPECTED_TABLE_IDENTIFIER');
   if(item.name==='stock_moves')continue;
   const relations=rows('PRAGMA foreign_key_list('+quote(item.name)+')');
   if(relations.some(r=>String(r.table).toLowerCase()==='stock_moves'))
     fail('INCOMING_FOREIGN_KEY');
 }
 const kinds=rows('SELECT move_type,COUNT(*) AS n FROM stock_moves GROUP BY move_type');
 const counts=Object.fromEntries(OLD_KINDS.map(x=>[x,0]));
 for(const r of kinds){
   if(!OLD_KINDS.includes(r.move_type)||!Number.isSafeInteger(r.n)||r.n<0)
     fail('LEGACY_MOVE_TYPE');
   counts[r.move_type]=r.n;
 }
 const count=first('SELECT COUNT(*) AS n FROM stock_moves')?.n;
 if(!Number.isSafeInteger(count)||count<0||
    Object.values(counts).reduce((a,b)=>a+b,0)!==count)
   fail('INCONSISTENT_MOVE_COUNT');
 return Object.freeze({status:'V3_STOCK_MOVE_SOURCE_READONLY_PASS',
   origin,existing_contract_version:3,stock_move_rows:count,
   movement_counts:Object.freeze(counts),writes_performed:false,
   migration_authorized:false,remote_d1_verified:false});
}
module.exports={inspectStockMoveV3};
