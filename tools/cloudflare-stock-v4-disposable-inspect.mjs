// G6 stock-v4 synthetic migration target: READ-ONLY identity/emptiness check.
// Only a separately pinned and reviewed target can pass. No D1 migration,
// restore, schema writes, Worker binding, production/staging or G5 mutation.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID,PROD_ID,STAGING_ID} from './check-cloudflare-staging.mjs';

const TARGET_FILE='cloudflare/stock-v4-disposable-target.json';
const G5_FILE='cloudflare/recovery-drill-target.json';
const HOST='https://api.cloudflare.com/client/v4';
const NAME='restaurant-business-stock-v4-disposable';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BOOKMARK=/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i;
const RETIRED_G5='cc3fe86d-1c46-4c2f-a399-0ec3c46d5198';
const FAIL='E_STOCK_V4_DISPOSABLE_TARGET_INSPECT';
const SQL=Object.freeze({
 objects:"SELECT type,name,tbl_name FROM sqlite_master WHERE substr(lower(name),1,7) <> 'sqlite_' ORDER BY type,name;",
 quick:'PRAGMA quick_check;'
});
const fail=()=>{throw Error(FAIL);};
const need=x=>{if(!x)fail();};
const keys=(obj,names)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&
 JSON.stringify(Object.keys(obj).sort())===JSON.stringify([...names].sort());
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function reviewedJSON(relative){
 const absolute=path.join(root,relative);
 const stat=fs.lstatSync(absolute);
 need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<2048);
 return JSON.parse(fs.readFileSync(absolute,'utf8'));
}
export function reviewedTarget(pin,g5=reviewedJSON(G5_FILE),account=ACCOUNT_ID){
 need(keys(pin,['database_name','database_id'])&&
  keys(g5,['database_name','database_id'])&&
  account===ACCOUNT_ID&&pin.database_name===NAME&&
  UUID.test(pin.database_id)&&
  pin.database_id!==PROD_ID&&pin.database_id!==STAGING_ID&&
  pin.database_id!==g5.database_id&&pin.database_id!==RETIRED_G5);
 // An enrollment PR is required to replace PENDING; never accept a freeform id.
 return Object.freeze({id:pin.database_id,name:NAME});
}
function parseSQL(reply){
 need(reply?.success===true&&Array.isArray(reply.result)&&reply.result.length===1&&
  reply.result[0]?.success===true&&Array.isArray(reply.result[0].results));
 return reply.result[0].results;
}
function pristine(rows){
 need(rows.length>=1);
 let reserved=0;
 for(const row of rows){
  need(keys(row,['type','name','tbl_name']));
  if(row.type==='table'&&row.name==='_cf_KV'&&row.tbl_name==='_cf_KV'){
   reserved++;continue;
  }
  need(row.type==='index'&&row.tbl_name==='_cf_KV'&&
   row.name.startsWith('_cf_'));
 }
 need(reserved===1);
}
function endpoints(target){
 const p='/accounts/'+ACCOUNT_ID+'/d1/database/'+target.id;
 return Object.freeze({meta:p,query:p+'/query',bookmark:p+'/time_travel/bookmark'});
}
export async function inspectIsolated(pin,io,g5){
 const target=reviewedTarget(pin,g5);
 need(typeof io==='function');
 const e=endpoints(target);
 const meta=await io('GET',e.meta,null);
 need(meta?.success===true&&meta.result?.uuid===target.id&&
  meta.result?.name===NAME&&meta.result?.version==='production');
 pristine(parseSQL(await io('POST',e.query,{sql:SQL.objects})));
 const quick=parseSQL(await io('POST',e.query,{sql:SQL.quick}));
 need(quick.length===1&&quick[0]?.quick_check==='ok');
 const mark=await io('GET',e.bookmark,null);
 need(mark?.success===true&&typeof mark.result?.bookmark==='string'&&
  BOOKMARK.test(mark.result.bookmark));
 return Object.freeze({
  status:'STOCK_V4_DISPOSABLE_PRISTINE_READONLY_PASS',
  isolated_target_identity_verified:true,
  empty_schema_verified:true,time_travel_bookmark_available:true,
  no_direct_worker_binding_certified:false,
  exclusive_use_verified:false,
  remote_v4_migration_performed:false,
  remote_restore_performed:false,
  production_write_performed:false,
  production_gate_modified:false,
  release_authorized:false
 });
}
export async function cloudflareRead(pin,token,method,url,body,fetchImpl=fetch,g5){
 const target=reviewedTarget(pin,g5),e=endpoints(target);
 need(typeof token==='string'&&token.length>12&&typeof fetchImpl==='function');
 const permitted=(method==='GET'&&body===null&&(url===e.meta||url===e.bookmark))||
  (method==='POST'&&url===e.query&&keys(body,['sql'])&&
   Object.values(SQL).includes(body.sql));
 need(permitted);
 const response=await fetchImpl(HOST+url,{
  method,redirect:'error',cache:'no-store',
  headers:{Authorization:'Bearer '+token,Accept:'application/json',
   ...(method==='POST'?{'Content-Type':'application/json'}:{})},
  ...(method==='POST'?{body:JSON.stringify(body)}:{}),
  signal:AbortSignal.timeout(15000)
 });
 need(response?.ok===true);
 const raw=await response.text();
 need(typeof raw==='string'&&raw.length>0&&raw.length<=65536);
 let data;try{data=JSON.parse(raw);}catch{fail();}
 need(data?.success===true);return data;
}
const self=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 try{
  need(process.argv.length===3&&process.argv[2]==='inspect'&&
   process.env.GITHUB_ACTIONS==='true'&&
   process.env.GITHUB_REF==='refs/heads/main'&&
   process.env.STOCK_V4_DISPOSABLE_CONFIRM==='CHECK_STOCK_V4_DISPOSABLE_READONLY'&&
   process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID);
  const pin=reviewedJSON(TARGET_FILE);
  const g5=reviewedJSON(G5_FILE);
  reviewedTarget(pin,g5);
  const token=process.env.CLOUDFLARE_API_TOKEN;
  need(typeof token==='string'&&token.length>12);
  console.log(JSON.stringify(await inspectIsolated(pin,
   (method,url,body)=>cloudflareRead(pin,token,method,url,body,fetch,g5),g5)));
 }catch{
  // Fail closed without leaking D1 identifiers, bookmarks, SQL or tokens.
  console.error(FAIL+'; no retries and no remote writes.');
  process.exitCode=1;
 }
}
export {SQL};
