'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDb}=require('../src/db'),{rows,command}=require('../src/service');
const {clientIp,requestIp,withRequestIp}=require('../src/request-ip');
const {makeHandler}=require('../server');
const fetchJson=(port,route,options={})=>new Promise((resolve,reject)=>{
 const body=options.body===undefined?null:JSON.stringify(options.body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,method:options.method||'GET',headers:{...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(options.headers||{})}},res=>{
 let raw='';res.on('data',b=>raw+=b);res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(raw),cookie:res.headers['set-cookie']?.[0]})}catch(e){reject(e)}})});
 req.on('error',reject);req.end(body);
});
test('accept only socket IP, canonicalize mapped IPv4 and reject spoofed headers',()=>{
 assert.equal(clientIp({socket:{remoteAddress:'::ffff:127.0.0.1'},headers:{'x-forwarded-for':'203.0.113.99'}}),'127.0.0.1');
 assert.equal(clientIp({socket:{remoteAddress:'::1'},headers:{'x-real-ip':'203.0.113.99'}}),'::1');
 assert.equal(clientIp({socket:{remoteAddress:'fake-ip'}}),null);
 assert.equal(clientIp({socket:{remoteAddress:null}}),null);
});
test('async request context isolates concurrent request IPs',async()=>{
 const [a,b]=await Promise.all([
  withRequestIp('192.0.2.10',async()=>{await Promise.resolve();return requestIp();}),
  withRequestIp('2001:db8::1',async()=>{await Promise.resolve();return requestIp();})
 ]);
 assert.equal(a,'192.0.2.10');assert.equal(b,'2001:db8::1');assert.equal(requestIp(),null);
});
test('owner audit shows connection IP on failed login, success, changes and logout',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-ip-audit-'));
 const {db,bootstrapPassword}=openDb(folder);
 const server=http.createServer(makeHandler(db));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(folder,{recursive:true,force:true});});
 const port=server.address().port,spoof={'x-forwarded-for':'203.0.113.12','x-real-ip':'198.51.100.77'};
 const bad=await fetchJson(port,'/api/login',{method:'POST',headers:spoof,body:{username:'owner',password:'bad'}});
 assert.equal(bad.status,401);
 const good=await fetchJson(port,'/api/login',{method:'POST',headers:spoof,body:{username:'owner',password:bootstrapPassword}});
 assert.equal(good.status,200);
 const cookie=good.cookie.split(';')[0],me=await fetchJson(port,'/api/me',{headers:{Cookie:cookie}});
 assert.equal(me.status,200);
 const created=await fetchJson(port,'/api/command',{method:'POST',headers:{Cookie:cookie,'x-csrf-token':me.data.csrf,...spoof},
  body:{action:'location.create',data:{name:'來源 IP 測試分店'}}});
 assert.equal(created.status,200);
 const audit=await fetchJson(port,'/api/data?entity=audit_logs',{headers:{Cookie:cookie}});
 assert.equal(audit.status,200);
 for(const action of ['auth.login_failed','auth.login','location.create']){
  const log=audit.data.rows.find(x=>x.action===action);
  assert.ok(log,action);
  assert.equal(log.ip_address,'127.0.0.1');
  assert.notEqual(log.ip_address,'203.0.113.12');
  assert.equal(JSON.parse(log.detail).source_ip,'127.0.0.1');
 }
 const logout=await fetchJson(port,'/api/logout',{method:'POST',headers:{Cookie:cookie,'x-csrf-token':me.data.csrf},body:{}});
 assert.equal(logout.status,200);
 assert.equal(rows(db,db.prepare("SELECT id,username,role FROM users WHERE username='owner'").get(),'audit_logs').find(x=>x.action==='auth.logout').ip_address,'127.0.0.1');
 assert.equal((await fetchJson(port,'/api/data?entity=audit_logs')).status,401);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE username=?').get('owner').n,2);
});
test('old audit rows display unknown IP, and nonowners cannot see IP audit',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-ip-legacy-'));
 const {db}=openDb(folder);
 t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true});});
 const owner=db.prepare("SELECT id,username,role FROM users WHERE username='owner'").get();
 command(db,owner,'ingredient.create',{sku:'LEGACY-IP',name:'舊紀錄',unit:'公斤'});
 const logs=rows(db,owner,'audit_logs');
 assert.equal(logs.find(x=>x.action==='ingredient.create').ip_address,null);
 assert.throws(()=>rows(db,{id:'staff',role:'staff'},'audit_logs'),{status:403});
});
