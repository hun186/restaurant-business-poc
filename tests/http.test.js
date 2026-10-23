'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {openDb}=require('../src/db'),{makeHandler}=require('../server');
function request(port,route,opts={}){return new Promise((resolve,reject)=>{
 const body=opts.body===undefined?null:JSON.stringify(opts.body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,method:opts.method||'GET',headers:{...(body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(opts.headers||{})}},res=>{let raw='';res.on('data',x=>raw+=x);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw),cookies:res.headers['set-cookie']}));});req.on('error',reject);req.end(body);
 });}
test('HTTP session login, CSRF, authorization, logout',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-http-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const {db,bootstrapPassword}=openDb(folder);t.after(()=>db.close());
 const server=http.createServer(makeHandler(db));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
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
