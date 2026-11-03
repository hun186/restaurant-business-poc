'use strict';
// Synthetic-only input boundary. No real credentials, Worker routes or remote D1.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const id='123e4567-e89b-12d3-a456-426614174000';
const loc='123e4567-e89b-12d3-a456-426614174001';
const base={action:'user.password',newPassword:'abcdefghijkl',targetUserId:id};
const bytes=obj=>new TextEncoder().encode(JSON.stringify(obj));
const load=()=>import('../cloudflare/native-admin-request-internal.mjs');
const bad={ok:false,code:'E_INVALID_INPUT'};

test('five native account actions validate exact JSON keys and primitive types',async()=>{
  const {decodeAdminBodyV1:decode,MAX_ADMIN_BODY_BYTES}=await load();
  assert.equal(MAX_ADMIN_BODY_BYTES,2048);
  for(const input of [
    base,
    {action:'user.role',role:'manager',targetUserId:id},
    {action:'user.active',active:false,targetUserId:id},
    {action:'user.assign-location',locationId:loc,targetUserId:id},
    {action:'user.unassign-location',locationId:loc,targetUserId:id}
  ])assert.deepEqual(decode(bytes(input)),{ok:true,input});
  for(const input of [
    null,[],{},'abc',
    {...base,unexpected:true},
    {...base,newPassword:'too-short'},
    {...base,newPassword:'a'.repeat(257)},
    {...base,targetUserId:123},
    {...base,action:'constructor'},
    {action:'user.role',role:'OWNER',targetUserId:id},
    {action:'user.role',role:'owner',targetUserId:'not-a-uuid'},
    {action:'user.active',active:1,targetUserId:id},
    {action:'user.assign-location',locationId:42,targetUserId:id},
    {action:'user.unassign-location',locationId:loc,targetUserId:id,role:'owner'}
  ])assert.deepEqual(decode(bytes(input)),bad);
});

test('byte limit is inclusive and strict UTF-8/JSON errors are denied',async()=>{
  const {decodeAdminBodyV1:decode}=await load();
  const raw=JSON.stringify(base);
  assert.equal(decode(new TextEncoder().encode(raw+' '.repeat(2048-raw.length))).ok,true);
  assert.deepEqual(decode(new TextEncoder().encode(raw+' '.repeat(2049-raw.length))),bad);
  assert.deepEqual(decode(Uint8Array.of(0xc3,0x28)),bad);
  assert.deepEqual(decode(new Uint8Array()),bad);
  assert.deepEqual(decode(bytes({action:'user.password',targetUserId:id,
    newPassword:'a'.repeat(12)+'\\u0000'})).ok,true);
  assert.deepEqual(decode(new TextEncoder().encode('{"action":')),bad);
  assert.deepEqual(decode('not-bytes'),bad);
});

test('synthetic Request rejects insecure methods, origins, headers and overlong streams',async()=>{
  const {readAdminRequestV1:read}=await load();
  const url='https://restaurant.example.workers.dev/api/admin/account';
  const origin='https://restaurant.example.workers.dev';
  const init=(body=JSON.stringify(base))=>({method:'POST',
    headers:{origin,'content-type':'application/json'},body});
  assert.deepEqual(await read(new Request(url,init())),{ok:true,input:base});
  for(const req of [
    new Request(url,{...init(),method:'PUT'}),
    new Request('http://restaurant.example.workers.dev/api/admin/account',init()),
    new Request(url,{...init(),headers:{'content-type':'application/json'}}),
    new Request(url,{...init(),headers:{origin:'https://evil.example','content-type':'application/json'}}),
    new Request(url,{...init(),headers:{origin,'content-type':'text/plain'}}),
    new Request(url,{...init(),headers:{origin,'content-type':'application/json','content-encoding':'gzip'}}),
    new Request(url,{...init(),headers:{origin,'content-type':'application/json','content-length':'99999'}})
  ])assert.deepEqual(await read(req),bad);
  let cancelCalled=false;
  const body=new ReadableStream({
    pull(controller){controller.enqueue(new Uint8Array(1100));},
    cancel(){cancelCalled=true;}
  });
  assert.deepEqual(await read(new Request(url,{...init(body),duplex:'half'})),bad);
  assert.equal(cancelCalled,true);
});

test('public Worker stays closed and does not import dormant request decoder',async()=>{
  const src=fs.readFileSync(path.join(__dirname,'../cloudflare/worker.mjs'),'utf8');
  assert.doesNotMatch(src,/native-admin-request-internal/);
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../wrangler.jsonc'),'utf8'));
  assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(config.preview_urls,false);
  let dbCalls=0;
  const worker=(await import('../cloudflare/worker.mjs')).default;
  for(const phase of ['disabled','preview-readonly']){
    const response=await worker.fetch(new Request(
      'https://restaurant.example.workers.dev/api/admin/account',{
        method:'POST',headers:{origin:'https://restaurant.example.workers.dev',
          'content-type':'application/json'},body:JSON.stringify(base)
      }),{CLOUD_AUTH_PHASE:phase,DB:{
        prepare(){dbCalls++;throw Error('D1 must remain closed');},
        batch(){dbCalls++;throw Error('D1 must remain closed');}
      }});
    assert.equal(response.status,503);
    assert.equal((await response.json()).code,'E_NOT_READY');
  }
  assert.equal(dbCalls,0);
});
