'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {uuid,hashPassword}=require('./security');
const {protect}=require('./backup-acl');
// SQL keywords and identifiers are case-insensitive; quoted literals must retain case.
function schemaError(message){const e=new Error('E_DB: '+message);e.code='E_DB';throw e;}
function normalizedDdl(sql){
 const source=String(sql||'').trim().replace(/;\s*$/,'').replace(/^(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\s+)IF\s+NOT\s+EXISTS\s+/i,'$1');
 let result='',quote=null;
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quote){
   result+=ch;
   if(quote==='['){if(ch===']')quote=null;}
   else if(ch===quote){if(source[i+1]===quote){result+=source[++i];}else quote=null;}
  }else if(ch==="'"||ch==='"'||ch.charCodeAt(0)===96||ch==='['){quote=ch;result+=ch;}
  else if(!/\s/.test(ch))result+=ch.toUpperCase();
 }
 if(quote)schemaError('Schema DDL 含未結束的字串或識別碼');
 return result;
}
// Build a trusted v2 contract in a separate in-memory database, not the
// business DB. Missing structures must never be silently recreated.
// Check persisted schema against versioned DDL without modifying the business DB.
// A partial/failed migration must be rejected before publishing a backup.
function verifyInstalledSchema(db,version){
 const schema=fs.readFileSync(path.join(__dirname,'../db/schema.sql'),'utf8');
 const v2At=schema.indexOf('CREATE TABLE backup_settings (');
 const v3At=schema.indexOf('CREATE TABLE ingredient_prices (');
 if(v2At<0||v3At<=v2At||![1,2,3].includes(version))
  schemaError('無法辨識版本化 Schema 驗證基準，拒絕升級');
 const expected=new DatabaseSync(':memory:');
 const compact=normalizedDdl;
 try{
  expected.exec(schema);
  const expectedObjects=expected.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all();
  const v1Reference=new DatabaseSync(':memory:');
  const v2Reference=new DatabaseSync(':memory:');
  let v1Names,v2Names;
  try{
   v1Reference.exec(schema.slice(0,v2At));
   v2Reference.exec(schema.slice(0,v3At));
   const names=ref=>new Set(ref.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'").all().map(x=>x.name));
   v1Names=names(v1Reference);v2Names=names(v2Reference);
  }finally{v1Reference.close();v2Reference.close();}
  if(v1Names.size<17||v2Names.size<=v1Names.size||expectedObjects.length<=v2Names.size)
   schemaError('版本化 Schema 驗證基準不完整，拒絕升級');
  // Reject future-version objects even if the recorded user_version is old.
  for(const item of expectedObjects){
   const isExpected=version===3||(version===2?v2Names:v1Names).has(item.name);
   const actual=db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get(item.type,item.name);
   if(!isExpected){
    if(actual)schemaError('v'+version+' 資料庫意外包含新版'+(item.type==='index'?'索引 ':'資料表 ')+item.name+'，拒絕升級');
    continue;
   }
   if(!actual)schemaError('v'+version+' 資料庫缺少必要'+(item.type==='index'?'索引 ':'資料表 ')+item.name+'，拒絕升級');
   // Verify full DDL: columns, PK/UNIQUE, CHECK, FK, v3 price/recipe indexes.
   if(compact(actual.sql)!==compact(item.sql))
    schemaError('v'+version+' 資料庫結構不符合既有 Schema：'+item.name+'，拒絕升級');
  }
 }finally{expected.close();}
}
// Read-only preflight must reject broken v1/v2/v3 before journal_mode=WAL writes.
function preflightExisting(filename){
 const db=new DatabaseSync(filename,{readOnly:true,timeout:3000});
 try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')schemaError('SQLite 完整性檢查失敗');
  if(db.prepare('PRAGMA foreign_key_check').all().length)schemaError('原始資料庫外鍵檢查失敗');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  verifyInstalledSchema(db,version);
  if(version>=2&&!db.prepare('SELECT id FROM backup_settings WHERE id=1').get())schemaError('備份設定表缺少設定資料');
  if(!db.prepare("SELECT 1 FROM users WHERE role='owner' LIMIT 1").get())schemaError('既有資料庫缺少業主帳號，拒絕自動重設管理密碼');
 }finally{db.close();}
}
function openDb(folder=path.join(__dirname,'..','data')){
 fs.mkdirSync(folder,{recursive:true,mode:0o700});
 const filename=path.join(folder,'restaurant.sqlite');
 if(fs.existsSync(filename) && fs.statSync(filename).size===0)throw new Error('E_DB: 資料庫為空檔，請由備份還原');
 const exists=fs.existsSync(filename);
 const marker=path.join(folder,'.installed');
 if(!exists && (fs.existsSync(marker) || fs.readdirSync(folder).some(x=>x!=='.DS_Store')))throw new Error('E_DB: 既有資料目錄內資料庫遺失，拒絕重建空白資料庫');
 if(exists)preflightExisting(filename);
 const db=new DatabaseSync(filename,{timeout:3000});
 try{
 db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;');
 if(exists){
  const integrity=db.prepare('PRAGMA quick_check').get();
  if(integrity.quick_check!=='ok')throw new Error('E_DB: SQLite 完整性檢查失敗');
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','audit_logs','stock_moves')").all();
  if(tables.length!==3)throw new Error('E_DB: 已有資料庫缺少關鍵資料表，拒絕建立空白替代表');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version===1){
   verifyInstalledSchema(db,1);
   // Make a consistent, verified v1 safety snapshot before the schema migration.
   // Do not silently reinitialize an established database on failure.
   // Migration and operational backups must obey identical canonical path safety.
   const {backupDir}=require('./backup-manager').getPaths({folder});
   fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
   if(!fs.lstatSync(backupDir).isDirectory()||fs.lstatSync(backupDir).isSymbolicLink())throw new Error('E_BACKUP: 不安全的備份目錄');
   protect(backupDir);
   const now=new Date().toISOString().replace(/[-:]/g,'');
   const name='restaurant-backup-'+now.slice(0,8)+'-'+now.slice(9,15)+'-'+crypto.randomBytes(4).toString('hex')+'-migration.sqlite';
   const output=path.join(backupDir,name),temp=output+'.partial';
   try{
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('E_DB: 原始資料庫外鍵檢查失敗');
    db.exec("VACUUM INTO '"+temp.replace(/'/g,"''")+"'");
    const verify=new DatabaseSync(temp,{readOnly:true});
    try{if(verify.prepare('PRAGMA quick_check').get().quick_check!=='ok'||verify.prepare('PRAGMA user_version').get().user_version!==1)throw Error('E_BACKUP: 升級前備份驗證失敗');}
    finally{verify.close();}
    fs.chmodSync(temp,0o600);protect(temp);fs.renameSync(temp,output);
   }catch(e){try{fs.unlinkSync(temp)}catch{}throw e;}
   db.exec('BEGIN IMMEDIATE');
   try{db.exec(fs.readFileSync(path.join(__dirname,'../db/backup.sql'),'utf8'));db.exec('PRAGMA user_version=2; COMMIT');}
   catch(e){db.exec('ROLLBACK');throw e;}
  }else if(version!==2&&version!==3)throw new Error('E_DB: 不支援的資料庫版本 '+version);
  if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='backup_settings'").get()||!db.prepare('SELECT id FROM backup_settings WHERE id=1').get())throw new Error('E_DB: 備份設定表缺失，拒絕補建');

  const cv=db.prepare('PRAGMA user_version').get().user_version;
  verifyInstalledSchema(db,cv); // Full structure check before migration snapshot or version change.
  if(cv===2){
   if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('E_DB: 升級前外鍵錯誤');
   for(const table of ['ingredient_prices','menu_dishes','dish_ingredients'])
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('E_DB: 價格表不完整，拒絕自動補建');
   const {backupDir}=require('./backup-manager').getPaths({folder});
   fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
   if(!fs.lstatSync(backupDir).isDirectory()||fs.lstatSync(backupDir).isSymbolicLink())throw new Error('E_BACKUP: 備份路徑不安全');
   protect(backupDir);
   const ts=new Date().toISOString(),stamp=ts.replace(/[-:]/g,'').slice(0,8)+'-'+ts.slice(11,19).replace(/:/g,'');
   const saved=path.join(backupDir,'restaurant-backup-'+stamp+'-'+crypto.randomBytes(4).toString('hex')+'-migration.sqlite'),temp=saved+'.partial';
   try{
    db.exec("VACUUM INTO '"+temp.replace(/'/g,"''")+"'");
    const check=new DatabaseSync(temp,{readOnly:true});
    try{if(check.prepare('PRAGMA quick_check').get().quick_check!=='ok'||check.prepare('PRAGMA foreign_key_check').all().length||check.prepare('PRAGMA user_version').get().user_version!==2)throw Error('E_BACKUP: v3 升級快照驗證失敗');}
    finally{check.close();}
    fs.chmodSync(temp,0o600);protect(temp);fs.renameSync(temp,saved);
   }catch(e){try{fs.unlinkSync(temp)}catch{}throw e;}
   db.exec('BEGIN IMMEDIATE');
   try{db.exec(fs.readFileSync(path.join(__dirname,'../db/pricing.sql'),'utf8'));db.exec('PRAGMA user_version=3; COMMIT');}
   catch(e){db.exec('ROLLBACK');throw e;}
  }else if(cv===3){
   for(const table of ['ingredient_prices','menu_dishes','dish_ingredients'])
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))throw new Error('E_DB: 價格表遺失，拒絕自動修復');
  }

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
 }catch(e){try{db.close()}catch{}throw e;}
}
function inTransaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
module.exports={openDb,inTransaction,verifyInstalledSchema};
