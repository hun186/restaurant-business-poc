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
 assert.equal(listed.users.some(user=>user.username==='newstaff'&&user.role==='staff'),true);
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


test('Owner account listing stays usable after 100 accounts with bounded pages and no secrets',async t=>{
 const f=await fixture(t),session=await f.login();
 assert.equal(session.status,200);
 const add=f.db.prepare(
  'INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?,?)');
 const grant=f.db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)');
 for(let i=0;i<100;i++){
  const id='synthetic-person-'+String(i).padStart(3,'0');
  add.run(id,'staff'+String(i).padStart(3,'0'),'Test account '+i,'staff',
    'synthetic-salt','synthetic-hash',i%7===0?0:1);
  if(i%2===0)grant.run(id,'123e4567-e89b-42d3-a456-426614174000');
 }
 assert.equal(count(f.db,'users'),101);
 const seen=[],locations=[];
 for(const [offset,size,more] of [[0,50,true],[50,50,true],[100,1,false]]){
  const path='/api/accounts'+(offset?'?offset='+offset:'');
  const response=await f.send(path,{headers:{cookie:session.cookie,
    'sec-fetch-site':'same-origin'}});
  assert.equal(response.status,200,'offset='+offset);
  const data=await response.json();
  assert.equal(data.offset,offset);
  assert.equal(data.users.length,size);
  assert.equal(data.has_more,more);
  assert.equal(data.next_offset,more?offset+50:null);
  assert.equal(data.can_create,false);
  assert.doesNotMatch(JSON.stringify(data),/password_hash|password_salt|csrf_token|synthetic-hash/);
  seen.push(...data.users.map(u=>u.username));
  locations.push(...data.users.filter(u=>u.location_ids.length).map(u=>u.username));
 }
 assert.equal(new Set(seen).size,101);
 assert.ok(seen.includes('owner'));
 assert.ok(locations.length>0);
 for(const bad of ['?offset=-1','?offset=01','?offset=nan','?offset=1.5',
    '?offset=50&offset=100','?limit=50']){
  assert.equal((await f.send('/api/accounts'+bad,
    {headers:{cookie:session.cookie}})).status,400,bad);
 }
 const wrongPost=await f.send('/api/accounts?offset=50',{method:'POST',
  headers:{cookie:session.cookie}},{
    ...f.env,CLOUD_NATIVE_ACCOUNT_WRITE_GATE:'operator-released'});
 assert.equal(wrongPost.status,400);
 assert.equal(count(f.db,'users'),101);
});
test('Account pagination navigation stays visible even when creation gate is closed',()=>{
 const ui=fs.readFileSync(path.join(root,'vercel-demo/native-account-management-ui.mjs'),'utf8');
 assert.match(ui,/上一頁/);
 assert.match(ui,/下一頁/);
 assert.match(ui,/api\/accounts\?offset=/);
 assert.match(ui,/pager.append\(previous,info,next\)/);
 assert.match(ui,/if\(data.can_create!==true\)/);
});


test('Owner account renderer expires and clears workspace on 401 pagination, POST and initial GET',async t=>{
 class FakeNode{
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.events={};
   this.value='';this.type='';this.checked=false;this.disabled=false;}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,callback){this.events[name]=callback;}
 }
 const oldDocument=globalThis.document;
 globalThis.document={createElement:tag=>new FakeNode(tag)};
 t.after(()=>{if(oldDocument===undefined)delete globalThis.document;
   else globalThis.document=oldDocument;});
 const {renderOwnerAccounts}=await import('../vercel-demo/native-account-management-ui.mjs');
 const find=(root,predicate)=>{
   if(predicate(root))return root;
   for(const child of root.children){const found=find(child,predicate);if(found)return found;}
   return null;
 };
 const findAll=(root,predicate)=>{
   const found=predicate(root)?[root]:[];
   for(const child of root.children)found.push(...findAll(child,predicate));
   return found;
 };
 const accountData={offset:0,users:[{username:'owner',display_name:'測試業主',
   role:'owner',active:true,location_ids:[]}],has_more:true,next_offset:50,
   can_create:true};
 const stores={rows:[{id:'123e4567-e89b-42d3-a456-426614174000',name:'測試門市',active:1}]};
 for(const which of ['pagination','post','initial-get']){
   const pane=new FakeNode('div'),expired=[],notices=[];
   const onAuthExpired=message=>{
     expired.push(message);
     for(const p of findAll(pane,n=>n.tag==='input'&&n.type==='password'))p.value='';
     pane.replaceChildren();
   };
   const api=async(url,options={})=>{
     if(url==='/api/data?entity=locations')return stores;
     if(url==='/api/accounts'&&options.method==='POST')
       throw Object.assign(Error('login expired'),{status:401});
     if(url==='/api/accounts') {
       if(which==='initial-get')throw Object.assign(Error('login expired'),{status:401});
       return accountData;
     }
     if(url==='/api/accounts?offset=50'||url==='/api/accounts'&&which==='post')
       throw Object.assign(Error('login expired'),{status:401});
     throw Error('Unexpected route '+url);
   };
   await renderOwnerAccounts({pane,api,role:'owner',signal:undefined,
     notice:msg=>notices.push(msg),refresh:async()=>{},
     live:()=>true,token:'synthetic-csrf',onAuthExpired});
   if(which==='pagination'){
     const pwd=findAll(pane,n=>n.tag==='input'&&n.type==='password');
     assert.equal(pwd.length,2);
     pwd[0].value='typed-secret-not-for-logs';
     const next=find(pane,n=>n.tag==='button'&&n.textContent==='下一頁');
     assert.ok(next?.events.click);
     await next.events.click();
     assert.equal(pwd[0].value,'');
   }else if(which==='post'){
     // Use the same successful initial GET; force a 401 only for POST.
     const inputs=findAll(pane,n=>n.tag==='input');
     const pwd=inputs.filter(n=>n.type==='password');
     assert.equal(pwd.length,2);
     pwd[0].value='typed-secret-not-for-logs';
     pwd[1].value=pwd[0].value;
     const box=inputs.find(n=>n.type==='checkbox');
     assert.ok(box);box.checked=true;
     const form=find(pane,n=>n.tag==='form');
     assert.ok(form?.events.submit);
     await form.events.submit({preventDefault(){}});
     assert.equal(pwd[0].value,'');
   }
   assert.equal(expired.length,1,which);
   assert.match(expired[0],/工作階段已失效/);
   assert.equal(pane.children.length,0,which);
 }
 const ownerApp=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
 assert.match(ownerApp,/onAuthExpired:showLogin/);
 assert.match(ownerApp,/function showLogin\(message\)[\s\S]*?clearSensitiveForms\(\)/);
});


test('Native account staff deactivation requires independent admin gate and atomically revokes Sessions',async t=>{
 const f=await fixture(t),owner=await f.login();assert.equal(owner.status,200);
 const id='123e4567-e89b-42d3-a456-426614174099';
 f.db.prepare(
  'INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?,?)'
 ).run(id,'employee99','Synthetic Employee','staff','test-salt','test-hash',1);
 f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run('synthetic-session-token-hash','synthetic-csrf',id,
        new Date(Date.now()+3600000).toISOString());
 const request=(body,env=f.env,csrf=owner.csrf,origin=site)=>
  f.send('/api/accounts/status',{method:'POST',
   headers:{cookie:owner.cookie,origin,'sec-fetch-site':'same-origin',
    'x-csrf-token':csrf,'content-type':'application/json'},
   body:JSON.stringify(body)},env);
 const body={targetUserId:id,expectedActive:true,active:false};
 assert.equal((await request(body)).status,503);
 assert.equal((await request(body,{...f.env,CLOUD_NATIVE_ACCOUNT_WRITE_GATE:'operator-released'})).status,503,
  'Account creation gate alone cannot disable staff');
 const admin={...f.env,CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE:'operator-released'};
 assert.equal((await request(body,admin,'bad')).status,403);
 assert.equal((await request(body,admin,owner.csrf,'https://cross-site.invalid')).status,403);
 assert.equal((await request({...body,targetUserId:'synthetic-owner'},admin)).status,400);
 const response=await request(body,admin);
 assert.equal(response.status,200,JSON.stringify(await response.json()));
 assert.equal(f.db.prepare('SELECT active FROM users WHERE id=?').get(id).active,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(id).n,0);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='user.active' AND entity_id=?").get(id).n,1);
 assert.equal((await request(body,admin)).status,409);
 const got=await (await f.send('/api/accounts',{headers:{cookie:owner.cookie}},admin)).json();
 assert.equal(got.can_create,false);assert.equal(got.can_manage_status,true);
 assert.equal(got.users.find(u=>u.id===id).active,false);
 const back=await request({targetUserId:id,expectedActive:false,active:true},admin);
 assert.equal(back.status,200);assert.equal(f.db.prepare('SELECT active FROM users WHERE id=?').get(id).active,1);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='user.active' AND entity_id=?").get(id).n,2);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(id).n,0,
   'Reactivation must not resurrect revoked sessions');
});
test('Native account status UI offers only soft disable behind server independent gate',()=>{
 const ui=fs.readFileSync(path.join(root,'vercel-demo/native-account-management-ui.mjs'),'utf8'),
  worker=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8'),
  server=fs.readFileSync(path.join(root,'cloudflare/native-account-management-http.mjs'),'utf8');
 assert.match(ui,/data.can_manage_status===true/);
 assert.match(ui,/api\('\/api\/accounts\/status'/);
 assert.match(ui,/expectedActive:user.active/);
 assert.match(ui,/user.role==='staff'\|\|user.role==='manager'/);
 assert.match(server,/CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE==='operator-released'/);
 assert.match(server,/DELETE FROM sessions WHERE user_id=/);
 assert.match(server,/audit_logs WHERE id=\?/);
 assert.match(worker,/nativeAccountStatusHttp\(request,env\)/);
 assert.doesNotMatch(server,/DELETE FROM users WHERE/);
});


test('Account soft-disable D1.batch failures are atomic at every statement boundary',async t=>{
 const targetId='123e4567-e89b-42d3-a456-426614174099';
 for(const faultIndex of [0,1,2,3]){
  await t.test('inject failure at batch statement '+faultIndex,async sub=>{
   const f=await fixture(sub),owner=await f.login();
   assert.equal(owner.status,200);
   f.db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?,?)')
    .run(targetId,'employee99','Employee','staff','synthetic-salt','synthetic-hash',1);
   const expiry=new Date(Date.now()+3600000).toISOString();
   const insertSession=f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)');
   for(let j=0;j<2;j++)insertSession.run('employee-session-'+j,'employee-csrf-'+j,targetId,expiry);
   const db=f.env.DB,originalBatch=db.batch.bind(db);
   const env={...f.env,CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE:'operator-released',DB:{
    ...db,async batch(statements){
     const wrapped=statements.map((item,index)=>({
      ...item,run:async()=>{
       if(index===faultIndex)throw Error('SYNTHETIC_BATCH_FAILURE');
       return item.run();
      }
     }));
     return originalBatch(wrapped);
    }
   }};
   const response=await f.send('/api/accounts/status',{method:'POST',
    headers:{cookie:owner.cookie,origin:site,'x-csrf-token':owner.csrf,
     'content-type':'application/json','sec-fetch-site':'same-origin'},
    body:JSON.stringify({targetUserId:targetId,expectedActive:true,active:false})},env);
   assert.equal(response.status,503);
   assert.equal(f.db.prepare('SELECT active FROM users WHERE id=?').get(targetId).active,1);
   assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(targetId).n,2);
   assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='user.active' AND entity_id=?").get(targetId).n,0);
  });
 }
});

test('Account soft-disable rechecks Owner and target authorization when queued batch starts',async t=>{
 const targetId='123e4567-e89b-42d3-a456-426614174099';
 for(const race of ['owner-session-revoked','owner-session-expired','owner-demoted','target-promoted']){
  await t.test(race,async sub=>{
   const f=await fixture(sub),owner=await f.login();
   assert.equal(owner.status,200);
   f.db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES(?,?,?,?,?,?,?)')
    .run(targetId,'employee99','Employee','staff','synthetic-salt','synthetic-hash',1);
   f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
    .run('employee-session','employee-csrf',targetId,new Date(Date.now()+3600000).toISOString());
   const db=f.env.DB,originalBatch=db.batch.bind(db);
   const env={...f.env,CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE:'operator-released',DB:{
    ...db,async batch(statements){
     if(race==='owner-session-revoked')f.db.prepare("DELETE FROM sessions WHERE user_id='synthetic-owner'").run();
     else if(race==='owner-session-expired')
      f.db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00Z' WHERE user_id='synthetic-owner'").run();
     else if(race==='owner-demoted')f.db.prepare("UPDATE users SET role='staff' WHERE id='synthetic-owner'").run();
     else f.db.prepare("UPDATE users SET role='owner' WHERE id=?").run(targetId);
     return originalBatch(statements);
    }
   }};
   const res=await f.send('/api/accounts/status',{method:'POST',
    headers:{cookie:owner.cookie,origin:site,'x-csrf-token':owner.csrf,
     'content-type':'application/json','sec-fetch-site':'same-origin'},
    body:JSON.stringify({targetUserId:targetId,expectedActive:true,active:false})},env);
   assert.equal(res.status,503,race);
   assert.equal(f.db.prepare('SELECT active FROM users WHERE id=?').get(targetId).active,1);
   assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(targetId).n,1);
   assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='user.active' AND entity_id=?").get(targetId).n,0);
  });
 }
});


test('Account state notice matches the independent admin gate reported by D1',()=>{
 const ui=fs.readFileSync(path.join(root,'vercel-demo/native-account-management-ui.mjs'),'utf8');
 assert.match(ui,/element\('p',data.can_manage_status===true\?/);
 assert.match(ui,/停用會撤銷所有登入工作階段並保留歷史紀錄/);
 assert.match(ui,/停用、角色調整及重設他人密碼尚未開放/);
});
