'use strict';
// Local transaction simulation of a dormant Durable Object candidate.
// A mocked mutex is NOT proof of a real Cloudflare multi-isolate deployment.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=()=>import('../cloudflare/native-admin-quota-do-core-internal.mjs');
const bridge=()=>import('../cloudflare/native-admin-quota-do-transport-internal.mjs');
const actor='123e4567-e89b-12d3-a456-426614174000';
const key='a'.repeat(64);
function storageFixture(){
  let map=new Map(),queue=Promise.resolve(),commits=0;
  const storage={transaction(fn){
    const next=queue.then(async()=>{
      const draft=new Map(map);
      const tx={get:async k=>draft.get(k),put:async(k,v)=>{draft.set(k,v);}};
      const result=await fn(tx);
      map=draft;
      commits++;
      return result;
    });
    queue=next.then(()=>{},()=>{});
    return next;
  }};
  return {storage,get:(k='native-admin-quota-v1')=>map.get(k),
    set:(v,k='native-admin-quota-v1')=>map.set(k,v),commits:()=>commits};
}
test('40 overlapping synthetic callers share one atomic quota state',async()=>{
  const {consumeAtomicWindowV1:consume}=await core(),s=storageFixture();
  const outcomes=await Promise.all(Array.from({length:40},
    ()=>consume(s.storage,'native-admin-preauth',1000)));
  assert.equal(outcomes.filter(Boolean).length,3);
  assert.deepEqual(s.get(),{scope:'native-admin-preauth',window:0,used:3});
  assert.equal(await consume(s.storage,'native-admin-preauth',59999),false);
  assert.equal(await consume(s.storage,'native-admin-preauth',60000),true);
  assert.deepEqual(s.get(),{scope:'native-admin-preauth',window:1,used:1});
});
test('durable state rejects corrupt counters, backward clocks and invalid scope',async()=>{
  const {consumeAtomicWindowV1:consume}=await core(),s=storageFixture();
  assert.equal(await consume(s.storage,'native-admin-owner',60001),true);
  assert.equal(await consume(s.storage,'native-admin-owner',60002),true);
  assert.equal(await consume(s.storage,'native-admin-owner',60003),false);
  for(const [scope,time] of [
    ['native-admin-preauth',60004],['native-admin-owner',10],
    ['unexpected',60004],['native-admin-owner',NaN]
  ])await assert.rejects(consume(s.storage,scope,time),/E_QUOTA_BACKEND_UNAVAILABLE/);
  s.set({scope:'native-admin-owner',window:1,used:900});
  await assert.rejects(consume(s.storage,'native-admin-owner',61000),
    /E_QUOTA_BACKEND_UNAVAILABLE/);
});
test('injected transaction exception does not save partial state',async()=>{
  const {consumeAtomicWindowV1:consume}=await core(),s=storageFixture();
  s.set({scope:'native-admin-owner',window:0,used:1});
  const broken={transaction:async fn=>fn({
    get:async()=>s.get(),put:async()=>{throw Error('SECRET_STORAGE');}
  })};
  await assert.rejects(consume(broken,'native-admin-owner',1000),
    e=>e.message==='E_QUOTA_BACKEND_UNAVAILABLE');
  assert.equal(s.get().used,1);
});
test('trusted preauth partition and Owner partition use separate Durable Object stubs',async()=>{
  const {createDormantDoQuotaTransportV1:create}=await bridge();
  assert.equal(create({getByName(){}},{}),null);
  assert.equal(create({getByName(){}},{trustedPreauthKey:'127.0.0.1'}),null);
  const storage=new Map(),names=[];
  const namespace={getByName(name){
    names.push(name);
    if(!storage.has(name))storage.set(name,storageFixture());
    return {async consumeQuotaV1(scope){
      return (await core()).consumeAtomicWindowV1(storage.get(name).storage,scope,1000);
    }};
  }};
  const transport=create(namespace,{trustedPreauthKey:key});
  const signal=new AbortController().signal;
  const pre={scope:'native-admin-preauth'},owner={scope:'native-admin-owner',actorId:actor};
  const results=await Promise.all(Array.from({length:15},
    ()=>transport.consumeAtomic(pre,{signal})));
  assert.equal(results.filter(Boolean).length,3);
  assert.equal(await transport.consumeAtomic(owner,{signal}),true);
  assert.equal(await transport.consumeAtomic(owner,{signal}),true);
  assert.equal(await transport.consumeAtomic(owner,{signal}),false);
  assert(names.includes('native-admin-quota-v1:preauth:'+key));
  assert(names.includes('native-admin-quota-v1:owner:'+actor));
  const before=names.length;
  for(const malformed of [
    {scope:'native-admin-owner',actorId:'bad'},
    {scope:'native-admin-preauth',ip:'spoofed'},
    {scope:'unexpected'}
  ])await assert.rejects(transport.consumeAtomic(malformed,{signal}),
    /E_QUOTA_BACKEND_UNAVAILABLE/);
  assert.equal(names.length,before);
});
test('invalid stub, backend failure and aborted RPC cannot be treated as allow',async()=>{
  const {createDormantDoQuotaTransportV1:create}=await bridge();
  const rejected=create({getByName(){throw Error('SECRET_BINDING');}},
    {trustedPreauthKey:key});
  await assert.rejects(rejected.consumeAtomic({scope:'native-admin-preauth'},
    {signal:new AbortController().signal}),e=>e.message==='E_QUOTA_BACKEND_UNAVAILABLE');
  const cancelled=new AbortController(),transport=create({getByName(){return {
    consumeQuotaV1:async()=>{cancelled.abort();return true;}
  }; }},{trustedPreauthKey:key});
  await assert.rejects(transport.consumeAtomic({scope:'native-admin-preauth'},
    {signal:cancelled.signal}),/E_QUOTA_BACKEND_UNAVAILABLE/);
  const forbidden=create({getByName(){}},{trustedPreauthKey:'not-a-hmac'});
  assert.equal(forbidden,null);
});
test('candidate class is dormant and has no Wrangler binding',()=>{
  const config=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../wrangler.jsonc'),'utf8'));
  const worker=fs.readFileSync(path.resolve(__dirname,'../cloudflare/worker.mjs'),'utf8');
  const classFile=fs.readFileSync(
    path.resolve(__dirname,'../cloudflare/native-admin-quota-do-class.example.mjs'),'utf8');
  assert.match(classFile,/extends DurableObject/);
  assert.match(classFile,/consumeAtomicWindowV1/);
  assert.doesNotMatch(worker,/native-admin-quota-do-/);
  assert.equal(Object.hasOwn(config,'durable_objects'),false);
  assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(config.preview_urls,false);
});
