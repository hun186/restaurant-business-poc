// P0 G5: read-only Production D1 Time Travel capability audit and local synthetic restore.
// Absolutely no Cloudflare Time Travel restore, Production D1 mutation, or data export.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID,PROD_ID} from './check-cloudflare-staging.mjs';
import {verifyProductionTarget} from './cloudflare-prod-d1-init.mjs';

const HOST='https://api.cloudflare.com/client/v4';
const PATH='/accounts/'+ACCOUNT_ID+'/d1/database/'+PROD_ID;
const BOOKMARK_RE=/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i;
const error=()=>{throw new Error('E_G5_RECOVERY_READONLY');};
const must=x=>{if(!x)error();};
const sha=buf=>createHash('sha256').update(buf).digest('hex');
const safeResults={production_migration_performed:false,production_restore_performed:false,
  remote_restore_rehearsal_verified:false,offsite_encrypted_backup_verified:false,
  recovery_signoff_granted:false,production_ready:false};

export function checkD1Metadata(meta,bookmark){
 must(meta?.success===true&&meta.result&&
   meta.result.uuid===PROD_ID&&
   meta.result.name==='restaurant-business-prod'&&
   meta.result.version==='production');
 must(bookmark?.success===true&&
   typeof bookmark.result?.bookmark==='string'&&
   BOOKMARK_RE.test(bookmark.result.bookmark));
 // NEVER return/bookmark; not even its digest or a timestamp derived from it.
 return Object.freeze({status:'G5_PROD_D1_TIME_TRAVEL_READONLY_CAPABILITY_PASS',
   backend:'production',current_bookmark_retrieved:true,
   ...safeResults});
}
export async function inspectRemote(read){
 must(typeof read==='function');
 const meta=await read(PATH);
 const bookmark=await read(PATH+'/time_travel/bookmark');
 return checkD1Metadata(meta,bookmark);
}
export async function cloudflareReadOnly(suffix,token,fetchImpl=fetch){
 must((suffix===PATH||suffix===PATH+'/time_travel/bookmark')&&
   typeof token==='string'&&token.length>12&&typeof fetchImpl==='function');
 const response=await fetchImpl(HOST+suffix,{
   method:'GET',
   redirect:'error',
   headers:{Authorization:'Bearer '+token,Accept:'application/json'},
   signal:AbortSignal.timeout(15000)
 });
 must(response?.ok===true);
 const body=await response.text();
 must(typeof body==='string'&&body.length>0&&body.length<=65536);
 let parsed;
 try{parsed=JSON.parse(body);}catch{error();}
 must(parsed?.success===true);
 return parsed;
}
function sqliteQuick(db){
 must(db.prepare('PRAGMA quick_check').get()?.quick_check==='ok');
}
export function isolatedSyntheticRestore(){
 const prefix='restaurant-g5-recovery-synthetic-';
 const root=fs.mkdtempSync(path.join(os.tmpdir(),prefix));
 // Create ONLY in a newly owned temporary folder; never open data/, backups/, D1 or user paths.
 const origin=path.join(root,'synthetic-source.sqlite');
 const snapshot=path.join(root,'synthetic-snapshot.sqlite');
 const recovered=path.join(root,'synthetic-recovered.sqlite');
 let db;
 try{
   db=new DatabaseSync(origin);
   db.exec("CREATE TABLE recovery_probe(id INTEGER PRIMARY KEY, label TEXT NOT NULL);");
   db.prepare('INSERT INTO recovery_probe(id,label) VALUES (?,?)').run(1,'synthetic-original');
   db.prepare('INSERT INTO recovery_probe(id,label) VALUES (?,?)').run(2,'synthetic-checkpoint');
   sqliteQuick(db);
   // SQLite-only recovery rehearsal: not a simulation of Cloudflare Time Travel internals.
   db.exec("VACUUM INTO '"+snapshot.replaceAll("'","''")+"';");
   const snapshotDigest=sha(fs.readFileSync(snapshot));
   db.prepare('UPDATE recovery_probe SET label=? WHERE id=1').run('synthetic-later-change');
   must(db.prepare('SELECT label FROM recovery_probe WHERE id=1').get()?.label==='synthetic-later-change');
   db.close();db=undefined;
   fs.copyFileSync(snapshot,recovered,fs.constants.COPYFILE_EXCL);
   must(sha(fs.readFileSync(recovered))===snapshotDigest);
   const restored=new DatabaseSync(recovered,{readOnly:true});
   try{
     sqliteQuick(restored);
     const rows=restored.prepare('SELECT id,label FROM recovery_probe ORDER BY id').all();
     must(rows.length===2&&rows[0].id===1&&
       rows[0].label==='synthetic-original'&&rows[1].id===2&&
       rows[1].label==='synthetic-checkpoint');
   }finally{restored.close();}
   const modified=new DatabaseSync(origin,{readOnly:true});
   try{
     must(modified.prepare('SELECT label FROM recovery_probe WHERE id=1').get()?.label==='synthetic-later-change');
   }finally{modified.close();}
   return Object.freeze({status:'G5_ISOLATED_SYNTHETIC_SQLITE_RESTORE_PASS',
     synthetic_rows_verified:2,snapshot_integrity_verified:true,
     source_database_preserved:true,temporary_files_removed_after_run:true,
     ...safeResults});
 }finally{
   if(db)db.close();
   must(path.basename(root).startsWith(prefix)&&path.dirname(root)===os.tmpdir());
   fs.rmSync(root,{recursive:true,force:true});
 }
}
function localConfig(){
 const worker=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
 const staging=JSON.parse(fs.readFileSync('wrangler.preview-migrations.jsonc','utf8'));
 const prod=JSON.parse(fs.readFileSync('wrangler.production-initialize.jsonc','utf8'));
 return verifyProductionTarget(worker,staging,prod,process.env.CLOUDFLARE_ACCOUNT_ID);
}
const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
 try{
   const [mode,...args]=process.argv.slice(2);
   must(args.length===0);
   if(mode==='synthetic'){
     console.log(JSON.stringify(isolatedSyntheticRestore()));
   }else if(mode==='remote'){
     must(process.env.GITHUB_ACTIONS==='true'&&
       process.env.GITHUB_REF==='refs/heads/main'&&
       process.env.G5_RECOVERY_READONLY_CONFIRM==='CHECK_PROD_D1_RECOVERY_READONLY');
     localConfig();
     const token=process.env.CLOUDFLARE_API_TOKEN;
     must(typeof token==='string'&&token.length>12);
     console.log(JSON.stringify(await inspectRemote(p=>cloudflareReadOnly(p,token))));
   }else error();
 }catch{
   console.error('G5_RECOVERY_READONLY_CHECK_FAILED');
   process.exitCode=1;
 }
}
