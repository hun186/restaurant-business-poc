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
            return {token_hash:digest,csrf_token:csrf,expires_at:new Date(Date.now()+3600000).toISOString(),
              id:actorId,username:'synthetic_owner',display_name:'Synthetic Owner',
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
    {action:'user.password',targetUserId,newPassword:'synthetic-pass-123456'},
    base,
    {action:'user.active',targetUserId,active:false},
    {action:'user.assign-location',targetUserId,locationId},
    {action:'user.unassign-location',targetUserId,locationId}
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
