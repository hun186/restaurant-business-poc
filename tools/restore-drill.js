'use strict';
// Non-destructive drill: copy an existing, verified SQLite snapshot to an
// access-protected disposable directory, verify it, and remove the copy.
// This MUST NEVER start the app, overwrite data/restaurant.sqlite or import
// user records into another persistent database.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {getPaths,list,verifySnapshot}=require('../src/backup-manager');
const {protect}=require('../src/backup-acl');
function error(code,message){throw Object.assign(new Error(message),{code});}
function inside(parent,child){
 const relative=path.relative(parent,child);
 return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));
}
function fileDigest(filename){
 const fd=fs.openSync(filename,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 const sha=crypto.createHash('sha256'),block=Buffer.alloc(1024*1024);
 try{
  if(!fs.fstatSync(fd).isFile())error('E_DRILL','隔離副本不是一般檔案');
  let n;while((n=fs.readSync(fd,block,0,block.length,null))!==0)sha.update(block.subarray(0,n));
  return sha.digest('hex');
 }finally{fs.closeSync(fd);}
}
function copyExclusive(source,dest){
 const src=fs.openSync(source,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 let target;
 try{
  const seen=fs.lstatSync(source),opened=fs.fstatSync(src);
  if(!seen.isFile()||seen.isSymbolicLink()||!opened.isFile()||
     seen.dev!==opened.dev||seen.ino!==opened.ino)error('E_DRILL','來源備份檔案不安全或已變更');
  target=fs.openSync(dest,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  const block=Buffer.alloc(1024*1024);
  let count=0,n;
  while((n=fs.readSync(src,block,0,block.length,null))!==0){
   let offset=0;
   while(offset<n){const written=fs.writeSync(target,block,offset,n-offset);if(written<=0)error('E_DRILL','隔離複製寫入失敗');offset+=written;}
   count+=n;
  }
  fs.fsyncSync(target);
  if(fs.fstatSync(src).size!==count)error('E_DRILL','來源備份複製期間長度改變');
  return count;
 }finally{if(target!==undefined)fs.closeSync(target);fs.closeSync(src);}
}
function drillRestore(opts={}){
 const {folder,backupDir}=getPaths(opts);
 const dbFile=path.join(folder,'restaurant.sqlite');
 // Never create missing operational data here (even an empty demo database).
 if(!fs.existsSync(dbFile)||!fs.lstatSync(dbFile).isFile()||fs.lstatSync(dbFile).isSymbolicLink())
  error('E_DB','未找到既有正式資料庫；拒絕以空白資料庫進行演練');
 const backups=list(backupDir);
 if(!backups.length)error('E_BACKUP','找不到符合格式的既有備份，請先執行手動備份');
 const chosen=opts.name===undefined?backups[0]:backups.find(b=>b.name===opts.name);
 if(!chosen)error('E_CONFIG','備份名稱不存在或不符合允許格式');
 const source=path.join(backupDir,chosen.name);
 const before=verifySnapshot(source); // read-only, schema/quick_check/FK validation
 const originalDigest=fileDigest(source);
 const base=fs.realpathSync.native(os.tmpdir());
 const active=fs.realpathSync.native(folder),archive=fs.realpathSync.native(backupDir);
 if(inside(active,base)||inside(archive,base))error('E_CONFIG','系統暫存位置位於正式資料或備份目錄中，拒絕演練');
 let tempDir=null;
 try{
  tempDir=fs.mkdtempSync(path.join(base,'restaurant-restore-drill-'));
  if(inside(active,tempDir)||inside(archive,tempDir))error('E_CONFIG','隔離驗證位置不安全');
  protect(tempDir);
  const copy=path.join(tempDir,'restored-copy.sqlite');
  const bytes=copyExclusive(source,copy);
  protect(copy);
  if(fileDigest(copy)!==originalDigest)error('E_DRILL','隔離副本與備份原檔校驗值不同');
  const copiedFingerprint=verifySnapshot(copy);
  if(copiedFingerprint!==before||verifySnapshot(source)!==before||fileDigest(source)!==originalDigest)
   error('E_DRILL','來源備份與隔離副本內容驗證不一致');
  const readOnly=new DatabaseSync(copy,{readOnly:true});
  let counts;
  try{
   counts={
    activeOwners:Number(readOnly.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1").get().n),
    locations:Number(readOnly.prepare('SELECT COUNT(*) AS n FROM locations').get().n),
    stockMoves:Number(readOnly.prepare('SELECT COUNT(*) AS n FROM stock_moves').get().n),
    orders:Number(readOnly.prepare('SELECT COUNT(*) AS n FROM purchase_orders').get().n)
   };
  }finally{readOnly.close();}
  if(counts.activeOwners<1)error('E_DRILL','隔離備份中沒有有效業主帳號');
  return {result:'verified',name:chosen.name,bytes,sha256:originalDigest,
   fingerprint:copiedFingerprint,counts,temporaryCopyRemoved:true};
 }finally{
  // Only remove a freshly generated directory under system temp; never the
  // selected backup or operational DB. Any copy remains private until removal.
  if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});
 }
}
function parseArgs(args){
 if(args.length===0)return {};
 if(args.length===2&&args[0]==='--backup'&&args[1])return {name:args[1]};
 error('E_CONFIG','用法：node tools/restore-drill.js [--backup 備份檔名]');
}
if(require.main===module){
 try{
  const result=drillRestore(parseArgs(process.argv.slice(2)));
  console.log('隔離備份驗證 PASS：'+result.name);
  console.log('位元組校驗 SHA-256：'+result.sha256);
  console.log('SQLite 業主／門市／庫存流水／叫貨：'+
    [result.counts.activeOwners,result.counts.locations,result.counts.stockMoves,result.counts.orders].join('／'));
  console.log('演練使用的隔離副本已刪除；正式 data/ 與 backups/ 完全未覆寫。');
  console.log('此項 PASS 不代表正式 Windows 異機還原、登入或跨磁碟／異地復原驗收完成。');
 }catch(e){
  console.error('['+(e.code||'E_DRILL')+'] 隔離備份驗證失敗：'+e.message);
  process.exitCode=1;
 }
}
module.exports={drillRestore,parseArgs};
