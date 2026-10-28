'use strict';
// RB-011-SESSION: synthetic cold-restore rehearsal only. Never opens operator data or archives for write.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const http=require('node:http');
const {DatabaseSync}=require('node:sqlite');
const {openDb,verifyInstalledSchema}=require('../src/db');
const {command}=require('../src/service');
const {perform,verifySnapshot,fingerprint}=require('../src/backup-manager');
const {makeHandler}=require('../server');

const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
async function request(port,route,{method='GET',headers={},body}={}){
 const response=await fetch('http://127.0.0.1:'+port+route,{
  method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual'
 });
 return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')};
}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-session-restore-'));
 const sourceDir=path.join(root,'source-data'),backupDir=path.join(root,'source-backups');
 const liveDir=path.join(root,'unsafe-recovered'),safeDir=path.join(root,'safe-recovered');
 const databases=[],servers=[];
 t.after(async()=>{
  for(const server of servers)if(server.listening)await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  for(const db of databases)try{db.close()}catch{}
  fs.rmSync(root,{recursive:true,force:true});
 });
 const source=openDb(sourceDir),db=source.db;databases.push(db);
 const owner=db.prepare("SELECT id,username,role FROM users WHERE role='owner'").get();
 const location=db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 const ingredient=command(db,owner,'ingredient.create',{sku:'SESSION-REC-TEST',name:'虛構存貨',unit:'公斤'}).id;
 command(db,owner,'stock.opening',{location_id:location,ingredient_id:ingredient,qty:7,note:'隔離測試'});
 const token='synthetic-previously-issued-token-not-a-real-secret';
 const tokenHash=crypto.createHash('sha256').update(token).digest('hex');
 db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
  .run(tokenHash,'synthetic-csrf',owner.id,'2099-01-01T00:00:00.000Z');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
 const created=perform({folder:sourceDir,backupDir,type:'manual'});
 const archive=path.join(backupDir,created.name),archiveDigest=digest(archive);
 const archiveFingerprint=verifySnapshot(archive);
 db.close();databases.pop();
 function copy(dir){fs.mkdirSync(dir,{mode:0o700});const filename=path.join(dir,'restaurant.sqlite');fs.copyFileSync(archive,filename);assert.equal(digest(filename),archiveDigest);return filename;}
 async function serve(dir){
  const restored=openDb(dir);
  databases.push(restored.db);
  assert.equal(restored.bootstrapPassword,null,'restoring an existing DB must not bootstrap owner');
  const server=http.createServer(makeHandler(restored.db));servers.push(server);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {db:restored.db,port:server.address().port};
 }
 return {root,archive,archiveDigest,archiveFingerprint,sourceDir,backupDir,liveDir,safeDir,
  ownerPassword:source.bootstrapPassword,token,copy,serve,ingredient};
}
test('unsafe synthetic recovery reaccepts an archived session; scrubbed isolated copy rejects old cookie',async t=>{
 const f=fixture(t),oldCookie='restaurant_session='+f.token;
 const unsafeFile=f.copy(f.liveDir),unsafe=await f.serve(f.liveDir);
 const replay=await request(unsafe.port,'/api/me',{headers:{Cookie:oldCookie}});
 assert.equal(replay.status,200,'regression guard: an unchanged snapshot can replay a formerly valid session');
 assert.equal(replay.body.user.role,'owner');
 assert.equal(unsafe.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);
 // IMPORTANT: only a separate disposable recovery copy is ever opened for write.
 const readyFile=f.copy(f.safeDir);
 const isolated=new DatabaseSync(readyFile);
 try{
  isolated.exec('PRAGMA foreign_keys=ON');
  assert.equal(isolated.prepare('PRAGMA user_version').get().user_version,3);
  verifyInstalledSchema(isolated,3);
  assert.equal(isolated.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.deepEqual(isolated.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(isolated.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1,
   'backup contains old sessions; test must not pass because the fixture omitted them');
  const before=fingerprint(isolated);
  isolated.exec('BEGIN IMMEDIATE');
  try{isolated.exec('DELETE FROM sessions');isolated.exec('COMMIT');}
  catch(error){isolated.exec('ROLLBACK');throw error;}
  assert.equal(isolated.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  assert.equal(fingerprint(isolated),before,'deleting volatile sessions must preserve business fingerprint');
  assert.equal(isolated.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.deepEqual(isolated.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{isolated.close();}
 const safe=await f.serve(f.safeDir);
 assert.equal((await request(safe.port,'/api/health')).status,200);
 assert.equal((await request(safe.port,'/api/me',{headers:{Cookie:oldCookie}})).status,401,
  'old pre-disaster cookie MUST be invalid after offline session revocation');
 assert.equal((await request(safe.port,'/api/overview',{headers:{Cookie:oldCookie}})).status,401);
 const login=await request(safe.port,'/api/login',{method:'POST',body:{username:'owner',password:f.ownerPassword}});
 assert.equal(login.status,200,'existing owner password, not reset/bootstrap password, still works');
 const freshCookie=login.cookie?.split(';')[0];assert.match(freshCookie,/^restaurant_session=/);
 assert.notEqual(freshCookie,oldCookie);
 const me=await request(safe.port,'/api/me',{headers:{Cookie:freshCookie}});
 assert.equal(me.status,200);assert.equal(me.body.user.role,'owner');
 const stock=await request(safe.port,'/api/data?entity=stock',{headers:{Cookie:freshCookie}});
 assert.equal(stock.status,200);
 assert.ok(stock.body.rows.some(r=>r.ingredient_id===f.ingredient&&r.on_hand===7));
 assert.equal(safe.db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get().n,1);
 assert.equal(safe.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1,
  'only the fresh login session should exist after the recovery');
 // The original backup is read-only evidence and remains unmodified.
 assert.equal(digest(f.archive),f.archiveDigest);
 assert.equal(fs.existsSync(f.archive+'-wal'),false);
 assert.equal(fs.existsSync(f.archive+'-shm'),false);
 assert.equal(verifySnapshot(f.archive),f.archiveFingerprint);
 assert.equal(fs.existsSync(path.join(f.sourceDir,'restaurant.sqlite')),true,
  'test keeps original database file distinct from the recovered files');
 assert.notEqual(unsafeFile,readyFile);
});
