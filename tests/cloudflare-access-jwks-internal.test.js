import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createAccessJwksLoader} from '../cloudflare/access-jwks-internal.mjs';

const ISSUER='https://example-team.cloudflareaccess.com';
const URL=ISSUER+'/cdn-cgi/access/certs';
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'jwk'});
const key={kid:'current',kty:'RSA',alg:'RS256',use:'sig',n:rsa.n,e:rsa.e};
function reply(body={keys:[key]},opts={}) {
  const response=new Response(typeof body==='string'?body:JSON.stringify(body),{
    status:opts.status||200,headers:{'content-type':opts.type||'application/json',...(opts.headers||{})}
  });
  Object.defineProperties(response,{url:{value:opts.url||URL},redirected:{value:!!opts.redirected}});
  return response;
}
function harness(responses=[reply()]) {
  let count=0,clock=100000;
  const requests=[];
  const loader=createAccessJwksLoader({issuer:ISSUER,nowMs:()=>clock,fetchImpl:async(url,options)=>{
    requests.push({url,options});
    return responses[Math.min(count++,responses.length-1)];
  }});
  return {loader,requests,get count(){return count;},advance(ms){clock+=ms;}};
}
test('fixed endpoint, credentials omitted, immutable public keys and bounded cache',async()=>{
  const h=harness([reply(),reply()]);
  const one=await h.loader.getJwks({requiredKid:'current'});
  assert.equal(one.keys[0].kid,'current');
  assert.equal(Object.isFrozen(one.keys[0]),true);
  assert.equal(one.keys[0].d,undefined);
  assert.deepEqual(await h.loader.getJwks(),one);
  assert.equal(h.count,1);
  assert.equal(h.requests[0].url,URL);
  assert.equal(h.requests[0].options.redirect,'error');
  assert.equal(h.requests[0].options.credentials,'omit');
  assert.equal(h.requests[0].options.cache,'no-store');
  h.advance(300001);
  await h.loader.getJwks();
  assert.equal(h.count,2);
});
test('rotation refresh for unknown kid, throttle misses and no stale after expiry',async()=>{
  const rotated={...key,kid:'rotated'};
  const h=harness([reply(),reply({keys:[rotated]}),reply({keys:[key]})]);
  await h.loader.getJwks();
  await assert.rejects(h.loader.getJwks({requiredKid:'unknown'}),/ACCESS_JWKS_UNAVAILABLE/);
  assert.equal(h.count,1); // within cooldown from initial fetch
  h.advance(30001);
  assert.equal((await h.loader.getJwks({requiredKid:'rotated'})).keys[0].kid,'rotated');
  assert.equal(h.count,2);
  h.advance(300001);
  assert.equal((await h.loader.getJwks({requiredKid:'current'})).keys[0].kid,'current');
  assert.equal(h.count,3);
});
test('rejects untrusted team config, malformed JWK and duplicate kid',async()=>{
  for(const issuer of ['http://example-team.cloudflareaccess.com','https://example-team.cloudflareaccess.com.evil.com',
    'https://example-team.cloudflareaccess.com/path','https://x@team.cloudflareaccess.com'])
    assert.throws(()=>createAccessJwksLoader({issuer}),/ACCESS_JWKS_UNAVAILABLE/);
  for(const k of [{...key,d:'private'}, {...key,kty:'EC'}, {...key,e:'AQAC'}, {...key,n:'AAAA'}]){
    await assert.rejects(harness([reply({keys:[k]})]).loader.getJwks(),/ACCESS_JWKS_UNAVAILABLE/);
  }
  await assert.rejects(harness([reply({keys:[key,key]})]).loader.getJwks(),/ACCESS_JWKS_UNAVAILABLE/);
  await assert.rejects(harness([reply({keys:[]})]).loader.getJwks(),/ACCESS_JWKS_UNAVAILABLE/);
});
test('strict response URL, redirect, type, HTTP, size, malformed JSON and body caps',async()=>{
  for(const response of [reply({}, {url:'https://evil.example/certs'}),reply({}, {redirected:true}),
    reply({}, {status:503}),reply({}, {type:'text/html'}),reply('{invalid'),
    reply({}, {headers:{'content-length':'65537'}}),reply(' '.repeat(65537))])
    await assert.rejects(harness([response]).loader.getJwks(),/ACCESS_JWKS_UNAVAILABLE/);
});
test('concurrent calls share one fetch; errors do not become cached grants',async()=>{
  const h=harness([reply('{bad'),reply()]);
  const errors=await Promise.allSettled([h.loader.getJwks(),h.loader.getJwks()]);
  assert.deepEqual(errors.map(x=>x.status),['rejected','rejected']);
  assert.equal(h.count,1);
  await assert.rejects(h.loader.getJwks(),/ACCESS_JWKS_UNAVAILABLE/);
  assert.equal(h.count,1);
  h.advance(30001);
  await h.loader.getJwks();
  assert.equal(h.count,2);
});

test('abort deadline rejects stalled request without exposing details',async()=>{
  const loader=createAccessJwksLoader({issuer:ISSUER,timeoutMs:100,fetchImpl:(_url,{signal})=>
    new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('secret network detail')),{once:true}))});
  await assert.rejects(loader.getJwks(),error=>error.message==='ACCESS_JWKS_UNAVAILABLE');
});

test('failed fetches are throttled even with no valid cached keys',async()=>{
  let now=100000, calls=0;
  const loader=createAccessJwksLoader({issuer:ISSUER,nowMs:()=>now,fetchImpl:async()=>{calls++;throw Error('unavailable')}});
  await assert.rejects(loader.getJwks(),/ACCESS_JWKS_UNAVAILABLE/);
  for(let i=0;i<20;i++) await assert.rejects(loader.getJwks({requiredKid:'unknown'}),/ACCESS_JWKS_UNAVAILABLE/);
  assert.equal(calls,1);
  now+=30001;
  await assert.rejects(loader.getJwks(),/ACCESS_JWKS_UNAVAILABLE/);
  assert.equal(calls,2);
});
test('unrelated key rotation cannot block requests for fresh cached keys',async()=>{
  let now=100000, calls=0, finish;
  const loader=createAccessJwksLoader({issuer:ISSUER,nowMs:()=>now,fetchImpl:async()=>{
    calls++;
    if(calls===1)return reply();
    return new Promise((_resolve,reject)=>{finish=reject});
  }});
  const cached=await loader.getJwks({requiredKid:'current'});
  now+=30001;
  const unknown=loader.getJwks({requiredKid:'new-key'});
  assert.equal(typeof finish,'function');
  assert.equal(await loader.getJwks({requiredKid:'current'}),cached);
  finish(Error('rotating endpoint unavailable'));
  await assert.rejects(unknown,/ACCESS_JWKS_UNAVAILABLE/);
  assert.equal(await loader.getJwks({requiredKid:'current'}),cached);
  assert.equal(calls,2);
});
