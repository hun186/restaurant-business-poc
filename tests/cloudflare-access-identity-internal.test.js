import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createSign} from 'node:crypto';
import {createTrustedAccessIdentity} from '../cloudflare/access-identity-internal.mjs';
const issuer='https://test-team.cloudflareaccess.com';
const audience='a'.repeat(64), now=1793420000000;
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const rsa=publicKey.export({format:'jwk'});
const key={kid:'key-id',kty:'RSA',use:'sig',alg:'RS256',n:rsa.n,e:rsa.e};
const encode=o=>Buffer.from(JSON.stringify(o)).toString('base64url');
function token(c={},h={}) {
  const head=encode({alg:'RS256',typ:'JWT',kid:'key-id',...h});
  const body=encode({iss:issuer,aud:[audience],sub:'synthetic-identity',iat:Math.floor(now/1000)-60,exp:Math.floor(now/1000)+60,...c});
  const sign=createSign('RSA-SHA256');sign.update(head+'.'+body);sign.end();
  return head+'.'+body+'.'+sign.sign(privateKey).toString('base64url');
}
function request(assertion) {return new Request('https://app.invalid',{headers:assertion?{'Cf-Access-Jwt-Assertion':assertion}:{}});}
function loader({bad=false}={}) {
  let calls=0;
  const verify=createTrustedAccessIdentity({issuer,audience,nowMs:()=>now,fetchImpl:async()=>{
    calls++;
    const r=new Response(JSON.stringify({keys:bad?[]:[key]}),{headers:{'Content-Type':'application/json'}});
    Object.defineProperty(r,'url',{value:issuer+'/cdn-cgi/access/certs'});
    return r;
  }});
  return {verify,get calls(){return calls}};
}
test('valid RSA-signed assertion with fetched trusted JWKS produces only subject',async()=>{
  const h=loader();
  assert.deepEqual(await h.verify.verify(request(token())),{subject:'synthetic-identity'});
  assert.deepEqual(await h.verify.verify(request(token())),{subject:'synthetic-identity'});
  assert.equal(h.calls,1);
});
test('missing and malformed assertions never initiate a remote JWKS fetch',async()=>{
  const h=loader();
  for(const assertion of [undefined,'garbage','a.b.c','x'.repeat(16385),token({}, {alg:'none'}),token({}, {kid:'bad/kid'})])
    assert.equal(await h.verify.verify(request(assertion)),null);
  assert.equal(h.calls,0);
});
test('invalid signature and claims cannot authorize even with trusted keys',async()=>{
  const h=loader();
  for(const assertion of [token({sub:'evil'}).slice(0,-4)+'junk',token({aud:['wrong']}),token({iss:'https://other.cloudflareaccess.com'}),token({exp:Math.floor(now/1000)-50}),token({nbf:Math.floor(now/1000)+60})])
    assert.equal(await h.verify.verify(request(assertion)),null);
});
test('broken JWKS never authenticates and invalid trust config rejects',async()=>{
  assert.equal(await loader({bad:true}).verify.verify(request(token())),null);
  assert.throws(()=>createTrustedAccessIdentity({issuer,audience:'not-a-real-audience'}),/ACCESS_IDENTITY_CONFIG_INVALID/);
  assert.throws(()=>createTrustedAccessIdentity({issuer:'https://evil.example',audience}),/ACCESS_JWKS_UNAVAILABLE/);
});
