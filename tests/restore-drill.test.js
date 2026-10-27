'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {openDb}=require('../src/db');
const {command}=require('../src/service');
const {perform,verifySnapshot,list}=require('../src/backup-manager');
const {drillRestore,parseArgs}=require('../tools/restore-drill');
const prefix='restaurant-restore-drill-';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-drill-test-'));
 const folder=path.join(root,'data'),backupDir=path.join(root,'backups');
 const {db}=openDb(folder);
 t.after(()=>{db.close();fs.rmSync(root,{recursive:true,force:true});});
 const owner=db.prepare("SELECT id,role,username FROM users WHERE role='owner'").get();
 const locationId=db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 return {root,folder,backupDir,db,owner,locationId};
}
function sha(file){return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
function transient(){return new Set(fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith(prefix)));}
function unchanged(before){assert.deepEqual(transient(),before,'isolation temp folders must be removed');}
test('restored disposable copy verifies a backup without changing newer live data or backup bytes',t=>{
 const f=fixture(t),owner=f.owner;
 const ing=command(f.db,owner,'ingredient.create',{sku:'DRILL-01',name:'演練食材',unit:'公斤'}).id;
 const initial=perform({folder:f.folder,backupDir:f.backupDir,type:'manual'});
 const file=path.join(f.backupDir,initial.name),digest=sha(file),fp=verifySnapshot(file);
 command(f.db,owner,'stock.opening',{location_id:f.locationId,ingredient_id:ing,qty:3,note:'備份後正式庫異動'});
 const current=f.db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get().n;
 const temp=transient(),result=drillRestore({folder:f.folder,backupDir:f.backupDir,name:initial.name});
 assert.equal(result.result,'verified');assert.equal(result.sha256,digest);
 assert.equal(result.fingerprint,fp);assert.equal(result.counts.stockMoves,0);
 assert.equal(result.counts.activeOwners,1);assert.equal(result.counts.locations,1);
 assert.equal(result.temporaryCopyRemoved,true);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get().n,current);
 assert.equal(sha(file),digest);assert.equal(list(f.backupDir).length,1);
 unchanged(temp);
});
test('newest named snapshot selected by default and malformed choices are rejected',t=>{
 const f=fixture(t);
 const earlier=perform({folder:f.folder,backupDir:f.backupDir,type:'manual',at:'2026-10-20T12:00:00.000Z'});
 const later=perform({folder:f.folder,backupDir:f.backupDir,type:'manual',at:'2026-10-21T12:00:00.000Z'});
 assert.equal(drillRestore({folder:f.folder,backupDir:f.backupDir}).name,later.name);
 assert.equal(drillRestore({folder:f.folder,backupDir:f.backupDir,name:earlier.name}).name,earlier.name);
 assert.throws(()=>drillRestore({folder:f.folder,backupDir:f.backupDir,name:'../restaurant.sqlite'}),{code:'E_CONFIG'});
 assert.deepEqual(parseArgs(['--backup',later.name]),{name:later.name});
 assert.throws(()=>parseArgs(['--data-dir','x']),{code:'E_CONFIG'});
});
test('missing backups and corrupt snapshots fail closed; no live database is overwritten',t=>{
 const f=fixture(t);
 const temp=transient(),before=sha(path.join(f.folder,'restaurant.sqlite'));
 assert.throws(()=>drillRestore({folder:f.folder,backupDir:f.backupDir}),{code:'E_BACKUP'});
 const created=perform({folder:f.folder,backupDir:f.backupDir,type:'manual'});
 const file=path.join(f.backupDir,created.name);fs.writeFileSync(file,'bad sqlite');
 assert.throws(()=>drillRestore({folder:f.folder,backupDir:f.backupDir}),/E_DB|database|file is not a database|SQLite/);
 assert.equal(sha(path.join(f.folder,'restaurant.sqlite')),before);
 assert.equal(fs.readFileSync(file,'utf8'),'bad sqlite');
 unchanged(temp);
});
test('read-only drill preserves original archive permissions and never creates SQLite WAL sidecars there',t=>{
 const f=fixture(t);
 const entry=perform({folder:f.folder,backupDir:f.backupDir,type:'manual'});
 const file=path.join(f.backupDir,entry.name);
 // WAL-mode backups demonstrate why calling DatabaseSync on the *source*
 // would be unsafe even when the SQLite handle is marked readOnly.
 const writable=new DatabaseSync(file);
 try{writable.exec('PRAGMA journal_mode=WAL');}finally{writable.close();}
 for(const suffix of ['-wal','-shm'])fs.rmSync(file+suffix,{force:true});
 const before=transient(),byteHash=sha(file);
 if(process.platform!=='win32'){
  fs.chmodSync(f.backupDir,0o750);fs.chmodSync(file,0o640);
 }
 const beforeDirMode=fs.statSync(f.backupDir).mode&0o777;
 const beforeFileMode=fs.statSync(file).mode&0o777;
 const result=drillRestore({folder:f.folder,backupDir:f.backupDir,name:entry.name});
 assert.equal(result.result,'verified');assert.equal(result.sha256,byteHash);
 assert.equal(fs.statSync(f.backupDir).mode&0o777,beforeDirMode,'archive dir mode untouched');
 assert.equal(fs.statSync(file).mode&0o777,beforeFileMode,'backup file mode untouched');
 for(const suffix of ['-wal','-shm'])assert.equal(fs.existsSync(file+suffix),false,'no sidecar next to source backup');
 assert.equal(sha(file),byteHash);
 unchanged(before);
});
test('rejected snapshot symlink does not adjust source permissions',t=>{
 if(process.platform==='win32'){t.skip('Windows symlink creation may require developer privileges');return;}
 const f=fixture(t),e=perform({folder:f.folder,backupDir:f.backupDir,type:'manual'});
 const backup=path.join(f.backupDir,e.name),outside=path.join(f.root,'outside.sqlite');
 fs.renameSync(backup,outside);fs.symlinkSync(outside,backup);
 const before=transient();
 assert.throws(()=>drillRestore({folder:f.folder,backupDir:f.backupDir}),{code:'E_BACKUP'});
 assert.equal(fs.lstatSync(backup).isSymbolicLink(),true);
 unchanged(before);
});
test('does not create a database when the original data folder has been lost',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-drill-missing-'));
 const folder=path.join(root,'data'),backupDir=path.join(root,'backups');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.throws(()=>drillRestore({folder,backupDir}),{code:'E_DB'});
 assert.equal(fs.existsSync(folder),false);
});
test('Windows launcher safeguards project path and never offers production overwrite',()=>{
 const batch=fs.readFileSync(path.join(__dirname,'../備份還原演練.bat'),'utf8');
 assert.match(batch,/pushd "%~dp0"/i);
 assert.match(batch,/if errorlevel 1 \(/i);
 assert.match(batch,/node --disable-warning=ExperimentalWarning "tools\\restore-drill.js"/i);
 assert.match(batch,/popd/i);
 assert.doesNotMatch(batch,/del\s+.*restaurant\.sqlite|copy\s+.*data\\restaurant\.sqlite/i);
});
