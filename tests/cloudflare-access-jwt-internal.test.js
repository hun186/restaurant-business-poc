import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { verifyAccessJwtAssertion, verifyAccessRequest } from '../cloudflare/access-jwt-internal.mjs';

const ISSUER = 'https://demo-team.cloudflareaccess.com';
const AUD = 'a'.repeat(32);
const NOW = 1793420000;
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const rsa = publicKey.export({ format: 'jwk' });
const key = { kty:'RSA',kid:'known-key',alg:'RS256',use:'sig',n:rsa.n,e:rsa.e };
const config = {issuer:ISSUER,audience:AUD,jwks:{keys:[key]},nowSeconds:NOW};
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(claimOverrides = {}, headerOverrides = {}) {
  const h = b64({alg:'RS256',typ:'JWT',kid:'known-key',...headerOverrides});
  const p = b64({iss:ISSUER,aud:[AUD],sub:'synthetic-subject',iat:NOW-300,exp:NOW+300,...claimOverrides});
  const signer=createSign('RSA-SHA256');signer.update(h+'.'+p);signer.end();
  return h+'.'+p+'.'+signer.sign(privateKey).toString('base64url');
}
test('verifies a real RS256 signature and returns only the synthetic subject',async()=>{
  assert.deepEqual(await verifyAccessJwtAssertion(token(),config),{subject:'synthetic-subject'});
  const req=new Request('https://example.invalid',{headers:{'Cf-Access-Jwt-Assertion':token()}});
  assert.deepEqual(await verifyAccessRequest(req,config),{subject:'synthetic-subject'});
  assert.equal(await verifyAccessRequest(new Request('https://example.invalid'),config),null);
});
test('rejects forged, unsigned and wrong-algorithm assertions',async()=>{
  const good=token(); const [h,p,s]=good.split('.');
  for(const bad of [good+'x',h+'.'+b64({iss:ISSUER,aud:[AUD],sub:'admin',iat:NOW-300,exp:NOW+300})+'.'+s,
    b64({alg:'none',typ:'JWT',kid:'known-key'})+'.'+p+'.'+s,
    token({}, {alg:'HS256'}),token({}, {kid:'attacker'}),
    h+'.'+p+'.'+s.slice(1), 'garbage','a.b.c',h+'.'+p+'.'+s+'=' ]) {
    assert.equal(await verifyAccessJwtAssertion(bad,config),null);
  }
});
test('rejects wrong audience, issuer, expired, not-before and future-issued tokens',async()=>{
  for(const claims of [{aud:['wrong']},{aud:AUD},{iss:'https://wrong.cloudflareaccess.com'},
    {exp:NOW-31},{nbf:NOW+31},{iat:NOW+31},
    {sub:''},{sub:'x'.repeat(257)},{exp:NOW-600}])
    assert.equal(await verifyAccessJwtAssertion(token(claims),config),null);
});
test('rejects invalid trust configuration, ambiguous keys, malformed claims',async()=>{
  const good=token();
  for(const invalid of [{...config,audience:''},{...config,issuer:'https://evil.example'},
    {...config,jwks:{keys:[key,key]}},{...config,jwks:{keys:[{...key,n:'no'}]}},
    {...config,jwks:{keys:[{...key,use:'enc'}]}},{...config,jwks:{keys:[]}}])
    assert.equal(await verifyAccessJwtAssertion(good,invalid),null);
  assert.equal(await verifyAccessJwtAssertion(token({iat:'yesterday'}),config),null);
  assert.equal(await verifyAccessJwtAssertion(token({nbf:'soon'}),config),null);
  assert.equal(await verifyAccessJwtAssertion('a'.repeat(16385),config),null);
});
