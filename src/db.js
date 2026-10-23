'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {uuid,hashPassword}=require('./security');
function openDb(folder=path.join(__dirname,'..','data')){
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const filename=path.join(folder,'restaurant.sqlite');
 if(fs.existsSync(filename) && fs.statSync(filename).size===0)throw new Error('E_DB: 資料庫為空檔，請由備份還原');
 const exists=fs.existsSync(filename);
 const marker=path.join(folder,'.installed');
 if(!exists && (fs.existsSync(marker) || fs.readdirSync(folder).some(x=>x!=='.DS_Store')))throw new Error('E_DB: 既有資料目錄內資料庫遺失，拒絕重建空白資料庫');
 const db=new DatabaseSync(filename,{timeout:3000});
 db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
 if(exists){
  const integrity=db.prepare('PRAGMA quick_check').get();
  if(integrity.quick_check!=='ok')throw new Error('E_DB: SQLite 完整性檢查失敗');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','audit_logs','stock_moves')").all();
  if(tables.length!==3)throw new Error('E_DB: 已有資料庫缺少關鍵資料表，拒絕建立空白替代表');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version!==1)throw new Error('E_DB: 不支援的資料庫版本 '+version);
 }else{
  db.exec(fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8'));
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(uuid(),'總店');
 }
 try{fs.chmodSync(filename,0o600)}catch{}
 const ownerCount=db.prepare("SELECT count(*) AS n FROM users WHERE role='owner'").get().n;
 if(!ownerCount){
  if(exists) throw new Error('E_DB: 已有資料庫缺少業主帳號，拒絕自動重設管理密碼');
  const first=db.prepare('SELECT id FROM locations LIMIT 1').get();
  const password=crypto.randomBytes(18).toString('base64url');
  const ph=hashPassword(password);
  const id=uuid();
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)').run(id,'owner','業主','owner',ph.salt,ph.hash);
  db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,first.id);
  fs.writeFileSync(marker,'restaurant-business-poc installed\n',{mode:0o600});
  return {db,bootstrapPassword:password};
 }
 if(!fs.existsSync(marker))fs.writeFileSync(marker,'restaurant-business-poc installed\n',{mode:0o600});
 return {db,bootstrapPassword:null};
}
function inTransaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
module.exports={openDb,inTransaction};
