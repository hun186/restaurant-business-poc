// G6 synthetic-only D1 v3->v4 POSTFLIGHT. All Cloudflare requests are
// metadata GET or exact allowlisted SELECT/PRAGMA; never remote DDL/DML/restore.
// This is NOT a migration runner, binding clearance or release authorization.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID} from './check-cloudflare-staging.mjs';
import {approvedG6BindingTarget} from './cloudflare-g5-binding-inventory.mjs';

const ERROR='E_G6_STOCK_V4_READONLY_POSTFLIGHT';
const HOST='https://api.cloudflare.com/client/v4';
const NAME='restaurant-business-stock-v4-disposable';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fail=()=>{throw Error(ERROR);};
const need=v=>{if(!v)fail();};
const exact=(obj,keys)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
 JSON.stringify(Object.keys(obj).sort())===JSON.stringify([...keys].sort());
const fixture={owner:'g6-fixture-owner',location:'g6-fixture-location',ingredient:'g6-fixture-ingredient'};
const TIME='2026-11-01 ';
const expectedMoves=Object.freeze([
 ['g6-m01',10,'purchase','g6-po-01','synthetic inbound','10:00:00'],
 ['g6-m02',-2,'usage',null,'synthetic usage','11:00:00'],
 ['g6-m03',-1,'supplier_return','g6-po-01','synthetic supplier return','12:00:00'],
 ['g6-m04',-0.5,'scrap',null,'synthetic scrap','13:00:00'],
 ['g6-m05',0.25,'adjustment',null,'synthetic recount','14:00:00']
]);
const expectedTables=Object.freeze([
 'audit_logs','backup_settings','cloud_schema_contract','d1_migrations',
 'dish_ingredients','evaluations','ingredient_prices','ingredients',
 'leave_requests','locations','login_attempts','menu_dishes',
 'purchase_orders','repairs','sessions','shifts',
 'stock_move_kind_contract','stock_moves','stocktakes','tasks',
 'training_courses','training_records','user_locations','users'
]);
const unusedTables=Object.freeze([
 'user_locations','sessions','login_attempts','tasks','purchase_orders',
 'stocktakes','repairs','shifts','leave_requests','training_courses',
 'training_records','evaluations','menu_dishes','dish_ingredients'
]);
export const SQL=Object.freeze({
 tableNames:"SELECT name FROM sqlite_master WHERE type='table' AND substr(lower(name),1,7) <> 'sqlite_' AND name <> '_cf_KV' ORDER BY name;",
 unexpectedObjects:"SELECT type,name FROM sqlite_master WHERE type IN ('view','trigger') AND substr(lower(name),1,7) <> 'sqlite_' ORDER BY type,name;",
 unusedCounts:'SELECT '+unusedTables.map(name=>
  '(SELECT COUNT(*) FROM '+name+') AS '+name).join(', ')+';',
 backup:'SELECT id,interval_days,retention_count,last_auto_at,last_auto_name,last_fingerprint,last_result,last_error FROM backup_settings ORDER BY id;',
 receipts:'SELECT id,name FROM d1_migrations ORDER BY id;',
 schema:'SELECT contract_version FROM cloud_schema_contract WHERE id=1;',
 version:'SELECT kind_version FROM stock_move_kind_contract WHERE id=1;',
 objects:"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('stock_moves','stock_moves_stock','stock_moves_v4','stock_move_kind_contract') ORDER BY name,type;",
 schemaInventory:"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE substr(lower(name),1,7) <> 'sqlite_' AND name <> '_cf_KV' ORDER BY type,name;",
 columns:'PRAGMA table_info(stock_moves);',
 index:'PRAGMA index_info(stock_moves_stock);',
 foreignKeys:'PRAGMA foreign_key_list(stock_moves);',
 foreign:'PRAGMA foreign_key_check;',
 quick:'PRAGMA quick_check;',
 users:'SELECT id,username,display_name,role,password_salt,password_hash,active FROM users ORDER BY id;',
 locations:'SELECT id,name,active FROM locations ORDER BY id;',
 ingredients:'SELECT id,sku,name,unit,min_stock,active FROM ingredients ORDER BY id;',
 moves:'SELECT id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at FROM stock_moves ORDER BY id;',
 audit:'SELECT id,actor_id,actor_name,action,entity,entity_id,location_id,detail FROM audit_logs ORDER BY id;',
 auditTimeline:'SELECT id,at FROM audit_logs ORDER BY id;',
 prices:'SELECT id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_by FROM ingredient_prices ORDER BY id;'
});
const rows=reply=>{
 need(reply?.success===true&&Array.isArray(reply.result)&&reply.result.length===1&&
  reply.result[0]?.success===true&&Array.isArray(reply.result[0]?.results));
 return reply.result[0].results;
};
function approvedPath(pin){
 const id=approvedG6BindingTarget(pin);
 return '/accounts/'+ACCOUNT_ID+'/d1/database/'+id;
}
// D1 REST JSON object key order is not contractual. Preserve array order and
// reject missing or extra keys, comparing leaf values strictly.
const eq=(a,b)=>{
 if(Object.is(a,b))return true;
 if(a===null||b===null||typeof a!==typeof b||typeof a!=='object')return false;
 if(Array.isArray(a)!==Array.isArray(b))return false;
 if(Array.isArray(a))return a.length===b.length&&a.every((v,i)=>eq(v,b[i]));
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
 return eq(ak,bk)&&ak.every(key=>eq(a[key],b[key]));
};
// SQLite may reflow CREATE TABLE formatting and quote a table identifier
// when ALTER TABLE RENAME runs. Ignore only formatting whitespace outside
// quoted SQL tokens. Whitespace within a literal (DEFAULT '' vs DEFAULT ' ')
// or a quoted identifier must remain semantically significant.
const SQLITE_FORMAT_WS=/[ \t\n\v\f\r]/;
const canonicalDDL=ddl=>{
 need(typeof ddl==='string');
 // SQLite accepts only ASCII SPACE and 0x09..0x0D as formatting whitespace.
 // JavaScript \s additionally matches NBSP and other Unicode identifier
 // characters, and must not be used when comparing actual SQLite DDL.
 const sql=ddl.replace(/^CREATE[ \t\n\v\f\r]+TABLE[ \t\n\v\f\r]+"stock_moves"/i,
  'CREATE TABLE stock_moves');
 let result='',quote=null;
 for(let i=0;i<sql.length;i++){
  const char=sql[i];
  if(quote!==null){
   result+=char;
   const closing=quote==='['?']':quote;
   if(char===closing){
    if(sql[i+1]===closing){result+=sql[++i];}
    else quote=null;
   }
  }else if(char==="'"||char==='"'||char===String.fromCharCode(96)||char==='['){
   quote=char;
   result+=char;
  }else if(!SQLITE_FORMAT_WS.test(char)){
   result+=char;
  }
 }
 need(quote===null);
 return result.replace(/;$/,'');
};
const expectedV4DDL=()=>{
 // This migration source is in the reviewed SHA-256 preflight inventory.
 // Parse the single proposed CREATE TABLE and account for SQLite RENAME output.
 const proposal=fs.readFileSync(path.join(ROOT,
  'cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql'),'utf8');
 const match=proposal.match(/CREATE TABLE stock_moves_v4\s*\([\s\S]*?\n\);/);
 need(match!==null);
 return canonicalDDL(match[0].replace('CREATE TABLE stock_moves_v4',
  'CREATE TABLE stock_moves'));
};
const single=(list,key,value)=>need(list.length===1&&
 exact(list[0],[key])&&list[0][key]===value);
export async function verifyG6V4Postflight(pin,io){
 const base=approvedPath(pin);
 need(typeof io==='function');
 let metadata;
 try{metadata=await io('GET',base,null);}catch{fail();}
 need(metadata?.success===true&&metadata.result?.uuid===pin.database_id&&
  metadata.result?.name===NAME&&metadata.result?.version==='production');
 const query=async name=>{
  need(Object.hasOwn(SQL,name));
  try{return rows(await io('POST',base+'/query',{sql:SQL[name]}));}catch{fail();}
 };
 const tables=await query('tableNames');
 need(eq(tables.map(row=>row.name),expectedTables.map(x=>x).sort()));
 need((await query('unexpectedObjects')).length===0);
 const unused=await query('unusedCounts');
 need(unused.length===1&&exact(unused[0],unusedTables)&&
  unusedTables.every(table=>unused[0][table]===0));
 need(eq(await query('backup'),[{
  id:1,interval_days:1,retention_count:50,last_auto_at:null,
  last_auto_name:null,last_fingerprint:null,last_result:null,last_error:null
 }]));
 const receipts=await query('receipts');
 need(eq(receipts,[
  {id:1,name:'0001_initial_v3.sql'},
  {id:2,name:'0002_login_attempts_window_indexes.sql'},
  {id:3,name:'0004_stock_move_kinds.sql'}
 ]));
 single(await query('schema'),'contract_version',3);
 single(await query('version'),'kind_version',4);
 const objects=await query('objects');
 need(objects.length===3&&eq(objects.map(x=>[x.type,x.name,x.tbl_name]),[
  ['table','stock_move_kind_contract','stock_move_kind_contract'],
  ['table','stock_moves','stock_moves'],
  ['index','stock_moves_stock','stock_moves']
 ]));
 // Check exact names separately; SQLite order is lexical under ORDER BY name.
 const names=objects.map(x=>x.name).sort();
 need(eq(names,['stock_move_kind_contract','stock_moves','stock_moves_stock']));
 const ddl=objects.find(x=>x.name==='stock_moves')?.sql;
 // Exact reviewed DDL, including all three REFERENCES, zero-quantity
 // prohibition, defaults and CHECK clauses; renamed-table quotes normalized.
 need(typeof ddl==='string'&&canonicalDDL(ddl)===expectedV4DDL());
 const foreignKeys=await query('foreignKeys');
 need(eq(foreignKeys,[
  {id:0,seq:0,table:'users',from:'actor_id',to:'id',
   on_update:'NO ACTION',on_delete:'NO ACTION',match:'NONE'},
  {id:1,seq:0,table:'locations',from:'location_id',to:'id',
   on_update:'NO ACTION',on_delete:'NO ACTION',match:'NONE'},
  {id:2,seq:0,table:'ingredients',from:'ingredient_id',to:'id',
   on_update:'NO ACTION',on_delete:'NO ACTION',match:'NONE'}
 ]));
 need(typeof ddl==='string'&&
  /move_type\s+IN\s*\(\s*'purchase'\s*,\s*'usage'\s*,\s*'adjustment'\s*,\s*'supplier_return'\s*,\s*'scrap'\s*\)/i.test(ddl)&&
  /qty_delta\s*<\s*0/i.test(ddl)&&
  /length\s*\(\s*trim\s*\(\s*note\s*\)\s*\)\s+BETWEEN\s+1\s+AND\s+300/i.test(ddl)&&
  /length\s*\(\s*trim\s*\(\s*reference_id\s*\)\s*\)\s+BETWEEN\s+1\s+AND\s+100/i.test(ddl));
 const cols=await query('columns');
 const expectedColumns=[
  ['id','TEXT',0,1],
  ['ingredient_id','TEXT',1,0],
  ['location_id','TEXT',1,0],
  ['qty_delta','REAL',1,0],
  ['move_type','TEXT',1,0],
  ['reference_id','TEXT',0,0],
  ['note','TEXT',1,0],
  ['actor_id','TEXT',0,0],
  ['created_at','TEXT',1,0]
 ];
 need(eq(cols.map(x=>[x.name,x.type,x.notnull,x.pk]),expectedColumns));
 need(eq((await query('index')).map(x=>x.name),['ingredient_id','location_id']));
 need((await query('foreign')).length===0);
 single(await query('quick'),'quick_check','ok');
 need(eq(await query('users'),[{
  id:fixture.owner,username:'g6-synthetic-owner',display_name:'G6 Synthetic',
  role:'owner',password_salt:'nonsecret_salt',password_hash:'nonsecret_hash',active:1
 }]));
 need(eq(await query('locations'),[{
  id:fixture.location,name:'G6 Synthetic Store',active:1
 }]));
 need(eq(await query('ingredients'),[{
  id:fixture.ingredient,sku:'G6-SYNTH-001',name:'G6 Synthetic Ingredient',
  unit:'kg',min_stock:0,active:1
 }]));
 const movements=await query('moves');
 need(movements.length===expectedMoves.length);
 for(let i=0;i<movements.length;i++){
  const [id,qty,kind,ref,note,time]=expectedMoves[i];
  need(eq(movements[i],{
   id,ingredient_id:fixture.ingredient,location_id:fixture.location,qty_delta:qty,
   move_type:kind,reference_id:ref,note,actor_id:fixture.owner,created_at:TIME+time
  }));
 }
 need(eq(await query('audit'),[{
  id:'g6-audit-01',actor_id:fixture.owner,actor_name:'G6 Synthetic',
  action:'stock.usage',entity:'stock_moves',entity_id:'g6-m02',
  location_id:fixture.location,detail:'{}'
 }]));
 need(eq(await query('auditTimeline'),[{
  id:'g6-audit-01',at:'2026-11-01 11:30:00'
 }]));
 need(eq(await query('prices'),[{
  id:'g6-price-01',ingredient_id:fixture.ingredient,location_id:fixture.location,
  price_date:'2026-11-01',price_cents:2300,unit:'kg',
  supplier:'G6 Synthetic Supplier',source:'manual',created_by:fixture.owner
 }]));
 return Object.freeze({
  status:'G6_STOCK_V4_REMOTE_READONLY_POSTFLIGHT_PASS',
  pinned_identity_verified:true,versioned_migration_receipts_verified:3,
  cloud_schema_contract:3,stock_move_kind_contract:4,
  synthetic_ledger_rows_verified:movements.length,
  synthetic_audit_rows_verified:1,synthetic_price_rows_verified:1,
  fk_check_pass:true,quick_check_pass:true,v4_constraints_inspected:true,
  exact_reviewed_v4_ddl_verified:true,foreign_key_definitions_verified:3,
  other_business_tables_verified_empty:true,
  exact_business_table_inventory_verified:true,
  unexpected_views_and_triggers_absent:true,
  exact_migration_id_sequence_verified:true,
  remote_write_performed:false,
  remote_migration_performed_by_this_tool:false,remote_restore_performed:false,
  production_gate_modified:false,release_authorized:false
 });
}
export async function cloudflarePostflightRead(pin,token,method,url,body,fetchImpl=fetch){
 const base=approvedPath(pin);
 need(typeof fetchImpl==='function'&&typeof token==='string'&&token.length>12);
 need((method==='GET'&&url===base&&body===null)||
  (method==='POST'&&url===base+'/query'&&
   exact(body,['sql'])&&Object.values(SQL).includes(body.sql)));
 let response;
 try{response=await fetchImpl(HOST+url,{
  method,redirect:'error',cache:'no-store',
  headers:{Authorization:'Bearer '+token,Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json'}:{})},
  ...(method==='POST'?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(15000)
 });}catch{fail();}
 need(response?.ok===true);
 let raw;
 try{raw=await response.text();}catch{fail();}
 need(typeof raw==='string'&&raw.length>0&&raw.length<=262144);
 let responseJSON;
 try{responseJSON=JSON.parse(raw);}catch{fail();}
 need(responseJSON?.success===true);
 return responseJSON;
}
function reviewedPin(){
 const p=path.join(ROOT,'cloudflare/stock-v4-disposable-target.json');
 const st=fs.lstatSync(p);
 need(st.isFile()&&!st.isSymbolicLink()&&st.size>0&&st.size<2048);
 const pin=JSON.parse(fs.readFileSync(p,'utf8'));
 approvedPath(pin);return pin;
}
const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
 try{
  need(process.argv.length===3&&process.argv[2]==='inspect'&&
   process.env.GITHUB_ACTIONS==='true'&&
   process.env.GITHUB_REF==='refs/heads/main'&&
   process.env.G6_V4_POSTFLIGHT_CONFIRM==='CHECK_G6_V4_POSTFLIGHT_READONLY'&&
   process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID);
  const pin=reviewedPin(),token=process.env.CLOUDFLARE_API_TOKEN;
  need(typeof token==='string'&&token.length>12);
  console.log(JSON.stringify(await verifyG6V4Postflight(pin,
   (m,u,b)=>cloudflarePostflightRead(pin,token,m,u,b))));
 }catch{
  // Never expose D1 identifier, SQL query results, fixture values or token.
  console.error('G6_STOCK_V4_POSTFLIGHT_READONLY_FAILED; no retries or writes.');
  process.exitCode=1;
 }
}
export {fixture as SYNTHETIC_IDS,expectedMoves as SYNTHETIC_MOVES};
