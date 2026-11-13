'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const workerPromise=import('../cloudflare/worker.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
function makeD1(db){
 const bind=(sql,args)=>({
  first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...bind(sql,[]),bind(...args){return bind(sql,args)}};},
  async batch(statements){
   db.exec('BEGIN IMMEDIATE');
   try{const r=[];for(const statement of statements)r.push(await statement.run());
    db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}
  }};
}
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 const password='owner-synthetic-original-123';
 const stored=await (await authPromise).hashWorkerPassword(password);
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
  .run('synthetic-owner','owner','測試業主','owner',stored.password_salt,stored.password_hash);
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('123e4567-e89b-42d3-a456-426614174000','合成測試餐廳');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('ingredient-1','TEST-1','奶油球','包');
 const env={DB:makeD1(db),CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  NATIVE_AUTH_SOURCE_PEPPER:'synthetic-source-pepper-32-characters-only'};
 const worker=(await workerPromise).default;
 const send=(url,init={},override=env,edge=true)=>{
  const request=new Request(site+url,init);
  if(edge)Object.defineProperty(request,'cf',{value:{colo:'TPE'}});
  return worker.fetch(request,override);
 };
 const ip='198.51.100.18';
 async function login(pass=password){
  const res=await send('/api/login',{method:'POST',headers:{
   origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
   'CF-Connecting-IP':ip},body:JSON.stringify({username:'owner',password:pass})});
  if(res.status!==200)return {status:res.status};
  const cookie=res.headers.get('set-cookie').split(';')[0],body=await res.json();
  return {status:200,cookie,csrf:body.csrf};
 }
 function change(session,current_password=password,new_password='brand-new-owner-password-123',options={}){
  const {override=env,origin=site,csrf=session.csrf,edge=true,body} = options;
  return send('/api/password/change',{method:'POST',headers:{
   origin,'content-type':'application/json','sec-fetch-site':'same-origin',
   'CF-Connecting-IP':ip,cookie:session.cookie,'x-csrf-token':csrf},
   body:body??JSON.stringify({current_password,new_password})
  },override,edge);
 }
 return {db,env,send,login,change,password};
}
const count=(db,table)=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n;


test('Native Owner sees account list without any password hashes; staff cannot list',async t=>{
 const f=await fixture(t),session=await f.login();
 assert.equal(session.status,200);
 const result=await f.send('/api/accounts',{headers:{cookie:session.cookie,'sec-fetch-site':'same-origin'}});
 assert.equal(result.status,200);const data=await result.json();
 assert.equal(data.can_create,false);assert.equal(data.users.length,1);
 assert.equal(data.users[0].role,'owner');
 assert.doesNotMatch(JSON.stringify(data),/password_hash|password_salt|csrf|synthetic-owner-password/);
 assert.equal((await f.send('/api/accounts')).status,401);
 f.db.prepare("UPDATE users SET role='staff' WHERE username='owner'").run();
 assert.equal((await f.send('/api/accounts',{headers:{cookie:session.cookie}})).status,403);
});

test('Native Owner account creation is separately gated; creates staff + store + audit atomically',async t=>{
 const f=await fixture(t),session=await f.login();
 assert.equal(session.status,200);
 const input={action:'user.create',username:'newstaff',displayName:'新員工',
  role:'staff',initialPassword:'synthetic-new-staff-password-123',
  locationIds:['123e4567-e89b-42d3-a456-426614174000']};
 const send=(payload=input,env=f.env,csrf=session.csrf,origin=site)=>
   f.send('/api/accounts',{method:'POST',headers:{cookie:session.cookie,
   'x-csrf-token':csrf,origin,'content-type':'application/json',
   'sec-fetch-site':'same-origin'},body:JSON.stringify(payload)},env);
 assert.equal((await send()).status,503);
 assert.equal(count(f.db,'users'),1);
 const live={...f.env,CLOUD_NATIVE_ACCOUNT_WRITE_GATE:'operator-released'};
 assert.equal((await send(input,live,'wrong')).status,403);
 assert.equal((await send(input,live,session.csrf,'https://evil.invalid')).status,403);
 assert.equal((await send({...input,role:'owner'},live)).status,400);
 const created=await send(input,live);
 assert.equal(created.status,201,JSON.stringify(await created.json()));
 const row=f.db.prepare("SELECT * FROM users WHERE username='newstaff'").get();
 assert.equal(row.role,'staff');assert.equal(row.active,1);
 assert.equal(await (await authPromise).verifyWorkerPassword(input.initialPassword,
   row.password_salt,row.password_hash),true);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM user_locations WHERE user_id=?').get(row.id).n,1);
 const audits=f.db.prepare("SELECT * FROM audit_logs WHERE action='user.create'").all();
 assert.equal(audits.length,1);
 assert.deepEqual(JSON.parse(audits[0].detail),{role:'staff',assigned_locations:1});
 assert.doesNotMatch(JSON.stringify(audits),/synthetic-new-staff-password|pbkdf2-sha256/);
 assert.equal((await send(input,live)).status,409);
 const listed=await (await f.send('/api/accounts',{headers:{cookie:session.cookie}},live)).json();
 assert.equal(listed.can_create,true);assert.equal(listed.users.length,2);
 assert.equal(listed.users[1].username,'newstaff');
 assert.equal(count(f.db,'users'),2);
});


test('Account manager UI entry is Owner-hidden and POST uses CSRF',()=>{
 const html=fs.readFileSync(path.join(root,'vercel-demo/owner-app.html'),'utf8');
 const app=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'vercel-demo/native-account-management-ui.mjs'),'utf8');
 assert.match(html,/data-view="accounts" hidden/);
 assert.match(app,/button.hidden=role!=='owner'/);
 assert.match(app,/renderOwnerAccounts/);
 assert.match(ui,/initialPassword:password.value/);
 assert.match(ui,/X-CSRF-Token/);
 assert.match(ui,/data.can_create!==true/);
});


test('New account UUID validation is RFC 4122-shaped and rejects truncated IDs',async t=>{
 const f=await fixture(t),session=await f.login();
 assert.equal(session.status,200);
 const env={...f.env,CLOUD_NATIVE_ACCOUNT_WRITE_GATE:'operator-released'};
 const body={action:'user.create',username:'badstore',displayName:'測試',
  role:'staff',initialPassword:'new-password-strong-12345',
  locationIds:['123e4567-e89b-42d3-426614174000']};
 const response=await f.send('/api/accounts',{method:'POST',
  headers:{origin:site,'sec-fetch-site':'same-origin',
   'content-type':'application/json',cookie:session.cookie,
   'x-csrf-token':session.csrf},body:JSON.stringify(body)},env);
 assert.equal(response.status,400);
 assert.equal(count(f.db,'users'),1);
});
