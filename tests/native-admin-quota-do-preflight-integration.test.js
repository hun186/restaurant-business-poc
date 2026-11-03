'use strict';
// Staged synthetic concurrency across private DO transport, quota adapter and
// Owner admission. A simulated transaction mutex is NOT live Worker UAT.
const test=require('node:test');
const assert=require('node:assert/strict');
const authPromise=import('../cloudflare/auth-core.mjs');
const adminPromise=import('../cloudflare/native-admin-admission-internal.mjs');
const wrapperPromise=import('../cloudflare/native-admin-quota-transport-internal.mjs');
const doBridgePromise=import('../cloudflare/native-admin-quota-do-transport-internal.mjs');
const corePromise=import('../cloudflare/native-admin-quota-do-core-internal.mjs');
const actorA='123e4567-e89b-12d3-a456-426614174000';
const actorB='123e4567-e89b-12d3-a456-426614174009';
const target='123e4567-e89b-12d3-a456-426614174001';
const store='123e4567-e89b-12d3-a456-426614174002';
function namespaceFixture(){
  const stores=new Map(),names=[];
  function storage(){
    let map=new Map(),queue=Promise.resolve();
    return {transaction(fn){
      const next=queue.then(async()=>{
        const draft=new Map(map),tx={
          get:async key=>draft.get(key),
          put:async(key,val)=>{draft.set(key,val);}
        };
        const result=await fn(tx);map=draft;return result;
      });
      queue=next.then(()=>{},()=>{});return next;
    }};
  }
  return {names,namespace:{getByName(name){
    names.push(name);
    if(!stores.has(name))stores.set(name,storage());
    return {async consumeQuotaV1(scope){
      return (await corePromise).consumeAtomicWindowV1(stores.get(name),scope,1000);
    }};
  }}};
}
async function fixture(actorId=actorA){
  const auth=await authPromise,token=auth.freshSessionToken();
  const csrf=auth.freshSessionToken(),digest=await auth.tokenSha256(token);
  const calls={read:0,write:0};
  const DB={prepare(sql){
    calls.read++;
    return {bind(...args){return {
      async first(){
        assert.ok(sql.includes('FROM sessions s JOIN users u'));
        assert.equal(args[0],digest);
        return {token_hash:digest,csrf_token:csrf,
          expires_at:new Date(Date.now()+3600000).toISOString(),
          id:actorId,username:'synthetic_owner',
          display_name:'Synthetic Owner',role:'owner'};
      },
      async all(){
        assert.ok(sql.includes('FROM user_locations'));
        return {results:[{location_id:store}]};
      }
    };}};
  },batch(){calls.write++;throw Error('D1_WRITES_FORBIDDEN');}};
  const env={CLOUD_AUTH_PHASE:'preview-readonly',
    ACCOUNT_SECURITY_STAGE:'internal-test-only',DB};
  const request=()=>new Request('https://private.example/api/admin/account',{
    method:'POST',headers:{
      origin:'https://private.example','content-type':'application/json',
      cookie:auth.SESSION_COOKIE+'='+token,'x-csrf-token':csrf
    },body:JSON.stringify({action:'user.role',targetUserId:target,role:'manager'})
  });
  return {env,request,calls};
}
async function quota(namespace,trustedPreauthKey){
  const {createExternalNativeAdminQuotaV1:wrap}=await wrapperPromise;
  const {createDormantDoQuotaTransportV1:create}=await doBridgePromise;
  return wrap(create(namespace,{trustedPreauthKey}));
}
test('concurrent Owner admission shares both durable quota stages with no writes',async()=>{
  const {namespace,names}=namespaceFixture(),f=await fixture();
  const {preflightNativeAdminV1:preflight}=await adminPromise;
  const q=await quota(namespace,'a'.repeat(64));
  const requests=Array.from({length:9},()=>f.request());
  const outcomes=await Promise.all(requests.map(r=>preflight(r,f.env,q)));
  assert.equal(outcomes.filter(r=>r.status===200).length,2);
  assert.equal(outcomes.filter(r=>r.status===429).length,7);
  assert.deepEqual(outcomes.filter(r=>r.status===200)[0],
    {status:200,code:'OK',actorId:actorA});
  assert.equal(f.calls.read,6,
    'only three preauth-allowed candidates reach two read-only D1 queries');
  assert.equal(f.calls.write,0);
  assert(requests.every(r=>r.bodyUsed===false));
  assert(names.some(n=>n==='native-admin-quota-v1:preauth:'+'a'.repeat(64)));
  assert(names.some(n=>n==='native-admin-quota-v1:owner:'+actorA));
});
test('preauth partitions are distinct, but the same Owner still shares a quota',async()=>{
  const {namespace,names}=namespaceFixture();
  const {preflightNativeAdminV1:preflight}=await adminPromise;
  const f=await fixture();
  for(const key of ['a'.repeat(64),'b'.repeat(64)]){
    const q=await quota(namespace,key);
    const statuses=await Promise.all(Array.from({length:2},
      ()=>preflight(f.request(),f.env,q)));
    assert.deepEqual(statuses.map(s=>s.status),
      key.startsWith('a')?[200,200]:[429,429]);
  }
  assert(names.some(n=>n==='native-admin-quota-v1:preauth:'+'b'.repeat(64)));
  assert.equal(f.calls.write,0);
  const different=await fixture(actorB),other=await quota(namespace,'b'.repeat(64));
  assert.equal((await preflight(different.request(),different.env,other)).status,200);
  assert.equal(different.calls.write,0);
});
test('missing trusted subject or broken remote stub fails before identity/body',async()=>{
  const {namespace}=namespaceFixture(),f=await fixture();
  const {preflightNativeAdminV1:preflight}=await adminPromise;
  const missing=await quota(namespace,'not-a-trusted-partition');
  const req=f.request();
  assert.deepEqual(await preflight(req,f.env,missing),{status:503,code:'E_NOT_READY'});
  assert.equal(f.calls.read,0);assert.equal(req.bodyUsed,false);
  const remote=await quota({getByName(){throw Error('BACKEND_SECRET');}},'a'.repeat(64));
  const failed=f.request();
  assert.deepEqual(await preflight(failed,f.env,remote),
    {status:503,code:'E_ADMIN_PREFLIGHT_UNAVAILABLE'});
  assert.equal(f.calls.read,0);assert.equal(f.calls.write,0);
  assert.equal(failed.bodyUsed,false);
});
