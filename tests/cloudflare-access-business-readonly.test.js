'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{generateKeyPairSync,createSign}=require('node:crypto');
const root=path.join(__dirname,'..');
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const pub=publicKey.export({format:'jwk'});
const ISSUER='https://synthetic-preview.cloudflareaccess.com';
const AUD='a'.repeat(64),NOW=1793420000000;
const key={kid:'synthetic-sign-key',kty:'RSA',use:'sig',alg:'RS256',n:pub.n,e:pub.e};
const handlerPromise=import('../cloudflare/access-business-readonly.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function signed(subject='staff-sub',claims={}){
 const h=b64({alg:'RS256',typ:'JWT',kid:key.kid});
 const p=b64({iss:ISSUER,aud:[AUD],sub:subject,iat:NOW/1000-60,exp:NOW/1000+120,...claims});
 const signer=createSign('RSA-SHA256');signer.update(h+'.'+p);signer.end();
 return h+'.'+p+'.'+signer.sign(privateKey).toString('base64url');
}
function d1(db){
 return {prepare(sql){
  const stmt=(args=[])=>({first:async()=>db.prepare(sql).get(...args),
   all:async()=>({results:db.prepare(sql).all(...args)})});
  return {...stmt(),bind:(...args)=>stmt(args)};
 }};
}
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations-access-0003/0003_access_identity_links.sql'),'utf8'));
 const ins=(sql,...args)=>db.prepare(sql).run(...args);
 for(const id of ['store-a','store-b'])ins('INSERT INTO locations(id,name) VALUES(?,?)',id,id);
 for(const [id,role,store,sub] of [
  ['staff-001','staff','store-a','staff-sub'],
  ['manager-001','manager','store-a','manager-sub'],
  ['outside-001','staff','store-b','other-sub']]){
  ins('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)',
   id,id,'Synthetic '+id,role,'fake','fake');
  ins('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)',id,store);
  ins('INSERT INTO access_identity_links(issuer,audience,subject,user_id,active) VALUES(?,?,?,?,1)',
   ISSUER,AUD,sub,id);
 }
 ins('INSERT INTO ingredients(id,sku,name,unit,min_stock) VALUES(?,?,?,?,?)',
  'ing','SKU','Synthetic Ingredient','kg',4);
 for(const [id,store,assigned] of [
  ['task-staff','store-a','staff-001'],['task-manager','store-a','manager-001'],
  ['task-other','store-b','outside-001']])
  ins('INSERT INTO tasks(id,location_id,title,assigned_to) VALUES(?,?,?,?)',id,store,id,assigned);
 for(const [id,store,by] of [
  ['po-a','store-a','staff-001'],['po-b','store-b','outside-001']])
  ins('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)',
   id,id,store,'ing','fake',1,by);
 for(const [id,store,qty] of [['move-a','store-a',2],['move-b','store-b',9]])
  ins("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,'ing',?,?,'purchase')",id,store,qty);
 const env={CLOUD_AUTH_PHASE:'preview-readonly',
  CLOUD_ACCESS_IDENTITY_GATE:'staging-get-only',
  CLOUD_ACCESS_ISSUER:ISSUER,CLOUD_ACCESS_AUDIENCE:AUD,DB:d1(db)};
 let requests=0;
 const fetchImpl=async (url,options)=>{
  requests++;
  assert.equal(url,ISSUER+'/cdn-cgi/access/certs');
  assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');
  const response=new Response(JSON.stringify({keys:[key]}),{headers:{'content-type':'application/json'}});
  Object.defineProperty(response,'url',{value:url});
  return response;
 };
 const req=(url,subject='staff-sub',method='GET',jwt)=>new Request('https://staging.invalid'+url,{
  method,headers:(jwt===null?{}:{'Cf-Access-Jwt-Assertion':jwt??signed(subject)})
 });
 return {db,env,fetchImpl,req,get requests(){return requests}};
}
async function setup(f){
 const {createPreviewAccessBusinessHandler}=await handlerPromise;
 return createPreviewAccessBusinessHandler({fetchImpl:f.fetchImpl,nowMs:()=>NOW});
}
test('signed Access staff reads only own tasks and active store stock; no cookies or writes',async t=>{
 const f=fixture(t),h=await setup(f),initial=f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
 const r=await h.handle(f.req('/api/access/data?entity=tasks'),f.env);
 assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);
 assert.equal(r.headers.get('set-cookie'),null);
 assert.equal(r.headers.get('access-control-allow-origin'),null);
 const body=await r.json();
 assert.deepEqual(body.rows.map(x=>x.id),['task-staff']);
 assert.equal(body.session_created,false);
 assert.equal(body.mutations_enabled,false);
 assert.equal((await (await h.handle(f.req('/api/access/data?entity=stock'),f.env)).json()).rows[0].location_id,'store-a');
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,initial);
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
 assert.equal(f.requests,1);
});
test('manager sees only assigned store; staff cannot read HR, audits or employee directory',async t=>{
 const f=fixture(t),h=await setup(f);
 const manager=await (await h.handle(f.req('/api/access/data?entity=tasks','manager-sub'),f.env)).json();
 assert.deepEqual(manager.rows.map(x=>x.id).sort(),['task-manager','task-staff']);
 const outsider=await (await h.handle(f.req('/api/access/data?entity=tasks','other-sub'),f.env)).json();
 assert.deepEqual(outsider.rows.map(x=>x.id),['task-other']);
 for(const entity of ['users','audit_logs','staff_directory','leave_requests','evaluations']){
  assert.equal((await h.handle(f.req('/api/access/data?entity='+entity),f.env)).status,404,entity);
 }
});
test('signed Access overview preserves scoped metric queries and grants',async t=>{
 const f=fixture(t),h=await setup(f);
 const staff=await h.handle(f.req('/api/access/overview'),f.env);
 assert.equal(staff.status,200);
 assert.deepEqual((await staff.json()).metrics,{open_tasks:1,pending_orders:1,open_repairs:0,low_stock:1});
 const manager=await (await h.handle(f.req('/api/access/overview','manager-sub'),f.env)).json();
 assert.deepEqual(manager.metrics,{open_tasks:2,pending_orders:1,open_repairs:0,low_stock:1});
 f.db.exec("UPDATE locations SET active=0 WHERE id='store-a'");
 // The only authorized store is disabled; the principal is intentionally
 // denied entirely rather than leaking a usable principal with zero stores.
 const after=await h.handle(f.req('/api/access/overview','manager-sub'),f.env);
 assert.equal(after.status,401);
 assert.equal((await after.json()).code,'E_UNAUTHENTICATED');
 const stock=await h.handle(f.req('/api/access/data?entity=stock','manager-sub'),f.env);
 assert.equal(stock.status,401);
});
test('production, absent gate/config/DB, unexpected methods and query input fail closed before JWT fetch',async t=>{
 const f=fixture(t),h=await setup(f);
 for(const invalid of [
  {...f.env,CLOUD_AUTH_PHASE:'disabled'},
  {...f.env,CLOUD_ACCESS_IDENTITY_GATE:undefined},
  {...f.env,CLOUD_ACCESS_ISSUER:'https://evil.invalid'},
  {...f.env,CLOUD_ACCESS_AUDIENCE:'invalid'},
  {...f.env,DB:null}
 ])assert.equal((await h.handle(f.req('/api/access/data?entity=tasks'),invalid)).status,503);
 for(const url of ['/api/access/data','/api/access/data?entity=tasks&entity=stock',
  '/api/access/data?entity=tasks&secret=1','/api/access/overview?entity=tasks',
  '/api/access/data?entity=users','/api/access/data?entity=tasks#debug'])
 assert.ok([400,404].includes((await h.handle(f.req(url),f.env)).status),url);
 assert.equal((await h.handle(f.req('/api/access/overview','staff-sub','POST'),f.env)).status,405);
 assert.equal(f.requests,0);
});
test('missing JWT, forged/expired JWT, link revocation and account disabling deny',async t=>{
 const f=fixture(t),h=await setup(f);
 assert.equal((await h.handle(f.req('/api/access/overview','staff-sub','GET',null),f.env)).status,401);
 assert.equal(f.requests,0);
 const tampered=signed().slice(0,-8)+'cccccccc';
 assert.equal((await h.handle(f.req('/api/access/overview','staff-sub','GET',tampered),f.env)).status,401);
 assert.equal((await h.handle(f.req('/api/access/overview','unknown'),f.env)).status,401);
 assert.equal((await h.handle(f.req('/api/access/overview','staff-sub','GET',
  signed('staff-sub',{exp:NOW/1000-120})),f.env)).status,401);
 f.db.exec("UPDATE access_identity_links SET active=0 WHERE subject='staff-sub'");
 assert.equal((await h.handle(f.req('/api/access/overview'),f.env)).status,401);
 f.db.exec("UPDATE access_identity_links SET active=1 WHERE subject='staff-sub'");
 f.db.exec("UPDATE users SET active=0 WHERE id='staff-001'");
 assert.equal((await h.handle(f.req('/api/access/data?entity=tasks'),f.env)).status,401);
});
test('bad D1 contract and SQL failure never disclose SQL/JWT or return metrics as success',async t=>{
 const f=fixture(t),h=await setup(f);
 f.db.exec('DELETE FROM cloud_schema_contract');
 let r=await h.handle(f.req('/api/access/overview'),f.env);
 assert.equal(r.status,401);assert.equal((await r.json()).code,'E_UNAUTHENTICATED'); // private D1 contract errors are intentionally indistinguishable from a denied principal
 f.db.exec('INSERT INTO cloud_schema_contract(id,contract_version) VALUES(1,3)');
 f.db.exec('DROP TABLE tasks');
 r=await h.handle(f.req('/api/access/overview'),f.env);
 assert.equal(r.status,503);
 assert.doesNotMatch(await r.text(),/SQLite|no such table|SELECT|staff-sub/i);
});
test('Worker routes new endpoints but never enables Access without explicit gate',async t=>{
 const f=fixture(t),worker=(await workerPromise).default;
 const disabled={...f.env,CLOUD_ACCESS_IDENTITY_GATE:undefined};
 for(const url of ['/api/access/data?entity=tasks','/api/access/overview']){
  const r=await worker.fetch(f.req(url),disabled);
  assert.equal(r.status,503);
  assert.equal((await r.json()).code,'E_ACCESS_NOT_ENABLED');
 }
 assert.equal((await worker.fetch(f.req('/api/login','staff-sub','POST'),disabled)).status,503);
 assert.equal(f.requests,0);
});
