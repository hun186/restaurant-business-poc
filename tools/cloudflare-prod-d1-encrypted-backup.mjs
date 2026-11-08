// Production D1 read-only SQL export -> locally encrypted archive, then offline replay.
// No Production SQL writes, migrations, imports, restore, or new Cloudflare databases.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createCipheriv,createDecipheriv,pbkdf2Sync,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createInterface} from 'node:readline/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {localProductionTarget,inspectProductionOwner} from './cloudflare-prod-owner-operator.mjs';
import {verifyExactMigrations} from './cloudflare-prod-d1-init.mjs';
import {EMPTY_TABLES} from './cloudflare-production-owner.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const APPROVAL='EXPORT_PRODUCTION_D1_TO_ENCRYPTED_LOCAL_BACKUP';
const FAIL='E_PRODUCTION_D1_BACKUP';
const HEADER='RBPOC_D1_AES256_GCM_SQL_V1';
const MAX_SQL_BYTES=32*1024*1024;
const MAX_RESP_BYTES=65536;
const ITERATIONS=310000;
// The official D1 Export API documents an opaque string, not a fixed UUID shape.
// Only allow bounded printable token characters; never log the bookmark.
const BOOKMARK=/^[A-Za-z0-9._:~-]{1,256}$/;
const PROGRESS_STATUS=/^[\x20-\x7E]{1,64}$/;
const EXTERNAL_HOST=/(\.cloudflarestorage\.com|\.r2\.dev|\.cloudflare\.com)$/i;
const FAIL_DETAILS=new Set(['RESPONSE_SHAPE','TASK_REJECTED','TASK_ERROR',
 'STATUS_INVALID','BOOKMARK_MISSING','BOOKMARK_INVALID','BOOKMARK_CHANGED',
 'COMPLETE_URL_MISSING']);
const fail=(reason='UNSAFE',detail)=>{
 const e=Error(FAIL);e.reason=reason;
 if(reason==='EXPORT_API'&&FAIL_DETAILS.has(detail))e.safeDetail=detail;
 throw e;
};
const isObj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const eqTarget=meta=>meta?.success===true&&meta.result?.name==='restaurant-business-prod'&&
 meta.result?.uuid===localProductionTarget().databaseId&&meta.result?.version==='production';
export const defaultDir=()=>path.join(os.homedir(),'RestaurantD1PrivateBackups');
export function privateDir(target=defaultDir()){
 if(typeof target!=='string'||!path.isAbsolute(target))fail('OUTPUT_PATH');
 const p=path.resolve(target),home=fs.realpathSync.native(os.homedir());
 if(p===home||p===ROOT||p.startsWith(ROOT+path.sep)||!p.startsWith(home+path.sep))
  fail('OUTPUT_PATH');
 if(!fs.existsSync(p))fs.mkdirSync(p,{recursive:true,mode:0o700});
 const real=fs.realpathSync.native(p);
 if(real!==p||!fs.lstatSync(p).isDirectory()||fs.lstatSync(p).isSymbolicLink())
  fail('OUTPUT_PATH');
 return p;
}
// Fail closed unless the encrypted copy can locally replay the *entire*
// reviewed v3 migration schema plus the two exact migration ledger entries.
export function verifyLocalSql(sql) {
 if(typeof sql!=='string'||!sql.trim()||
   Buffer.byteLength(sql,'utf8')>MAX_SQL_BYTES)fail('SQL_SIZE');
 let db;
 try{
  const migrationsDir=path.join(ROOT,'cloudflare','migrations');
  verifyExactMigrations(migrationsDir);
  const initial=fs.readFileSync(path.join(migrationsDir,'0001_initial_v3.sql'),'utf8');
  const second=fs.readFileSync(path.join(migrationsDir,'0002_login_attempts_window_indexes.sql'),'utf8');
  const expectedTables=[...initial.matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)]
   .map(m=>m[1]).concat('d1_migrations');
  const expectedIndexes=[...(initial+'\n'+second).matchAll(
   /CREATE\s+(?:UNIQUE\s+)?INDEX\s+([A-Za-z_][A-Za-z_0-9]*)\s+ON\s+/gi)].map(m=>m[1]);
  if(expectedTables.length!==23||new Set(expectedTables).size!==23||
    expectedIndexes.length<8||new Set(expectedIndexes).size!==expectedIndexes.length)
   fail('SQL_SCHEMA');
  db=new DatabaseSync(':memory:');
  db.exec(sql);
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')fail('SQL_INTEGRITY');
  if(db.prepare('PRAGMA foreign_key_check').all().length!==0)fail('SQL_FK');
  const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_cf_KV'").all()
   .map(row=>row.name).sort();
  if(JSON.stringify(names)!==JSON.stringify(expectedTables.sort()))fail('SQL_SCHEMA');
  const indexNames=db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND tbl_name <> '_cf_KV'").all()
   .map(row=>row.name).sort();
  if(JSON.stringify(indexNames)!==JSON.stringify(expectedIndexes.sort()))fail('SQL_SCHEMA');
  const contract=db.prepare('SELECT id,contract_version FROM cloud_schema_contract').all();
  const ledger=db.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(x=>x.name);
  if(contract.length!==1||contract[0].id!==1||contract[0].contract_version!==3||
     JSON.stringify(ledger)!==JSON.stringify(['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql']))
    fail('SQL_SCHEMA');
  // An exported pre-UAT database must be either pristine or contain EXACTLY
  // the single audited Owner bootstrap. Reject partial/mixed states, real
  // business data, login attempts, live sessions, or additional users/audits.
  const counts=Object.fromEntries(EMPTY_TABLES.map(table=>{
    const n=db.prepare('SELECT COUNT(*) AS n FROM '+table).get()?.n;
    if(!Number.isSafeInteger(n)||n<0)fail('SQL_OWNER_STATE');
    return [table,n];
  }));
  const empty=EMPTY_TABLES.every(table=>counts[table]===0);
  const enrolled=EMPTY_TABLES.every(table=>
    counts[table]===(table==='users'||table==='audit_logs'?1:0));
  if(!empty&&!enrolled)fail('SQL_OWNER_STATE');
  if(enrolled){
    const owner=db.prepare('SELECT id,username,role,active,password_salt,password_hash FROM users').get();
    const audit=db.prepare('SELECT actor_name,action,entity,entity_id,detail FROM audit_logs').get();
    let detail;
    try{detail=JSON.parse(audit?.detail);}catch{fail('SQL_OWNER_STATE');}
    if(typeof owner?.id!=='string'||!owner.id||
       owner.username!=='owner'||owner.role!=='owner'||owner.active!==1||
       !/^[0-9a-f]{32}$/.test(owner.password_salt||'')||
       !/^pbkdf2-sha256\\$100000\\$[0-9a-f]{64}$/.test(owner.password_hash||'')||
       audit?.actor_name!=='production-bootstrap'||audit?.action!=='auth.owner_bootstrap'||
       audit?.entity!=='users'||audit?.entity_id!==owner.id||
       !detail||typeof detail!=='object'||Array.isArray(detail)||
       Object.keys(detail).length!==1||detail.hash_version!=='pbkdf2-sha256$100000')
      fail('SQL_OWNER_STATE');
  }
  const owners=enrolled?1:0;
  return Object.freeze({schema_version:3,applied_migrations:2,owner_count:owners,
   owner_enrollment_audits:owners,
   local_sqlite_replay_verified:true,production_restore_performed:false,
   remote_restore_rehearsal_verified:false,offsite_encrypted_backup_verified:false});
 }catch(e){if(e.message===FAIL)throw e;fail('SQL_REPLAY');}
 finally{if(db)db.close();}
}
export function encryptSql(sql,passphrase){
 if(typeof passphrase!=='string'||passphrase.length<16||passphrase.length>256)
  fail('PASSPHRASE');
 const salt=randomBytes(16),iv=randomBytes(12);
 const key=pbkdf2Sync(passphrase,salt,ITERATIONS,32,'sha256');
 try{
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const enc=Buffer.concat([cipher.update(Buffer.from(sql,'utf8')),cipher.final()]);
  return Buffer.from(JSON.stringify({format:HEADER,iterations:ITERATIONS,
   salt:salt.toString('base64'),iv:iv.toString('base64'),
   tag:cipher.getAuthTag().toString('base64'),ciphertext:enc.toString('base64')}));
 }finally{key.fill(0);}
}
export function decryptSql(bytes,passphrase){
 if(!Buffer.isBuffer(bytes)||bytes.length>MAX_SQL_BYTES*2)fail('ARCHIVE_SIZE');
 let data;
 try{data=JSON.parse(bytes.toString('utf8'));}catch{fail('ARCHIVE_FORMAT');}
 if(!isObj(data)||data.format!==HEADER||data.iterations!==ITERATIONS||
   typeof data.salt!=='string'||typeof data.iv!=='string'||
   typeof data.tag!=='string'||typeof data.ciphertext!=='string')fail('ARCHIVE_FORMAT');
 const salt=Buffer.from(data.salt,'base64'),iv=Buffer.from(data.iv,'base64'),
  tag=Buffer.from(data.tag,'base64'),ciphertext=Buffer.from(data.ciphertext,'base64');
 if(salt.length!==16||iv.length!==12||tag.length!==16||
   ciphertext.length<16||ciphertext.length>MAX_SQL_BYTES)fail('ARCHIVE_FORMAT');
 const key=pbkdf2Sync(passphrase,salt,ITERATIONS,32,'sha256');
 try{
  const decipher=createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext),decipher.final()]).toString('utf8');
 }catch{fail('ARCHIVE_AUTH');}
 finally{key.fill(0);}
}
async function api(url,method,token,body,transport) {
 let res;
 try{res=await transport(url,{method,redirect:'error',cache:'no-store',
  headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},
  ...(method==='POST'?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 }catch{fail('NETWORK');}
 if(!res?.ok||res.status!==200)fail('HTTP');
 let raw;try{raw=await res.text();}catch{fail('NETWORK');}
 if(typeof raw!=='string'||raw.length>MAX_RESP_BYTES)fail('API_SHAPE');
 let data;try{data=JSON.parse(raw);}catch{fail('API_SHAPE');}
 if(!isObj(data)||data.success!==true)fail('API_SHAPE');
 return data;
}
export async function remoteExport({token,transport=fetch,pause=ms=>delay(ms)}){
 if(typeof token!=='string'||token.length<20||token.length>4096)fail('TOKEN');
 const target=localProductionTarget();
 const prefix='https://api.cloudflare.com/client/v4/accounts/'+target.accountId+
  '/d1/database/'+target.databaseId;
 const meta=await api(prefix,'GET',token,null,transport);
 if(!eqTarget(meta))fail('TARGET');
 let read;
 try{read=await inspectProductionOwner(token,transport);}catch{fail('OWNER_STATE');}
 if(read.status!=='PRODUCTION_OWNER_READY_TO_ENROLL_READONLY' &&
    read.status!=='PRODUCTION_OWNER_ALREADY_ENROLLED_READONLY')fail('OWNER_STATE');
 const endpoint=prefix+'/export';
 let bookmark='',signed='';
 for(let i=0;i<16;i++){
  const body={output_format:'polling'};
  if(bookmark)body.current_bookmark=bookmark;
  const next=await api(endpoint,'POST',token,body,transport);
  const r=next.result;
  // Wrangler's official export poller only treats "complete" and "error"
  // as terminal: other bounded status tokens are progress indicators.
  // The API docs do not publish an exhaustive list of progress statuses.
  // Never show server status, messages, error, bookmark, or signed URL.
  if(!isObj(r)||(r.type!==undefined&&r.type!=='export'))
   fail('EXPORT_API','RESPONSE_SHAPE');
  if(r.success!==true)fail('EXPORT_API','TASK_REJECTED');
  if(r.status==='error')fail('EXPORT_API','TASK_ERROR');
  if(r.status==='complete'){
   if(typeof r.result?.signed_url!=='string'||!r.result.signed_url)
    fail('EXPORT_API','COMPLETE_URL_MISSING');
   signed=r.result.signed_url;break;
  }
  // Accept opaque progress labels, but reject objects, control characters,
  // oversized values, and missing/changed bookmarks. Polling stays bounded.
  if(r.status!==undefined &&
    (typeof r.status!=='string'||!PROGRESS_STATUS.test(r.status)))
   fail('EXPORT_API','STATUS_INVALID');
  if(r.result!==undefined)fail('EXPORT_API','RESPONSE_SHAPE');
  if(typeof r.at_bookmark!=='string'||!r.at_bookmark)
   fail('EXPORT_API','BOOKMARK_MISSING');
  if(!BOOKMARK.test(r.at_bookmark))fail('EXPORT_API','BOOKMARK_INVALID');
  if(bookmark&&bookmark!==r.at_bookmark)fail('EXPORT_API','BOOKMARK_CHANGED');
  bookmark=r.at_bookmark;
  if(i<15)await pause(2000);
 }
 if(!signed)fail('EXPORT_TIMEOUT');
 let url;try{url=new URL(signed);}catch{fail('SIGNED_URL');}
 if(url.protocol!=='https:'||url.username||url.password||url.port||
    !EXTERNAL_HOST.test(url.hostname)||url.hostname.endsWith('..'))
  fail('SIGNED_URL');
 let download;try{
  download=await transport(url.href,{method:'GET',redirect:'error',
   cache:'no-store',signal:AbortSignal.timeout(30000)});
 }catch{fail('NETWORK');}
 if(!download?.ok||download.status!==200||!download.body?.getReader)fail('DOWNLOAD');
 const length=Number(download.headers?.get?.('content-length'));
 if(Number.isFinite(length)&&length>MAX_SQL_BYTES)fail('DOWNLOAD_SIZE');
 const chunks=[],reader=download.body.getReader();let bytes=0;
 try{
  for(;;){const {done,value}=await reader.read();if(done)break;
   if(!(value instanceof Uint8Array))fail('DOWNLOAD');
   bytes+=value.length;if(bytes>MAX_SQL_BYTES)fail('DOWNLOAD_SIZE');
   chunks.push(Buffer.from(value));}
 }catch{fail('DOWNLOAD');}
 finally{reader.releaseLock();}
 if(bytes<64)fail('DOWNLOAD_SIZE');
 const sql=Buffer.concat(chunks).toString('utf8');
 if(sql.includes('\uFFFD'))fail('DOWNLOAD_ENCODING');
 return sql;
}
export function sealedArchive(sql,passphrase,dir=defaultDir()){
 const verified=verifyLocalSql(sql),outDir=privateDir(dir);
 const filename='restaurant-prod-d1-'+new Date().toISOString().replace(/[:.]/g,'-')+
  '-'+randomBytes(4).toString('hex')+'.sql.aes';
 const final=path.join(outDir,filename),ciphertext=encryptSql(sql,passphrase);
 const check=decryptSql(ciphertext,passphrase);
 const after=verifyLocalSql(check);
 if(JSON.stringify(after)!==JSON.stringify(verified))fail('ARCHIVE_VERIFY');
 let fd;
 try{fd=fs.openSync(final,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
  fs.writeFileSync(fd,ciphertext);fs.fsyncSync(fd);
 }catch{if(fd!==undefined){fs.closeSync(fd);fd=undefined;try{fs.unlinkSync(final);}catch{}}
  fail('SAVE');
 }finally{if(fd!==undefined)fs.closeSync(fd);}
 return Object.freeze({status:'PROD_D1_ENCRYPTED_LOCAL_EXPORT_PASS',file:final,
  archive_sha256:createHash('sha256').update(ciphertext).digest('hex'),
  ...verified,production_write_performed:false,export_api_called:true,
  remote_restore_rehearsal_verified:false,offsite_encrypted_backup_verified:false,
  recovery_signoff_granted:false});
}
export function verifyArchive(file,passphrase) {
 if(typeof file!=='string'||!path.isAbsolute(file)||!file.endsWith('.sql.aes'))
  fail('VERIFY_PATH');
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_SQL_BYTES*2)fail('VERIFY_PATH');
 const bytes=fs.readFileSync(file),sql=decryptSql(bytes,passphrase);
 const v=verifyLocalSql(sql);
 return Object.freeze({status:'PROD_D1_ENCRYPTED_LOCAL_VERIFY_PASS',
  archive_sha256:createHash('sha256').update(bytes).digest('hex'),
  ...v,source_file_unchanged:true,production_write_performed:false});
}
// Offline only: compare an independently stored encrypted copy with the
// original ciphertext, then authenticate + replay BOTH archives in memory.
// It does not inspect media identity, assert physical offsite custody, or copy.
export function verifyIndependentCopy(originalFile,copyFile,passphrase){
 if(typeof originalFile!=='string'||typeof copyFile!=='string'||
    !path.isAbsolute(originalFile)||!path.isAbsolute(copyFile)||
    !originalFile.endsWith('.sql.aes')||!copyFile.endsWith('.sql.aes'))
   fail('COPY_PATH');
 let a,b,sa,sb;
 try{
  a=fs.realpathSync.native(originalFile);
  b=fs.realpathSync.native(copyFile);
  sa=fs.lstatSync(originalFile);
  sb=fs.lstatSync(copyFile);
 }catch{fail('COPY_PATH');}
 if(!sa.isFile()||!sb.isFile()||sa.isSymbolicLink()||sb.isSymbolicLink()||
    sa.size>MAX_SQL_BYTES*2||sb.size>MAX_SQL_BYTES*2)fail('COPY_PATH');
 if((process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b)||
   (sa.ino!==0&&sa.ino===sb.ino&&sa.dev===sb.dev))
   fail('COPY_SAME_FILE');
 const original=verifyArchive(originalFile,passphrase);
 const copy=verifyArchive(copyFile,passphrase);
 if(original.archive_sha256!==copy.archive_sha256)fail('COPY_MISMATCH');
 if(original.schema_version!==copy.schema_version||
    original.applied_migrations!==copy.applied_migrations||
    original.owner_count!==copy.owner_count)fail('COPY_MISMATCH');
 return Object.freeze({status:'PROD_D1_ENCRYPTED_COPY_VERIFY_PASS',
  archive_sha256:copy.archive_sha256,copy_matches_source:true,
  both_archives_offline_sqlite_replay_verified:true,
  schema_version:copy.schema_version,applied_migrations:copy.applied_migrations,
  owner_count:copy.owner_count,source_files_unchanged:true,
  production_write_performed:false,production_restore_performed:false,
  remote_restore_rehearsal_verified:false,
  offsite_encrypted_backup_verified:false,
  external_storage_attestation_required:true,recovery_signoff_granted:false});
}
async function hidden(prompt){
 if(!process.stdin.isTTY||!process.stdout.isTTY||!process.stdin.setRawMode)fail('TTY');
 process.stdout.write(prompt);
 return new Promise((resolve,reject)=>{
  let bytes=Buffer.alloc(0),done=false;const prior=process.stdin.isRaw;
  function finish(error){
   if(done)return;done=true;process.stdin.off('data',onData);
   process.stdin.setRawMode(!!prior);process.stdin.pause();process.stdout.write('\n');
   if(error){bytes.fill(0);reject(Error(FAIL));return;}
   const result=bytes.toString('utf8');bytes.fill(0);resolve(result);
  }
  function onData(c){for(const b of c){
   if(b===10||b===13){finish(false);return;}
   if(b===3||b===27){finish(true);return;}
   if(b===127||b===8){bytes=bytes.subarray(0,Math.max(0,bytes.length-1));continue;}
   if(b<32||bytes.length>=4096){finish(true);return;}
   bytes=Buffer.concat([bytes,Buffer.from([b])]);
  }}
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);
 });
}
async function main(args){
 if(args.length===1&&args[0]==='--verify-copy'){
  const rl=createInterface({input:process.stdin,output:process.stdout});
  let originalFile,copyFile;
  try{
   originalFile=await rl.question('Original .sql.aes full path: ');
   copyFile=await rl.question('Copied .sql.aes full path: ');
  }finally{rl.close();}
  if(!originalFile?.trim()||!copyFile?.trim())fail('COPY_PATH');
  const pass=await hidden('Backup passphrase (hidden): ');
  console.log(JSON.stringify(verifyIndependentCopy(
   path.resolve(originalFile.trim()),path.resolve(copyFile.trim()),pass)));
  return;
 }
 if(args.length===2&&args[0]==='--verify'){
  const pass=await hidden('Backup passphrase (hidden): ');
  console.log(JSON.stringify(verifyArchive(path.resolve(args[1]),pass)));return;
 }
 if(args.length!==1||args[0]!=='--export')fail('ARGS');
 const {execFileSync}=await import('node:child_process');
 const run=x=>execFileSync('git',x,{cwd:ROOT,encoding:'utf8',timeout:8000,
  stdio:['ignore','pipe','ignore']}).trim();
 if(process.env.GITHUB_ACTIONS==='true'||run(['branch','--show-current'])!=='main'||
   run(['status','--porcelain','--untracked-files=no'])!=='')fail('CHECKOUT');
 const dir=privateDir();
 const rl=createInterface({input:process.stdin,output:process.stdout});
 let approval;try{approval=await rl.question('Export can temporarily block Production D1 queries. Type '+APPROVAL+': ');}
 finally{rl.close();}
 if(approval!==APPROVAL)fail('APPROVAL');
 const token=await hidden('Production D1 Read/Export API Token (hidden): ');
 const pass=await hidden('New encryption passphrase (min 16 chars, hidden): ');
 const confirm=await hidden('Repeat encryption passphrase (hidden): ');
 if(pass!==confirm)fail('PASSPHRASE');
 // Only local encrypted archive is stored. No plaintext SQL file is created.
 const sql=await remoteExport({token});
 console.log(JSON.stringify(sealedArchive(sql,pass,dir)));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv.slice(2)).catch(e=>{
  const safe=new Set(['ARGS','CHECKOUT','APPROVAL','PASSPHRASE','TOKEN','TARGET','OWNER_STATE',
   'NETWORK','HTTP','API_SHAPE','EXPORT_API','EXPORT_TIMEOUT','SIGNED_URL','DOWNLOAD',
   'DOWNLOAD_SIZE','DOWNLOAD_ENCODING','SQL_SIZE','SQL_INTEGRITY','SQL_FK','SQL_SCHEMA',
   'SQL_REPLAY','SQL_OWNER_STATE','ARCHIVE_SIZE','ARCHIVE_FORMAT','ARCHIVE_AUTH','ARCHIVE_VERIFY',
   'OUTPUT_PATH','SAVE','VERIFY_PATH','COPY_PATH','COPY_SAME_FILE','COPY_MISMATCH','TTY']);
  const detail=e.reason==='EXPORT_API'&&FAIL_DETAILS.has(e.safeDetail)
   ?' detail='+e.safeDetail:'';
  console.error(FAIL+' phase='+(safe.has(e.reason)?e.reason:'UNKNOWN')+detail+
   '; NO PRODUCTION SQL WRITE. NO RESTORE AUTHORIZED.');process.exitCode=1;
 });
}
