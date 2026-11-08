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
