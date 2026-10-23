'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {openDb}=require('../src/db');
const base=path.resolve(process.env.DATA_DIR||path.join(__dirname,'../data'));
const origin=path.join(base,'restaurant.sqlite');
if(!fs.existsSync(origin))throw new Error('E_DB: 資料庫不存在，拒絕建立或備份空庫');
const {db}=openDb(base);
const targetDir=path.resolve(process.env.BACKUP_DIR||path.join(__dirname,'../backups'));
fs.mkdirSync(targetDir,{recursive:true,mode:0o700});
const out=path.join(targetDir,'restaurant-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
const temp=out+'.partial';
try{
 db.exec(`VACUUM INTO '${temp.replace(/'/g,"''")}'`);
 const check=new DatabaseSync(temp,{readOnly:true});
 try{
  const q=check.prepare('PRAGMA quick_check').get();
  if(q.quick_check!=='ok')throw new Error('E_BACKUP: 備份完整性錯誤');
  if(check.prepare('PRAGMA foreign_key_check').all().length)throw new Error('E_BACKUP: 備份外鍵檢查失敗');
  if(!check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get())throw new Error('E_BACKUP: 缺少帳號表');
 }finally{check.close();}
 fs.chmodSync(temp,0o600);fs.renameSync(temp,out);console.log('驗證成功的備份：'+out);
}catch(e){try{fs.rmSync(temp,{force:true})}catch{}throw e;}finally{db.close();}
