'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {generateKeyPairSync,createSign,randomUUID}=require('node:crypto');
const root=path.join(__dirname,'..');
const handlerPromise=import('../cloudflare/access-task-status-write.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const ISSUER='https://synthetic-write.cloudflareaccess.com',AUD='b'.repeat(64),NOW=1793420000000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pub=publicKey.export({format:'jwk'});
const key={kid:'synthetic-task-key',kty:'RSA',use:'sig',alg:'RS256',n:pub.n,e:pub.e};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function jwt(subject='staff-sub',claims={}){
 const h=b64({alg:'RS256',typ:'JWT',kid:key.kid});
 const p=b64({iss:ISSUER,aud:[AUD],sub:subject,iat:NOW/1000-45,exp:NOW/1000+120,...claims});
 const sign=createSign('RSA-SHA256');sign.update(h+'.'+p);sign.end();
 return h+'.'+p+'.'+sign.sign(privateKey).toString('base64url');
}
function adapt(db,options={}){
 const bound=(sql,args=[])=>({
  first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...bound(sql),bind:(...args)=>bound(sql,args)};},
  async batch(statements){
   if(options.beforeBatch)options.beforeBatch();
   db.exec('BEGIN IMMEDIATE');
   try{
    const out=[];
    for(let i=0;i<statements.length;i++){
     if(i===options.failAt)throw Error('E_SYNTHETIC_BATCH_FAILURE');
     out.push(await statements[i].run());
    }
    db.exec('COMMIT');return out;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }};
}
function fixture(t,options={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations-access-0003/0003_access_identity_links.sql'),'utf8'));
 const ids={storeA:randomUUID(),storeB:randomUUID(),taskA:randomUUID(),taskB:randomUUID(),taskManager:randomUUID()};
 const ins=(sql,...args)=>db.prepare(sql).run(...args);
 ins('INSERT INTO locations(id,name) VALUES(?,?)',ids.storeA,'Synthetic Store A');
 ins('INSERT INTO locations(id,name) VALUES(?,?)',ids.storeB,'Synthetic Store B');
 const people=[
  ['owner','owner',[], 'owner-sub'],
  ['manager','manager',[ids.storeA],'manager-sub'],
  ['staff','staff',[ids.storeA],'staff-sub'],
  ['other','staff',[ids.storeB],'other-sub']
 ];
 for(const [id,role,loc,subject] of people){
  ins('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)',
   id,id,'Synthetic '+id,role,'unused','unused');
  for(const l of loc)ins('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)',id,l);
  ins('INSERT INTO access_identity_links(issuer,audience,subject,user_id,active) VALUES(?,?,?,?,1)',
   ISSUER,AUD,subject,id);
 }
 for(const [id,store,assigned] of [
  [ids.taskA,ids.storeA,'staff'],[ids.taskB,ids.storeB,'other'],
  [ids.taskManager,ids.storeA,'manager']
 ])ins('INSERT INTO tasks(id,location_id,title,assigned_to) VALUES(?,?,?,?)',
   id,store,'Synthetic Task',assigned);
 const env={DB:adapt(db,options),CLOUD_AUTH_PHASE:'preview-readonly',
  CLOUD_ACCESS_IDENTITY_GATE:'staging-get-only',
  CLOUD_ACCESS_TASK_WRITE_GATE:'staging-task-status-only',
  CLOUD_ACCESS_ISSUER:ISSUER,CLOUD_ACCESS_AUDIENCE:AUD};
 let lookups=0;
 const fetchImpl=async (url,opts)=>{
  lookups++;
  assert.equal(url,ISSUER+'/cdn-cgi/access/certs');
  assert.equal(opts.method,'GET');assert.equal(opts.credentials,'omit');
  const r=new Response(JSON.stringify({keys:[key]}),{headers:{'content-type':'application/json'}});
  Object.defineProperty(r,'url',{value:url});
  return r;
 };
 const makeRequest=(id=ids.taskA,status='doing',options={})=>{
  const headers={'Cf-Access-Jwt-Assertion':options.jwt??jwt(options.subject||'staff-sub'),
   Origin:options.origin??'https://private.staging.invalid',
   'Sec-Fetch-Site':options.fetchSite??'same-origin',
   'X-Staging-Intent':options.intent??'task.status',
   'Content-Type':options.contentType??'application/json',
   ...options.headers};
  if(options.tokenMissing)delete headers['Cf-Access-Jwt-Assertion'];
  if(options.originMissing)delete headers.Origin;
  const req=new Request(options.url||'https://private.staging.invalid/api/access/task-status',{
   method:options.method||'POST',headers,
   ...((options.method||'POST')==='POST'?{body:options.body??JSON.stringify({action:'task.status',data:{id,status}})}:{})
  });
  return req;
 };
 return {db,ids,env,fetchImpl,makeRequest,get lookups(){return lookups}};
}
async function handler(f){
 const {createPreviewAccessTaskStatusHandler}=await handlerPromise;
 return createPreviewAccessTaskStatusHandler({fetchImpl:f.fetchImpl,nowMs:()=>NOW});
}
const status=(f,id)=>f.db.prepare('SELECT status FROM tasks WHERE id=?').get(id).status;
const logs=f=>f.db.prepare('SELECT action,actor_id,entity_id,detail FROM audit_logs ORDER BY rowid').all();

test('signed Access assigned staff and manager update task + audit atomically, no sessions or JWT stored',async t=>{
 const f=fixture(t),h=await handler(f);
 let r=await h.handle(f.makeRequest(),f.env);
 assert.equal(r.status,200);assert.equal((await r.json()).result.status,'doing');
 assert.equal(status(f,f.ids.taskA),'doing');assert.equal(logs(f).length,1);
 assert.deepEqual(JSON.parse(logs(f)[0].detail),{from:'todo',to:'doing'});
 assert.equal(logs(f)[0].actor_id,'staff');
 assert.equal(r.headers.get('set-cookie'),null);
 assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
 r=await h.handle(f.makeRequest(f.ids.taskA,'done',{subject:'manager-sub'}),f.env);
 assert.equal(r.status,200);
 assert.equal(logs(f).length,2);
 assert.equal(status(f,f.ids.taskA),'done');
 assert.equal((await h.handle(f.makeRequest(f.ids.taskA,'done'),f.env)).status,409);
 assert.equal(logs(f).length,2);
 assert.equal(f.lookups,2); // two independent signature validators, cached after first request
});
test('cross-store, unassigned employee and disabled locations cannot write or create audit',async t=>{
 const f=fixture(t),h=await handler(f);
 for(const [who,id] of [
  ['manager-sub',f.ids.taskB],['staff-sub',f.ids.taskB],['staff-sub',f.ids.taskManager],
  ['other-sub',f.ids.taskA]
 ])assert.equal((await h.handle(f.makeRequest(id,'doing',{subject:who}),f.env)).status,404,who);
 f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
 assert.equal((await h.handle(f.makeRequest(f.ids.taskA,'doing',{subject:'owner-sub'}),f.env)).status,404);
 assert.equal((await h.handle(f.makeRequest(f.ids.taskA),f.env)).status,401);
 assert.equal(logs(f).length,0);
});
test('Owner may update active store outside own grant; role from D1 not JWT',async t=>{
 const f=fixture(t),h=await handler(f);
 const r=await h.handle(f.makeRequest(f.ids.taskB,'doing',{subject:'owner-sub',
  jwt:jwt('owner-sub',{role:'staff'})}),f.env);
 assert.equal(r.status,200);
 assert.equal(status(f,f.ids.taskB),'doing');
 assert.equal(logs(f).length,1);
});
test('missing write gate or any disabled Production phase blocks public Worker before JWT or D1 writes',async t=>{
 const f=fixture(t),worker=(await workerPromise).default,h=await handler(f);
 for(const e of [
  {...f.env,CLOUD_ACCESS_TASK_WRITE_GATE:undefined},
  {...f.env,CLOUD_ACCESS_IDENTITY_GATE:undefined},
  {...f.env,CLOUD_AUTH_PHASE:'disabled'},
  {...f.env,CLOUD_ACCESS_AUDIENCE:'bad'},
  {...f.env,DB:{prepare:f.env.DB.prepare}},
 ]){
  const r=await worker.fetch(f.makeRequest(),e);
  assert.equal(r.status,503);
 }
 const bad=await worker.fetch(new Request('https://private.staging.invalid/api/command',{method:'POST'}),f.env);
 assert.equal(bad.status,503);
 assert.equal(status(f,f.ids.taskA),'todo');
 assert.equal(logs(f).length,0);
 assert.equal(f.lookups,0);
 assert.equal((await h.handle(f.makeRequest(f.ids.taskA,'doing',{method:'GET'}),f.env)).status,405);
});
test('CSRF, origin, metadata, non-HTTPS, wrong route and invalid JSON rejected with no batch',async t=>{
 const f=fixture(t),h=await handler(f);
 for(const options of [
  {origin:'https://hostile.invalid'},
  {fetchSite:'cross-site'},
  {fetchSite:'same-site'},
  {intent:'invalid'},
  {originMissing:true},
  {url:'http://private.staging.invalid/api/access/task-status',origin:'http://private.staging.invalid'},
  {url:'https://private.staging.invalid/api/access/task-status?role=owner'},
  {contentType:'text/plain'},
  {body:'not json'},
  {body:JSON.stringify({action:'task.status',data:{id:f.ids.taskA,status:'doing',location_id:f.ids.storeB}})},
  {body:JSON.stringify({action:'task.status',data:{id:f.ids.taskA,status:'evil'}})},
  {body:' '.repeat(5000)},
  {headers:{'content-length':'5000'}}
 ]){
  const r=await h.handle(f.makeRequest(f.ids.taskA,'doing',options),f.env);
  assert.ok([400,403].includes(r.status),JSON.stringify(options));
 }
 assert.equal(status(f,f.ids.taskA),'todo');assert.equal(logs(f).length,0);
 assert.equal(f.lookups,0);
});
test('signed JWT invalid, expired, unlinked, revoked or user disabled denies mutations',async t=>{
 const f=fixture(t),h=await handler(f);
 for(const options of [
  {tokenMissing:true},{subject:'unknown-sub'},
  {jwt:jwt('staff-sub',{exp:NOW/1000-100})},
  {jwt:jwt('staff-sub',{aud:['c'.repeat(64)]})},
  {jwt:jwt('staff-sub').slice(0,-4)+'xxxx'}
 ]){
  const r=await h.handle(f.makeRequest(f.ids.taskA,'doing',options),f.env);
  assert.equal(r.status,401,JSON.stringify(options));
 }
 f.db.prepare("UPDATE access_identity_links SET active=0 WHERE subject='staff-sub'").run();
 assert.equal((await h.handle(f.makeRequest(),f.env)).status,401);
 f.db.prepare("UPDATE access_identity_links SET active=1 WHERE subject='staff-sub'").run();
 f.db.prepare("UPDATE users SET active=0 WHERE id='staff'").run();
 assert.equal((await h.handle(f.makeRequest(),f.env)).status,401);
 assert.equal(logs(f).length,0);assert.equal(status(f,f.ids.taskA),'todo');
});
test('D1 audit/update/validation batch failure rolls back all writes, never partial 200',async t=>{
 for(const failAt of [0,1,2]){
  const f=fixture(t,{failAt}),h=await handler(f);
  const r=await h.handle(f.makeRequest(),f.env);
  assert.equal(r.status,503);
  assert.equal(status(f,f.ids.taskA),'todo');
  assert.deepEqual(logs(f),[]);
 }
});
test('revoked link, role, store grant, or status just before transaction prevents any side effect',async t=>{
 const scenarios=[
  f=>f.db.prepare("UPDATE access_identity_links SET active=0 WHERE subject='staff-sub'").run(),
  f=>f.db.prepare("UPDATE users SET role='manager' WHERE id='staff'").run(),
  f=>f.db.prepare('DELETE FROM user_locations WHERE user_id=? AND location_id=?').run('staff',f.ids.storeA),
  f=>f.db.prepare('UPDATE tasks SET status=? WHERE id=?').run('done',f.ids.taskA)
 ];
 for(const modify of scenarios){
  let f;f=fixture(t,{beforeBatch(){modify(f)}});
  const h=await handler(f);
  const r=await h.handle(f.makeRequest(),f.env);
  assert.equal(r.status,409);
  assert.equal(logs(f).length,0);
  assert.notEqual(status(f,f.ids.taskA),'doing');
 }
});
test('missing schema and failed D1 do not leak SQL, JWT, or task content',async t=>{
 const f=fixture(t),h=await handler(f);
 f.db.exec('DROP TABLE access_identity_links');
 const r=await h.handle(f.makeRequest(),f.env);
 assert.equal(r.status,401);
 assert.doesNotMatch(await r.text(),/no such table|SELECT|staff-sub|JWT/i);
 assert.equal(logs(f).length,0);
});
