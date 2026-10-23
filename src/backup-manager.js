'use strict';
// Fixed-host SQLite backups only. Never import from the Vercel static demo.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {Worker}=require('node:worker_threads');
const {protect}=require('./backup-acl');
const ROOT=path.resolve(__dirname,'..');
const NAME=/^restaurant-backup-\d{8}-\d{6}-[a-f0-9]{8}-(auto|manual|migration)\.sqlite$/;
const TABLES=['locations','users','user_locations','audit_logs','tasks','ingredients','stock_moves','purchase_orders','stocktakes','repairs','shifts','leave_requests','training_courses','training_records','evaluations'];
function problem(code,message){const err=new Error(message);err.code=code;throw err;}
function getPaths(opts={}){
 const folder=path.resolve(opts.folder||process.env.DATA_DIR||path.join(ROOT,'data'));
 const backupDir=path.resolve(opts.backupDir||process.env.BACKUP_DIR||path.join(ROOT,'backups'));
 const relative=path.relative(folder,backupDir);
 if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))problem('E_CONFIG','備份資料夾不能位於正式資料庫目錄內');
 return {folder,backupDir};
}
function directory(dir,create=false){
 if(create)fs.mkdirSync(dir,{recursive:true,mode:0o700});
 let info;try{info=fs.lstatSync(dir);}catch(e){if(!create&&e.code==='ENOENT')return false;throw e;}
 if(!info.isDirectory()||info.isSymbolicLink())problem('E_BACKUP','備份位置不是安全的實體資料夾');
 protect(dir);return true;
}
function namedFile(dir,name){
 if(typeof name!=='string'||!NAME.test(name)||path.basename(name)!==name)problem('E_CONFIG','無效備份名稱');
 if(!directory(dir))problem('E_BACKUP','找不到備份資料夾');
 const file=path.join(dir,name);let st;
 try{st=fs.lstatSync(file);}catch(e){if(e.code==='ENOENT')problem('E_BACKUP','指定備份檔案不存在');throw e;}
 if(!st.isFile()||st.isSymbolicLink())problem('E_BACKUP','拒絕讀取非一般備份檔案');
 protect(file);return {file,stat:st};
}
function list(backupDir){
 if(!directory(backupDir))return [];
 return fs.readdirSync(backupDir).filter(name=>NAME.test(name)).map(name=>{
  const {stat}=namedFile(backupDir,name);
  return {name,type:name.match(NAME)[1],size:stat.size,createdAt:stat.birthtime.toISOString()};
 }).sort((a,b)=>b.name.localeCompare(a.name));
}
function settings(db){const x=db.prepare('SELECT interval_days AS intervalDays, retention_count AS retentionCount,last_auto_at AS lastAutoAt,last_auto_name AS lastAutoName,last_fingerprint AS lastFingerprint,last_result AS lastResult,last_error AS lastError FROM backup_settings WHERE id=1').get();if(!x)problem('E_DB','備份設定表遺失');return x;}
function dueAt(s){return s.lastAutoAt?new Date(Date.parse(s.lastAutoAt)+s.intervalDays*86400000).toISOString():null;}
function validate(intervalDays,retentionCount){if(!Number.isInteger(intervalDays)||intervalDays<1||intervalDays>365||!Number.isInteger(retentionCount)||retentionCount<1||retentionCount>500)problem('E_CONFIG','備份間隔須為 1～365 天，保留數須為 1～500 份整數');}
function prune(db,backupDir){const count=settings(db).retentionCount;const files=list(backupDir).filter(x=>x.type==='auto');for(const old of files.slice(count))fs.unlinkSync(namedFile(backupDir,old.name).file);}
function integrity(db){
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')problem('E_DB','SQLite 完整性檢查失敗');
 if(db.prepare('PRAGMA foreign_key_check').all().length)problem('E_DB','SQLite 外鍵檢查失敗');
 if(db.prepare('PRAGMA user_version').get().user_version!==2)problem('E_DB','未辨識的資料庫版本');
 for(const table of [...TABLES,'backup_settings'])if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))problem('E_DB','缺少必要資料表：'+table);
}
// Deterministic row digest of persistent operational/security data. Excludes volatile
// sessions, login_attempts and backup metadata; includes meaningful audit events.
// Scan occurs inside a Worker so the HTTP event loop remains responsive.
function fingerprint(db){const sha=crypto.createHash('sha256');
 for(const table of TABLES){sha.update('\nTABLE:'+table+'\n');const q=table==='audit_logs'?"SELECT * FROM audit_logs WHERE action NOT LIKE 'backup.%' ORDER BY id":table==='user_locations'?'SELECT * FROM user_locations ORDER BY user_id,location_id':`SELECT * FROM "${table}" ORDER BY id`;
  for(const r of db.prepare(q).iterate()){sha.update(JSON.stringify(r,(_,v)=>typeof v==='bigint'?String(v):v));sha.update('\n');}
 }
 return sha.digest('hex');
}
function verifySnapshot(file){const db=new DatabaseSync(file,{readOnly:true});try{integrity(db);return fingerprint(db);}finally{db.close();}}
function stamp(now){return now.toISOString().replace(/[-:]/g,'').slice(0,8)+'-'+now.toISOString().slice(11,19).replace(/:/g,'');}
function reclaimPartial(dir,now=Date.now()){
 // Never remove completed snapshots. Only recover aged, non-symlink temp files.
 for(const name of fs.readdirSync(dir)){
  if(!name.endsWith('.partial')||!NAME.test(name.slice(0,-8)))continue;
  const file=path.join(dir,name),st=fs.lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink())problem('E_BACKUP','中斷備份含不安全的暫存檔');
  if(now-st.mtimeMs>=24*3600000)fs.unlinkSync(file);
 }
}
function acquire(dir){directory(dir,true);const lock=path.join(dir,'.restaurant-backup.lock');
 try{const fd=fs.openSync(lock,'wx',0o600);fs.writeSync(fd,JSON.stringify({pid:process.pid,at:Date.now()}));return ()=>{try{fs.closeSync(fd)}finally{try{fs.unlinkSync(lock)}catch{}}};}
 catch(e){if(e.code!=='EEXIST')throw e;
  // A dead writer's lock is reclaimed only after two hours. Never reclaim a live PID.
  let pid=null,age=0;
  try{const st=fs.lstatSync(lock);if(!st.isFile()||st.isSymbolicLink())problem('E_BACKUP_BUSY','不安全的備份鎖定檔');age=Date.now()-st.mtimeMs;pid=JSON.parse(fs.readFileSync(lock,'utf8')).pid;}catch(err){if(err.code==='E_BACKUP_BUSY')throw err;}
  let live=true;if(Number.isSafeInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')live=false;}}
  if(live||age<7200000)problem('E_BACKUP_BUSY','備份正在執行或舊鎖尚未安全過期');
  fs.unlinkSync(lock);return acquire(dir);
 }
}
function perform({folder,backupDir,type='manual',at}={}){
 if(!['manual','auto'].includes(type))problem('E_CONFIG','不支援的備份類型');
 ({folder,backupDir}=getPaths({folder,backupDir}));
 const source=path.join(folder,'restaurant.sqlite');if(!fs.existsSync(source))problem('E_DB','資料庫不存在，禁止備份空白資料庫');
 const release=acquire(backupDir);reclaimPartial(backupDir);let db,partial=null;const now=at?new Date(at):new Date();
 try{
  const {openDb}=require('./db');db=openDb(folder).db;integrity(db);
  const s=settings(db);
  if(type==='auto'&&dueAt(s)&&Date.parse(dueAt(s))>now.getTime())return {result:'not_due'};
  const current=fingerprint(db);
  if(type==='auto'&&s.lastFingerprint===current&&s.lastAutoName){
   // Never skip just because metadata says a snapshot once existed: verify it.
   try{const previous=namedFile(backupDir,s.lastAutoName);if(verifySnapshot(previous.file)===current){db.prepare("UPDATE backup_settings SET last_auto_at=?,last_result='skipped',last_error=NULL WHERE id=1").run(now.toISOString());return {result:'skipped',name:s.lastAutoName};}}
   catch(e){console.warn('[E_BACKUP] 前次備份失效，改為重新建立：'+String(e.code||e.message));}
  }
  const name='restaurant-backup-'+stamp(now)+'-'+crypto.randomBytes(4).toString('hex')+'-'+type+'.sqlite';
  const target=path.join(backupDir,name);partial=target+'.partial';
  if(fs.existsSync(target)||fs.existsSync(partial))problem('E_BACKUP','備份暫存名稱衝突');
  db.exec("VACUUM INTO '"+partial.replace(/'/g,"''")+"'");
  const savedFingerprint=verifySnapshot(partial);
  fs.chmodSync(partial,0o600);protect(partial);fs.renameSync(partial,target);partial=null;
  if(type==='auto')db.prepare("UPDATE backup_settings SET last_auto_at=?,last_auto_name=?,last_fingerprint=?,last_result='created',last_error=NULL WHERE id=1").run(now.toISOString(),name,savedFingerprint);
  try{prune(db,backupDir);}catch(e){db.prepare('UPDATE backup_settings SET last_error=? WHERE id=1').run('舊版清理失敗（'+(e.code||'E_BACKUP')+'），已保留新備份');}
  return {result:'created',name};
 }catch(e){if(type==='auto'&&db)try{db.prepare('UPDATE backup_settings SET last_error=? WHERE id=1').run('自動備份失敗（'+(e.code||'E_BACKUP')+'）');}catch{}throw e;}
 finally{if(partial)try{fs.unlinkSync(partial)}catch{};if(db)db.close();release();}
}
function createManager(db,opts={}){
 const paths=getPaths(opts);let active=null,timer=null;
 function status(){const s=settings(db);return {...s,nextDueAt:dueAt(s),running:!!active,backups:list(paths.backupDir)};}
 function save(next){if(active)problem('E_BACKUP_BUSY','備份進行中');validate(next.intervalDays,next.retentionCount);db.prepare('UPDATE backup_settings SET interval_days=?,retention_count=? WHERE id=1').run(next.intervalDays,next.retentionCount);prune(db,paths.backupDir);return status();}
 function remove(name){if(active)problem('E_BACKUP_BUSY','備份進行中');fs.unlinkSync(namedFile(paths.backupDir,name).file);return status();}
 function run(type='manual'){
  if(active)return Promise.reject(Object.assign(new Error('備份進行中'),{code:'E_BACKUP_BUSY'}));
  active=new Promise((resolve,reject)=>{
   const worker=new Worker(path.join(__dirname,'backup-worker.js'),{workerData:{...paths,type}});let settled=false;
   function finish(err,value){if(settled)return;settled=true;if(err)reject(err);else resolve(value);}
   worker.on('message',m=>{if(m.ok)finish(null,m.result);else finish(Object.assign(new Error(m.message||'備份失敗'),{code:m.code||'E_BACKUP'}));});
   worker.on('error',e=>finish(e));worker.on('exit',c=>{if(!settled)finish(Object.assign(new Error('備份程序意外結束 '+c),{code:'E_BACKUP'}));});
  });const result=active;result.finally(()=>{if(active===result)active=null;}).catch(()=>{});return result;
 }
 function tick(){if(active)return Promise.resolve(null);let s;try{s=settings(db);}catch(e){return Promise.reject(e);}const next=dueAt(s);if(next&&Date.parse(next)>Date.now())return Promise.resolve(null);return run('auto');}
 function start(){if(timer||process.env.VERCEL)return;timer=setInterval(()=>tick().catch(e=>console.error('[E_BACKUP]',e.code||e.message)),60000);timer.unref?.();setImmediate(()=>tick().catch(e=>console.error('[E_BACKUP]',e.code||e.message)));}
 function stop(){if(timer)clearInterval(timer);timer=null;}
 return {status,save,remove,run,tick,start,stop,safeFile:name=>namedFile(paths.backupDir,name)};
}
module.exports={getPaths,settings,validate,dueAt,list,integrity,fingerprint,verifySnapshot,perform,createManager};
