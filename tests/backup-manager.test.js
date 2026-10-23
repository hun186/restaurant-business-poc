'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {openDb}=require('../src/db'),{command}=require('../src/service');
const {perform,createManager,list,verifySnapshot}=require('../src/backup-manager');
const {makeHandler}=require('../server');
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-backup-test-'));const folder=path.join(root,'data'),backupDir=path.join(root,'backups');const {db,bootstrapPassword}=openDb(folder);t.after(()=>{try{db.close()}catch{}fs.rmSync(root,{recursive:true,force:true});});return {root,folder,backupDir,db,bootstrapPassword,owner:db.prepare("SELECT id,username,role FROM users WHERE role='owner'").get()};}
const day='2026-10-23T09:00:00.000Z';
test('default settings are 1 day and 50 automatic backups',t=>{
 const f=fixture(t),m=createManager(f.db,f);const s=m.status();assert.equal(s.intervalDays,1);assert.equal(s.retentionCount,50);assert.equal(s.backups.length,0);
 assert.equal(s.lastAutoAt,null);
});
test('verified automatic backup skips unchanged durable data and advances due date',t=>{
 const f=fixture(t);let a=perform({...f,type:'auto',at:day});assert.equal(a.result,'created');const name=a.name;
 assert.equal(verifySnapshot(path.join(f.backupDir,name)).length,64);
 a=perform({...f,type:'auto',at:'2026-10-24T09:00:00.000Z'});assert.equal(a.result,'skipped');assert.equal(a.name,name);
 assert.equal(list(f.backupDir).length,1);
 let m=createManager(f.db,f),s=m.status();assert.equal(s.lastResult,'skipped');assert.equal(s.lastAutoAt,'2026-10-24T09:00:00.000Z');
 assert.equal(perform({...f,type:'auto',at:'2026-10-24T10:00:00.000Z'}).result,'not_due');
});
test('real business change creates new auto backup even after a skip',t=>{
 const f=fixture(t);perform({...f,type:'auto',at:day});perform({...f,type:'auto',at:'2026-10-24T09:00:00.000Z'});
 command(f.db,f.owner,'ingredient.create',{sku:'TOMATO-100',name:'番茄',unit:'公斤',min_stock:2});
 const a=perform({...f,type:'auto',at:'2026-10-25T09:00:00.000Z'});
 assert.equal(a.result,'created');assert.equal(list(f.backupDir).filter(x=>x.type==='auto').length,2);
});
test('previous auto file missing or corrupt must not cause unsafe skip',t=>{
 const f=fixture(t),a=perform({...f,type:'auto',at:day});fs.writeFileSync(path.join(f.backupDir,a.name),'not sqlite');
 const b=perform({...f,type:'auto',at:'2026-10-24T09:00:00.000Z'});assert.equal(b.result,'created');assert.notEqual(b.name,a.name);
});
test('retention removes only the oldest automatic snapshots',t=>{
 const f=fixture(t),m=createManager(f.db,f);m.save({intervalDays:1,retentionCount:1});
 perform({...f,type:'auto',at:day});const manual1=perform({...f,type:'manual',at:'2026-10-23T10:00:00.000Z'}).name;
 command(f.db,f.owner,'ingredient.create',{sku:'EGG-100',name:'雞蛋',unit:'顆',min_stock:3});
 perform({...f,type:'auto',at:'2026-10-24T09:00:00.000Z'});
 const all=list(f.backupDir);assert.equal(all.filter(x=>x.type==='auto').length,1);assert.ok(all.some(x=>x.name===manual1));
 const manual2=perform({...f,type:'manual',at:'2026-10-25T09:00:00.000Z'}).name;
 assert.ok(list(f.backupDir).some(x=>x.name===manual2));
});
test('settings and file names are validated; symlink downloads rejected',t=>{
 const f=fixture(t),m=createManager(f.db,f);
 assert.throws(()=>m.save({intervalDays:0,retentionCount:50}),{code:'E_CONFIG'});
 assert.throws(()=>m.save({intervalDays:1.5,retentionCount:50}),{code:'E_CONFIG'});
 assert.throws(()=>m.remove('../outside.sqlite'),{code:'E_CONFIG'});
 const entry=perform({...f,type:'manual',at:day});
 assert.throws(()=>m.safeFile('../'+entry.name),{code:'E_CONFIG'});
 if(process.platform!=='win32'){
  const link=entry.name.replace(/\.sqlite$/,'.sqlite');fs.renameSync(path.join(f.backupDir,entry.name),path.join(f.root,'safe.sqlite'));
  fs.symlinkSync(path.join(f.root,'safe.sqlite'),path.join(f.backupDir,link));
  assert.throws(()=>m.safeFile(link),{code:'E_BACKUP'});
 }
});
test('existing v1 database migrates to v3 via verified snapshots',t=>{
 const f=fixture(t);f.db.exec('DROP TABLE dish_ingredients;DROP TABLE menu_dishes;DROP TABLE ingredient_prices;DROP TABLE backup_settings; PRAGMA user_version=1;');f.db.close();
 const prior=process.env.BACKUP_DIR;process.env.BACKUP_DIR=f.backupDir;
 try{const next=openDb(f.folder);try{
  assert.equal(next.db.prepare('PRAGMA user_version').get().user_version,3);
  assert.equal(next.db.prepare('SELECT interval_days FROM backup_settings WHERE id=1').get().interval_days,1);
  assert.equal(next.bootstrapPassword,null);
  const migration=list(f.backupDir).filter(x=>x.type==='migration');assert.equal(migration.length,2);
 }finally{next.db.close();}}finally{if(prior===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=prior;}
});
test('background worker performs validated backup without blocking HTTP',async t=>{
 const f=fixture(t),m=createManager(f.db,f);
 const r=await m.run('manual');assert.equal(r.result,'created');assert.equal(list(f.backupDir).length,1);
 assert.equal(m.status().running,false);
});
function request(port,route,opt={}){return new Promise((resolve,reject)=>{
 const body=opt.body===undefined?null:JSON.stringify(opt.body);const req=http.request({hostname:'127.0.0.1',port,path:route,method:opt.method||'GET',headers:{...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(opt.headers||{})}},res=>{
  let data=Buffer.alloc(0);res.on('data',b=>data=Buffer.concat([data,b]));res.on('end',()=>{let json;try{json=JSON.parse(data.toString())}catch{}resolve({status:res.statusCode,json,data,cookie:res.headers['set-cookie']?.[0],headers:res.headers});});});req.on('error',reject);req.end(body);
});}
test('backup API requires owner session and CSRF; downloads verified binary',async t=>{
 const f=fixture(t),m=createManager(f.db,f);
 const server=http.createServer(makeHandler(f.db,m));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));});const port=server.address().port;
 assert.equal((await request(port,'/api/backups')).status,401);
 const login=await request(port,'/api/login',{method:'POST',body:{username:'owner',password:f.bootstrapPassword}});
 const auth={cookie:login.cookie.split(';')[0]};const me=await request(port,'/api/me',{headers:auth});
 assert.equal((await request(port,'/api/backups',{headers:auth})).status,200);
 assert.equal((await request(port,'/api/backups',{method:'POST',headers:auth,body:{action:'create'}})).status,403);
 const ok=await request(port,'/api/backups',{method:'POST',headers:{...auth,'x-csrf-token':me.json.csrf},body:{action:'create'}});
 assert.equal(ok.status,200);assert.equal(ok.json.result.result,'created');
 const name=ok.json.result.name;
 const download=await request(port,'/api/backups?file='+encodeURIComponent(name),{headers:auth});
 assert.equal(download.status,200);assert.equal(download.data.subarray(0,15).toString(),'SQLite format 3');
 assert.equal((await request(port,'/api/backups?file=../abc.sqlite',{headers:auth})).status,400);
 const id=command(f.db,f.owner,'user.create',{location_id:f.db.prepare('SELECT id FROM locations LIMIT 1').get().id,username:'manager66',display_name:'主管',password:'manager-password-456',role:'manager'}).id;
 const other=await request(port,'/api/login',{method:'POST',body:{username:'manager66',password:'manager-password-456'}});
 assert.equal((await request(port,'/api/backups',{headers:{cookie:other.cookie.split(';')[0]}})).status,403);
});
test('older abandoned partial can be safely reclaimed without deleting completed backups',t=>{
 const f=fixture(t);const a=perform({...f,type:'manual',at:day});
 const partial=path.join(f.backupDir,a.name+'.partial');fs.writeFileSync(partial,'stale interrupted temp');
 const then=new Date(Date.now()-26*3600000);fs.utimesSync(partial,then,then);
 perform({...f,type:'manual',at:'2026-10-24T09:00:00.000Z'});
 assert.equal(fs.existsSync(partial),false);
 assert.equal(fs.existsSync(path.join(f.backupDir,a.name)),true);
});
test('refuse writing backup directory inside operational data directory',t=>{
 const f=fixture(t);assert.throws(()=>perform({...f,backupDir:path.join(f.folder,'backups'),type:'manual'}),{code:'E_CONFIG'});
});
