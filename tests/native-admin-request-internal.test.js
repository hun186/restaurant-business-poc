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
  // Thousands of zero-length chunks do not consume the 2048-byte buffer.
  // Request deadline/CPU accounting still needs separate release review.
  let emptyCount=0;
  const emptyChunks=new ReadableStream({
    pull(controller){
      if(emptyCount++<500){controller.enqueue(new Uint8Array());return;}
      controller.enqueue(bytes(base));controller.close();
    }
  });
  assert.deepEqual(await read(new Request(url,{...init(emptyChunks),duplex:'half'})),
    {ok:true,input:base});
  assert.ok(emptyCount>=500);
});

test('synthetic stream has finite chunk and wall-clock read budgets',async()=>{
  const {readAdminRequestV1:read,MAX_ADMIN_READ_CHUNKS,MAX_ADMIN_READ_MS}=await load();
  assert.equal(MAX_ADMIN_READ_CHUNKS,4096);
  assert.equal(MAX_ADMIN_READ_MS,2000);
  const url='https://restaurant.example.workers.dev/api/admin/account';
  const init=body=>({method:'POST',duplex:'half',body,
    headers:{origin:'https://restaurant.example.workers.dev',
      'content-type':'application/json'}});
  let count=0;
  const unboundedEmpty=new ReadableStream({
    pull(controller){count++;controller.enqueue(new Uint8Array());}
  });
  assert.deepEqual(await read(new Request(url,init(unboundedEmpty))),bad);
  assert.ok(count>=MAX_ADMIN_READ_CHUNKS);
  // A producer which never supplies a chunk must not hold an awaited read forever.
  const stalled=new ReadableStream({start(){}});
  const start=Date.now();
  assert.deepEqual(await read(new Request(url,init(stalled))),bad);
  assert.ok(Date.now()-start<10000);
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

test('v1 request parser refuses alternate paths, query aliases and fragments without reading body',async()=>{
  const {readAdminRequestV1:read}=await load();
  const origin='https://restaurant.example.workers.dev';
  for(const suffix of [
    '/api/admin/account/','/api/admin/account?debug=1',
    '/api/admin/account#frag','/api/admin/account%2F',
    '/api/command','/api/admin/accounts'
  ]){
    const req=new Request(origin+suffix,{method:'POST',
      headers:{origin,'content-type':'application/json'},body:JSON.stringify(base)});
    assert.deepEqual(await read(req),bad,suffix);
    assert.equal(req.bodyUsed,false,suffix);
  }
  assert.deepEqual(await read(new Request(origin+'/api/admin/account',{
    method:'POST',headers:{origin,'content-type':'application/json'},
    body:JSON.stringify(base)})),{ok:true,input:base});
});

test('shared header envelope policy stays fail-closed for malformed MIME and length',async()=>{
  const {validAdminBodyHeadersV1:valid,readAdminRequestV1:read}=await load();
  const origin='https://restaurant.example.workers.dev';
  const url=origin+'/api/admin/account';
  for(const badHeaders of [
    {'content-type':''},
    {'content-type':'text/plain'},
    {'content-type':'application/json; charset=latin-1'},
    {'content-encoding':'gzip'},
    {'content-encoding':''},
    {'content-length':'2049'},
    {'content-length':'03'},
    {'content-length':'-1'},
    {'content-length':'999999999999999999999999'}
  ]){
    const req=new Request(url,{method:'POST',headers:{
      origin,'content-type':'application/json',...badHeaders},body:JSON.stringify(base)});
    assert.equal(valid(req.headers),false,JSON.stringify(badHeaders));
    assert.deepEqual(await read(req),bad);
    assert.equal(req.bodyUsed,false);
  }
  assert.equal(valid({get(){throw Error('SYNTHETIC_HEADER_SECRET');},
    has(){return false;}}),false);
  assert.equal(valid({get(){return null;}}),false);
  const req=new Request(url,{method:'POST',headers:{
    origin,'content-type':'application/json; charset=UTF-8'},body:JSON.stringify(base)});
  assert.equal(valid(req.headers),true);
  assert.deepEqual(await read(req),{ok:true,input:base});
});

test('synthetic malformed Headers getters and changing length never escape decoder',async()=>{
  const {readAdminRequestV1:read}=await load();
  const url='https://restaurant.example.workers.dev/api/admin/account';
  const origin='https://restaurant.example.workers.dev';
  const obj=(headers,body={getReader(){throw Error('SECRET_STREAM');}})=>
    ({url,method:'POST',headers,body});
  const good={get(key){return key==='origin'?origin:
    key==='content-type'?'application/json':null;},has(){return false;}};
  assert.deepEqual(await read(obj({...good,
    get(key){if(key==='origin')throw Error('SECRET_ORIGIN');return good.get(key);}})),bad);
  let lengthReads=0;
  assert.deepEqual(await read(obj({...good,
    get(key){if(key==='content-length'&&++lengthReads>1)throw Error('SECRET_LENGTH');
      return good.get(key);}})),bad);
  assert.deepEqual(await read(obj(good)),bad,
    'throwing getReader must fail with a stable invalid-input result');
  assert.deepEqual(await read(obj(good,{getReader(){return null;}})),bad);
});

test('synthetic stream errors and cleanup throwing cannot leak an exception',async()=>{
  const {readAdminRequestV1:read}=await load();
  const url='https://restaurant.example.workers.dev/api/admin/account';
  const origin='https://restaurant.example.workers.dev';
  const headers=new Headers({origin,'content-type':'application/json'});
  let released=0,canceled=0;
  const body={getReader(){return {
    read(){throw Error('SECRET_READ');},
    cancel(){canceled++;throw Error('SECRET_CANCEL');},
    releaseLock(){released++;throw Error('SECRET_RELEASE');}
  };}};
  assert.deepEqual(await read({url,method:'POST',headers,body}),bad);
  assert.equal(canceled,1);
  assert.equal(released,1);
  const invalidChunk={getReader(){return {
    async read(){return {done:false,value:'not-a-byte-array'};},
    cancel(){canceled++;return undefined;},
    releaseLock(){released++;throw Error('SECRET_RELEASE');}
  };}};
  assert.deepEqual(await read({url,method:'POST',headers,body:invalidChunk}),bad);
  assert.equal(canceled,2);
  assert.equal(released,2);
});

test('one shared exact-route policy rejects aliases, URL credentials and query/fragment',async()=>{
  const {validAdminPathV1:valid,readAdminRequestV1:read}=await load();
  const origin='https://restaurant.example.workers.dev';
  const endpoint=origin+'/api/admin/account';
  assert.equal(valid(endpoint),true);
  for(const url of [
    origin+'/api/admin/account/',
    origin+'/api/admin/account?debug=1',
    origin+'/api/admin/account#frag',
    origin+'/api/admin/account%2f',
    origin+'/api/admin/accounts',
    'https://user:pass@restaurant.example.workers.dev/api/admin/account',
    'not a url'
  ])assert.equal(valid(url),false,url);
  const fake={method:'POST',url:'https://user:pass@restaurant.example.workers.dev/api/admin/account',
    headers:new Headers({origin,'content-type':'application/json'}),
    body:{getReader(){throw Error('SECRET_BODY');}}};
  assert.deepEqual(await read(fake),bad);
});

test('internal caller can only shrink reader time budget, never extend it',async()=>{
  const {readAdminRequestV1:read,MAX_ADMIN_READ_MS}=await load();
  const origin='https://restaurant.example.workers.dev';
  let acquired=0,canceled=0,released=0;
  const req={method:'POST',url:origin+'/api/admin/account',
    headers:new Headers({origin,'content-type':'application/json'}),
    body:{getReader(){acquired++;return {
      read(){return new Promise(()=>{});},
      cancel(){canceled++;return Promise.resolve();},
      releaseLock(){released++;}
    };}}
  };
  for(const budget of [0,-1,MAX_ADMIN_READ_MS+1,1.5,null]){
    assert.deepEqual(await read(req,{readTimeoutMs:budget}),bad);
  }
  assert.equal(acquired,0);
  const started=Date.now();
  assert.deepEqual(await read(req,{readTimeoutMs:30}),bad);
  assert.ok(Date.now()-started<1000,'short deadline should not wait the original 2s');
  assert.equal(acquired,1);
  assert.equal(canceled,1);
  assert.equal(released,1);
});
