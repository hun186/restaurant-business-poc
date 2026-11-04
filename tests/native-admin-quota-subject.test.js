'use strict';
// No real gateway, keys, Worker binding or network. Synthetic WebCrypto only.
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHmac}=require('node:crypto');
const load=()=>import('../cloudflare/native-admin-quota-subject-internal.mjs');
const bridge=()=>import('../cloudflare/native-admin-quota-do-transport-internal.mjs');
const identityA='verified-gateway:subject-000001';
const identityB='verified-gateway:subject-000002';
async function key(bytes,extractable=false){
  return crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},
    extractable,['sign']);
}
test('opaque HMAC is stable and agrees with independent node crypto vector',async()=>{
  const {deriveVerifiedPreauthPartitionV1:derive}=await load();
  const material=new Uint8Array(32).fill(0x5a),secret=await key(material);
  const first=await derive(identityA,secret);
  const expected=createHmac('sha256',Buffer.from(material))
    .update('restaurant:native-admin:preauth:v1\\0'+identityA.replace('',''))
    .digest('hex');
  // The explicit NUL is a domain separator, not backslash-zero text.
  const actualExpected=createHmac('sha256',Buffer.from(material))
    .update('restaurant:native-admin:preauth:v1\0'+identityA).digest('hex');
  assert.equal(first,actualExpected);
  assert.match(first,/^[0-9a-f]{64}$/);
  assert.equal(await derive(identityA,secret),first);
  assert.notEqual(await derive(identityB,secret),first);
  assert.notEqual(await derive(identityA,await key(new Uint8Array(32).fill(0x5b))),first);
  assert.notEqual(first,identityA);
  assert.equal(typeof expected,'string');
});
test('no raw header, arbitrary object, weak/extractable key or forged key is accepted',async()=>{
  const {deriveVerifiedPreauthPartitionV1:derive}=await load();
  const strong=await key(new Uint8Array(32).fill(0x5a));
  for(const subject of [
    null,undefined,{},new Headers({'cf-connecting-ip':'203.0.113.1'}),
    '203.0.113.1','CF-Connecting-IP:203.0.113.1',
    'verified-gateway:UPPER','verified-gateway:hi',
    'verified-gateway:subject 000001','verified-gateway:subject\n000001'
  ])await assert.rejects(derive(subject,strong),/E_QUOTA_SUBJECT_UNAVAILABLE/);
  for(const badKey of [
    null,{},await key(new Uint8Array(4).fill(1)),
    await key(new Uint8Array(32).fill(1),true),
    {type:'secret',extractable:false,algorithm:{name:'HMAC',hash:{name:'SHA-256'},length:256},usages:['sign']}
  ])await assert.rejects(derive(identityA,badKey),
    /E_QUOTA_SUBJECT_UNAVAILABLE/);
});
test('derived partition names route through dormant DO transport without raw IDs',async()=>{
  const {deriveVerifiedPreauthPartitionV1:derive}=await load();
  const {createDormantDoQuotaTransportV1:create}=await bridge();
  const partition=await derive(identityA,await key(new Uint8Array(32).fill(0x5a)));
  const routed=[];
  const namespace={getByName(name){
    routed.push(name);
    return {async consumeQuotaV1(scope){assert.equal(scope,'native-admin-preauth');return true;}};
  }};
  const transport=create(namespace,{trustedPreauthKey:partition});
  assert.ok(transport);
  assert.equal(await transport.consumeAtomic({scope:'native-admin-preauth'},
    {signal:new AbortController().signal}),true);
  assert.deepEqual(routed,['native-admin-quota-v1:preauth:'+partition]);
  assert(!routed[0].includes(identityA));
});
