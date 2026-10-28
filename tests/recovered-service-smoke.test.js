'use strict';
// RB-011: Synthetic, disposable recovery-to-HTTP test. NEVER touches operator data.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {openDb}=require('../src/db');
const {perform,verifySnapshot}=require('../src/backup-manager');
const {command}=require('../src/service');
const {makeHandler}=require('../server');

const sha=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const requests=async(port,route,options={})=>{
 const {method='GET',headers={},body}=options;
 const response=await fetch('http://127.0.0.1:'+port+route,{
  method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},
  ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'manual'
 });
 const raw=await response.text();
 return {status:response.status,body:JSON.parse(raw),cookie:response.headers.get('set-cookie')};
};
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-cold-restore-smoke-'));
 const data=path.join(root,'source-data');
 const backups=path.join(root,'source-backups');
 const restored=path.join(root,'isolated-recovery');
 let source=null,recovered=null,server=null;
 t.after(async()=>{
  if(server?.listening)await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  if(recovered)recovered.close();
  if(source)source.close();
  fs.rmSync(root,{recursive:true,force:true});
 });
 return {
  data,backups,restored,
  openSource(){const opened=openDb(data);source=opened.db;return opened;},
  closeSource(){if(source){source.close();source=null;}},
  reopenRecovered(){const opened=openDb(restored);recovered=opened.db;return opened;},
  async serve(){
   server=http.createServer(makeHandler(recovered));
   await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',resolve);
   });
   return server.address().port;
  }
 };
}
test('synthetic external recovery boots the actual HTTP API without using source data',async t=>{
 const f=fixture(t);
 const opened=f.openSource(),owner=opened.db.prepare("SELECT id,username,role FROM users WHERE role='owner'").get();
 const location=opened.db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 const ingredient=command(opened.db,owner,'ingredient.create',{sku:'SYNTHETIC-REC-01',name:'虛構復原食材',unit:'kg'}).id;
 command(opened.db,owner,'stock.opening',{location_id:location,ingredient_id:ingredient,qty:9,note:'Synthetic cold restore'});
 const managerPassword='fictional-manager-password-123';
 command(opened.db,owner,'user.create',{
  username:'restoremanager',display_name:'虛構恢復主管',role:'manager',
  password:managerPassword,location_id:location
 });
 const created=perform({folder:f.data,backupDir:f.backups,type:'manual'});
 const original=path.join(f.backups,created.name),hash=sha(original),fingerprint=verifySnapshot(original);
 f.closeSource();
 // Simulate a brand-new isolated machine with no operational data folder.
 assert.equal(fs.existsSync(f.restored),false);
 fs.mkdirSync(f.restored,{mode:0o700});
 fs.copyFileSync(original,path.join(f.restored,'restaurant.sqlite'));
 assert.equal(sha(path.join(f.restored,'restaurant.sqlite')),hash);
 const restored=f.reopenRecovered();
 assert.equal(restored.bootstrapPassword,null,'restored DB must never silently bootstrap a new owner');
 assert.equal(restored.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 assert.deepEqual(restored.db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(verifySnapshot(path.join(f.restored,'restaurant.sqlite')),fingerprint);
 const port=await f.serve();
 assert.equal((await requests(port,'/api/health')).status,200);
 assert.equal((await requests(port,'/api/me')).status,401);
 const ownerLogin=await requests(port,'/api/login',{
  method:'POST',body:{username:'owner',password:opened.bootstrapPassword}
 });
 assert.equal(ownerLogin.status,200);
 assert.match(ownerLogin.cookie,/^restaurant_session=[^;]+; HttpOnly; SameSite=Strict;/);
 const cookie=ownerLogin.cookie.split(';')[0];
 const me=await requests(port,'/api/me',{headers:{Cookie:cookie}});
 assert.equal(me.status,200);
 assert.equal(me.body.user.role,'owner');
 const inventory=await requests(port,'/api/data?entity=ingredients',{headers:{Cookie:cookie}});
 assert.equal(inventory.status,200);
 assert.ok(inventory.body.rows.some(row=>row.sku==='SYNTHETIC-REC-01'));
 assert.equal((await requests(port,'/api/overview',{headers:{Cookie:cookie}})).status,200);
 const managerLogin=await requests(port,'/api/login',{
  method:'POST',body:{username:'restoremanager',password:managerPassword}
 });
 assert.equal(managerLogin.status,200);
 const managerCookie=managerLogin.cookie.split(';')[0];
 const managerMe=await requests(port,'/api/me',{headers:{Cookie:managerCookie}});
 assert.equal(managerMe.body.user.role,'manager');
 const forbidden=await requests(port,'/api/command',{method:'POST',
  headers:{Cookie:managerCookie,'x-csrf-token':managerMe.body.csrf},
  body:{action:'location.create',data:{name:'不應被建立的虛構門市'}}
 });
 assert.equal(forbidden.status,403);
 assert.equal(restored.db.prepare('SELECT COUNT(*) AS n FROM stock_moves').get().n,1);
 assert.equal(restored.db.prepare("SELECT COUNT(*) AS n FROM locations WHERE name='不應被建立的虛構門市'").get().n,0);
 // The source archive remains byte-for-byte unchanged, without SQLite sidecars.
 assert.equal(sha(original),hash);
 assert.equal(fs.existsSync(original+'-wal'),false);
 assert.equal(fs.existsSync(original+'-shm'),false);
 // This ONLY proves same-runner synthetic startup. It is not Windows field UAT,
 // credential/session revocation, an offsite host, or an authorized live restore.
});
test('corrupted synthetic cold restore fails closed without overwriting source archive',t=>{
 const f=fixture(t);
 const initial=f.openSource();
 const created=perform({folder:f.data,backupDir:f.backups,type:'manual'});
 const archive=path.join(f.backups,created.name),digest=sha(archive);
 f.closeSource();
 fs.mkdirSync(f.restored,{mode:0o700});
 fs.writeFileSync(path.join(f.restored,'restaurant.sqlite'),'not an SQLite snapshot');
 assert.throws(()=>f.reopenRecovered(),/E_DB|SQLite|database|file is not a database/i);
 assert.equal(sha(archive),digest);
 assert.equal(fs.existsSync(path.join(f.restored,'.installed')),false);
 assert.ok(initial.bootstrapPassword);
});
