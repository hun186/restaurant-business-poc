'use strict';
// NO production migration: read a named offline backup as BYTES ONLY.
// Copy into a disposable private directory, migrate the SECOND private copy,
// verify every legacy row, and remove both copies. Never write source data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {protect}=require('../src/backup-acl');
const {verifyInstalledSchema}=require('../src/db');
const {fingerprint,verifySnapshot}=require('../src/backup-manager');
const {inspectStockMoveV3}=require('../src/stock-move-v3-readonly-preflight.cjs');
const {checkStockV4OfflinePostflight}=require('../src/stock-move-v4-readonly-postflight.cjs');
const NAME=/^restaurant-backup-\d{8}-\d{6}-[a-f0-9]{8}-(?:auto|manual|migration)\.sqlite$/;
const DIGEST=/^[a-f0-9]{64}$/i;
const error=code=>{const e=new Error('E_V4_CLONE_'+code);e.code='E_V4_CLONE_'+code;throw e;};
function safeSource(file){
 if(typeof file!=='string'||!file||path.basename(file)!==file&&
    !NAME.test(path.basename(file)))error('FILE_NAME');
 const p=path.resolve(file);
 if(!NAME.test(path.basename(p)))error('FILE_NAME');
 let st;
 try{st=fs.lstatSync(p);}catch{error('SOURCE_MISSING');}
 if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||st.size<=0)
  error('SOURCE_UNSAFE');
 return p;
}
function digestCopy(source,dest){
 // The source is never opened with SQLite, chmod or ACL mutation.
 const inFd=fs.openSync(source,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 let outFd;
 try{
  const before=fs.fstatSync(inFd),leaf=fs.lstatSync(source);
  if(!before.isFile()||!leaf.isFile()||leaf.isSymbolicLink()||
     leaf.dev!==before.dev||leaf.ino!==before.ino||
     before.nlink!==1||before.size<=0)error('SOURCE_RACE');
  outFd=fs.openSync(dest,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY,0o600);
  const sha=crypto.createHash('sha256'),block=Buffer.alloc(1024*1024);
  let bytes=0,n;
  while((n=fs.readSync(inFd,block,0,block.length,null))!==0){
   sha.update(block.subarray(0,n));bytes+=n;
   let w=0;while(w<n){const k=fs.writeSync(outFd,block,w,n-w);if(k<=0)error('WRITE_FAILED');w+=k;}
  }
  fs.fsyncSync(outFd);
  const after=fs.fstatSync(inFd);
  if(bytes!==before.size||before.size!==after.size||
     before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)
   error('SOURCE_CHANGED');
  return {sha256:sha.digest('hex'),bytes};
 }finally{if(outFd!==undefined)fs.closeSync(outFd);fs.closeSync(inFd);}
}
function copyPrivate(from,to){
 // Already-private disposable source, not a customer path.
 fs.copyFileSync(from,to,fs.constants.COPYFILE_EXCL);
 protect(to);
}
function runCloneRehearsal({file,expectedSha256}={}){
 if(typeof expectedSha256!=='string'||!DIGEST.test(expectedSha256))
  error('EXPECTED_SHA256');
 const source=safeSource(file),root=fs.realpathSync.native(os.tmpdir());
 let dir;
 try{
  dir=fs.mkdtempSync(path.join(root,'restaurant-stock-v4-clone-'));
  protect(dir);
  const beforeFile=path.join(dir,'v3-before.sqlite'),afterFile=path.join(dir,'v4-working.sqlite');
  const copied=digestCopy(source,beforeFile);
  protect(beforeFile);
  const actual=Buffer.from(copied.sha256,'hex'),expected=Buffer.from(expectedSha256,'hex');
  if(!crypto.timingSafeEqual(actual,expected))error('SOURCE_DIGEST');
  const verifiedV3Fingerprint=verifySnapshot(beforeFile);
  copyPrivate(beforeFile,afterFile);
  let before,after;
  let preflight,postflight;
  try{
   before=new DatabaseSync(beforeFile,{readOnly:true});
   after=new DatabaseSync(afterFile);
   if(after.prepare('PRAGMA journal_mode').get().journal_mode==='wal')
    after.exec('PRAGMA journal_mode=DELETE');
   after.exec('PRAGMA foreign_keys=ON');
   verifyInstalledSchema(before,3);
   preflight=inspectStockMoveV3(before,'local');
   if(fingerprint(before)!==verifiedV3Fingerprint)error('SOURCE_INCONSISTENT');
   verifyInstalledSchema(after,3);
   const migration=fs.readFileSync(path.join(__dirname,
    '../db/migration-proposals/0004_stock_move_kinds.sql'),'utf8');
   after.exec('BEGIN IMMEDIATE');
   try{
    after.exec(migration);
    // Postflight requires the existing v3 marker: compare ALL old rows here.
    postflight=checkStockV4OfflinePostflight(before,after,'local');
    after.exec('PRAGMA user_version=4');
    verifyInstalledSchema(after,4);
    if(fingerprint(after)!==verifiedV3Fingerprint)error('HISTORICAL_FINGERPRINT');
    after.exec('COMMIT');
   }catch(e){try{after.exec('ROLLBACK');}catch{}throw e;}
  }finally{try{after?.close();}finally{before?.close();}}
  // Independently reopen the fully committed v4 result read-only.
  const finalFingerprint=verifySnapshot(afterFile);
  if(finalFingerprint!==verifiedV3Fingerprint)error('FINAL_FINGERPRINT');
  const v4=new DatabaseSync(afterFile,{readOnly:true});
  try{
   if(v4.prepare('PRAGMA user_version').get().user_version!==4)
    error('FINAL_VERSION');
   if(v4.prepare('SELECT kind_version FROM stock_move_kind_contract WHERE id=1')
     .get()?.kind_version!==4)error('FINAL_MARKER');
  }finally{v4.close();}
  return Object.freeze({
   status:'LOCAL_STOCK_V4_DISPOSABLE_REHEARSAL_PASS',
   source_sha256:copied.sha256,
   source_bytes:copied.bytes,
   original_stock_move_rows:preflight.stock_move_rows,
   preserved_tables:postflight.preserved_tables,
   original_row_fingerprint_preserved:true,
   source_opened_with_sqlite:false,
   source_changed:false,
   disposable_copies_removed:true,
   migration_authorized:false,
   production_database_modified:false,
   production_gate_enabled:false
  });
 }catch(e){
  // Error details may include SQL content or local paths. Return fixed codes.
  if(e.code?.startsWith('E_V4_CLONE_'))throw e;
  error('REHEARSAL_FAILED');
 }finally{
  if(dir)fs.rmSync(dir,{recursive:true,force:true});
 }
}
function parseArgs(args){
 if(!Array.isArray(args)||args.length!==4||args[0]!=='--file'||args[2]!=='--sha256'||
    !args[1]||!args[3])error('ARGS');
 return {file:args[1],expectedSha256:args[3]};
}
if(require.main===module){
 process.exitCode=1;
 try{
  const result=runCloneRehearsal(parseArgs(process.argv.slice(2)));
  console.log('離線 SQLite v3→v4 隔離副本遷移演練 PASS');
  console.log('原始流水筆數：'+result.original_stock_move_rows+
   '；完整保留資料表：'+result.preserved_tables);
  console.log('隔離前後歷史資料指紋一致；原備份僅以位元組讀取；暫存副本已清除。');
  console.log('未遷移正式資料庫、未啟用 Gate；此結果不等於營運環境驗收。');
  process.exitCode=0;
 }catch(e){
  console.error('['+(e.code?.startsWith('E_V4_CLONE_')?e.code:'E_V4_CLONE_REHEARSAL_FAILED')+
   '] 隔離演練未通過；正式來源未遷移。');
 }
}
module.exports={runCloneRehearsal,parseArgs};
