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
export const SQL=Object.freeze({
 receipts:'SELECT name FROM d1_migrations ORDER BY id;',
 schema:'SELECT contract_version FROM cloud_schema_contract WHERE id=1;',
 version:'SELECT kind_version FROM stock_move_kind_contract WHERE id=1;',
 objects:"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('stock_moves','stock_moves_stock','stock_moves_v4','stock_move_kind_contract') ORDER BY name,type;",
 columns:'PRAGMA table_info(stock_moves);',
 index:'PRAGMA index_info(stock_moves_stock);',
 foreign:'PRAGMA foreign_key_check;',
 quick:'PRAGMA quick_check;',
 users:'SELECT id,username,role FROM users ORDER BY id;',
 locations:'SELECT id,name FROM locations ORDER BY id;',
 ingredients:'SELECT id,sku,name,unit FROM ingredients ORDER BY id;',
 moves:'SELECT id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at FROM stock_moves ORDER BY id;',
 audit:'SELECT id,actor_id,actor_name,action,entity,entity_id,location_id,detail FROM audit_logs ORDER BY id;',
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
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const single=(list,key,value)=>need(list.length===1&&
 exact(list[0],[key])&&list[0][key]===value);
export async function verifyG6V4Postflight(pin,io){
 const base=approvedPath(pin);
 need(typeof io==='function');
 const metadata=await io('GET',base,null);
 need(metadata?.success===true&&metadata.result?.uuid===pin.database_id&&
  metadata.result?.name===NAME&&metadata.result?.version==='production');
 const query=async name=>rows(await io('POST',base+'/query',{sql:SQL[name]}));
 const receipts=await query('receipts');
 need(eq(receipts,[
  {name:'0001_initial_v3.sql'},
  {name:'0002_login_attempts_window_indexes.sql'},
  {name:'0004_stock_move_kinds.sql'}
 ]));
 single(await query('schema'),'contract_version',3);
 single(await query('version'),'kind_version',4);
 const objects=await query('objects');
 need(objects.length===3&&eq(objects.map(x=>[x.type,x.name,x.tbl_name]),[
  ['table','stock_move_kind_contract','stock_move_kind_contract'],
  ['table','stock_moves','stock_moves'],
  ['index','stock_moves_stock','stock_moves']
 ].sort((a,b)=>a[1].localeCompare(b[1])).sort((a,b)=>a[1]<b[1]?-1:a[1]>b[1]?1:0)));
 // Check exact names separately; SQLite order is lexical under ORDER BY name.
 const names=objects.map(x=>x.name).sort();
 need(eq(names,['stock_move_kind_contract','stock_moves','stock_moves_stock']));
 const ddl=objects.find(x=>x.name==='stock_moves')?.sql;
 need(typeof ddl==='string'&&
  /move_type\s+IN\s*\(\s*'purchase'\s*,\s*'usage'\s*,\s*'adjustment'\s*,\s*'supplier_return'\s*,\s*'scrap'\s*\)/i.test(ddl)&&
  /qty_delta\s*<\s*0/i.test(ddl)&&
  /length\s*\(\s*trim\s*\(\s*note\s*\)\s*\)\s+BETWEEN\s+1\s+AND\s+300/i.test(ddl)&&
  /length\s*\(\s*trim\s*\(\s*reference_id\s*\)\s*\)\s+BETWEEN\s+1\s+AND\s+100/i.test(ddl));
 const cols=await query('columns');
 need(eq(cols.map(x=>x.name),[
  'id','ingredient_id','location_id','qty_delta','move_type',
  'reference_id','note','actor_id','created_at'
 ])&&cols[0]?.pk===1);
 need(eq((await query('index')).map(x=>x.name),['ingredient_id','location_id']));
 need((await query('foreign')).length===0);
 single(await query('quick'),'quick_check','ok');
 need(eq(await query('users'),[{id:fixture.owner,username:'g6-synthetic-owner',role:'owner'}]));
 need(eq(await query('locations'),[{id:fixture.location,name:'G6 Synthetic Store'}]));
 need(eq(await query('ingredients'),[{
  id:fixture.ingredient,sku:'G6-SYNTH-001',name:'G6 Synthetic Ingredient',unit:'kg'
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
  real_business_data_seen:false,remote_write_performed:false,
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
