'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const script=path.join(root,'tools/cloudflare-prod-auth-activity-readonly.mjs');
const source=fs.readFileSync(script,'utf8');
const actions=fs.readFileSync(path.join(root,
 '.github/workflows/d1-production-auth-activity-readonly.yml'),'utf8');
const api=import('../tools/cloudflare-prod-auth-activity-readonly.mjs');
const keys=[
 'schema_ok','migrations_ok','users_present','owner_candidate_present',
 'owner_bootstrap_audit_present','sessions_present',
 'unexpired_active_user_session_present','expired_sessions_present',
 'invalid_session_expiry_present','login_attempts_present',
 'recent_login_attempts_present','successful_login_attempts_present',
 'failed_login_attempts_present'
];
const empty=()=>Object.fromEntries(keys.map(k=>[k,
 k==='schema_ok'||k==='migrations_ok'?1:0]));
const wrap=values=>[{success:true,results:[values]}];
const call=(...args)=>spawnSync(process.execPath,[script,...args],
 {cwd:root,encoding:'utf8',timeout:12000});

test('only a fixed aggregate SELECT can be produced; no row data or IDs projected',async()=>{
 const {productionAuthActivitySql}=await api;
 const sql=productionAuthActivitySql('auth');
 assert.match(sql,/^SELECT /);
 assert.match(sql,/ AS sessions_present/);
 assert.match(sql,/ AS login_attempts_present/);
 assert.match(sql,/unixepoch\(s\.expires_at\)>unixepoch\('now'\)/);
 assert.match(sql,/ at>=datetime\('now','-7 days'\)/);
 assert.doesNotMatch(sql,/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|CREATE|ATTACH)\b/i);
 assert.doesNotMatch(sql,/SELECT\s+\*|AS token_hash|AS csrf_token|AS username|AS ip_hash|AS password_hash/i);
 assert.equal((sql.match(/;/g)||[]).length,1);
 for(const invalid of ['', 'before','after','write','cleanup',null])
  assert.throws(()=>productionAuthActivitySql(invalid),
   /E_PROD_AUTH_ACTIVITY_READONLY/);
});

test('normal state and historical attempt without sessions produce only safe booleans',async()=>{
 const {inspectProductionAuthActivity}=await api;
 const plain=inspectProductionAuthActivity(wrap(empty()));
 assert.equal(plain.status,'PROD_AUTH_ACTIVITY_READONLY_PASS');
 assert.equal(plain.sessions_present,false);
 assert.equal(plain.login_attempts_present,false);
 assert.equal(plain.owner_created_or_modified,false);
 assert.equal(plain.production_write_performed,false);
 assert.equal(plain.release_authorized,false);
 const e=empty();
 e.login_attempts_present=1;
 e.failed_login_attempts_present=1;
 const actual=inspectProductionAuthActivity(wrap(e));
 assert.equal(actual.login_attempts_present,true);
 assert.equal(actual.failed_login_attempts_present,true);
 assert.equal(actual.sessions_present,false);
 assert.doesNotMatch(JSON.stringify(actual),
  /token_hash|csrf_token|username|password_hash|password_salt|ip_hash/);
});

test('unexpired active-user session differs from stale and invalid timestamp states',async()=>{
 const {inspectProductionAuthActivity}=await api;
 const active=empty();
 active.users_present=1;
 active.owner_candidate_present=1;
 active.sessions_present=1;
 active.unexpired_active_user_session_present=1;
 const a=inspectProductionAuthActivity(wrap(active));
 assert.equal(a.unexpired_active_user_session_present,true);
 assert.equal(a.expired_sessions_present,false);
 assert.equal(a.login_gate_modified,false);
 const expired=empty();
 expired.sessions_present=1;
 expired.expired_sessions_present=1;
 const b=inspectProductionAuthActivity(wrap(expired));
 assert.equal(b.expired_sessions_present,true);
 assert.equal(b.unexpired_active_user_session_present,false);
 const malformed=empty();
 malformed.sessions_present=1;
 malformed.invalid_session_expiry_present=1;
 assert.equal(inspectProductionAuthActivity(wrap(malformed))
  .invalid_session_expiry_present,true);
});

test('invalid schema, extra row/field, wrong flag type and contradictory flags all fail closed',async()=>{
 const {inspectProductionAuthActivity}=await api;
 const invalid=[
  values=>{values.schema_ok=0;},
  values=>{values.migrations_ok=0;},
  values=>{values.sessions_present='1';},
  values=>{values.login_attempts_present=0;values.failed_login_attempts_present=1;},
  values=>{values.users_present=0;values.owner_candidate_present=1;},
  values=>{values.sessions_present=0;values.expired_sessions_present=1;},
  values=>{values.login_attempts_present=1;},
  values=>{values.unexpected_field=1;}
 ];
 for(const change of invalid){
  const vals=empty();
  change(vals);
  assert.throws(()=>inspectProductionAuthActivity(wrap(vals)),
   /E_PROD_AUTH_ACTIVITY_READONLY/);
 }
 assert.throws(()=>inspectProductionAuthActivity([{success:true,results:[]}]),
  /E_PROD_AUTH_ACTIVITY_READONLY/);
 assert.throws(()=>inspectProductionAuthActivity([{success:true,results:[empty(),empty()]}]),
  /E_PROD_AUTH_ACTIVITY_READONLY/);
 assert.throws(()=>inspectProductionAuthActivity([{success:false,results:[empty()]}]),
  /E_PROD_AUTH_ACTIVITY_READONLY/);
});

test('actual CLI only returns sanitized booleans; private data is never emitted',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prod-auth-private-'));
 const filepath=path.join(dir,'metadata.json');
 try{
  const state=empty();
  state.sessions_present=1;
  state.expired_sessions_present=1;
  state.login_attempts_present=1;
  state.failed_login_attempts_present=1;
  fs.writeFileSync(filepath,JSON.stringify(wrap(state)),{mode:0o600});
  const result=call('inspect',filepath);
  assert.equal(result.status,0,result.stderr);
  const out=JSON.parse(result.stdout);
  assert.equal(out.expired_sessions_present,true);
  assert.equal(out.failed_login_attempts_present,true);
  assert.equal(out.release_authorized,false);
  assert.doesNotMatch(result.stdout,/password|username|token_hash|ip_hash|csrf/i);
  const poison=wrap({...state,secret:'PRIVATE_OWNER_VALUE'});
  fs.writeFileSync(filepath,JSON.stringify(poison),{mode:0o600});
  const bad=call('inspect',filepath);
  assert.equal(bad.status,1);
  assert.equal(bad.stdout,'');
  assert.equal(bad.stderr.trim(),'E_PROD_AUTH_ACTIVITY_READONLY stage=INVALID_RESULT');
  assert.doesNotMatch(bad.stderr,/PRIVATE_OWNER_VALUE/);
  fs.writeFileSync(filepath,'{sensitive secret', {mode:0o600});
  const malformed=call('inspect',filepath);
  assert.equal(malformed.status,1);
  assert.equal(malformed.stderr.trim(),'E_PROD_AUTH_ACTIVITY_READONLY stage=INVALID_EVIDENCE');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
 const wrong=call('sql','cleanup');
 assert.equal(wrong.status,1);
 assert.equal(wrong.stderr.trim(),'E_PROD_AUTH_ACTIVITY_READONLY stage=INVALID_MODE');
});

test('production auth-activity workflow is manually authorized, fixed target and read only',()=>{
 assert.match(actions,/^  workflow_dispatch:/m);
 assert.match(actions,/github\.ref == 'refs\/heads\/main'/);
 assert.match(actions,/CHECK_PROD_AUTH_ACTIVITY_READONLY/);
 assert.match(actions,/environment: d1-production-readonly/);
 assert.match(actions,/restaurant-business-production-d1-initialization/);
 assert.match(actions,/CLOUDFLARE_PROD_D1_READ_TOKEN/);
 assert.match(actions,/cloudflare-hosted-probe-preflight/);
 assert.match(actions,/cloudflare-prod-d1-init\.mjs config/);
 assert.match(actions,/wrangler@4\.152\.0/);
 assert.match(actions,/d1 execute PROD_DB --remote --json/);
 assert.match(actions,/cloudflare-prod-auth-activity-readonly\.mjs sql auth/);
 assert.match(actions,/cloudflare-prod-auth-activity-readonly\.mjs inspect/);
 assert.doesNotMatch(actions,/^\s*(push|pull_request|schedule):/m);
 assert.doesNotMatch(actions,
  /CLOUDFLARE_PROD_D1_WRITE_TOKEN|wrangler deploy|d1 migrations apply|time-travel restore|d1 execute.*--file/i);
 assert.match(source,/owner_created_or_modified:false/);
 assert.match(source,/cleanup_authorized:false/);
});
