'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const canonPromise=import('../cloudflare/client-ip.mjs');
const loginPromise=import('../cloudflare/login-service.mjs');
const pepper='staging-ip-digest-test-pepper-32-characters-long';
const request=ip=>new Request('https://preview.workers.dev/api/login',
  {headers:ip===null?{'X-Forwarded-For':'198.51.100.11'}:{'CF-Connecting-IP':ip}});
test('strict IPv4 literals reject aliases that could split source quotas',async()=>{
  const {canonicalCloudflareClientIp:parse}=await canonPromise;
  assert.equal(parse('198.51.100.11'),'4:198.51.100.11');
  for(const invalid of ['198.051.100.11','001.2.3.4','198.51.100.256',
    '999.999.999.999','3232235777','0xC0.0x00.0x02.0x01','198.51.100',
    '198.51.100.11:80',' 198.51.100.11','198.51.100.11 ',
    '198.51.100.11, 203.0.113.5','evil.example','',null,undefined])
    assert.equal(parse(invalid),null,String(invalid));
});
test('canonicalize equivalent IPv6 spellings into one rate-limit source',async()=>{
  const {canonicalCloudflareClientIp:parse}=await canonPromise;
  const examples=['2001:db8::1','2001:0DB8:0000:0000:0000:0000:0000:0001','2001:db8:0:0:0::1'];
  for(const candidate of examples)assert.equal(parse(candidate),'6:2001:db8::1',candidate);
  assert.equal(parse('::1'),'6:::1');
  assert.equal(parse('::ffff:c000:201'),'4:192.0.2.1');
  assert.equal(parse('::FFFF:192.0.2.1'),'4:192.0.2.1');
  assert.equal(parse('::ffff:192.0.2.1'),parse('192.0.2.1'));
  for(const invalid of ['2001:db8:::1','2001:db8::1%eth0','[2001:db8::1]',
    '2001:db8::1/64','2001:db8::1,::2','::ffff:192.000.002.001',
    '::ffff:192.0.2.256','2001:db8::192.0.2.1',':',':::'])
    assert.equal(parse(invalid),null,invalid);
});
test('HMAC source quota shares canonical equivalent IPv6 and IPv4-mapped literals',async()=>{
  const {sourceIpDigest}=await loginPromise;
  const v6a=await sourceIpDigest(request('2001:0db8:0:0::1'),pepper);
  const v6b=await sourceIpDigest(request('2001:DB8::1'),pepper);
  assert.equal(v6a,v6b);
  const a=await sourceIpDigest(request('192.0.2.1'),pepper);
  const b=await sourceIpDigest(request('::ffff:192.0.2.1'),pepper);
  const c=await sourceIpDigest(request('::ffff:c000:201'),pepper);
  assert.equal(a,b);
  assert.equal(b,c);
  assert.notEqual(a,v6a);
  assert.match(a,/^[a-f0-9]{64}$/);
});
test('untrusted forwarded headers and malformed client IP fail before HMAC',async()=>{
  const {sourceIpDigest}=await loginPromise;
  for(const ip of [null,'198.051.100.11','198.51.100.999','::ffff:192.0.2.256',
    '2001:db8:::1','::1%eth0','198.51.100.11, 198.51.100.12'])
    await assert.rejects(()=>sourceIpDigest(request(ip),pepper),/E_AUTH_SOURCE_UNAVAILABLE/);
  await assert.rejects(()=>sourceIpDigest(request('192.0.2.1'),'weak'),/E_AUTH_SOURCE_UNAVAILABLE/);
});
test('public Cloudflare Worker still refuses login, regardless of client IP header',async()=>{
  const worker=(await import('../cloudflare/worker.mjs')).default;
  const r=new Request('https://example.workers.dev/api/login',{method:'POST',
    headers:{'CF-Connecting-IP':'198.51.100.11'},body:'do-not-accept-credentials'});
  const response=await worker.fetch(r,{CLOUD_AUTH_PHASE:'disabled',ASSETS:{fetch(){throw Error('should not serve assets')}}});
  assert.equal(response.status,503);
  assert.equal((await response.json()).code,'E_NOT_READY');
});
