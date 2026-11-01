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

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const APPROVAL='EXPORT_PRODUCTION_D1_TO_ENCRYPTED_LOCAL_BACKUP';
const FAIL='E_PRODUCTION_D1_BACKUP';
const HEADER='RBPOC_D1_AES256_GCM_SQL_V1';
const MAX_SQL_BYTES=32*1024*1024;
const MAX_RESP_BYTES=65536;
const ITERATIONS=310000;
const BOOKMARK=/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32}$/i;
const EXTERNAL_HOST=/(\.cloudflarestorage\.com|\.r2\.dev|\.cloudflare\.com)$/i;
const fail=(reason='UNSAFE')=>{const e=Error(FAIL);e.reason=reason;throw e;};
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
export function verifyLocalSql(sql) {
 if(typeof sql!=='string'||!sql.trim()||
   Buffer.byteLength(sql,'utf8')>MAX_SQL_BYTES)fail('SQL_SIZE');
 let db;
 try{
  db=new DatabaseSync(':memory:');
  db.exec(sql);
  if(db.prepare('PRAGMA quick_check').get()?.quick_check!=='ok')fail('SQL_INTEGRITY');
  if(db.prepare('PRAGMA foreign_key_check').all().length!==0)fail('SQL_FK');
  const table=String(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='cloud_schema_contract'").get()?.name||'');
  if(table!=='cloud_schema_contract')fail('SQL_SCHEMA');
  const required=['users','locations','audit_logs','sessions','stock_moves',
    'purchase_orders','cloud_schema_contract','d1_migrations'];
  for(const name of required){
   if(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)?.name!==name)
    fail('SQL_SCHEMA');
  }
  const version=db.prepare('SELECT contract_version FROM cloud_schema_contract').get()?.contract_version;
  const ledger=db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get()?.n;
  const owners=db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1").get()?.n;
  if(Number(version)!==3||ledger!==2||!Number.isSafeInteger(owners)||owners>1)
   fail('SQL_SCHEMA');
  return Object.freeze({schema_version:3,applied_migrations:2,owner_count:owners,
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
 if(read.status!=='PRODUCTION_OWNER_READY_TO_ENROLL_READONLY')fail('OWNER_STATE');
 const endpoint=prefix+'/export';
 let bookmark='',signed='';
 for(let i=0;i<16;i++){
  const body={output_format:'polling'};
  if(bookmark)body.current_bookmark=bookmark;
  const next=await api(endpoint,'POST',token,body,transport);
  const r=next.result;
  if(!isObj(r)||r.type!=='export'||r.success!==true||r.status==='error')fail('EXPORT_API');
  if(r.status==='complete'){
   if(typeof r.result?.signed_url!=='string')fail('EXPORT_API');
   signed=r.result.signed_url;break;
  }
  if(r.status&&r.status!=='in_progress'&&r.status!=='pending')fail('EXPORT_API');
  if(typeof r.at_bookmark!=='string'||!BOOKMARK.test(r.at_bookmark))fail('EXPORT_API');
  if(bookmark&&bookmark!==r.at_bookmark)fail('EXPORT_API');
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
   'SQL_REPLAY','ARCHIVE_SIZE','ARCHIVE_FORMAT','ARCHIVE_AUTH','ARCHIVE_VERIFY',
   'OUTPUT_PATH','SAVE','VERIFY_PATH','TTY']);
  console.error(FAIL+' phase='+(safe.has(e.reason)?e.reason:'UNKNOWN')+
   '; NO PRODUCTION WRITE. EXPORT/RESTORE NOT AUTHORIZED.');process.exitCode=1;
 });
}
