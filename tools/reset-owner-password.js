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
  const owner=db.prepare("SELECT id,username,password_salt,password_hash FROM users WHERE username='owner' COLLATE NOCASE AND role='owner' AND active=1").all();
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
   const latest=db.prepare('SELECT id,role,active,password_salt,password_hash FROM users WHERE id=? AND username=? COLLATE NOCASE').get(owner.id,'owner');
   if(!latest||latest.role!=='owner'||latest.active!==1)error('備份後 owner 帳號狀態變更，拒絕重設');
   // Another offline recovery may have finished between this process's
   // read-only preflight, verified backup and BEGIN IMMEDIATE. Never overwrite
   // credentials whose preflight hash/salt changed while the backup lock was
   // released. BEGIN IMMEDIATE serializes the final compare-and-swap.
   if(latest.password_salt!==owner.password_salt||latest.password_hash!==owner.password_hash)
    error('備份後 owner 憑證已被另一程序變更，拒絕覆寫；請確認最新重設結果');
   const changed=db.prepare("UPDATE users SET password_salt=?,password_hash=? WHERE id=? AND role='owner' AND active=1 AND password_salt=? AND password_hash=?")
    .run(hashed.salt,hashed.hash,owner.id,owner.password_salt,owner.password_hash);
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
// The Windows launcher uses an easier one-key confirmation but still requires
// an actual interactive TTY. No flag can bypass this explicit consent.
function cliMode(argv){
 if(argv.length===0)return 'advanced';
 if(argv.length===1&&argv[0]==='--guided')return 'guided';
 error('使用方式：Windows 請雙擊 重設業主密碼.bat，其他系統執行 node tools/reset-owner-password.js');
}
function confirmed(mode,answer){
 return mode==='guided'?String(answer).trim()==='1':answer==='RESET owner';
}
async function main(){
 const mode=cliMode(process.argv.slice(2));
 if(!process.stdin.isTTY||!process.stdout.isTTY)error('為安全起見，請在本機互動式終端機操作，不接受管線或遠端自動輸入');
 console.log('\n========================================');
 console.log(' 餐廳好管家｜忘記 owner 密碼安全復原');
 console.log('========================================');
 console.log('【步驟 1】請先關閉「啟動餐廳好管家.bat」或 npm start 視窗。');
 console.log('【步驟 2】將先檢查現有資料庫並製作完整、經驗證的備份。');
 console.log('【步驟 3】重設完成後會顯示一次新密碼，請立即記錄。');
 console.log('不會刪除原有資料；如備份驗證失敗，將取消重設。');
 const rl=readline.createInterface({input:process.stdin,output:process.stdout});
 let answer;
 try{
  answer=await rl.question(mode==='guided'
   ?'\n確認網站已完全停止後，輸入數字 1 並按 Enter 繼續；輸入其他內容取消：'
   :'\n確認網站已完全停止後，輸入 RESET owner 並按 Enter 繼續；其他內容取消：');
 }finally{rl.close();}
 if(!confirmed(mode,answer)){console.log('\n已取消，owner 密碼與資料未修改。');return;}
 console.log('\n正在檢查資料庫並產生安全備份，請勿關閉此視窗…');
 const result=recoverOwner();
 console.log('\n========================================');
 console.log(' 成功：owner 密碼已安全重設');
 console.log('========================================');
 console.log('重設前的有效備份：'+result.backupPath);
 console.log('登入帳號：owner');
 console.log('新隨機密碼（僅顯示這一次，請立即保存）：'+result.password);
 console.log('\n請妥善保存新密碼；勿傳到公開聊天、截圖或貼在 GitHub。');
 console.log('關閉此視窗後，雙擊「啟動餐廳好管家.bat」重新登入。');
 console.log('舊的 owner 登入 Session 已撤銷。');
}
if(require.main===module)main().catch(e=>{console.error('\n密碼復原失敗：'+e.message);console.error('資料庫未因此自動重建；請保留 data 與 backups，必要時聯繫管理者。');process.exitCode=1;});
module.exports={recoverOwner,inspectOwner,cliMode,confirmed};
