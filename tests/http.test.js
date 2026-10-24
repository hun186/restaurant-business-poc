'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {openDb}=require('../src/db'),{makeHandler}=require('../server');
function request(port,route,opts={}){return new Promise((resolve,reject)=>{
 const body=opts.body===undefined?null:JSON.stringify(opts.body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,method:opts.method||'GET',headers:{...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(opts.headers||{})}},res=>{let raw='';res.on('data',x=>raw+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw),cookies:res.headers['set-cookie']}));});req.on('error',reject);req.end(body);
 });}
test('HTTP session login, CSRF, authorization, logout',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-http-'));
 const {db,bootstrapPassword}=openDb(folder);
 const server=http.createServer(makeHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));db.close();fs.rmSync(folder,{recursive:true,force:true});});
 const port=server.address().port;
 assert.equal((await request(port,'/api/me')).status,401);
 assert.equal((await request(port,'/api/login',{method:'POST',body:{username:'owner',password:'bad'}})).status,401);
 const login=await request(port,'/api/login',{method:'POST',body:{username:'owner',password:bootstrapPassword}});
 assert.equal(login.status,200);const cookie=login.cookies[0].split(';')[0];assert.ok(login.cookies[0].includes('HttpOnly'));assert.ok(login.cookies[0].includes('SameSite=Strict'));
 const auth={Cookie:cookie};const me=await request(port,'/api/me',{headers:auth});assert.equal(me.status,200);assert.equal(me.body.user.role,'owner');
 assert.equal((await request(port,'/api/command',{method:'POST',headers:auth,body:{action:'location.create',data:{name:'東店'}}})).status,403);
 const created=await request(port,'/api/command',{method:'POST',headers:{...auth,'x-csrf-token':me.body.csrf},body:{action:'location.create',data:{name:'東店'}}});assert.equal(created.status,200);
 assert.equal((await request(port,'/api/logout',{method:'POST',headers:{...auth,'x-csrf-token':me.body.csrf},body:{}})).status,200);
 assert.equal((await request(port,'/api/me',{headers:auth})).status,401);
});


test('paused POST cannot use a revoked role or owner session after JSON body finishes',async t=>{
 const {command}=require('../src/service'),{createManager}=require('../src/backup-manager');
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-http-race-'));
 const backupDir=path.join(path.dirname(folder),path.basename(folder)+'-backups');
 const {db,bootstrapPassword}=openDb(folder);
 const owner=db.prepare("SELECT id,username,role FROM users WHERE role='owner'").get();
 const location=db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 const managerId=command(db,owner,'user.create',{username:'slowmanager',display_name:'慢速傳輸主管',role:'manager',password:'slow-password-123',location_id:location}).id;
 const backups=createManager(db,{folder,backupDir}),handler=makeHandler(db,backups);
 let signal;
 const gate=()=>new Promise(resolve=>{signal=resolve;});
 const server=http.createServer((req,res)=>{
  const response=handler(req,res);
  // handler has reached its await parse(req) before the next microtask.
  if(req.headers['x-paused-test']==='1')queueMicrotask(()=>signal?.());
  return response;
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(folder,{recursive:true,force:true});fs.rmSync(backupDir,{recursive:true,force:true});});
 const port=server.address().port;
 const ownerLogin=await request(port,'/api/login',{method:'POST',body:{username:'owner',password:bootstrapPassword}});
 const managerLogin=await request(port,'/api/login',{method:'POST',body:{username:'slowmanager',password:'slow-password-123'}});
 assert.equal(ownerLogin.status,200);assert.equal(managerLogin.status,200);
 const ownerCookie=ownerLogin.cookies[0].split(';')[0],managerCookie=managerLogin.cookies[0].split(';')[0];
 const ownerCsrf=(await request(port,'/api/me',{headers:{Cookie:ownerCookie}})).body.csrf;
 const managerCsrf=(await request(port,'/api/me',{headers:{Cookie:managerCookie}})).body.csrf;
 async function paused(route,cookie,csrf,body,revoke){
  const ready=gate(),json=JSON.stringify(body),split=Math.max(1,Math.floor(json.length/2));
  let client;const result=new Promise((resolve,reject)=>{
   client=http.request({hostname:'127.0.0.1',port,path:route,method:'POST',headers:{
    'content-type':'application/json','content-length':Buffer.byteLength(json),
    Cookie:cookie,'x-csrf-token':csrf,'x-paused-test':'1'
   }},res=>{let raw='';res.on('data',x=>raw+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});
   client.on('error',reject);
   client.write(json.slice(0,split));
  });
  await ready;revoke();client.end(json.slice(split));return result;
 }
 const commandResponse=await paused('/api/command',managerCookie,managerCsrf,{action:'ingredient.create',data:{sku:'BLOCK-RACE',name:'不應新增',unit:'公斤'}},()=>{
  command(db,owner,'user.role',{user_id:managerId,role:'staff'});
 });
 assert.equal(commandResponse.status,401);
 assert.equal(db.prepare("SELECT count(*) n FROM ingredients WHERE sku='BLOCK-RACE'").get().n,0);
 const settingsBefore=db.prepare('SELECT interval_days FROM backup_settings WHERE id=1').get().interval_days;
 const backupResponse=await paused('/api/backups',ownerCookie,ownerCsrf,{action:'save',intervalDays:9,retentionCount:33},()=>{
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(owner.id);
 });
 assert.equal(backupResponse.status,401);
 assert.equal(db.prepare('SELECT interval_days FROM backup_settings WHERE id=1').get().interval_days,settingsBefore);
});
