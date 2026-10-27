'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const localConfig=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
const hostedConfig=JSON.parse(fs.readFileSync(path.join(root,'wrangler.pbkdf2-hosted-disabled.jsonc'),'utf8'));
const prodSource=fs.readFileSync(path.join(root,'cloudflare/worker.mjs'),'utf8');
const hostedSource=fs.readFileSync(path.join(root,'cloudflare/pbkdf2-hosted-access-worker.mjs'),'utf8');
const AUD='abcdef0123456789abcdef0123456789';
const ctx={access:{aud:AUD,getIdentity:async()=>({email:'not-used@example.test'})}};
const enabled={PROBE_ENABLED:'access-only',PROBE_ACCESS_AUD:AUD};
const url='https://protected-probe.example.test';
const workerPromise=import('../cloudflare/pbkdf2-hosted-access-worker.mjs');
const synthPromise=import('../cloudflare/pbkdf2-hosted-synthetic.mjs');

const req=(endpoint,opts={})=>new Request(url+endpoint,{method:'POST',headers:{'x-synthetic-probe-intent':'pbkdf2-only'},...opts});
test('standalone hosted Worker is not routable or enabled by repository config',()=>{
  assert.equal(hostedConfig.name,'restaurant-pbkdf2-hosted-cpu-staging-probe');
  assert.equal(hostedConfig.main,'./cloudflare/pbkdf2-hosted-access-worker.mjs');
  assert.notEqual(hostedConfig.name,localConfig.name);
  assert.equal(hostedConfig.workers_dev,false);
  assert.equal(hostedConfig.preview_urls,false);
  assert.deepEqual(hostedConfig.vars,{PROBE_ENABLED:'disabled'});
  for(const key of ['d1_databases','routes','route','assets','services','triggers','kv_namespaces','r2_buckets','unsafe'])
    assert.equal(Object.hasOwn(hostedConfig,key),false,key);
  assert.doesNotMatch(prodSource,/pbkdf2-hosted-access-worker|pbkdf2-hosted-synthetic|PROBE_ENABLED/);
  assert.match(prodSource,/E_NOT_READY/);
  assert.equal(localConfig.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(localConfig.previews.vars.CLOUD_AUTH_PHASE,'preview-readonly');
  assert.doesNotMatch(hostedSource,/env\.DB|INSERT INTO|UPDATE users|DELETE FROM|STAGING_OWNER_PASSWORD/);
});
test('unauthorized requests ALWAYS fail before KDF despite forged Access headers',async()=>{
  const w=(await workerPromise).default;
  const endpoint='/synthetic/verify-correct';
  assert.equal((await w.fetch(req(endpoint),hostedConfig.vars,ctx)).status,404);
  assert.equal((await w.fetch(req(endpoint),enabled,{})).status,403);
  assert.equal((await w.fetch(req(endpoint),enabled,{access:{aud:'wrong'}})).status,403);
  assert.equal((await w.fetch(req(endpoint),enabled,{access:{aud:'other',getIdentity:async()=>({})}})).status,403);
  assert.equal((await w.fetch(req(endpoint),{...enabled,PROBE_ACCESS_AUD:'bogus'},ctx)).status,403);
  assert.equal((await w.fetch(req(endpoint),{...enabled,PROBE_ENABLED:'enabled'},ctx)).status,404);
  const forged=req(endpoint,{headers:{
    'x-synthetic-probe-intent':'pbkdf2-only',
    'cf-access-jwt-assertion':'faked',
    'cf-authorization':'faked'
  }});
  assert.equal((await w.fetch(forged,enabled,{})).status,403);
});
test('Access-authenticated Worker rejects unexpected URL, verb, cross-site and payload',async()=>{
  const w=(await workerPromise).default;
  const get=(suffix,opts={})=>new Request(url+suffix,opts);
  assert.equal((await w.fetch(get('/synthetic/hash'),enabled,ctx)).status,405);
  assert.equal((await w.fetch(req('/synthetic/unknown'),enabled,ctx)).status,404);
  assert.equal((await w.fetch(req('/synthetic/hash?password=x'),enabled,ctx)).status,404);
  assert.equal((await w.fetch(new Request('http://protected-probe.example.test/synthetic/hash',{method:'POST'}),enabled,ctx)).status,404);
  assert.equal((await w.fetch(req('/synthetic/hash',{headers:{origin:'https://evil.test','x-synthetic-probe-intent':'pbkdf2-only'}}),enabled,ctx)).status,403);
  assert.equal((await w.fetch(req('/synthetic/hash',{headers:{'sec-fetch-site':'cross-site','x-synthetic-probe-intent':'pbkdf2-only'}}),enabled,ctx)).status,403);
  assert.equal((await w.fetch(req('/synthetic/hash',{headers:{'content-length':'2','x-synthetic-probe-intent':'pbkdf2-only'}}),enabled,ctx)).status,400);
  assert.equal((await w.fetch(req('/synthetic/hash',{body:'{"password":"test"}'}),enabled,ctx)).status,400);
  assert.equal((await w.fetch(req('/synthetic/hash',{headers:{authorization:'Bearer x','x-synthetic-probe-intent':'pbkdf2-only'}}),enabled,ctx)).status,400);
  assert.equal((await w.fetch(req('/synthetic/hash',{headers:{}}),enabled,ctx)).status,400);
  const streamed=req('/synthetic/hash',{headers:{'content-length':'0','x-synthetic-probe-intent':'pbkdf2-only'},body:'notempty'});
  assert.equal((await w.fetch(streamed,enabled,ctx)).status,400);
});
test('all three synthetic operations execute one validated 600k KDF, without inline CPU or wall time',async()=>{
  const w=(await workerPromise).default;
  const {HOSTED_OPERATIONS,runHostedSyntheticOperation}=await synthPromise;
  assert.deepEqual(HOSTED_OPERATIONS,['hash','verify-correct','verify-wrong']);
  await assert.rejects(()=>runHostedSyntheticOperation('unknown'),/E_SYNTHETIC_OPERATION/);
  for(const op of HOSTED_OPERATIONS){
    const res=await w.fetch(req('/synthetic/'+op),enabled,ctx);
    assert.equal(res.status,200,op);
    assert.equal(res.headers.get('cache-control'),'no-store');
    const body=await res.json();
    assert.equal(body.kind,'hosted_synthetic_result_no_inline_timings');
    assert.equal(body.operation,op);
    assert.equal(body.iterations,600000);
    assert.equal(body.valid,true);
    assert.equal(body.cpu_verified,false);
    for(const key of ['wall_ms','cpu_ms','wallTimeMs','cpuTimeMs']) {
      assert.equal(Object.hasOwn(body,key),false,key);
    }
    assert.match(body.probe_id,/^[0-9a-f-]{36}$/);
    assert.doesNotMatch(JSON.stringify(body),/synthetic-benchmark|salt|password|token|session|email|ip_hash/i);
  }
});
test('regression: frozen Cloudflare performance.now clock cannot create false wall/CPU measurements',async()=>{
  const {mock}=require('node:test');
  const worker=(await workerPromise).default;
  const {runHostedSyntheticOperation,HOSTED_OPERATIONS}=await synthPromise;
  const emitted=[];
  const clock=mock.method(performance,'now',()=>0);
  const info=mock.method(console,'info',msg=>emitted.push(JSON.parse(msg)));
  try{
    for(const op of HOSTED_OPERATIONS){
      const result=await runHostedSyntheticOperation(op);
      assert.deepEqual(result,{operation:op,iterations:600000,valid:true});
      const res=await worker.fetch(req('/synthetic/'+op),enabled,ctx);
      assert.equal(res.status,200,op);
      const body=await res.json();
      assert.equal(body.kind,'hosted_synthetic_result_no_inline_timings');
      assert.equal(body.valid,true);
      assert.equal(body.cpu_verified,false);
      for(const key of ['wall_ms','cpu_ms','wallTimeMs','cpuTimeMs']){
        assert.equal(Object.hasOwn(body,key),false,key+' must not be exposed');
      }
    }
    assert.equal(emitted.length,HOSTED_OPERATIONS.length);
    for(const item of emitted){
      assert.equal(item.event,'pbkdf2_synthetic_only');
      assert.equal(item.iterations,600000);
      assert.match(item.probe_id,/^[0-9a-f-]{36}$/);
      for(const key of ['wall_ms','cpu_ms','wallTimeMs','cpuTimeMs']){
        assert.equal(Object.hasOwn(item,key),false,key+' must not be logged');
      }
    }
    assert.ok(clock.mock.callCount()===0,'Hosted operation must not consult frozen performance.now');
  }finally{
    info.mock.restore();
    clock.mock.restore();
  }
});
test('Content-Length 0 with non-null readable empty stream is accepted; nonempty stream denied',async()=>{
  const w=(await workerPromise).default;
  const zero=req('/synthetic/verify-wrong',{headers:{
    'x-synthetic-probe-intent':'pbkdf2-only','content-length':'0'
  },body:''});
  assert.notEqual(zero.body,null);
  assert.equal((await w.fetch(zero,enabled,ctx)).status,200);
  const denied=req('/synthetic/hash',{method:'POST',body:new ReadableStream({
    start(c){c.enqueue(new Uint8Array([0x31]));c.close();}
  }),duplex:'half'});
  assert.equal((await w.fetch(denied,enabled,ctx)).status,400);
});
