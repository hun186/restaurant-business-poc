import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {createBoundAccessPrincipal} from '../cloudflare/access-principal-internal.mjs';

const ISSUER='https://synthetic-team.cloudflareaccess.com';
const AUD='a'.repeat(64),NOW=1793420000000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const rsa=publicKey.export({format:'jwk'});
const key={kid:'synthetic-key',kty:'RSA',use:'sig',alg:'RS256',n:rsa.n,e:rsa.e};
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function signed(subject='synthetic-subject',claims={}) {
  const h=b64({alg:'RS256',typ:'JWT',kid:'synthetic-key'});
  const p=b64({iss:ISSUER,aud:[AUD],sub:subject,
    iat:NOW/1000-60,exp:NOW/1000+60,...claims});
  const signer=createSign('RSA-SHA256');signer.update(h+'.'+p);signer.end();
  return h+'.'+p+'.'+signer.sign(privateKey).toString('base64url');
}
function req(token=signed()) {
  return new Request('https://staging.invalid/api/private',{headers:token?{'Cf-Access-Jwt-Assertion':token}:{}});
}
function dbFixture(t,includeMapping=true) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec('CREATE TABLE cloud_schema_contract(id INTEGER PRIMARY KEY,contract_version INTEGER NOT NULL);'+
    'INSERT INTO cloud_schema_contract VALUES(1,3);'+
    'CREATE TABLE users(id TEXT PRIMARY KEY,username TEXT,display_name TEXT,role TEXT,active INTEGER);'+
    'CREATE TABLE locations(id TEXT PRIMARY KEY,active INTEGER);'+
    'CREATE TABLE user_locations(user_id TEXT,location_id TEXT);'+
    "INSERT INTO users VALUES('s1','shared-name','Synthetic Staff','staff',1),"+
      "('m1','manager','Synthetic Manager','manager',1),('o1','owner','Synthetic Owner','owner',1),"+
      "('inactive','inactive','Disabled','staff',0);"+
    "INSERT INTO locations VALUES('store-a',1),('store-b',1),('store-off',0);"+
    "INSERT INTO user_locations VALUES('s1','store-a'),('s1','store-off'),('m1','store-b');");
  if(includeMapping)db.exec('CREATE TABLE access_identity_links('+
    'issuer TEXT,audience TEXT,subject TEXT,user_id TEXT,active INTEGER);'+
    "INSERT INTO access_identity_links VALUES('"+ISSUER+"','"+AUD+"','synthetic-subject','s1',1);");
  return {
    db,
    wrapper:{prepare(sql){const statement=db.prepare(sql);return {
      first:async()=>statement.get(),
      bind(...args){return {first:async()=>statement.get(...args),all:async()=>({results:statement.all(...args)})}}};}}
  };
}
function resolver(){
  let requests=0;
  const lookup=createBoundAccessPrincipal({issuer:ISSUER,audience:AUD,nowMs:()=>NOW,
    fetchImpl:async(url,options)=>{
      requests++;
      assert.equal(url,ISSUER+'/cdn-cgi/access/certs');
      assert.equal(options.credentials,'omit');
      const response=new Response(JSON.stringify({keys:[key]}),
        {headers:{'Content-Type':'application/json'}});
      Object.defineProperty(response,'url',{value:url});
      return response;
    }});
  return {lookup,get requests(){return requests}};
}
function env(f,phase='preview-readonly'){return {CLOUD_AUTH_PHASE:phase,DB:f.wrapper};}

test('signed and explicitly linked active staff maps to DB role and active stores only',async t=>{
  const f=dbFixture(t),r=resolver();
  const user=await r.lookup.resolve(req(),env(f));
  assert.deepEqual(user,{id:'s1',username:'shared-name',display_name:'Synthetic Staff',role:'staff',locations:['store-a']});
  assert.equal(Object.isFrozen(user),true);
  assert.equal(Object.isFrozen(user.locations),true);
  assert.equal(r.requests,1);
});
test('no automatic identity, email, username, or unlinked staff fallback',async t=>{
  const f=dbFixture(t),r=resolver();
  for(const subject of ['shared-name','s1','synthetic@example.org','other-subject'])
    assert.equal(await r.lookup.resolve(req(signed(subject)),env(f)),null);
  assert.equal(await r.lookup.resolve(req(signed('synthetic-subject',{aud:['wrong']})),env(f)),null);
  assert.equal(await r.lookup.resolve(req(signed('synthetic-subject',{iss:'https://evil.cloudflareaccess.com'})),env(f)),null);
  assert.equal(await r.lookup.resolve(req(signed('synthetic-subject',{exp:NOW/1000-100})),env(f)),null);
  const [h,p,s]=signed().split('.');
  assert.equal(await r.lookup.resolve(req(h+'.'+p+'.'+s.slice(2)),env(f)),null);
});
test('phase disabled and missing JWT short circuit before D1 fetch or queries',async t=>{
  const f=dbFixture(t),r=resolver();
  assert.equal(await r.lookup.resolve(req(),env(f,'disabled')),null);
  assert.equal(await r.lookup.resolve(req(null),env(f)),null);
  assert.equal(await r.lookup.resolve(req(),{CLOUD_AUTH_PHASE:'preview-readonly'}),null);
  assert.equal(r.requests,0);
});
test('missing binding schema and wrong contract fail closed without migration',async t=>{
  const f=dbFixture(t,false),r=resolver();
  assert.equal(await r.lookup.resolve(req(),env(f)),null);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,4);
  f.db.prepare('UPDATE cloud_schema_contract SET contract_version=2').run();
  assert.equal(await r.lookup.resolve(req(),env(f)),null);
});
test('binding inactive, user disabled, duplicate mapping and missing store deny',async t=>{
  const f=dbFixture(t),r=resolver();
  const sql=f.db;
  sql.prepare("UPDATE access_identity_links SET active=0").run();
  assert.equal(await r.lookup.resolve(req(),env(f)),null);
  sql.prepare("UPDATE access_identity_links SET active=1").run();
  sql.prepare("UPDATE users SET active=0 WHERE id='s1'").run();
  assert.equal(await r.lookup.resolve(req(),env(f)),null);
  sql.prepare("UPDATE users SET active=1 WHERE id='s1'").run();
  sql.prepare("INSERT INTO access_identity_links VALUES(?,?,?,?,?)")
    .run(ISSUER,AUD,'synthetic-subject','m1',1);
  assert.equal(await r.lookup.resolve(req(),env(f)),null);
  sql.prepare("DELETE FROM access_identity_links WHERE user_id='m1'").run();
  sql.prepare("UPDATE locations SET active=0 WHERE id='store-a'").run();
  assert.equal(await r.lookup.resolve(req(),env(f)),null);
});
test('explicit owner binding and revoked membership use database policy, not JWT role claim',async t=>{
  const f=dbFixture(t),r=resolver();
  f.db.prepare("UPDATE access_identity_links SET user_id='o1'").run();
  const result=await r.lookup.resolve(req(signed('synthetic-subject',{role:'staff'})),env(f));
  assert.equal(result.role,'owner');
  assert.deepEqual(result.locations,[]);
  f.db.prepare("UPDATE users SET role='invalid' WHERE id='o1'").run();
  assert.equal(await r.lookup.resolve(req(),env(f)),null);
});
