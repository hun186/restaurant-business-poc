import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {createPreviewAccessMeHandler} from '../cloudflare/access-me-readonly.mjs';
import worker from '../cloudflare/worker.mjs';

const ISSUER='https://synthetic-preview.cloudflareaccess.com';
const AUDIENCE='a'.repeat(64);
const NOW=1793420000000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const rsa=publicKey.export({format:'jwk'});
const jwk={kid:'synthetic-key',kty:'RSA',alg:'RS256',use:'sig',e:rsa.e,n:rsa.n};
const b64=data=>Buffer.from(JSON.stringify(data)).toString('base64url');
function signed(subject='synthetic-owner-subject',override={}){
 const header=b64({typ:'JWT',alg:'RS256',kid:jwk.kid});
 const claims=b64({iss:ISSUER,aud:[AUDIENCE],sub:subject,iat:NOW/1000-60,exp:NOW/1000+120,...override});
 const signer=createSign('RSA-SHA256');
 signer.update(header+'.'+claims);signer.end();
 return header+'.'+claims+'.'+signer.sign(privateKey).toString('base64url');
}
const req=(path='/api/access/me',token=signed(),method='GET')=>new Request('https://staging.invalid'+path,{
 method,headers:token?{'Cf-Access-Jwt-Assertion':token}:{}
});
function fixture(t,withLink=true){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE cloud_schema_contract(id INTEGER PRIMARY KEY,contract_version INTEGER NOT NULL);'+
  'INSERT INTO cloud_schema_contract VALUES(1,3);'+
  'CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,display_name TEXT,role TEXT,active INTEGER);'+
  'CREATE TABLE locations(id TEXT PRIMARY KEY,active INTEGER);'+
  'CREATE TABLE user_locations(user_id TEXT,location_id TEXT);'+
  "INSERT INTO users VALUES('manager01','manager','Synthetic Manager','manager',1);"+
  "INSERT INTO locations VALUES('store-active',1),('store-disabled',0);"+
  "INSERT INTO user_locations VALUES('manager01','store-active'),('manager01','store-disabled');");
 if(withLink){
  db.exec('CREATE TABLE access_identity_links(issuer TEXT,audience TEXT,subject TEXT,user_id TEXT,active INTEGER);');
  db.prepare('INSERT INTO access_identity_links VALUES(?,?,?,?,?)')
    .run(ISSUER,AUDIENCE,'synthetic-owner-subject','manager01',1);
 }
 const env={
  CLOUD_AUTH_PHASE:'preview-readonly',
  CLOUD_ACCESS_IDENTITY_GATE:'staging-get-only',
  CLOUD_ACCESS_ISSUER:ISSUER,
  CLOUD_ACCESS_AUDIENCE:AUDIENCE,
  DB:{
   prepare(sql){
    const stmt=db.prepare(sql);
    return {
     first:async()=>stmt.get(),
     bind(...args){return {all:async()=>({results:stmt.all(...args)}),first:async()=>stmt.get(...args)};}
    };
   }
  }
 };
 return {db,env};
}
function handler(){
 let keyFetches=0;
 const h=createPreviewAccessMeHandler({
  nowMs:()=>NOW,
  fetchImpl:async(url,options)=>{
   keyFetches++;
   assert.equal(url,ISSUER+'/cdn-cgi/access/certs');
   assert.equal(options.method,'GET');
   assert.equal(options.credentials,'omit');
   const res=new Response(JSON.stringify({keys:[jwk]}),{headers:{'Content-Type':'application/json'}});
   Object.defineProperty(res,'url',{value:url});
   return res;
  }
 });
 return {h,get keyFetches(){return keyFetches;}};
}
test('gated signed Access GET resolves only explicitly linked D1 role and active stores',async t=>{
 const f=fixture(t),x=handler();
 const response=await x.h.handle(req(),f.env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('cache-control'),/no-store/);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 const body=await response.json();
 assert.deepEqual(body,{
  status:'staging_access_readonly',
  user:{id:'manager01',username:'manager',display_name:'Synthetic Manager',
   role:'manager',locations:['store-active']},
  production_ready:false,session_created:false,mutations_enabled:false
 });
 assert.equal(response.headers.get('set-cookie'),null);
 assert.equal(x.keyFetches,1);
 assert.equal((await x.h.handle(req(),f.env)).status,200);
 assert.equal(x.keyFetches,1,'JWT key is cached per trusted Access config');
});
test('no gated preview config, production, missing DB and POST refuse without JWKS calls',async t=>{
 const f=fixture(t),x=handler();
 for(const phase of ['disabled','production','']){
  assert.equal((await x.h.handle(req(),{...f.env,CLOUD_AUTH_PHASE:phase})).status,503);
 }
 assert.equal((await x.h.handle(req(),{...f.env,CLOUD_ACCESS_IDENTITY_GATE:'disabled'})).status,503);
 assert.equal((await x.h.handle(req(),{...f.env,CLOUD_ACCESS_ISSUER:'https://evil.invalid'})).status,503);
 assert.equal((await x.h.handle(req(),{...f.env,CLOUD_ACCESS_AUDIENCE:'wrong'})).status,503);
 assert.equal((await x.h.handle(req(),{...f.env,DB:null})).status,503);
 assert.equal((await x.h.handle(req('/api/access/me',signed(),'POST'),f.env)).status,405);
 assert.equal((await x.h.handle(req('/api/access/me?x=1'),f.env)).status,400);
 assert.equal(x.keyFetches,0);
});
test('unsigned, tampered, expired or wrong audience claims never reach an identity response',async t=>{
 const f=fixture(t),x=handler();
 assert.equal((await x.h.handle(req('/api/access/me',null),f.env)).status,401);
 assert.equal(x.keyFetches,0);
 const valid=signed();
 const broken=valid.slice(0,-4)+'abcd';
 assert.equal((await x.h.handle(req('/api/access/me',broken),f.env)).status,401);
 assert.equal((await x.h.handle(req('/api/access/me',signed('other-subject')),f.env)).status,401);
 assert.equal((await x.h.handle(req('/api/access/me',signed(undefined,{aud:['wrong-aud']})),f.env)).status,401);
 assert.equal((await x.h.handle(req('/api/access/me',signed(undefined,{exp:NOW/1000-120})),f.env)).status,401);
});
test('D1 link not present, inactive, revoked user or revoked store all deny',async t=>{
 const f=fixture(t),x=handler();
 f.db.exec('UPDATE access_identity_links SET active=0');
 assert.equal((await x.h.handle(req(),f.env)).status,401);
 f.db.exec('UPDATE access_identity_links SET active=1');
 f.db.exec("UPDATE users SET active=0 WHERE id='manager01'");
 assert.equal((await x.h.handle(req(),f.env)).status,401);
 f.db.exec("UPDATE users SET active=1 WHERE id='manager01'");
 f.db.exec("UPDATE locations SET active=0 WHERE id='store-active'");
 assert.equal((await x.h.handle(req(),f.env)).status,401);
 const missing=fixture(t,false);
 assert.equal((await x.h.handle(req(),missing.env)).status,401);
});
test('new Worker route stays off by default and no password or session is created',async t=>{
 const f=fixture(t),x=handler();
 const original=globalThis.fetch;
 try{
  const envOff={...f.env,CLOUD_ACCESS_IDENTITY_GATE:undefined};
  const response=await worker.fetch(req(),envOff);
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'E_ACCESS_NOT_ENABLED');
  assert.equal((await worker.fetch(req('/api/login',null,'POST'),envOff)).status,503);
 }finally{assert.equal(globalThis.fetch,original);}
 assert.equal(x.keyFetches,0);
});
test('malformed D1 responses and schema errors fail without leaking SQL/Access claims',async t=>{
 const f=fixture(t),x=handler();
 const db=f.env.DB;
 const response=await x.h.handle(req(),{
  ...f.env,DB:{prepare(){throw Error('secret-select-statement/SQL')}}});
 assert.equal(response.status,401);
 assert.doesNotMatch(await response.text(),/secret-select|synthetic-owner-subject|SELECT/);
 assert.equal((await x.h.handle(req(),{...f.env,DB:db})).status,200);
});
