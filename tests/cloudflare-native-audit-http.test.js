'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const pepper='synthetic-audit-test-pepper-32-characters-only';
const workerPromise=import('../cloudflare/worker.mjs');
const authPromise=import('../cloudflare/auth-core.mjs');
function d1(db){
 const stmt=(sql,args=[])=>({
  first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
  async batch(statements){
   db.exec('BEGIN IMMEDIATE');try{
    const results=[];for(const statement of statements)results.push(await statement.run());
    db.exec('COMMIT');return results;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }};
}
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 const {hashWorkerPassword}=await authPromise,hash=await hashWorkerPassword('example-owner-password-123');
 const owner='123e4567-e89b-42d3-a456-426614174001';
 const manager='123e4567-e89b-42d3-a456-426614174002';
 for(const [id,name,role] of [[owner,'owner','owner'],[manager,'manager','manager']])
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
    .run(id,name,'測試'+name,role,hash.password_salt,hash.password_hash);
 const env={DB:d1(db),CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:pepper,
  ASSETS:{fetch:async()=>new Response('PUBLIC_ASSET')}};
 const worker=(await workerPromise).default;
 const send=(route,init={},override=env)=>{
  const req=new Request(site+route,init);
  Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
  return worker.fetch(req,override);
 };
 const login=async username=>{
  const response=await send('/api/login',{method:'POST',headers:{
   origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
   'CF-Connecting-IP':'198.51.100.25'
  },body:JSON.stringify({username,password:'example-owner-password-123'})});
  assert.equal(response.status,200);
  return response.headers.get('set-cookie').split(';')[0];
 };
 const event=(id,at,action,detail='{}')=>db.prepare(
  'INSERT INTO audit_logs(id,at,actor_name,action,entity,detail,ip_hash) VALUES(?,?,?,?,?,?,?)'
 ).run(id,at,'測試業主',action,'users',detail,'secret-ip-hash-not-expose');
 return {db,env,send,login,event};
}
test('Native Owner audit is owner-only, no-store, and never returns raw details, IP hashes or opaque IDs',async t=>{
 const f=await fixture(t);
 const owner=await f.login('owner'),manager=await f.login('manager');
 f.event('audit-example-1','2026-11-16 02:00:00','user.role',
  JSON.stringify({from:'staff',to:'manager',revoked_sessions:2,
   password:'secret-password',token_hash:'secret-token',source_ip:'198.51.100.25'}));
 const result=await f.send('/api/audit',{headers:{cookie:owner}});
 assert.equal(result.status,200);
 assert.equal(result.headers.get('cache-control'),'private, no-store, max-age=0');
 const body=await result.json();
 assert.equal(body.mode,'native_d1');assert.equal(body.offset,0);
 const target=body.rows.find(r=>r.action==='user.role');
 assert.ok(target);assert.match(target.summary,/原狀態：staff/);
 assert.match(target.summary,/新狀態：manager/);
 assert.match(target.summary,/已撤銷登入：2/);
 for(const privateValue of ['secret-password','secret-token','198.51.100.25',
   'secret-ip-hash-not-expose','audit-example-1','password','token_hash','source_ip'])
  assert(!JSON.stringify(body).includes(privateValue),'leaked '+privateValue);
 assert.equal((await f.send('/api/audit')).status,401);
 assert.equal((await f.send('/api/audit',{headers:{cookie:manager}})).status,403);
 assert.equal((await f.send('/api/audit',{headers:{cookie:owner}},
  {...f.env,CLOUD_NATIVE_LOGIN_GATE:undefined})).status,503);
 assert.equal((await f.send('/api/audit',{method:'POST',headers:{cookie:owner},body:'{}'})).status,405);
 f.db.prepare("UPDATE users SET active=0 WHERE username='owner'").run();
 assert.equal((await f.send('/api/audit',{headers:{cookie:owner}})).status,401);
});
test('Native audit filters by fixed categories and Taiwan calendar dates',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 f.event('audit-before','2026-11-15 15:59:59','auth.login_failed');
 f.event('audit-start','2026-11-15 16:00:00','user.active',
  JSON.stringify({active:false,secret:'should-not-appear'}));
 f.event('audit-end','2026-11-16 15:59:59','task.status');
 f.event('audit-after','2026-11-16 16:00:00','auth.logout');
 const get=async query=>await (await f.send('/api/audit?'+query,{headers:{cookie:owner}})).json();
 const range=await get('from=2026-11-16&to=2026-11-16');
 assert(range.rows.some(x=>x.action==='user.active'));
 assert(range.rows.some(x=>x.action==='task.status'));
 assert(!range.rows.some(x=>x.action==='auth.login_failed'));
 assert(!range.rows.some(x=>x.action==='auth.logout'));
 const auth=await get('category=auth');
 assert(auth.rows.length>0&&auth.rows.every(x=>x.action.startsWith('auth.')));
 const account=await get('category=account');
 assert(account.rows.some(x=>x.action==='user.active'));
 assert(account.rows.every(x=>x.action.startsWith('user.')));
 const operations=await get('category=operations');
 assert(operations.rows.some(x=>x.action==='task.status'));
 assert(operations.rows.every(x=>!x.action.startsWith('auth.')&&!x.action.startsWith('user.')));
 for(const q of ['category=unknown','category=auth&category=account','offset=-1',
  'offset=12','offset=5050','from=2026-02-30','from=2026-11-18&to=2026-11-16',
  'from=2025-01-01&to=2026-11-16','date=2026-11-16','offset=01',
  'from=2026-11-16&from=2026-11-16']){
  assert.equal((await f.send('/api/audit?'+q,{headers:{cookie:owner}})).status,400,q);
 }
 assert.equal((await f.send('/api/audit',{headers:{cookie:owner,authorization:'Bearer x'}})).status,400);
 assert.equal((await f.send('/api/audit',{headers:{cookie:owner,'sec-fetch-site':'cross-site'}})).status,403);
});
test('Audit pagination is stable, bounded at 50 rows and never mutates business data',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 for(let i=0;i<61;i++)f.event('audit-many-'+String(i).padStart(3,'0'),
  '2026-11-16 03:00:00','task.status',JSON.stringify({number:'PO'+String(i).padStart(3,'0')}));
 const before=f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
 const fetchPage=async offset=>{
  const r=await f.send('/api/audit?category=operations&offset='+offset,{headers:{cookie:owner}});
  assert.equal(r.status,200);return r.json();
 };
 const first=await fetchPage(0),second=await fetchPage(50);
 assert.equal(first.rows.length,50);assert.equal(first.has_more,true);
 assert.equal(first.next_offset,50);assert.equal(second.rows.length,11);
 assert.equal(second.has_more,false);assert.equal(second.next_offset,null);
 assert.equal(new Set([...first.rows,...second.rows].map(x=>x.summary)).size,61);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,before);
 f.db.prepare('DELETE FROM cloud_schema_contract').run();
 assert.equal((await f.send('/api/audit',{headers:{cookie:owner}})).status,503);
});
test('Audit pagination caps the next offset and signals a narrower filter is needed',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 const prepare=f.env.DB.prepare.bind(f.env.DB);
 const rows=Array.from({length:51},()=>({at:'2026-11-16 03:00:00',
  actor_name:'Synthetic Owner',action:'task.status',entity:'tasks',detail:'{}'}));
 const simulated={...f.env,DB:{...f.env.DB,prepare(sql){
  if(sql.startsWith('SELECT at,actor_name,action,entity,detail, ')){
   return {bind(){return {all:async()=>({results:rows})};}};
  }
  return prepare(sql);
 }}};
 const first=await (await f.send('/api/audit?offset=4950',
  {headers:{cookie:owner}},simulated)).json();
 assert.equal(first.has_more,true);assert.equal(first.next_offset,5000);
 assert.equal(first.truncated,false);
 const capped=await (await f.send('/api/audit?offset=5000',
  {headers:{cookie:owner}},simulated)).json();
 assert.equal(capped.rows.length,50);
 assert.equal(capped.has_more,false);assert.equal(capped.next_offset,null);
 assert.equal(capped.truncated,true);
 assert.equal((await f.send('/api/audit?offset=5050',{headers:{cookie:owner}},
  simulated)).status,400);
});

test('Owner audit UI keeps pagination bound to submitted filters',async t=>{
 class FakeNode{
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.value='';
   this.disabled=false;this.events={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,listener){this.events[name]=listener;}
 }
 const before=globalThis.document;
 globalThis.document={createElement:tag=>new FakeNode(tag)};
 t.after(()=>{if(before===undefined)delete globalThis.document;else globalThis.document=before;});
 const {renderOwnerAudit}=await import('../vercel-demo/native-owner-audit-ui.mjs');
 const pane=new FakeNode('div'),requests=[],expired=[];
 const api=async url=>{
  requests.push(url);
  const params=new URL(url,site).searchParams,offset=Number(params.get('offset'));
  return {mode:'native_d1',offset,has_more:offset===0,
   next_offset:offset===0?50:null,truncated:false,
   rows:[{at:'2026-11-16 03:00:00',actor_name:'Synthetic',
    action:'task.status',entity:'tasks',summary:'已更新'}]};
 };
 const find=(node,predicate)=>{
  if(predicate(node))return node;
  for(const child of node.children){const res=find(child,predicate);if(res)return res;}
  return null;
 };
 await renderOwnerAudit({pane,api,role:'owner',signal:undefined,notice:()=>{},
  live:()=>true,onAuthExpired:msg=>expired.push(msg)});
 assert.equal(requests.length,1);assert.match(requests[0],/category=all&offset=0/);
 const form=find(pane,n=>n.tag==='form');
 const cat=find(pane,n=>n.tag==='select');
 const inputs=[];
 const collect=n=>{if(n.tag==='input')inputs.push(n);for(const child of n.children)collect(child);};
 collect(form);
 assert.equal(inputs.length,2);
 const next=find(pane,n=>n.tag==='button'&&n.textContent==='下一頁');
 cat.value='account';inputs[0].value='2026-11-15';
 await next.events.click();
 assert.equal(requests.length,2);
 assert.match(requests[1],/category=all&offset=50/);
 assert(!requests[1].includes('from='),'unsubmitted field must not affect page');
 await form.events.submit({preventDefault(){}});
 assert.equal(requests.length,3);
 assert.match(requests[2],/category=account&offset=0&from=2026-11-15/);
 const previous=find(pane,n=>n.tag==='button'&&n.textContent==='上一頁');
 assert.equal(previous.disabled,true);
 assert.equal(expired.length,0);
 const html=fs.readFileSync(path.join(root,'vercel-demo/native-owner-audit-ui.mjs'),'utf8');
 assert.match(html,/const selected=applied/);
 assert.match(html,/超過查詢上限，請縮小日期範圍/);
});

test('Owner audit source exposes no mock/local storage and never trusts a client-supplied role',()=>{
 const worker=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
 const api=fs.readFileSync(path.join(root,'cloudflare/native-audit-http.mjs'),'utf8');
 const html=fs.readFileSync(path.join(root,'vercel-demo/owner-app.html'),'utf8');
 const ownerApp=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'vercel-demo/native-owner-audit-ui.mjs'),'utf8');
 assert.match(worker,/nativeAuditHttp\(request,env\)/);
 assert.match(html,/data-view="audit_logs" hidden/);
 assert.match(ownerApp,/renderOwnerAudit\(/);
 assert.match(ownerApp,/live:\(\)=>marker===revision&&liveAuth\(epoch,token\)/);
 assert.match(ownerApp,/if\(button\)button.hidden=role!=='owner'/);
 assert.match(api,/if\(principal.role!=='owner'\)/);
 assert.match(api,/SELECT at,actor_name,action,entity,detail, /);
 assert.doesNotMatch(api,/SELECT \* FROM audit_logs|SELECT .*ip_hash.*FROM audit_logs/);
 for(const source of [ownerApp,ui]){
  assert.doesNotMatch(source,/mock\.js|localStorage|sessionStorage|\.innerHTML\s*=/);
 }
 assert.match(ui,/textContent=String\(value\)/);
 assert.match(ui,/new URLSearchParams/);
 const projection=fs.readFileSync(path.join(root,'vercel-demo/native-owner-audit-export.mjs'),'utf8');
 assert.match(projection,/timeZone:'Asia\/Taipei'/);
 assert.match(ui,/nativeAuditPageSheet\(lastRows\)/);
});

test('Audit page Excel contains only visible allowlisted values and not private event fields',async()=>{
 const {nativeAuditPageSheet,taipeiAuditTime}=await import('../vercel-demo/native-owner-audit-export.mjs');
 const {buildWorkbook}=require('../public/xlsx-lite.js');
 const rows=[{at:'2026-11-16 02:00:00',actor_name:'測試業主',
  action:'user.role',entity:'users',summary:'=HYPERLINK("https://evil.invalid","sample")',
  ip_hash:'SHOULD_NOT_EXPORT_IPHASH',actor_id:'SHOULD_NOT_EXPORT_ACTOR',
  detail:'SHOULD_NOT_EXPORT_DETAIL',password:'SHOULD_NOT_EXPORT_PASSWORD'}];
 const sheet=nativeAuditPageSheet(rows);
 assert.equal(sheet.rows.length,1);
 assert.equal(sheet.headers.length,5);
 assert.equal(sheet.rows[0][1],'測試業主');
 assert.equal(sheet.rows[0][2],'帳號角色變更');
 assert.match(sheet.rows[0][0],/2026/);
 assert.equal(taipeiAuditTime('not-a-date'),'時間資料異常');
 assert(!JSON.stringify(sheet).includes('SHOULD_NOT_EXPORT'));
 const xml=Buffer.from(buildWorkbook([sheet])).toString('utf8');
 assert(xml.includes('inlineStr'),'audit user content is text not an Excel formula');
 assert(!xml.includes('SHOULD_NOT_EXPORT'));
 assert(!/<f(?:\s|>)/.test(xml),'no formula element');
 assert.throws(()=>nativeAuditPageSheet(Array(51).fill(rows[0])));
 assert.throws(()=>nativeAuditPageSheet([{at:'2026-11-16',actor_name:'A'},null]));
});
test('Native Owner audit export button uses only loaded current page and live Owner session',async t=>{
 class FakeNode{
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.value='';
   this.disabled=false;this.events={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,listener){this.events[name]=listener;}
 }
 const beforeDoc=globalThis.document,beforeConfirm=globalThis.confirm;
 globalThis.document={createElement:tag=>new FakeNode(tag)};
 let confirms=0,live=true,requests=0;
 globalThis.confirm=()=>{confirms++;return false;};
 t.after(()=>{
  if(beforeDoc===undefined)delete globalThis.document;else globalThis.document=beforeDoc;
  if(beforeConfirm===undefined)delete globalThis.confirm;else globalThis.confirm=beforeConfirm;
 });
 const {renderOwnerAudit}=await import('../vercel-demo/native-owner-audit-ui.mjs');
 const pane=new FakeNode('div');
 const api=async()=>{requests++;return {mode:'native_d1',offset:0,has_more:false,
  next_offset:null,truncated:false,rows:[{
   at:'2026-11-16 02:00:00',actor_name:'業主',action:'auth.login',
   entity:'users',summary:'登入成功',password_hash:'must-not-export'
  }]};};
 await renderOwnerAudit({pane,api,role:'owner',signal:undefined,notice:()=>{},
  live:()=>live,onAuthExpired:()=>{}});
 const find=(node,predicate)=>{
  if(predicate(node))return node;
  for(const child of node.children){const a=find(child,predicate);if(a)return a;}
  return null;
 };
 const button=find(pane,n=>n.tag==='button'&&n.textContent.includes('Excel'));
 assert(button&&!button.disabled);
 button.events.click();assert.equal(confirms,1);
 assert.equal(requests,1,'download must not issue new D1 requests');
 live=false;button.events.click();
 assert.equal(confirms,1,'revoked session cannot export previously loaded data');
 assert.equal(requests,1);
 const denied=new FakeNode('div');live=true;
 await renderOwnerAudit({pane:denied,api,role:'staff',signal:undefined,notice:()=>{},
  live:()=>true,onAuthExpired:()=>{}});
 assert.equal(find(denied,n=>n.tag==='button'&&n.textContent.includes('Excel')),null,
  'staff cannot be shown an audit export control');
});

test('password-reset audit resolves only current target login name and ignores raw detail',async t=>{
 const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager');
 const id=f.db.prepare("SELECT id FROM users WHERE username='manager'").get().id;
 const insert=f.db.prepare('INSERT INTO audit_logs(id,at,actor_name,action,entity,entity_id,detail,ip_hash) VALUES(?,?,?,?,?,?,?,?)');
 const raw=JSON.stringify({from:'secret-raw-detail',password:'secret-password',target:'fake-name'});
 insert.run('reset-1','2026-11-16 02:00:00','owner','user.password_reset','users',id,raw,'secret-ip');
 insert.run('reset-2','2026-11-16 02:00:01','owner','user.password_reset','users','missing-target',raw,'secret-ip');
 insert.run('reset-3','2026-11-16 02:00:02','owner','user.password_reset','tasks',id,raw,'secret-ip');
 insert.run('reset-4','2026-11-16 02:00:03','owner','user.role','users',id,'{}','secret-ip');
 const before=f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
 const get=async()=>await (await f.send('/api/audit?category=account',{headers:{cookie:owner}})).json();
 let body=await get();
 assert.deepEqual(body.rows.filter(x=>x.action==='user.password_reset').map(x=>x.summary),
 ['密碼重設事件；目標帳號無法核對','密碼重設事件；目標帳號無法核對','重設對象（目前帳號）：manager']);
 for(const row of body.rows)assert.deepEqual(Object.keys(row).sort(),['action','actor_name','at','entity','summary']);
 assert.equal(body.rows.find(x=>x.action==='user.role').summary,'');
 assert(!JSON.stringify(body).includes(id));
 assert.doesNotMatch(JSON.stringify(body),/reset-[1-4]|secret-raw-detail|secret-password|secret-ip|fake-name|missing-target|reset_target_username/);
 assert.equal((await f.send('/api/audit?category=account',{headers:{cookie:manager}})).status,403);
 f.db.prepare("UPDATE users SET username='renamed-manager' WHERE id=?").run(id);
 body=await get();assert(body.rows.some(x=>x.summary==='重設對象（目前帳號）：renamed-manager'));
 f.db.prepare("UPDATE users SET username='invalid username' WHERE id=?").run(id);
 body=await get();assert(body.rows.filter(x=>x.action==='user.password_reset').every(x=>x.summary==='密碼重設事件；目標帳號無法核對'));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,before);
});
