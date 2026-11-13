'use strict';
// Synthetic transport contract only: no real shared quota backend or D1 access.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const load=()=>import('../cloudflare/native-admin-quota-transport-internal.mjs');
const actorId='123e4567-e89b-12d3-a456-426614174000';
const sig=()=>new AbortController();

test('external quota contract accepts only two canonical scopes and a live signal',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await load();
  const observed=[];
  const quota=make({async consumeAtomic(payload,{signal}){
    assert.equal(signal.aborted,false);
    observed.push(payload);return true;
  }});
  const a=sig();
  assert.equal(await quota.consume({scope:'native-admin-preauth'},{signal:a.signal}),true);
  assert.equal(await quota.consume({scope:'native-admin-owner',actorId},{signal:a.signal}),true);
  assert.deepEqual(observed,[{scope:'native-admin-preauth'},
    {scope:'native-admin-owner',actorId}]);
  assert.deepEqual(Object.keys(quota),['consume']);
  assert.equal(Object.isFrozen(quota),true);
});

test('adapter denies noncanonical scopes, user-controlled fields, IDs and missing signal',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await load();
  let calls=0;
  const quota=make({async consumeAtomic(){calls++;return true;}});
  for(const decision of [null,[],{},Object.create(null),
    {scope:'native-admin-preauth',actorId},
    {scope:'native-admin-preauth',ip:'127.0.0.1'},
    {scope:'native-admin-owner'},
    {scope:'native-admin-owner',actorId:actorId.toUpperCase()},
    {scope:'native-admin-owner',actorId:'../owner'},
    {scope:'native-admin-owner',actorId,cookie:'secret'},
    {scope:'other',actorId}]){
    await assert.rejects(quota.consume(decision,{signal:sig().signal}),/E_QUOTA_CONTRACT_UNAVAILABLE/);
  }
  await assert.rejects(quota.consume({scope:'native-admin-preauth'}),/E_QUOTA_CONTRACT_UNAVAILABLE/);
  const aborted=sig();aborted.abort();
  await assert.rejects(quota.consume({scope:'native-admin-preauth'},{signal:aborted.signal}),
    /E_QUOTA_CONTRACT_UNAVAILABLE/);
  assert.equal(calls,0);
  assert.equal(make(null),null);
  assert.equal(make({consumeAtomic:true}),null);
});

test('nonboolean results, thrown transport and late success after abort fail closed',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await load();
  const payload={scope:'native-admin-preauth'};
  for(const result of [null,undefined,{allowed:true},0,1,'true']){
    const quota=make({async consumeAtomic(){return result;}});
    await assert.rejects(quota.consume(payload,{signal:sig().signal}),
      /E_QUOTA_CONTRACT_UNAVAILABLE/);
  }
  assert.equal(await make({async consumeAtomic(){return false;}})
    .consume(payload,{signal:sig().signal}),false);
  await assert.rejects(make({async consumeAtomic(){throw Error('BACKEND_SECRET');}})
    .consume(payload,{signal:sig().signal}),/E_QUOTA_CONTRACT_UNAVAILABLE/);
  const ctl=sig(),quota=make({consumeAtomic:()=>new Promise(resolve=>{
    queueMicrotask(()=>{ctl.abort();resolve(true);});
  })});
  await assert.rejects(quota.consume(payload,{signal:ctl.signal}),
    /E_QUOTA_CONTRACT_UNAVAILABLE/);
});

test('adapter stays internal; public Worker and Wrangler expose no quota binding',async()=>{
  const worker=fs.readFileSync(path.resolve(__dirname,'../cloudflare/worker.mjs'),'utf8');
  const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../wrangler.jsonc'),'utf8'));
  assert.doesNotMatch(worker,/native-admin-quota-transport-internal/);
  assert.equal(config.keep_vars,true);
  assert.equal(Object.hasOwn(config,'vars'),false);
  assert.equal(config.preview_urls,false);
  assert.equal(Object.hasOwn(config.vars??{},'NATIVE_ADMIN_QUOTA_BINDING'),false);
});

test('hostile getters, symbols and proxy traps never reach quota storage',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await load();
  let called=0,getters=0;
  const quota=make({async consumeAtomic(){called++;return true;}});
  const a={};Object.defineProperty(a,'scope',{enumerable:true,get(){
    getters++;throw Error('SECRET_SCOPE');
  }});
  const b={scope:'native-admin-owner'};
  Object.defineProperty(b,'actorId',{enumerable:true,get(){
    getters++;throw Error('SECRET_ACTOR');
  }});
  const bad=[
    a,b,{scope:'native-admin-preauth',[Symbol('extra')]:1},
    new Proxy({scope:'native-admin-preauth'},{ownKeys(){throw Error('SECRET_KEYS');}}),
    new Proxy({scope:'native-admin-preauth'},{getPrototypeOf(){throw Error('SECRET_PROTO');}})
  ];
  for(const decision of bad)
    await assert.rejects(quota.consume(decision,{signal:sig().signal}),
      /E_QUOTA_CONTRACT_UNAVAILABLE/);
  assert.equal(called,0);assert.equal(getters,0);
});

test('backend exceptions, hostile transport getter and forged AbortSignal fail closed',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await load();
  assert.equal(make({get consumeAtomic(){throw Error('SECRET_TRANSPORT');}}),null);
  let called=0;
  const quota=make({async consumeAtomic(){called++;throw Error('SECRET_BACKEND');}});
  await assert.rejects(quota.consume({scope:'native-admin-preauth'},{
    signal:{aborted:false,addEventListener(){}}
  }),/E_QUOTA_CONTRACT_UNAVAILABLE/);
  assert.equal(called,0);
  const error=await quota.consume({scope:'native-admin-preauth'},{
    signal:sig().signal
  }).then(()=>null,e=>e);
  assert.equal(error.message,'E_QUOTA_CONTRACT_UNAVAILABLE');
  assert.doesNotMatch(error.stack||'',/SECRET_BACKEND|SECRET_TRANSPORT/);
  assert.equal(called,1);
});
