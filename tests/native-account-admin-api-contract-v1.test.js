'use strict';
// Contract-only checks. No public API, database writes or real accounts.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const spec=read('docs/native-account-admin-api-contract-v1.json');
const wrangler=read('wrangler.jsonc');

test('native account admin v1 contract is explicitly not released',()=>{
  assert.equal(spec.schema,'restaurant_native_admin_api_contract_v1');
  assert.equal(spec.status,'DESIGN_ONLY_NO_HTTP_HANDLER');
  assert.equal(spec.candidate_endpoint.path,'/api/admin/account');
  assert.equal(spec.candidate_endpoint.method,'POST');
  assert.equal(spec.candidate_endpoint.https_required,true);
  assert.equal(spec.candidate_endpoint.origin,'same-origin');
  assert.equal(spec.candidate_endpoint.csrf,'session-bound');
  assert.equal(spec.candidate_endpoint.authorized_role,'owner');
  assert.equal(spec.candidate_endpoint.public_route_exists,false);
  assert.equal(spec.candidate_endpoint.max_body_bytes,2048);
  assert.equal(wrangler.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(wrangler.preview_urls,false);
  assert.equal(Object.hasOwn(wrangler.vars,'ACCOUNT_SECURITY_STAGE'),false);
  assert.equal(Object.hasOwn(wrangler.previews.vars,'ACCOUNT_SECURITY_STAGE'),false);
  assert.equal(spec.release_gates.requires_new_explicit_production_authorization,true);
});

test('v1 action matrix is closed, exact-key, owner-only and secret-free by contract',()=>{
  assert.deepEqual(Object.keys(spec.actions).sort(),[
    'user.active','user.assign-location','user.password','user.role','user.unassign-location'
  ]);
  for(const [action,entry] of Object.entries(spec.actions)){
    assert.equal(entry.role,'owner',action);
    assert.equal(entry.audit_action,action,action);
    assert.equal(entry.types.action,'literal:'+action,action);
    assert.deepEqual([...entry.fields].sort(),entry.fields,action);
    assert.deepEqual([...new Set(entry.fields)],entry.fields,action);
    assert.equal(entry.fields[0],'action',action);
    assert.ok(entry.fields.includes('targetUserId'),action);
    assert.equal(entry.types.targetUserId,'uuid',action);
    assert.match(entry.session_effect,/^revoke_all_target_sessions/,action);
    assert.equal(spec.response_contract.secret_fields_never_returned.includes('token_hash'),true);
  }
  assert.equal(spec.actions['user.password'].password_never_logged,true);
  for(const role of ['user.role','user.active']){
    assert.equal(spec.actions[role].self_target,'denied');
    assert.equal(spec.actions[role].last_active_owner_protected,true);
  }
});

test('proposed admin endpoint is absent from both public Worker phases with zero D1 calls',async()=>{
  const worker=(await import('../cloudflare/worker.mjs')).default;
  let dbCalls=0,assets=0;
  for(const phase of ['disabled','preview-readonly']){
    const env={
      CLOUD_AUTH_PHASE:phase,ACCOUNT_SECURITY_STAGE:'internal-test-only',
      CLOUD_NATIVE_LOGIN_GATE:'operator-released',
      DB:{
        prepare(){dbCalls++;throw Error('D1_READ_FORBIDDEN');},
        batch(){dbCalls++;throw Error('D1_WRITE_FORBIDDEN');}
      },
      ASSETS:{fetch(){assets++;throw Error('ASSET_FALLBACK_FORBIDDEN');}}
    };
    const req=new Request('https://restaurant.example.workers.dev'+spec.candidate_endpoint.path,{
      method:'POST',
      headers:{origin:'https://restaurant.example.workers.dev','content-type':'application/json',
        'x-csrf-token':'synthetic-rejected'},
      body:JSON.stringify({action:'user.password',targetUserId:'synthetic',
        newPassword:'NEVER_A_REAL_PASSWORD'})
    });
    const res=await worker.fetch(req,env);
    assert.equal(res.status,503,phase);
    assert.deepEqual(await res.json(),{code:'E_NOT_READY',
      error:'Cloudflare 正式後端尚未啟用；目前只有虛構資料展示版，請勿輸入真實帳密或營運資料。'});
  }
  assert.equal(dbCalls,0);
  assert.equal(assets,0);
});
