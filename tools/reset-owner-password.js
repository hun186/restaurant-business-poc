'use strict';
// Offline-only local owner credential recovery. No web endpoint and no default passwords.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const readline=require('node:readline/promises');
const {DatabaseSync}=require('node:sqlite');
const {hashPassword,uuid}=require('../src/security');
const {verifyInstalledSchema}=require('../src/db');
const {getPaths,perform}=require('../src/backup-manager');

function error(message){const e=new Error('E_RECOVERY: '+message);e.code='E_RECOVERY';throw e;}
function inspectOwner(filename){
 const stat=fs.lstatSync(filename,{throwIfNoEntry:false});
 if(!stat||!stat.isFile()||stat.isSymbolicLink())error('找不到安全、既有的 restaurant.sqlite；不會建立或重建資料庫');
 const db=new DatabaseSync(filename,{readOnly:true,timeout:3000});
 try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')error('SQLite 完整性檢查未通過');
  if(db.prepare('PRAGMA foreign_key_check').all().length)error('SQLite 外鍵驗證未通過');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version!==3)error('資料庫不是目前 v3 版本；請先使用正常升級流程，勿離線修改');
  verifyInstalledSchema(db,3);
  const owner=db.prepare("SELECT id,username FROM users WHERE username='owner' COLLATE NOCASE AND role='owner' AND active=1").all();
  if(owner.length!==1)error('無法唯一識別有效的 owner 管理帳號，拒絕重設');
  return owner[0];
 }finally{db.close();}
}
function recoverOwner({folder=process.env.DATA_DIR||path.join(__dirname,'..','data'),backupDir}={}){
 const dirs=getPaths({folder,backupDir});
 const marker=path.join(dirs.folder,'.installed');
 const markerInfo=fs.lstatSync(marker,{throwIfNoEntry:false});
 if(!markerInfo||!markerInfo.isFile()||markerInfo.isSymbolicLink())
  error('找不到安全的 .installed 註記；拒絕對未確認的資料目錄執行重設');
 const file=path.join(dirs.folder,'restaurant.sqlite');
 const owner=inspectOwner(file);
 // A verified full snapshot is mandatory *before* altering credentials.
 // Failure to snapshot leaves the original hash and sessions untouched.
 const backup=perform({...dirs,type:'manual'});
 if(backup.result!=='created'||!backup.name)error('原始資料庫的安全備份未完成');
 const password=crypto.randomBytes(18).toString('base64url');
 const hashed=hashPassword(password);
 const db=new DatabaseSync(file,{timeout:3000});
 try{
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; BEGIN IMMEDIATE');
  try{
   const latest=db.prepare('SELECT id,role,active FROM users WHERE id=? AND username=? COLLATE NOCASE').get(owner.id,'owner');
   if(!latest||latest.role!=='owner'||latest.active!==1)error('備份後 owner 帳號狀態變更，拒絕重設');
   const changed=db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=? AND role=? AND active=1')
    .run(hashed.salt,hashed.hash,owner.id,'owner');
   if(changed.changes!==1)error('未更新到唯一的有效 owner 帳號');
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner.id);
   db.prepare('DELETE FROM login_attempts WHERE username=? COLLATE NOCASE').run('owner');
   db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?,?)')
    .run(uuid(),owner.id,'(offline recovery)','auth.owner_password_recovered','users',owner.id,'{"sessions_revoked":true,"method":"offline_console"}');
   db.exec('COMMIT');
  }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
 }finally{db.close();}
 return {password,backupPath:path.join(dirs.backupDir,backup.name)};
}
async function main(){
 if(process.argv.length!==2)error('用法：node tools/reset-owner-password.js（自訂資料目錄請使用 DATA_DIR）');
 if(!process.stdin.isTTY||!process.stdout.isTTY)error('為安全起見，請在本機互動式終端機操作，不支援腳本／遠端管線輸入');
 console.log('餐廳好管家：owner 離線密碼復原');
 console.log('必須先停止 npm start / Windows 啟動視窗；操作會先驗證並備份既有 SQLite，不會重建資料庫。');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 let answer;
 try{answer=await rl.question('確認已停止網站後，輸入 RESET owner 才會執行：');}
 finally{rl.close();}
 if(answer!=='RESET owner'){console.log('已取消，不修改資料');return;}
 const result=recoverOwner();
 console.log('\n重設成功。已驗證的重設前備份：'+result.backupPath);
 console.log('帳號：owner');
 console.log('新隨機密碼（僅顯示這一次，請立即存入密碼管理器）：'+result.password);
 console.log('舊的 owner 登入 Session 已撤銷。請重新啟動 npm start，使用新密碼登入後自行變更密碼。');
}
if(require.main===module)main().catch(e=>{console.error('密碼復原失敗：'+e.message);process.exitCode=1;});
module.exports={recoverOwner,inspectOwner};
