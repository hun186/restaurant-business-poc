'use strict';
// Synthetic-only integration of the dormant quota transport and Owner preflight.
// No live shared rate-limit service, Worker binding or real D1 access.
const test=require('node:test');
const assert=require('node:assert/strict');
const authPromise=import('../cloudflare/auth-core.mjs');
const admissionPromise=import('../cloudflare/native-admin-admission-internal.mjs');
const quotaPromise=import('../cloudflare/native-admin-quota-transport-internal.mjs');
const actorId='123e4567-e89b-12d3-a456-426614174000';
const targetId='123e4567-e89b-12d3-a456-426614174001';
const locationId='123e4567-e89b-12d3-a456-426614174002';

async function fixture(role='owner'){
  const auth=await authPromise,token=auth.freshSessionToken();
  const csrf=auth.freshSessionToken(),digest=await auth.tokenSha256(token);
  const calls={read:0,write:0};
  const DB={
    prepare(sql){
      calls.read++;
      return {bind(...args){return {
        async first(){
          assert.ok(sql.includes('FROM sessions s JOIN users u'));
          assert.equal(args[0],digest);
          return {token_hash:digest,csrf_token:csrf,
            expires_at:new Date(Date.now()+3600000).toISOString(),id:actorId,
            username:'fixture_owner',display_name:'Fixture Owner',role};
        },
        async all(){
          assert.ok(sql.includes('FROM user_locations'));
          return {results:[{location_id:locationId}]};
        }
      };}};
    },
    batch(){calls.write++;throw Error('D1_MUTATION_FORBIDDEN');}
  };
  const env={CLOUD_AUTH_PHASE:'preview-readonly',
    ACCOUNT_SECURITY_STAGE:'internal-test-only',DB};
  const request=()=>new Request('https://private.example/api/admin/account',{
    method:'POST',headers:{origin:'https://private.example',
      'content-type':'application/json',
      cookie:auth.SESSION_COOKIE+'='+token,'x-csrf-token':csrf},
    body:JSON.stringify({action:'user.role',role:'manager',targetUserId})
  });
  return {env,calls,request};
}

test('a supplied atomic transport receives both canonical scopes after Owner identity read',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await quotaPromise;
  const {preflightNativeAdminV1:preflight}=await admissionPromise;
  const f=await fixture(),order=[];
  const transport={async consumeAtomic(payload,{signal}){
    assert.equal(signal.aborted,false);
    order.push(payload);return true;
  }};
  const quota=make(transport);
  const req=f.request();
  assert.deepEqual(await preflight(req,f.env,quota),
    {status:200,code:'OK',actorId});
  assert.deepEqual(order,[{scope:'native-admin-preauth'},
    {scope:'native-admin-owner',actorId}]);
  assert.equal(f.calls.read,2);
  assert.equal(f.calls.write,0);
  assert.equal(req.bodyUsed,false);
});

test('preauth denial and unavailable transport never reach D1',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await quotaPromise;
  const {preflightNativeAdminV1:preflight}=await admissionPromise;
  for(const behavior of [false,{allowed:true},new Error('BACKEND_SECRET')]){
    const f=await fixture();
    const quota=make({async consumeAtomic(){
      if(behavior instanceof Error)throw behavior;
      return behavior;
    }});
    const result=await preflight(f.request(),f.env,quota);
    assert.deepEqual(result,behavior===false?
      {status:429,code:'E_RATE_LIMITED'}:
      {status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
    assert.equal(f.calls.read,0);
    assert.equal(f.calls.write,0);
    assert.doesNotMatch(JSON.stringify(result),/BACKEND_SECRET/);
  }
  const f=await fixture();
  assert.deepEqual(await preflight(f.request(),f.env,make(null)),
    {status:503,code:'E_NOT_READY'});
  assert.equal(f.calls.read,0);
});

test('Owner-scoped denial still cannot read body or mutate account',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await quotaPromise;
  const {preflightNativeAdminV1:preflight}=await admissionPromise;
  const f=await fixture(),scopes=[];
  const quota=make({async consumeAtomic(payload){
    scopes.push(payload.scope);
    return payload.scope==='native-admin-preauth';
  }});
  const req=f.request();
  assert.deepEqual(await preflight(req,f.env,quota),
    {status:429,code:'E_RATE_LIMITED'});
  assert.deepEqual(scopes,['native-admin-preauth','native-admin-owner']);
  assert.equal(f.calls.read,2);
  assert.equal(f.calls.write,0);
  assert.equal(req.bodyUsed,false);
});

test('non-Owner cannot consume Owner quota even with external provider granting preauth',async()=>{
  const {createExternalNativeAdminQuotaV1:make}=await quotaPromise;
  const {preflightNativeAdminV1:preflight}=await admissionPromise;
  const f=await fixture('manager'),observed=[];
  const quota=make({async consumeAtomic(payload){observed.push(payload.scope);return true;}});
  assert.deepEqual(await preflight(f.request(),f.env,quota),
    {status:403,code:'E_FORBIDDEN'});
  assert.deepEqual(observed,['native-admin-preauth']);
  assert.equal(f.calls.write,0);
});
