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
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('shop-1','合成測試餐廳');
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

test('authenticated Owner changes password, revokes all sessions, keeps business data and writes audit',async t=>{
 const f=await fixture(t),first=await f.login(),second=await f.login();
 assert.equal(first.status,200);assert.equal(second.status,200);
 assert.equal(count(f.db,'sessions'),2);
 const result=await f.change(first);
 assert.equal(result.status,200);
 assert.equal((await result.json()).code,'OK');
 assert.match(result.headers.get('set-cookie')||'',/Max-Age=0$/);
 assert.equal(count(f.db,'sessions'),0);
 for(const who of [first,second]){
  assert.equal((await f.send('/api/me',{headers:{cookie:who.cookie}})).status,401);
 }
 assert.equal(count(f.db,'locations'),1);
 assert.equal(count(f.db,'ingredients'),1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.password_change'").get().n,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM login_attempts WHERE success=1").get().n,3);
 const old=await f.login();
 assert.equal(old.status,401,'old password must never authenticate');
 const fresh=await f.login('brand-new-owner-password-123');
 assert.equal(fresh.status,200,'new password must authenticate');
});

test('wrong current password preserves active sessions and all persisted owner data',async t=>{
 const f=await fixture(t),session=await f.login();
 const before=f.db.prepare('SELECT password_salt,password_hash FROM users WHERE username=?').get('owner');
 const bad=await f.change(session,'incorrect-old-password-222');
 assert.equal(bad.status,403);
 assert.equal((await bad.json()).code,'E_INVALID_CURRENT_PASSWORD');
 const after=f.db.prepare('SELECT password_salt,password_hash FROM users WHERE username=?').get('owner');
 assert.deepEqual(after,before);
 assert.equal(count(f.db,'sessions'),1);
 assert.equal((await f.send('/api/me',{headers:{cookie:session.cookie}})).status,200);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.password_change'").get().n,0);
});

test('change requires session, same-origin + CSRF, valid HTTPS/POST/JSON/edge provenance',async t=>{
 const f=await fixture(t),session=await f.login();
 const missing=await f.send('/api/password/change',{method:'POST',headers:{
  origin:site,'content-type':'application/json'},body:'{}'});
 assert.equal(missing.status,401);
 const cases=[
  [await f.change(session,undefined,undefined,{csrf:'bad'}),403],
  [await f.change(session,undefined,undefined,{origin:'https://evil.example'}),403],
  [await f.change(session,undefined,undefined,{edge:false}),503],
  [await f.change(session,undefined,undefined,{body:'not-json'}),400],
  [await f.change(session,undefined,undefined,{body:JSON.stringify({
   current_password:'owner-synthetic-original-123',new_password:'short'})}),400],
  [await f.change(session,f.password,f.password),400],
  [await f.change(session,undefined,undefined,{override:{...f.env,CLOUD_NATIVE_LOGIN_GATE:'disabled'}}),503],
  [await f.send('/api/password/change',{method:'GET'}),405]
 ];
 for(const [result,expected] of cases)assert.equal(result.status,expected);
 assert.equal(count(f.db,'sessions'),1);
 assert.equal(f.db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='auth.password_change'").get().n,0);
});

test('change current-password guesses are throttled and do not revoke a valid session',async t=>{
 const f=await fixture(t),session=await f.login();
 let sawLimit=false;
 for(let n=0;n<12;n++){
  const response=await f.change(session,'guess-number-'+String(n).padStart(4,'0')+'-wrong');
  if(response.status===429){sawLimit=true;break;}
  assert.equal(response.status,403);
 }
 assert.equal(sawLimit,true);
 assert.equal(count(f.db,'sessions'),1);
 assert.equal((await f.send('/api/me',{headers:{cookie:session.cookie}})).status,200);
});
test('native Owner UI exposes account page but never embeds reset tokens/password data',()=>{
 const js=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8'),
  html=fs.readFileSync(path.join(root,'vercel-demo/owner-app.html'),'utf8'),
  status=fs.readFileSync(path.join(root,'vercel-demo/native-owner-capability.mjs'),'utf8');
 assert.match(html,/data-view="account"/);
 assert.match(js,/renderPasswordChange/);
 assert.match(js,/\/api\/password\/change/);
 assert.match(js,/current_password:current\.value,new_password:next\.value/);
 assert.match(js,/showLogin\(\)/);
 assert.match(status,/pageLabel:'帳號安全・密碼管理'/);
 assert.doesNotMatch(js,/localStorage|sessionStorage/);
});
