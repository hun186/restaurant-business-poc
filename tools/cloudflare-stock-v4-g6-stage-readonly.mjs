// G6-only read-only checkpoint inventory for an isolated synthetic database.
// Every remote SQL string is inherited from the reviewed postflight allowlist.
// This diagnoses states after interruption; it never authorizes stage execution,
// retries, writes, migration, recovery, production changes or operator approval.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID} from './check-cloudflare-staging.mjs';
import {approvedG6BindingTarget} from './cloudflare-g5-binding-inventory.mjs';
import {SQL,verifyG6V4Postflight,cloudflarePostflightRead} from './cloudflare-stock-v4-g6-postflight.mjs';

const ERROR='G6_STAGE_READONLY_DIAGNOSTIC_FAILED';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const need=x=>{if(!x)throw Error(ERROR);};
const equal=(a,b)=>{
 if(Object.is(a,b))return true;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
 if(Array.isArray(a)!==Array.isArray(b))return false;
 if(Array.isArray(a))return a.length===b.length&&a.every((x,i)=>equal(x,b[i]));
 const ak=Object.keys(a).sort(),bk=Object.keys(b).sort();
 return equal(ak,bk)&&ak.every(k=>equal(a[k],b[k]));
};
const allTables=Object.freeze([
 'audit_logs','backup_settings','cloud_schema_contract','d1_migrations',
 'dish_ingredients','evaluations','ingredient_prices','ingredients',
 'leave_requests','locations','login_attempts','menu_dishes','purchase_orders',
 'repairs','sessions','shifts','stock_move_kind_contract','stock_moves',
 'stocktakes','tasks','training_courses','training_records','user_locations','users'
]);
const unusedTables=Object.freeze([
 'user_locations','sessions','login_attempts','tasks','purchase_orders',
 'stocktakes','repairs','shifts','leave_requests','training_courses',
 'training_records','evaluations','menu_dishes','dish_ingredients'
]);
const move=(id,qty,kind,ref,note,time)=>({
 id,ingredient_id:'g6-fixture-ingredient',location_id:'g6-fixture-location',
 qty_delta:qty,move_type:kind,reference_id:ref,note,
 actor_id:'g6-fixture-owner',created_at:'2026-11-01 '+time
});
const historicalMoves=Object.freeze([
 move('g6-m01',10,'purchase','g6-po-01','synthetic inbound','10:00:00'),
 move('g6-m02',-2,'usage',null,'synthetic usage','11:00:00')
]);
const finalMoves=Object.freeze([
 ...historicalMoves,
 move('g6-m03',-1,'supplier_return','g6-po-01','synthetic supplier return','12:00:00'),
 move('g6-m04',-0.5,'scrap',null,'synthetic scrap','13:00:00'),
 move('g6-m05',0.25,'adjustment',null,'synthetic recount','14:00:00')
]);
const v3Receipts=Object.freeze([
 {id:1,name:'0001_initial_v3.sql'},
 {id:2,name:'0002_login_attempts_window_indexes.sql'}
]);
const v4Receipts=Object.freeze([...v3Receipts,
 {id:3,name:'0004_stock_move_kinds.sql'}]);
const emptyBackup=Object.freeze([{
 id:1,interval_days:1,retention_count:50,last_auto_at:null,
 last_auto_name:null,last_fingerprint:null,last_result:null,last_error:null
}]);
function parseRows(data){
 need(data?.success===true&&Array.isArray(data.result)&&data.result.length===1&&
  data.result[0]?.success===true&&Array.isArray(data.result[0]?.results));
 return data.result[0].results;
}
function certificate(stage,migrationCount,moveCount){
 return Object.freeze({
  status:'G6_STAGE_READONLY_CLASSIFIED',
  stage,
  migration_receipts_verified:migrationCount,
  synthetic_ledger_rows_verified:moveCount,
  pinned_g6_identity_verified:true,
  negative_sql_guard:true,
  cloudflare_write_performed:false,
  cloudflare_migration_performed:false,
  restore_performed:false,
  exclusive_use_verified:false,
  indirect_access_verified:false,
  operator_attestation_verified:false,
  next_stage_execution_authorized:false,
  retry_authorized:false,
  production_gate_modified:false
 });
}
export async function diagnoseG6ReadOnlyStage(pin,io){
 // Validate pin before even issuing a metadata request.
 const id=approvedG6BindingTarget(pin);
 need(typeof io==='function');
 const base='/accounts/'+ACCOUNT_ID+'/d1/database/'+id;
 const read=async name=>{
  need(Object.hasOwn(SQL,name));
  try{return parseRows(await io('POST',base+'/query',{sql:SQL[name]}));}
  catch{throw Error(ERROR);}
 };
 let meta;
 try{meta=await io('GET',base,null);}catch{throw Error(ERROR);}
 need(meta?.success===true&&meta.result?.uuid===id&&
  meta.result?.name===pin.database_name&&meta.result?.version==='production');
 const tables=await read('tableNames');
 need(tables.every(row=>equal(Object.keys(row),['name'])&&typeof row.name==='string'));
 need(equal(await read('unexpectedObjects'),[]));
 need(equal(await read('foreign'),[]));
 need(equal(await read('quick'),[{quick_check:'ok'}]));
 const names=tables.map(x=>x.name);
 if(names.length===0){
  need(equal(await read('objects'),[]));
  return certificate(0,0,0);
 }
 const hasV4=names.includes('stock_move_kind_contract');
 const expected=(hasV4?allTables:allTables.filter(x=>x!=='stock_move_kind_contract'))
  .slice().sort();
 need(equal(names,expected));
 need(equal(await read('receipts'),hasV4?v4Receipts:v3Receipts));
 need(equal(await read('schema'),[{contract_version:3}]));
 need(equal(await read('backup'),emptyBackup));
 const unused=await read('unusedCounts');
 need(unused.length===1&&
  equal(Object.keys(unused[0]).sort(),unusedTables.slice().sort())&&
  unusedTables.every(k=>unused[0][k]===0));
 const objects=await read('objects');
 need(equal(objects.map(x=>[x.type,x.name,x.tbl_name]),
  hasV4?[
   ['table','stock_move_kind_contract','stock_move_kind_contract'],
   ['table','stock_moves','stock_moves'],
   ['index','stock_moves_stock','stock_moves']
  ]:[
   ['table','stock_moves','stock_moves'],
   ['index','stock_moves_stock','stock_moves']
  ]));
 if(hasV4){
  need(equal(await read('version'),[{kind_version:4}]));
  need((await read('foreignKeys')).length===3);
 }
 const users=await read('users'),locations=await read('locations'),
  ingredients=await read('ingredients'),moves=await read('moves'),
  audit=await read('audit'),prices=await read('prices');
 if(!hasV4&&moves.length===0){
  need(users.length===0&&locations.length===0&&ingredients.length===0&&
   audit.length===0&&prices.length===0);
  return certificate(1,2,0);
 }
 need(equal(users,[{
  id:'g6-fixture-owner',username:'g6-synthetic-owner',display_name:'G6 Synthetic',
  role:'owner',password_salt:'nonsecret_salt',password_hash:'nonsecret_hash',active:1
 }]));
 need(equal(locations,[{
  id:'g6-fixture-location',name:'G6 Synthetic Store',active:1
 }]));
 need(equal(ingredients,[{
  id:'g6-fixture-ingredient',sku:'G6-SYNTH-001',
  name:'G6 Synthetic Ingredient',unit:'kg',min_stock:0,active:1
 }]));
 need(equal(audit,[{
  id:'g6-audit-01',actor_id:'g6-fixture-owner',actor_name:'G6 Synthetic',
  action:'stock.usage',entity:'stock_moves',entity_id:'g6-m02',
  location_id:'g6-fixture-location',detail:'{}'
 }]));
 need(equal(prices,[{
  id:'g6-price-01',ingredient_id:'g6-fixture-ingredient',
  location_id:'g6-fixture-location',price_date:'2026-11-01',
  price_cents:2300,unit:'kg',supplier:'G6 Synthetic Supplier',
  source:'manual',created_by:'g6-fixture-owner'
 }]));
 if(!hasV4){
  need(equal(moves,historicalMoves));
  return certificate(2,2,2);
 }
 if(equal(moves,historicalMoves))return certificate(3,3,2);
 // Stage 4 is certified ONLY by the previously reviewed *complete*
 // postflight, including exact DDL, FK definitions, no unknown rows/objects.
 need(equal(moves,finalMoves));
 const full=await verifyG6V4Postflight(pin,io);
 need(full?.status==='G6_STOCK_V4_REMOTE_READONLY_POSTFLIGHT_PASS');
 return certificate(4,3,5);
}
function reviewedPin(){
 const file=path.join(ROOT,'cloudflare/stock-v4-disposable-target.json');
 const stat=fs.lstatSync(file);
 need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=2048);
 const pin=JSON.parse(fs.readFileSync(file,'utf8'));
 approvedG6BindingTarget(pin);
 return pin;
}
const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
 try{
  need(process.argv.length===3&&process.argv[2]==='inspect'&&
   process.env.GITHUB_ACTIONS==='true'&&
   process.env.GITHUB_REF==='refs/heads/main'&&
   process.env.G6_STAGE_READONLY_CONFIRM==='CHECK_G6_STAGE_READONLY'&&
   process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID);
  const pin=reviewedPin(),token=process.env.CLOUDFLARE_API_TOKEN;
  need(typeof token==='string'&&token.length>12);
  const receipt=await diagnoseG6ReadOnlyStage(pin,
   (method,url,body)=>cloudflarePostflightRead(pin,token,method,url,body));
  console.log(JSON.stringify(receipt));
 }catch{
  console.error(ERROR+'; no cloud database change or stage authorization.');
  process.exitCode=1;
 }
}
