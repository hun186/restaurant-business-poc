'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');

const endpoint='https://restaurant.test.workers.dev/api/login';
const nativePromise=import('../cloudflare/native-login-http.mjs');
const request=(source)=>new Request(endpoint,{
  method:'POST',body:new ReadableStream(source),duplex:'half'
});

test('native login bounded-body reader rejects a stalled upload within a total deadline',async()=>{
  const {bodyWithinLimit}=await nativePromise;
  let canceled=0;
  const r=request({start(){},cancel(){canceled++;}});
  await assert.rejects(()=>bodyWithinLimit(r,{maxDurationMs:30}),
    error=>error?.message==='E_BODY_DEADLINE');
  assert.equal(canceled,1);
});

test('native login bounded-body reader rejects unbounded empty chunks',async()=>{
  const {bodyWithinLimit}=await nativePromise;
  const r=request({start(controller){
    for(let i=0;i<257;i++)controller.enqueue(new Uint8Array());
    controller.close();
  }});
  await assert.rejects(()=>bodyWithinLimit(r),
    error=>error?.message==='E_BODY_CHUNKS');
});

test('native login bounded-body reader rejects malformed stream chunks',async()=>{
  const {bodyWithinLimit}=await nativePromise;
  let closed=0;
  const r={body:{getReader:()=>({
    read:async()=>({done:false,value:'not-bytes'}),
    cancel(){closed++;return Promise.resolve();},
    releaseLock(){}
  })}};
  await assert.rejects(()=>bodyWithinLimit(r),
    error=>error?.message==='E_BODY_INVALID');
  assert.equal(closed,1);
});

test('native login bounded-body reader refuses a hanging cancel promise',async()=>{
  const {bodyWithinLimit}=await nativePromise;
  const r={body:{getReader:()=>({
    read:()=>new Promise(()=>{}),
    cancel:()=>new Promise(()=>{}),
    releaseLock(){}
  })}};
  await assert.rejects(()=>bodyWithinLimit(r,{maxDurationMs:30}),
    error=>error?.message==='E_BODY_DEADLINE');
});

test('native login bounded-body reader preserves UTF-8 and 2048-byte limit',async()=>{
  const {bodyWithinLimit}=await nativePromise;
  const contents=JSON.stringify({username:'owner',password:'example-password-123'});
  const binary=new TextEncoder().encode(contents);
  const r=request({start(controller){
    controller.enqueue(binary.subarray(0,5));
    controller.enqueue(binary.subarray(5));
    controller.close();
  }});
  assert.equal(await bodyWithinLimit(r),contents);
  const tooBig=request({start(controller){
    controller.enqueue(new Uint8Array(2049));controller.close();
  }});
  await assert.rejects(()=>bodyWithinLimit(tooBig),
    error=>error?.message==='E_BODY_TOO_LARGE');
});

test('explicit larger body ceiling is bounded, strict UTF-8, preserves default and stream guards',async()=>{
 const {bodyWithinLimit}=await nativePromise;
 const stream=bytes=>request({start(c){c.enqueue(bytes.subarray(0,1));c.enqueue(bytes.subarray(1));c.close();}});
 const content='評'.repeat(1200),bytes=new TextEncoder().encode(content);
 await assert.rejects(()=>bodyWithinLimit(stream(bytes)),/E_BODY_TOO_LARGE/);
 assert.equal(await bodyWithinLimit(stream(bytes),{maxBytes:8192}),content);
 assert.equal((await bodyWithinLimit(stream(new Uint8Array(8192).fill(65)),{maxBytes:8192})).length,8192);
 await assert.rejects(()=>bodyWithinLimit(stream(new Uint8Array(8193)),{maxBytes:8192}),/E_BODY_TOO_LARGE/);
 for(const invalid of [0,8193,1.5,Infinity,'8192',null])
  await assert.rejects(()=>bodyWithinLimit(stream(bytes),{maxBytes:invalid}),/E_BODY_INVALID/);
 await assert.rejects(()=>bodyWithinLimit(stream(new Uint8Array([0xc3,0x28])),{maxBytes:8192}));
 await assert.rejects(()=>bodyWithinLimit(request({start(c){for(let i=0;i<257;i++)c.enqueue(new Uint8Array());c.close();}}),{maxBytes:8192}),/E_BODY_CHUNKS/);
 await assert.rejects(()=>bodyWithinLimit(request({start(){}}),{maxBytes:8192,maxDurationMs:30}),/E_BODY_DEADLINE/);
});
