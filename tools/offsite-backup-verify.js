'use strict';
// Offline read-only verification of an external copy of a restaurant backup.
// Does not require (or create) the original data/restaurant.sqlite directory.
// The source archive is never opened with SQLite, chmod, re-ACL'd, or modified.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {verifySnapshot}=require('../src/backup-manager');
const {protect}=require('../src/backup-acl');
const BACKUP_NAME=/^restaurant-backup-\d{8}-\d{6}-[a-f0-9]{8}-(auto|manual|migration)\.sqlite$/;
const HEX=/^[a-f0-9]{64}$/i;
function fail(code,message){throw Object.assign(new Error(message),{code});}
function hashFile(file){
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 try{
  if(!fs.fstatSync(fd).isFile())fail('E_VERIFY','驗證副本不是一般檔案');
  const sha=crypto.createHash('sha256'),block=Buffer.alloc(1024*1024);
  let n;while((n=fs.readSync(fd,block,0,block.length,null))>0)sha.update(block.subarray(0,n));
  return sha.digest('hex');
 }finally{fs.closeSync(fd);}
}
function readCopy(source,destination){
 const src=fs.openSync(source,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
 let target;
 try{
  const seen=fs.lstatSync(source),opened=fs.fstatSync(src);
  if(!seen.isFile()||seen.isSymbolicLink()||!opened.isFile()||
     seen.dev!==opened.dev||seen.ino!==opened.ino)fail('E_VERIFY','來源備份並非安全的一般檔案');
  target=fs.openSync(destination,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL,0o600);
  const sha=crypto.createHash('sha256'),block=Buffer.alloc(1024*1024);
  let bytes=0,n;
  while((n=fs.readSync(src,block,0,block.length,null))>0){
   let offset=0;
   while(offset<n){
    const wrote=fs.writeSync(target,block,offset,n-offset);
    if(wrote<=0)fail('E_VERIFY','暫存副本寫入失敗');
    offset+=wrote;
   }
   sha.update(block.subarray(0,n));bytes+=n;
  }
  fs.fsyncSync(target);
  const after=fs.fstatSync(src);
  if(bytes!==opened.size||after.size!==opened.size||
     after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)
   fail('E_VERIFY','來源檔案在讀取過程中發生變更');
  return {bytes,sha256:sha.digest('hex')};
 }finally{if(target!==undefined)fs.closeSync(target);fs.closeSync(src);}
}
function verifyOffsiteCopy({file,expectedSha256}={}){
 if(typeof file!=='string'||!file.trim()||!BACKUP_NAME.test(path.basename(file)))
  fail('E_CONFIG','必須指定符合備份命名規則的完整檔案路徑');
 if(typeof expectedSha256!=='string'||!HEX.test(expectedSha256))
  fail('E_CONFIG','須提供在原始電腦獨立留存的 64 碼 SHA-256');
 const source=path.resolve(file);
 // Never touch backup source permissions. Reject a symlink leaf, and compare
 // the actual opened file descriptor to the lstat result before copying.
 let st;try{st=fs.lstatSync(source);}catch(e){if(e.code==='ENOENT')fail('E_BACKUP','外接備份檔案不存在');throw e;}
 if(!st.isFile()||st.isSymbolicLink())fail('E_BACKUP','拒絕開啟非一般備份檔案');
 const tempBase=fs.realpathSync.native(os.tmpdir());
 let tempDir=null;
 try{
  tempDir=fs.mkdtempSync(path.join(tempBase,'restaurant-offsite-verify-'));
  protect(tempDir);
  const copy=path.join(tempDir,'isolated.sqlite');
  const {bytes,sha256}=readCopy(source,copy);
  protect(copy);
  if(!crypto.timingSafeEqual(Buffer.from(sha256,'hex'),Buffer.from(expectedSha256,'hex')))
   fail('E_DIGEST','備份搬運前後 SHA-256 不一致，禁止採用');
  if(hashFile(copy)!==sha256)fail('E_VERIFY','隔離副本與輸入來源內容不一致');
  const fingerprint=verifySnapshot(copy); // SQLite is opened only in temp.
  const db=new DatabaseSync(copy,{readOnly:true});
  let counts;
  try{
   counts={
    activeOwners:Number(db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='owner' AND active=1").get().n),
    locations:Number(db.prepare('SELECT COUNT(*) AS n FROM locations').get().n),
    stockMoves:Number(db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get().n),
    orders:Number(db.prepare('SELECT COUNT(*) AS n FROM purchase_orders').get().n)
   };
  }finally{db.close();}
  if(counts.activeOwners<1)fail('E_VERIFY','備份中沒有有效的業主帳號');
  return {result:'verified',name:path.basename(source),bytes,sha256,fingerprint,counts,
   sourceUnchanged:true,temporaryCopyRemoved:true};
 }finally{if(tempDir)fs.rmSync(tempDir,{recursive:true,force:true});}
}
function parseArgs(args){
 if(!Array.isArray(args)||args.length!==4||args[0]!=='--file'||args[2]!=='--sha256'||!args[1]||!args[3])
  fail('E_CONFIG','用法：node tools/offsite-backup-verify.js --file <外接備份路徑> --sha256 <原始 SHA-256>');
 return {file:args[1],expectedSha256:args[3]};
}
function requiredAnswer(rl,prompt){
 // EOF/closed stdin can end Node's event loop while question() is pending.
 // Reject explicitly instead of allowing the process to exit successfully.
 return new Promise((resolve,reject)=>{
  let settled=false;
  const closed=()=>{
   if(settled)return;
   settled=true;
   reject(Object.assign(new Error('未完成輸入，禁止將備份視為驗證成功'),{code:'E_INPUT'}));
  };
  rl.once('close',closed);
  rl.question(prompt).then(answer=>{
   if(settled)return;
   settled=true;rl.removeListener('close',closed);resolve(answer);
  },err=>{
   if(settled)return;
   settled=true;rl.removeListener('close',closed);reject(err);
  });
 });
}
async function interactiveInput(){
 const readline=require('node:readline/promises');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 try{
  const supplied=(await requiredAnswer(rl,'請輸入已搬到這台電腦的 .sqlite 備份完整路徑：')).trim();
  const file=supplied.startsWith('"')&&supplied.endsWith('"')?supplied.slice(1,-1):supplied;
  const expectedSha256=(await requiredAnswer(rl,'請輸入從來源電腦另行安全留存的 64 碼 SHA-256：')).trim();
  return {file,expectedSha256};
 }finally{rl.close();}
}
async function main(){
 try{
  const args=process.argv.slice(2);
  const inputs=args.length===1&&args[0]==='--interactive'?await interactiveInput():parseArgs(args);
  const result=verifyOffsiteCopy(inputs);
  console.log('外接備份隔離驗證 PASS：'+result.name);
  console.log('SHA-256：'+result.sha256);
  console.log('有效業主／門市／庫存流水／叫貨筆數：'+Object.values(result.counts).join('／'));
  console.log('外接來源備份未被修改；隔離副本已刪除。未執行實際還原、登入或異地備份。');
  process.exitCode=0;
 }catch(e){
  console.error('['+(e.code||'E_VERIFY')+'] 外接備份驗證失敗：'+e.message);
  process.exitCode=1;
 }
}
if(require.main===module){
 process.exitCode=1; // fail closed until complete verified outcome
 void main();
}
module.exports={verifyOffsiteCopy,parseArgs};
