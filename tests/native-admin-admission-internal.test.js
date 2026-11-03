'use strict';
// Synthetic Owner/Session/CSRF admission only; no deployed HTTP endpoint or D1.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const authPromise=import('../cloudflare/auth-core.mjs');
const admitPromise=import('../cloudflare/native-admin-admission-internal.mjs');
const decoderPromise=import('../cloudflare/native-admin-request-internal.mjs');
const actorId='123e4567-e89b-12d3-a456-426614174000';
const targetId='123e4567-e89b-12d3-a456-426614174001';
const locationId='123e4567-e89b-12d3-a456-426614174002';
const base={action:'user.role',role:'manager',targetUserId:targetId};
const ENDPOINT='https://private.example/api/admin/account';
const unavailable={status:503,code:'E_NOT_READY'};

async function fixture(options={}){
  const auth=await authPromise;
  const token=auth.freshSessionToken(),csrf=auth.freshSessionToken();
  const digest=await auth.tokenSha256(token);
  const calls={queries:0,writes:0,quota:[]};
  const DB={
    prepare(sql){
      calls.queries++;
      return {bind(...args){
        return {
          async first(){
            if(options.dbFailure)throw Error('SYNTHETIC_SQL_SECRET');
            if(!sql.includes('FROM sessions s JOIN users u'))throw Error('Unexpected SQL');
            if(options.revoked||options.expired||args[0]!==digest)return null;
            if(options.holdSessionRead)await new Promise(resolve=>{options.holdSessionRead.release=resolve;});
            return {token_hash:digest,csrf_token:csrf,expires_at:new Date(Date.now()+3600000).toISOString(),
              id:options.actorId===undefined?actorId:options.actorId,username:'synthetic_owner',display_name:'Synthetic Owner',
              role:options.role||'owner'};
          },
          async all(){
            if(options.dbFailure)throw Error('SYNTHETIC_SQL_SECRET');
            if(!sql.includes('FROM user_locations'))throw Error('Unexpected SQL');
            return {results:[{location_id:locationId}]};
          }
        };
      }};
    },
    batch(){calls.writes++;throw Error('D1_WRITE_MUST_NOT_HAPPEN');}
  };
  const env={CLOUD_AUTH_PHASE:'preview-readonly',
    ACCOUNT_SECURITY_STAGE:'internal-test-only',DB};
  const quota={async consume(scope){
    calls.quota.push(scope);
    if(options.quotaThrows)throw Error('SYNTHETIC_QUOTA_SECRET');
    if(options.denyScope===scope.scope)return false;
    if(options.quotaInvalid)return {allowed:true};
    return true;
  }};
  function request(input=base,headers={}){
    return new Request(ENDPOINT,{method:'POST',
      headers:{origin:'https://private.example','content-type':'application/json',
        cookie:auth.SESSION_COOKIE+'='+token,'x-csrf-token':csrf,...headers},
      body:JSON.stringify(input)});
  }
  return {env,quota,request,calls,csrf,token,auth};
}

test('Owner admission checks both quotas and live Session/CSRF before reading body',async()=>{
  const f=await fixture();
  const req=f.request();
  assert.equal(req.bodyUsed,false);
  const result=await (await admitPromise).preflightNativeAdminV1(req,f.env,f.quota);
  assert.deepEqual(result,{status:200,code:'OK',actorId});
  assert.deepEqual(f.calls.quota,[
    {scope:'native-admin-preauth'},
    {scope:'native-admin-owner',actorId}
  ]);
  assert.equal(f.calls.queries,2);
  assert.equal(f.calls.writes,0);
  assert.equal(req.bodyUsed,false,'preflight must not consume the JSON body');
  assert.deepEqual(await (await decoderPromise).readAdminRequestV1(req),
    {ok:true,input:base});
  assert.doesNotMatch(JSON.stringify(result),/csrf|cookie|token|password|SYNTHETIC/i);
});

test('all five v1 commands share one Owner admission boundary',async()=>{
  const f=await fixture(),admit=(await admitPromise).preflightNativeAdminV1;
  for(const input of [
    {action:'user.password',targetUserId:targetId,newPassword:'synthetic-pass-123456'},
    base,
    {action:'user.active',targetUserId:targetId,active:false},
    {action:'user.assign-location',targetUserId:targetId,locationId},
    {action:'user.unassign-location',targetUserId:targetId,locationId}
  ]){
    const req=f.request(input);
    assert.equal((await admit(req,f.env,f.quota)).status,200);
    assert.deepEqual((await (await decoderPromise).readAdminRequestV1(req)).input,input);
  }
  assert.equal(f.calls.writes,0);
});

test('dormant stage, missing quota and malformed request fail before any D1 read',async()=>{
  const f=await fixture(),admit=(await admitPromise).preflightNativeAdminV1;
  assert.deepEqual(await admit(f.request(),{...f.env,CLOUD_AUTH_PHASE:'disabled'},f.quota),unavailable);
  assert.deepEqual(await admit(f.request(),{...f.env,ACCOUNT_SECURITY_STAGE:'off'},f.quota),unavailable);
  assert.deepEqual(await admit(f.request(),f.env,null),unavailable);
  const badOrigin=f.request(base,{origin:'https://evil.example'});
  assert.equal((await admit(badOrigin,f.env,f.quota)).status,403);
  assert.equal(badOrigin.bodyUsed,false);
  const httpRequest=new Request('http://private.example/api/admin/account',{
    method:'POST',headers:{origin:'http://private.example',cookie:'ignored',
      'x-csrf-token':'ignored','content-type':'application/json'},body:JSON.stringify(base)});
  assert.equal((await admit(httpRequest,f.env,f.quota)).status,403);
  const wrongMethod=new Request(ENDPOINT,{
    method:'PUT',headers:{origin:'https://private.example'},body:JSON.stringify(base)});
  assert.equal((await admit(wrongMethod,f.env,f.quota)).status,400);
  assert.equal(f.calls.queries,0);
  assert.equal(f.calls.quota.length,0);
  assert.equal(f.calls.writes,0);
});

test('preauth quota fails closed before token/D1 lookup; invalid provider cannot authorize',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  for(const options of [{denyScope:'native-admin-preauth'},{quotaThrows:true},{quotaInvalid:true}]){
    const f=await fixture(options),req=f.request();
    const result=await admit(req,f.env,f.quota);
    assert.equal(result.status,options.denyScope?429:503);
    assert.equal(f.calls.queries,0);
    assert.equal(f.calls.writes,0);
    assert.equal(req.bodyUsed,false);
    assert.doesNotMatch(JSON.stringify(result),/SECRET/);
  }
});

test('revoked/expired sessions are rejected and nonowners cannot admit mutations',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  for(const opt of [{revoked:true},{expired:true},{role:'manager'},{role:'staff'}]){
    const f=await fixture(opt),req=f.request();
    const result=await admit(req,f.env,f.quota);
    assert.equal(result.status,opt.role?403:401);
    assert.equal(f.calls.writes,0);
    assert.equal(req.bodyUsed,false);
    assert.deepEqual(f.calls.quota,[{scope:'native-admin-preauth'}]);
  }
});

test('missing/wrong CSRF rejects Owner; owner-scoped quota refuses before parsing',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  const f=await fixture();
  for(const h of [{'x-csrf-token':''},{'x-csrf-token':'bogus'}]){
    assert.equal((await admit(f.request(base,h),f.env,f.quota)).status,403);
  }
  assert.equal(f.calls.writes,0);
  const limited=await fixture({denyScope:'native-admin-owner'});
  const req=limited.request();
  assert.deepEqual(await admit(req,limited.env,limited.quota),
    {status:429,code:'E_RATE_LIMITED'});
  assert.equal(req.bodyUsed,false);
  assert.equal(limited.calls.writes,0);
});

test('D1 errors and quota errors expose no SQL or credentials',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  for(const options of [{dbFailure:true},{quotaThrows:true}]){
    const f=await fixture(options);
    const result=await admit(f.request(),f.env,f.quota);
    assert.equal(result.status,503);
    assert.doesNotMatch(JSON.stringify(result),/SQL|SECRET|cookie|token_hash|csrf_token/);
    assert.equal(f.calls.writes,0);
  }
});

test('public Worker still cannot import or expose native admin admission',async()=>{
  const workerPath=path.join(__dirname,'../cloudflare/worker.mjs');
  const source=fs.readFileSync(workerPath,'utf8');
  assert.doesNotMatch(source,/native-admin-admission-internal/);
  const worker=(await import('../cloudflare/worker.mjs')).default;
  let dbCalls=0;
  const request=new Request('https://public.example/api/admin/account',{
    method:'POST',headers:{origin:'https://public.example','content-type':'application/json'},
    body:JSON.stringify(base)});
  const result=await worker.fetch(request,{
    CLOUD_AUTH_PHASE:'disabled',ACCOUNT_SECURITY_STAGE:'internal-test-only',
    DB:{prepare(){dbCalls++;throw Error('SQL');},batch(){dbCalls++;throw Error('SQL');}}
  });
  assert.equal(result.status,503);
  assert.equal((await result.json()).code,'E_NOT_READY');
  assert.equal(dbCalls,0);
});

test('a never-settling preauth quota ends with 503, aborts its signal and skips D1',async()=>{
  const f=await fixture(),admit=(await admitPromise).preflightNativeAdminV1;
  let signal,release;
  const quota={consume(_payload,options){
    signal=options.signal;
    return new Promise(resolve=>{release=resolve;});
  }};
  const req=f.request(),start=Date.now();
  assert.deepEqual(await admit(req,f.env,quota),
    {status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
  assert.ok(Date.now()-start<5000,'quota admission must be time bounded');
  assert.equal(signal?.aborted,true);
  assert.equal(f.calls.queries,0);
  assert.equal(f.calls.writes,0);
  assert.equal(req.bodyUsed,false);
  release(true);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.calls.queries,0,'late quota success must not start D1 lookup');
});

test('a stalled D1 read times out without advancing to owner quota',async()=>{
  const hold={},f=await fixture({holdSessionRead:hold});
  const admit=(await admitPromise).preflightNativeAdminV1,req=f.request();
  const start=Date.now();
  assert.deepEqual(await admit(req,f.env,f.quota),
    {status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
  assert.ok(Date.now()-start<5000,'identity read must be time bounded');
  assert.deepEqual(f.calls.quota,[{scope:'native-admin-preauth'}]);
  assert.equal(f.calls.writes,0);
  assert.equal(req.bodyUsed,false);
  assert.equal(typeof hold.release,'function');
  hold.release();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls.quota,[{scope:'native-admin-preauth'}],
    'late D1 success must not consume Owner quota');
});

test('a stalled owner quota fails closed after a successful identity lookup',async()=>{
  const f=await fixture(),admit=(await admitPromise).preflightNativeAdminV1;
  let ownerSignal,release;
  const quota={consume(payload,{signal}){
    if(payload.scope==='native-admin-preauth')return Promise.resolve(true);
    ownerSignal=signal;
    return new Promise(resolve=>{release=resolve;});
  }};
  const req=f.request();
  assert.deepEqual(await admit(req,f.env,quota),
    {status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
  assert.equal(ownerSignal?.aborted,true);
  assert.equal(f.calls.queries,2);
  assert.equal(f.calls.writes,0);
  assert.equal(req.bodyUsed,false);
  release(true);
});

test('Owner preflight is bound to the exact candidate admin route before quota or D1',async()=>{
  const f=await fixture(),admit=(await admitPromise).preflightNativeAdminV1;
  const origin='https://private.example';
  for(const suffix of [
    '/api/admin/account/','/api/admin/account?debug=1',
    '/api/admin/account#frag','/api/admin/account%2F',
    '/api/command','/api/admin/accounts'
  ]){
    const valid=f.request();
    const req=new Request(origin+suffix,{method:'POST',
      headers:valid.headers,body:JSON.stringify(base)});
    assert.deepEqual(await admit(req,f.env,f.quota),
      {status:400,code:'E_INVALID_INPUT'},suffix);
    assert.equal(req.bodyUsed,false,suffix);
  }
  assert.equal(f.calls.queries,0);
  assert.equal(f.calls.writes,0);
  assert.deepEqual(f.calls.quota,[]);
});

test('malformed JSON request headers fail before quota or D1 even for valid Owner cookies',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  for(const headers of [
    {'content-type':''},
    {'content-type':'text/plain'},
    {'content-type':'application/json; charset=iso-8859-1'},
    {'content-encoding':'gzip'},
    {'content-length':'2049'},
    {'content-length':'03'},
    {'content-length':'-1'},
    {'content-length':'9999999999999999999999999'}
  ]){
    const f=await fixture(),req=f.request(base,headers);
    assert.deepEqual(await admit(req,f.env,f.quota),
      {status:400,code:'E_INVALID_INPUT'},JSON.stringify(headers));
    assert.equal(req.bodyUsed,false);
    assert.equal(f.calls.queries,0);
    assert.equal(f.calls.writes,0);
    assert.deepEqual(f.calls.quota,[]);
  }
  const f=await fixture(),req=f.request(base,{'content-type':'application/json; charset=utf-8'});
  assert.deepEqual(await admit(req,f.env,f.quota),
    {status:200,code:'OK',actorId});
  assert.equal(req.bodyUsed,false);
  assert.equal(f.calls.writes,0);
});

test('Owner preflight and parser share the same cheap MIME and byte-length contract',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  const parser=await decoderPromise;
  for(const badHeaders of [
    {'content-type':'text/plain'},
    {'content-type':'application/json; charset=latin-1'},
    {'content-encoding':'gzip'},
    {'content-length':'2049'},
    {'content-length':'03'},
    {'content-length':'999999999999999999999999'}
  ]){
    const f=await fixture(),req=f.request(base,badHeaders);
    assert.equal(parser.validAdminBodyHeadersV1(req.headers),false);
    assert.deepEqual(await admit(req,f.env,f.quota),{status:400,code:'E_INVALID_INPUT'});
    assert.equal(req.bodyUsed,false);
    assert.equal(f.calls.queries,0);
    assert.equal(f.calls.writes,0);
    assert.deepEqual(f.calls.quota,[]);
    assert.deepEqual(await parser.readAdminRequestV1(req),{ok:false,code:'E_INVALID_INPUT'});
    assert.equal(req.bodyUsed,false);
  }
  const f=await fixture(),ok=f.request(base,{'content-type':'application/json;charset=UTF-8'});
  assert.equal(parser.validAdminBodyHeadersV1(ok.headers),true);
  assert.equal((await admit(ok,f.env,f.quota)).status,200);
  assert.deepEqual(await parser.readAdminRequestV1(ok),{ok:true,input:base});
  assert.equal(f.calls.writes,0);
});

test('Owner preflight rejects missing, consumed and locked bodies before quota or D1',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  for(const kind of ['missing','consumed','locked']){
    const f=await fixture();
    let req,reader;
    if(kind==='missing'){
      const withHeaders=f.request();
      req=new Request(ENDPOINT,{method:'POST',headers:withHeaders.headers});
    }else{
      req=f.request();
      if(kind==='consumed')await req.text();
      else reader=req.body.getReader();
    }
    try{
      assert.deepEqual(await admit(req,f.env,f.quota),
        {status:400,code:'E_INVALID_INPUT'},kind);
      assert.equal(f.calls.queries,0);
      assert.equal(f.calls.writes,0);
      assert.deepEqual(f.calls.quota,[]);
    }finally{reader?.releaseLock();}
  }
});

test('malformed body getter in synthetic request is rejected without quota or D1',async()=>{
  const f=await fixture(),admit=(await admitPromise).preflightNativeAdminV1;
  const valid=f.request();
  const malformed={method:'POST',url:ENDPOINT,headers:valid.headers,
    bodyUsed:false,get body(){throw Error('SECRET_BODY_GETTER');}};
  assert.deepEqual(await admit(malformed,f.env,f.quota),
    {status:400,code:'E_INVALID_INPUT'});
  assert.deepEqual(f.calls.quota,[]);
  assert.equal(f.calls.queries,0);
  assert.equal(f.calls.writes,0);
});

test('Owner admission shares exact-route policy and rejects userinfo before quota or D1',async()=>{
  const f=await fixture(),admit=(await admitPromise).preflightNativeAdminV1;
  const from=f.request();
  const request={method:'POST',
    url:'https://synthetic-user:synthetic-secret@private.example/api/admin/account',
    headers:from.headers,bodyUsed:false,body:from.body};
  assert.equal((await decoderPromise).validAdminPathV1(request.url),false);
  assert.deepEqual(await admit(request,f.env,f.quota),
    {status:400,code:'E_INVALID_INPUT'});
  assert.deepEqual(f.calls.quota,[]);
  assert.equal(f.calls.queries,0);
  assert.equal(f.calls.writes,0);
  assert.equal(from.bodyUsed,false);
});

test('private prepare sequence authorizes Owner before consuming a valid JSON body',async()=>{
  const f=await fixture();
  const {prepareNativeAdminCommandV1:prepare}=
    await import('../cloudflare/native-admin-prepare-internal.mjs');
  const req=f.request();
  assert.equal(req.bodyUsed,false);
  assert.deepEqual(await prepare(req,f.env,f.quota),
    {status:200,code:'OK',actorId,input:base});
  assert.equal(req.bodyUsed,true);
  assert.deepEqual(f.calls.quota,[
    {scope:'native-admin-preauth'}, {scope:'native-admin-owner',actorId}
  ]);
  assert.equal(f.calls.queries,2);
  assert.equal(f.calls.writes,0);
});

test('private prepare never reads the body after preauth deny, no quota or non-Owner',async()=>{
  const {prepareNativeAdminCommandV1:prepare}=
    await import('../cloudflare/native-admin-prepare-internal.mjs');
  for(const scenario of ['preauth-deny','no-quota','manager']){
    const f=await fixture(
      scenario==='preauth-deny'?{denyScope:'native-admin-preauth'}:
      scenario==='manager'?{role:'manager'}:{}
    );
    const req=f.request();
    const result=await prepare(req,f.env,scenario==='no-quota'?null:f.quota);
    assert.equal(result.status,scenario==='preauth-deny'?429:scenario==='manager'?403:503);
    assert.equal(req.bodyUsed,false,scenario);
    assert.equal(f.calls.writes,0);
    assert.equal(f.calls.queries,scenario==='manager'?2:0);
  }
});

test('private prepare rejects invalid JSON fields only after admitted Owner; never dispatches writes',async()=>{
  const f=await fixture();
  const {prepareNativeAdminCommandV1:prepare}=
    await import('../cloudflare/native-admin-prepare-internal.mjs');
  const req=f.request({...base,role:'UNRECOGNIZED'});
  assert.deepEqual(await prepare(req,f.env,f.quota),
    {status:400,code:'E_INVALID_INPUT'});
  assert.equal(req.bodyUsed,true);
  assert.deepEqual(f.calls.quota,[
    {scope:'native-admin-preauth'}, {scope:'native-admin-owner',actorId}
  ]);
  assert.equal(f.calls.writes,0);
});

test('malformed D1 Owner ID never reaches Owner quota or JSON body preparation',async()=>{
  const admit=(await admitPromise).preflightNativeAdminV1;
  const {prepareNativeAdminCommandV1:prepare}=
    await import('../cloudflare/native-admin-prepare-internal.mjs');
  for(const value of ['invalid-owner','',actorId.toUpperCase(),null]){
    const f=await fixture({actorId:value}),request=f.request();
    assert.deepEqual(await admit(request,f.env,f.quota),
      {status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'},String(value));
    assert.deepEqual(f.calls.quota,[{scope:'native-admin-preauth'}]);
    assert.equal(f.calls.queries,2);
    assert.equal(f.calls.writes,0);
    assert.equal(request.bodyUsed,false);
    const second=f.request();
    assert.deepEqual(await prepare(second,f.env,f.quota),
      {status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
    assert.equal(second.bodyUsed,false);
    assert.equal(f.calls.writes,0);
    assert.equal(f.calls.quota.filter(x=>x.scope==='native-admin-owner').length,0);
  }
});
