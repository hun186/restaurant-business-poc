// P0 #34 G5: destructive restore rehearsal on a separately reviewed DISPOSABLE D1 only.
// NO PRODUCTION/STAGING DATA. Never enroll a database without a reviewed target-file PR.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ACCOUNT_ID,PROD_ID,STAGING_ID} from './check-cloudflare-staging.mjs';

const TARGET_FILE='cloudflare/recovery-drill-target.json';
const HOST='https://api.cloudflare.com/client/v4';
const NAME='restaurant-business-g5-disposable-recovery-drill';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKMARK=/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i;
const SQL=Object.freeze({
 objects:"SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name;",
 create:"CREATE TABLE g5_disposable_probe (id INTEGER PRIMARY KEY, label TEXT NOT NULL);",
 seed:"INSERT INTO g5_disposable_probe (id,label) VALUES (1,'synthetic-original');",
 baseline:"SELECT id,label FROM g5_disposable_probe ORDER BY id;",
 change:"UPDATE g5_disposable_probe SET label='synthetic-modified' WHERE id=1;",
 later:"INSERT INTO g5_disposable_probe (id,label) VALUES (2,'synthetic-after-checkpoint');",
 quick:"PRAGMA quick_check;"
});
const fail=()=>{throw new Error('E_G5_DISPOSABLE_D1_RESTORE_GUARD');};
function need(ok){if(!ok)fail();}
function exactKeys(o,k){need(o&&typeof o==='object'&&!Array.isArray(o)&&
 JSON.stringify(Object.keys(o).sort())===JSON.stringify([...k].sort()));}
export function approvedTarget(pin,account=ACCOUNT_ID){
 exactKeys(pin,['database_name','database_id']);
 need(account===ACCOUNT_ID&&pin.database_name===NAME&&
   UUID.test(pin.database_id)&&pin.database_id!==PROD_ID&&
   pin.database_id!==STAGING_ID);
 return Object.freeze({id:pin.database_id,name:pin.database_name});
}
function parseMeta(reply,target){
 need(reply?.success===true&&reply.result?.uuid===target.id&&
  reply.result?.name===NAME&&reply.result?.version==='production');
}
function parseBookmark(reply){
 need(reply?.success===true&&typeof reply.result?.bookmark==='string'&&
  BOOKMARK.test(reply.result.bookmark));
 return reply.result.bookmark; // kept only in process memory, never printed.
}
function sqlRows(reply){
 need(reply?.success===true&&Array.isArray(reply.result)&&reply.result.length===1&&
   reply.result[0]?.success===true&&Array.isArray(reply.result[0].results));
 return reply.result[0].results;
}
function quickOk(rows){need(rows.length===1&&rows[0].quick_check==='ok');}
function baselineOk(rows){need(rows.length===1&&rows[0].id===1&&rows[0].label==='synthetic-original');}
function changedOk(rows){need(rows.length===2&&rows[0].id===1&&rows[0].label==='synthetic-modified'&&
 rows[1].id===2&&rows[1].label==='synthetic-after-checkpoint');}
function pristineOk(rows){
 need(rows.length>=1);
 let reserved=0;
 for(const row of rows){
  exactKeys(row,['type','name','tbl_name']);
  if(row.type==='table'&&row.name==='_cf_KV'&&row.tbl_name==='_cf_KV'){reserved++;continue;}
  // Only Cloudflare's reserved D1 system index is accepted, never any business object.
  need(row.type==='index'&&row.tbl_name==='_cf_KV'&&row.name.startsWith('_cf_'));
 }
 need(reserved===1);
}
function postRestoreOk(rows){
 need(rows.length>=2);
 let reserved=0,probe=0;
 for(const row of rows){
   exactKeys(row,['type','name','tbl_name']);
   if(row.type==='table'&&row.name==='_cf_KV'&&row.tbl_name==='_cf_KV'){reserved++;continue;}
   if(row.type==='table'&&row.name==='g5_disposable_probe'&&row.tbl_name==='g5_disposable_probe'){probe++;continue;}
   need(row.type==='index'&&row.tbl_name==='_cf_KV'&&row.name.startsWith('_cf_'));
 }
 need(reserved===1&&probe===1);
}
const base=id=>'/accounts/'+ACCOUNT_ID+'/d1/database/'+id;
const message={production_restore_performed:false,production_migration_performed:false,
 production_login_enabled:false,production_ready:false,
 encrypted_offsite_backup_verified:false,recovery_signoff_granted:false};
function planEndpoints(target){
 const p=base(target.id);
 return Object.freeze({meta:p,query:p+'/query',bookmark:p+'/time_travel/bookmark',
   restore:p+'/time_travel/restore'});
}
export async function inspectDisposable(pin,io){
 const target=approvedTarget(pin);
 need(typeof io==='function');
 const paths=planEndpoints(target);
 parseMeta(await io('GET',paths.meta,null),target);
 pristineOk(sqlRows(await io('POST',paths.query,{sql:SQL.objects})));
 quickOk(sqlRows(await io('POST',paths.query,{sql:SQL.quick})));
 parseBookmark(await io('GET',paths.bookmark,null));
 return Object.freeze({status:'G5_DISPOSABLE_D1_PRISTINE_READONLY_PASS',
  isolated_disposable_target:true,remote_restore_rehearsal_verified:false,...message});
}
export async function runDisposableDrill(pin,io,clock=()=>Date.now()){
 const target=approvedTarget(pin);
 need(typeof io==='function'&&typeof clock==='function');
 const paths=planEndpoints(target);
 // The same protected GitHub job serializes this process. Concurrent edits made
 // by other Cloudflare users outside GitHub are NOT prevented; use a change window.
 parseMeta(await io('GET',paths.meta,null),target);
 pristineOk(sqlRows(await io('POST',paths.query,{sql:SQL.objects})));
 quickOk(sqlRows(await io('POST',paths.query,{sql:SQL.quick})));
 // Following operations mutate ONLY the reviewed disposable database UUID.
 sqlRows(await io('POST',paths.query,{sql:SQL.create}));
 sqlRows(await io('POST',paths.query,{sql:SQL.seed}));
 baselineOk(sqlRows(await io('POST',paths.query,{sql:SQL.baseline})));
 const checkpoint=parseBookmark(await io('GET',paths.bookmark,null));
 sqlRows(await io('POST',paths.query,{sql:SQL.change}));
 sqlRows(await io('POST',paths.query,{sql:SQL.later}));
 changedOk(sqlRows(await io('POST',paths.query,{sql:SQL.baseline})));
 const t0=clock();
 const response=await io('POST',paths.restore+'?bookmark='+encodeURIComponent(checkpoint),null);
 need(response?.success===true&&response?.result&&
   typeof response.result.previous_bookmark==='string'&&BOOKMARK.test(response.result.previous_bookmark)&&
   typeof response.result.bookmark==='string'&&BOOKMARK.test(response.result.bookmark));
 const rows=sqlRows(await io('POST',paths.query,{sql:SQL.baseline}));
 baselineOk(rows);
 postRestoreOk(sqlRows(await io('POST',paths.query,{sql:SQL.objects})));
 quickOk(sqlRows(await io('POST',paths.query,{sql:SQL.quick})));
 const elapsed=clock()-t0;
 need(Number.isFinite(elapsed)&&elapsed>=0&&elapsed<3600000);
 return Object.freeze({status:'G5_DISPOSABLE_D1_REMOTE_RESTORE_VERIFIED',
   isolated_disposable_target:true,remote_restore_rehearsal_verified:true,
   observed_restore_and_verify_ms:Math.round(elapsed),
   ...message});
}
export async function cloudflareRequest(target,token,method,url,body,fetchImpl=fetch){
 const t=approvedTarget(target);
 const paths=planEndpoints(t);
 need(typeof token==='string'&&token.length>12&&typeof fetchImpl==='function');
 let isValid=false;
 if(method==='GET'&&body===null)
   isValid=url===paths.meta||url===paths.bookmark;
 if(method==='POST'&&url===paths.query)
   isValid=body&&typeof body.sql==='string'&&
     Object.values(SQL).includes(body.sql)&&Object.keys(body).length===1;
 if(method==='POST'&&body===null&&url.startsWith(paths.restore+'?bookmark=')){
   const q=url.slice((paths.restore+'?bookmark=').length);
   isValid=BOOKMARK.test(q)&&!q.includes('%');
 }
 need(isValid);
 const response=await fetchImpl(HOST+url,{
   method,redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/json',
     ...(method==='POST'&&body!==null?{'Content-Type':'application/json'}:{})},
   ...(body!==null?{body:JSON.stringify(body)}:{}),
   signal:AbortSignal.timeout(15000)
 });
 need(response?.ok===true);
 const raw=await response.text();
 need(typeof raw==='string'&&raw.length>0&&raw.length<=65536);
 try{const v=JSON.parse(raw);need(v?.success===true);return v;}catch{fail();}
}
function readPin(){
 const x=fs.lstatSync(TARGET_FILE);need(x.isFile()&&!x.isSymbolicLink()&&x.size<1024);
 return JSON.parse(fs.readFileSync(TARGET_FILE,'utf8'));
}
const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
 try{
  const [mode,...args]=process.argv.slice(2);
  need(args.length===0&&['inspect','drill'].includes(mode));
  need(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REF==='refs/heads/main'&&
    process.env.CLOUDFLARE_ACCOUNT_ID===ACCOUNT_ID);
  const pin=readPin(),target=approvedTarget(pin);
  const token=process.env.CLOUDFLARE_API_TOKEN;
  need(typeof token==='string'&&token.length>12);
  if(mode==='inspect'){
    need(process.env.G5_DRILL_CONFIRM==='CHECK_DISPOSABLE_D1_READONLY');
    console.log(JSON.stringify(await inspectDisposable(pin,
      (method,url,body)=>cloudflareRequest(pin,token,method,url,body))));
  }else{
    // A code-reviewed pin is required, plus a separate approved write environment.
    need(process.env.G5_DRILL_CONFIRM==='RESTORE_DISPOSABLE_D1_ONLY'&&
      process.env.G5_DRILL_APPROVED_SHA===process.env.GITHUB_SHA&&
      process.env.G5_DRILL_APPROVED_ID===target.id&&
      process.env.G5_DRILL_APPROVAL==='DISPOSABLE_RESTORE_AUTHORIZED'&&
      process.env.G5_DRILL_BINDINGS_ATTESTED==='NO_DISPOSABLE_D1_WORKER_BINDING'&&
      process.env.G5_DRILL_EXCLUSIVE_ATTESTED==='DISPOSABLE_D1_NO_CONCURRENT_USERS');
    console.log(JSON.stringify(await runDisposableDrill(pin,
      (method,url,body)=>cloudflareRequest(pin,token,method,url,body))));
  }
 }catch{
  // Deliberately do not print bookmark, D1 ID, Cloudflare API errors, token or SQL rows.
  console.error('G5_DISPOSABLE_D1_RESTORE_CHECK_FAILED; no automatic retries.');
  process.exitCode=1;
 }
}
export {SQL};
