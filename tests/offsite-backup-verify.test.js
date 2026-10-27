'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {openDb}=require('../src/db');
const {perform}=require('../src/backup-manager');
const {verifyOffsiteCopy,parseArgs}=require('../tools/offsite-backup-verify');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-offsite-test-'));
 const folder=path.join(root,'data'),backupDir=path.join(root,'backups'),remoteDir=path.join(root,'removable-drive');
 fs.mkdirSync(remoteDir,{recursive:true});
 const db=openDb(folder).db;
 t.after(()=>{try{db.close();}catch{}fs.rmSync(root,{recursive:true,force:true});});
 const created=perform({folder,backupDir,type:'manual'});
 const source=path.join(backupDir,created.name),remote=path.join(remoteDir,created.name);
 fs.copyFileSync(source,remote);
 return {root,folder,backupDir,remoteDir,remote,db};
}
const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const staging=()=>new Set(fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('restaurant-offsite-verify-')));
test('offsite verifier works on another host with no live database and leaves source untouched',t=>{
 const f=fixture(t),hash=digest(f.remote);
 f.db.close();
 fs.rmSync(f.folder,{recursive:true,force:true});
 const before=staging(),mode=fs.statSync(f.remote).mode&0o777,files=fs.readdirSync(f.remoteDir);
 const result=verifyOffsiteCopy({file:f.remote,expectedSha256:hash});
 assert.equal(result.result,'verified');
 assert.equal(result.sha256,hash);assert.equal(result.counts.activeOwners,1);
 assert.equal(result.sourceUnchanged,true);assert.equal(result.temporaryCopyRemoved,true);
 assert.equal(fs.existsSync(f.folder),false,'no operational data directory created');
 assert.equal(digest(f.remote),hash);assert.equal(fs.statSync(f.remote).mode&0o777,mode);
 assert.deepEqual(fs.readdirSync(f.remoteDir),files,'no WAL/SHM sidecars at source');
 assert.deepEqual(staging(),before,'disposable copy cleaned');
});
test('wrong or missing independent digest rejects; original never changed',t=>{
 const f=fixture(t),hash=digest(f.remote),prior=staging();
 assert.throws(()=>verifyOffsiteCopy({file:f.remote,expectedSha256:'0'.repeat(64)}),{code:'E_DIGEST'});
 assert.throws(()=>verifyOffsiteCopy({file:f.remote,expectedSha256:''}),{code:'E_CONFIG'});
 assert.throws(()=>verifyOffsiteCopy({file:f.remote,expectedSha256:hash.slice(0,63)}),{code:'E_CONFIG'});
 assert.equal(digest(f.remote),hash);assert.deepEqual(staging(),prior);
});
test('corrupted external backup fails closed even with its current matching digest',t=>{
 const f=fixture(t),prior=staging();
 fs.writeFileSync(f.remote,'not sqlite');
 assert.throws(()=>verifyOffsiteCopy({file:f.remote,expectedSha256:digest(f.remote)}),/E_DB|SQLite|database|file is not a database/);
 assert.equal(fs.readFileSync(f.remote,'utf8'),'not sqlite');assert.deepEqual(staging(),prior);
});
test('WAL-mode archive does not gain -wal/-shm on the removable drive',t=>{
 const f=fixture(t);
 const db=new DatabaseSync(f.remote);
 try{db.exec('PRAGMA journal_mode=WAL');}finally{db.close();}
 for(const ext of ['-wal','-shm'])fs.rmSync(f.remote+ext,{force:true});
 const before=staging(),hash=digest(f.remote);
 if(process.platform!=='win32'){fs.chmodSync(f.remoteDir,0o750);fs.chmodSync(f.remote,0o640);}
 const mode=fs.statSync(f.remote).mode&0o777,dirMode=fs.statSync(f.remoteDir).mode&0o777;
 assert.equal(verifyOffsiteCopy({file:f.remote,expectedSha256:hash}).result,'verified');
 assert.equal(fs.statSync(f.remote).mode&0o777,mode);assert.equal(fs.statSync(f.remoteDir).mode&0o777,dirMode);
 for(const ext of ['-wal','-shm'])assert.equal(fs.existsSync(f.remote+ext),false);
 assert.deepEqual(staging(),before);
});
test('Windows interactive launcher uses Node prompts rather than CMD-interpolated paths',()=>{
 const bat=fs.readFileSync(path.join(__dirname,'../異機備份驗證.bat'),'utf8');
 assert.match(bat,/pushd "%~dp0"/i);
 assert.match(bat,/node --disable-warning=ExperimentalWarning "tools\\offsite-backup-verify.js" --interactive/i);
 assert.match(bat,/popd/i);
 assert.doesNotMatch(bat,/%DRILL_FILE%|%DRILL_HASH%|copy\s+.*data\\restaurant\.sqlite/i);
});
test('CLI validates external snapshot without printing actual account or employee data',t=>{
 const f=fixture(t),hash=digest(f.remote);
 const child=require('node:child_process').spawnSync(process.execPath,
  [path.join(__dirname,'../tools/offsite-backup-verify.js'),'--file',f.remote,'--sha256',hash],
  {encoding:'utf8',timeout:20000});
 assert.equal(child.status,0,child.stderr);
 assert.match(child.stdout,/PASS/);
 assert.match(child.stdout,new RegExp(hash));
 assert.doesNotMatch(child.stdout,/password_hash|password_salt|display_name/);
});
test('rejects symlinks, unexpected filenames and invalid CLI parameters',t=>{
 const f=fixture(t),hash=digest(f.remote),args=['--file',f.remote,'--sha256',hash];
 assert.deepEqual(parseArgs(args),{file:f.remote,expectedSha256:hash});
 assert.throws(()=>parseArgs(['--file',f.remote]),{code:'E_CONFIG'});
 assert.throws(()=>verifyOffsiteCopy({file:path.join(f.remoteDir,'other.sqlite'),expectedSha256:hash}),{code:'E_CONFIG'});
 assert.throws(()=>verifyOffsiteCopy({file:path.join(f.remoteDir,'restaurant-backup-20261028-000000-deadbeef-manual.sqlite'),expectedSha256:hash}),{code:'E_BACKUP'});
 if(process.platform==='win32')return;
 const link=path.join(f.remoteDir,'restaurant-backup-20261028-000000-deadbeef-manual.sqlite');
 fs.symlinkSync(f.remote,link);
 assert.throws(()=>verifyOffsiteCopy({file:link,expectedSha256:hash}),{code:'E_BACKUP'});
});
