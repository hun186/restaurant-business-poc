// Fixed, read-only Production v3 stock-migration source inspector. No data writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID,PROD_ID,STAGING_ID} from './check-cloudflare-staging.mjs';
const HOST='https://api.cloudflare.com/client/v4';
const BASE='/accounts/'+ACCOUNT_ID+'/d1/database/'+PROD_ID;
const FAIL='E_PROD_STOCK_V4_READONLY_PREFLIGHT';
const die=()=>{throw Error(FAIL);};
const need=x=>{if(!x)die();};
const KINDS=['purchase','usage','adjustment'];
const FIELDS=['id','ingredient_id','location_id','qty_delta','move_type','reference_id','note','actor_id','created_at'];
const EXPECTED_DDL=[
'CREATE TABLE stock_moves (',
' id TEXT PRIMARY KEY, ingredient_id TEXT NOT NULL REFERENCES ingredients(id),',
' location_id TEXT NOT NULL REFERENCES locations(id), qty_delta REAL NOT NULL CHECK(qty_delta != 0),',
" move_type TEXT NOT NULL CHECK(move_type IN ('purchase','usage','adjustment')),",
" reference_id TEXT, note TEXT NOT NULL DEFAULT '', actor_id TEXT REFERENCES users(id),",
' created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',')'].join('\n');
const EXPECTED_INDEX='CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id)';
const norm=x=>typeof x==='string'?x.trim().replace(/\s+/g,' ').replace(/;$/,''):'';
export const QUERIES=Object.freeze({
 migrations:'SELECT id,name FROM d1_migrations ORDER BY id',
 contract:'SELECT contract_version FROM cloud_schema_contract WHERE id=1',
 objects:"SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name IN ('stock_moves','stock_moves_stock','stock_move_kind_contract','stock_moves_v4') ORDER BY name",
 columns:'PRAGMA table_info(stock_moves)',
 index:'PRAGMA index_info(stock_moves_stock)',
 indexes:"SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='stock_moves' AND sql IS NOT NULL ORDER BY name",
 otherObjects:"SELECT type,name FROM sqlite_master WHERE type IN ('view','trigger')",
 kinds:'SELECT move_type,COUNT(*) AS n FROM stock_moves GROUP BY move_type ORDER BY move_type',
 quick:'PRAGMA quick_check',
 fk:'PRAGMA foreign_key_check',
 owner:"SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1"
});
const Q=Object.values(QUERIES);
need(Q.length===11&&Q.every(s=>/^(?:SELECT|PRAGMA)\b/.test(s)&&!s.includes(';')));
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 JSON.stringify(Object.keys(x).sort())===JSON.stringify([...keys].sort());
const num=x=>Number.isSafeInteger(x)&&x>=0;
const rows=reply=>{
 need(reply?.success===true&&Array.isArray(reply.result)&&reply.result.length===1&&
 reply.result[0]?.success===true&&Array.isArray(reply.result[0].results));
 return reply.result[0].results;
};
export function verifyProductionConfiguration(config){
 need(PROD_ID!==STAGING_ID&&config?.name==='restaurant-business-poc'&&
 Array.isArray(config.d1_databases)&&config.d1_databases.length===1);
 const b=config.d1_databases[0];
 need(b.binding==='DB'&&b.database_name==='restaurant-business-prod'&&
 b.database_id===PROD_ID&&b.migrations_dir==='cloudflare/migrations');
 return true;
}
export function auditStockV3(meta,replies){
 need(meta?.success===true&&meta.result?.uuid===PROD_ID&&
 meta.result?.name==='restaurant-business-prod'&&meta.result?.version==='production');
 need(exact(replies,Object.keys(QUERIES)));
 const r=Object.fromEntries(Object.entries(replies).map(([k,v])=>[k,rows(v)]));
 need(r.migrations.length===2&&r.migrations.every((m,i)=>exact(m,['id','name'])&&m.id===i+1&&
 m.name===['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'][i]));
 need(r.contract.length===1&&exact(r.contract[0],['contract_version'])&&r.contract[0].contract_version===3);
 need(r.objects.length===2);
 const table=r.objects.find(o=>o.name==='stock_moves');
 const idx=r.objects.find(o=>o.name==='stock_moves_stock');
 need(table&&exact(table,['type','name','tbl_name','sql'])&&table.type==='table'&&
 table.tbl_name==='stock_moves'&&norm(table.sql)===norm(EXPECTED_DDL));
 need(idx&&exact(idx,['type','name','tbl_name','sql'])&&idx.type==='index'&&
 idx.tbl_name==='stock_moves'&&norm(idx.sql)===norm(EXPECTED_INDEX));
 need(r.columns.length===FIELDS.length&&r.columns.every((o,i)=>o?.name===FIELDS[i]));
 need(r.index.length===2&&r.index.map(o=>o?.name).join(',')==='ingredient_id,location_id');
 need(r.indexes.length===1&&r.indexes[0]?.name==='stock_moves_stock'&&
 norm(r.indexes[0]?.sql)===norm(EXPECTED_INDEX));
 need(r.otherObjects.length===0&&r.quick.length===1&&r.quick[0]?.quick_check==='ok'&&r.fk.length===0);
 need(r.owner.length===1&&exact(r.owner[0],['n'])&&r.owner[0].n===1);
 const counts=Object.fromEntries(KINDS.map(k=>[k,0])),seen=new Set();
 for(const item of r.kinds){
 need(exact(item,['move_type','n'])&&KINDS.includes(item.move_type)&&
 !seen.has(item.move_type)&&num(item.n));
 seen.add(item.move_type);counts[item.move_type]=item.n;
 }
 const total=Object.values(counts).reduce((a,b)=>a+b,0);
 need(Number.isSafeInteger(total));
 return Object.freeze({status:'PROD_STOCK_V4_REMOTE_V3_READONLY_PREFLIGHT_PASS',
 production_target_verified:true,contract_version:3,applied_migrations:2,
 legacy_stock_move_rows:total,legacy_movement_counts:counts,
 migration_executed:false,production_write_performed:false,
 restore_performed:false,production_gate_enabled:false,release_authorized:false});
}
export async function cloudflareReadOnly(target,token,method,sql=null,fetchImpl=fetch){
 need(target===BASE&&typeof token==='string'&&token.length>12&&typeof fetchImpl==='function'&&
 ((method==='GET'&&sql===null)||(method==='POST'&&Q.includes(sql))));
 const response=await fetchImpl(HOST+target+(method==='POST'?'/query':''),{
 method,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/json',
 ...(method==='POST'?{'Content-Type':'application/json'}:{})},
 ...(method==='POST'?{body:JSON.stringify({sql})}:{}),
 signal:AbortSignal.timeout(15000)});
 need(response?.ok===true);
 const raw=await response.text();need(typeof raw==='string'&&raw.length>0&&raw.length<=65536);
 let obj;try{obj=JSON.parse(raw);}catch{die();}
 need(obj?.success===true);return obj;
}
export async function inspectRemote(io){
 need(typeof io==='function');
 const meta=await io('GET',null),replies={};
 for(const [key,sql] of Object.entries(QUERIES))replies[key]=await io('POST',sql);
 return auditStockV3(meta,replies);
}
const self=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 try{
 need(process.argv.length===3&&process.argv[2]==='inspect'&&
 process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REF==='refs/heads/main'&&
 process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID&&
 process.env.STOCK_V4_READONLY_CONFIRM==='CHECK_PROD_STOCK_V3_READONLY');
 verifyProductionConfiguration(JSON.parse(fs.readFileSync('wrangler.jsonc','utf8')));
 const token=process.env.CLOUDFLARE_API_TOKEN;need(typeof token==='string'&&token.length>12);
 console.log(JSON.stringify(await inspectRemote((method,sql)=>
 cloudflareReadOnly(BASE,token,method,sql))));
 }catch{
 console.error(FAIL+'; no migration, no write, no automatic retries.');
 process.exitCode=1;
 }
}
