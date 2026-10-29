'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const script=path.join(root,'tools/cloudflare-d1-disposable-drill.mjs');
const wf=path.join(root,'.github/workflows/d1-disposable-restore-drill-g5.yml');
const modulePromise=import('../tools/cloudflare-d1-disposable-drill.mjs');
const legit='1a2b3c4d-1111-4222-8333-abcdefab1234';
const prod='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
const stage='2c355bed-d9c3-449c-aa9b-1018f3bc1177';
const name='restaurant-business-g5-disposable-recovery-drill';
const account='31b409b04896d260ba0fadf6cc2bb305';
const bookmark='00000001-00000002-00004e2f-0a83ea2fceebc654de0640c422be4653';
const pin=(id=legit)=>({database_name:name,database_id:id});
const ok=result=>({success:true,result});
const q=rows=>ok([{success:true,results:rows}]);
function fake(){
 const calls=[];
 let stageOfDb='empty';
 const base='/accounts/'+account+'/d1/database/'+legit;
 const responder=async(method,url,body)=>{
  calls.push({method,url,sql:body?.sql});
  if(url===base&&method==='GET')return ok({uuid:legit,name,version:'production'});
  if(url===base+'/time_travel/bookmark'&&method==='GET')return ok({bookmark});
  if(url.startsWith(base+'/time_travel/restore?bookmark=')&&method==='POST'){
    assert.equal(url,base+'/time_travel/restore?bookmark='+bookmark);
    assert.equal(stageOfDb,'changed');
    stageOfDb='restored';
    return ok({bookmark,previous_bookmark:bookmark});
  }
  assert.equal(url,base+'/query');
  assert.equal(method,'POST');
  if(body.sql.includes('sqlite_master')){
   if(stageOfDb==='empty')return q([{type:'table',name:'_cf_KV',tbl_name:'_cf_KV'}]);
   return q([{type:'table',name:'_cf_KV',tbl_name:'_cf_KV'},
             {type:'table',name:'g5_disposable_probe',tbl_name:'g5_disposable_probe'}]);
  }
  if(body.sql==='PRAGMA quick_check;')return q([{quick_check:'ok'}]);
  if(body.sql.startsWith('CREATE TABLE g5_disposable_probe')){
   assert.equal(stageOfDb,'empty');stageOfDb='created';return q([]);
  }
  if(body.sql.startsWith('INSERT INTO g5_disposable_probe (id,label) VALUES (1,')){
   assert.equal(stageOfDb,'created');stageOfDb='baseline';return q([]);
  }
  if(body.sql.startsWith('SELECT id,label')){
   if(stageOfDb==='baseline'||stageOfDb==='restored')return q([{id:1,label:'synthetic-original'}]);
   if(stageOfDb==='changed')return q([{id:1,label:'synthetic-modified'},
     {id:2,label:'synthetic-after-checkpoint'}]);
   throw Error('unexpected SELECT stage');
  }
  if(body.sql.startsWith('UPDATE g5_disposable_probe')){
   assert.equal(stageOfDb,'baseline');stageOfDb='updated';return q([]);
  }
  if(body.sql.startsWith('INSERT INTO g5_disposable_probe (id,label) VALUES (2,')){
   assert.equal(stageOfDb,'updated');stageOfDb='changed';return q([]);
  }
  throw Error('unexpected query');
 };
 return {calls,responder};
}
test('exact reviewed target must be distinct from production, staging and unreviewed placeholder',async()=>{
 const m=await modulePromise;
 assert.equal(m.approvedTarget(pin()).id,legit);
 for(const id of [prod,stage,'PENDING_SEPARATE_REVIEWED_TARGET_PR','',account]){
   assert.throws(()=>m.approvedTarget(pin(id)),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
 }
 assert.throws(()=>m.approvedTarget({...pin(),extra:'bad'}),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
 assert.throws(()=>m.approvedTarget({...pin(),database_name:'restaurant-business-prod'}),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
 assert.throws(()=>m.approvedTarget(pin(),'f'.repeat(32)),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
 const realPin=JSON.parse(fs.readFileSync(path.join(root,'cloudflare/recovery-drill-target.json'),'utf8'));
 assert.deepEqual(realPin,{database_name:name,database_id:'cc3fe86d-1c46-4c2f-a399-0ec3c46d5198'});
 assert.equal(m.approvedTarget(realPin).id,'cc3fe86d-1c46-4c2f-a399-0ec3c46d5198');
 assert.notEqual(realPin.database_id,prod);
 assert.notEqual(realPin.database_id,stage);
});
test('disposable read-only precheck is success only for a new and genuinely isolated database',async()=>{
 const m=await modulePromise,{calls,responder}=fake();
 const report=await m.inspectDisposable(pin(),responder);
 assert.equal(report.status,'G5_DISPOSABLE_D1_PRISTINE_READONLY_PASS');
 assert.equal(report.remote_restore_rehearsal_verified,false);
 assert.equal(report.production_restore_performed,false);
 assert.ok(calls.every(x=>x.method==='GET'||(x.method==='POST'&&
   ['SELECT','PRAGMA'].some(v=>x.sql?.startsWith(v)))));
});
test('mocked Cloudflare D1 controlled destructive restore completes baseline/mutate/restore/verify sequence',async()=>{
 const m=await modulePromise,{responder,calls}=fake();
 const report=await m.runDisposableDrill(pin(),responder,(()=>{let t=100;return ()=>t+=17})());
 assert.equal(report.status,'G5_DISPOSABLE_D1_REMOTE_RESTORE_VERIFIED');
 assert.equal(report.remote_restore_rehearsal_verified,true);
 assert.equal(report.production_restore_performed,false);
 assert.equal(report.recovery_signoff_granted,false);
 assert.equal(report.production_ready,false);
 assert.equal(report.observed_restore_and_verify_ms,17);
 assert.equal(calls.filter(x=>x.url.includes('/time_travel/restore')).length,1);
 assert.ok(calls.every(x=>x.url.includes(legit)&&!x.url.includes(prod)&&!x.url.includes(stage)));
 assert.doesNotMatch(JSON.stringify(report),new RegExp(bookmark.slice(0,12)));
});
test('fail closed before any writes when D1 already has tables or metadata points to production',async()=>{
 const m=await modulePromise;
 const {calls,responder}=fake();
 await assert.rejects(()=>m.runDisposableDrill(pin(),async(method,url,body)=>{
  if(body?.sql?.includes('sqlite_master'))return q([
   {type:'table',name:'_cf_KV',tbl_name:'_cf_KV'},
   {type:'table',name:'users',tbl_name:'users'}]);
  return responder(method,url,body);
 }),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
 assert.equal(calls.filter(x=>x.sql?.startsWith('CREATE')).length,0);
 await assert.rejects(()=>m.runDisposableDrill(pin(),async(method,url,body)=>{
  if(url.endsWith('/query')&&body.sql.includes('sqlite_master'))
   return q([{type:'table',name:'_cf_KV',tbl_name:'_cf_KV'}]);
  if(method==='GET'&&url.endsWith(legit))return ok({uuid:prod,name,version:'production'});
  return responder(method,url,body);
 }),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
});
test('restore response without both bookmarks or failed verification never certifies remote drill',async()=>{
 const m=await modulePromise;
 const make=()=>fake().responder;
 const bad=make();
 await assert.rejects(()=>m.runDisposableDrill(pin(),async(method,url,body)=>{
  if(url.includes('/time_travel/restore'))return ok({bookmark});
  return bad(method,url,body);
 }),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
});
test('HTTP transport permits only exact approved disposable paths, static SQL and bookmark-form restore',async()=>{
 const m=await modulePromise;
 let seen=[];
 const fetchMock=async(url,opts)=>{seen.push({url,opts});return {ok:true,text:async()=>JSON.stringify(ok({uuid:legit,name,version:'production'}))};};
 const base='/accounts/'+account+'/d1/database/'+legit;
 const reply=await m.cloudflareRequest(pin(),'synthetic_mock_token_123456','GET',base,null,fetchMock);
 assert.equal(reply.result.uuid,legit);
 await m.cloudflareRequest(pin(),'synthetic_mock_token_123456','POST',base+'/query',{sql:m.SQL.objects},fetchMock);
 assert.equal(seen[1].opts.method,'POST');
 assert.equal(JSON.parse(seen[1].opts.body).sql,m.SQL.objects);
 assert.equal(seen[0].opts.redirect,'error');
 for(const [method,url,body] of [
  ['POST','/accounts/'+account+'/d1/database/'+prod+'/time_travel/restore?bookmark='+bookmark,null],
  ['POST',base+'/query',{sql:'DELETE FROM users;'}],
  ['POST',base+'/query',{sql:m.SQL.objects,params:['hack']}],
  ['GET','https://attacker.invalid/'+base,null],
  ['POST',base+'/time_travel/restore?bookmark=bad',null],
  ['POST',base+'/time_travel/restore?bookmark='+bookmark+'&extra=1',null],
  ['DELETE',base,null]
 ])await assert.rejects(()=>m.cloudflareRequest(pin(),'synthetic_mock_token_123456',method,url,body,fetchMock),/E_G5_DISPOSABLE_D1_RESTORE_GUARD/);
 assert.equal(seen.length,2);
});
test('manual workflow contains independent write Environment, release SHA and disposable UUID approvals',()=>{
 const a=fs.readFileSync(wf,'utf8');
 assert.match(a,/^  workflow_dispatch:/m);
 assert.doesNotMatch(a,/^\s*(schedule|push|pull_request):/m);
 assert.match(a,/environment: d1-recovery-drill-readonly/);
 assert.match(a,/environment: d1-recovery-drill-write/);
 assert.match(a,/G5_DRILL_RELEASE_SHA/);
 assert.match(a,/G5_DRILL_APPROVED_DB_ID/);
 assert.match(a,/DISPOSABLE_RESTORE_AUTHORIZED/);
 assert.match(a,/binding_attestation:|G5_DRILL_BINDINGS_ATTESTED/);
 assert.match(a,/exclusive_use_attestation:|G5_DRILL_EXCLUSIVE_ATTESTED/);
 assert.match(a,/NO_DISPOSABLE_D1_WORKER_BINDING/);
 assert.match(a,/DISPOSABLE_D1_NO_CONCURRENT_USERS/);
 assert.match(a,/BINDING_ATTESTATION.*NO_DISPOSABLE_D1_WORKER_BINDING/);
 assert.match(a,/EXCLUSIVE_ATTESTATION.*DISPOSABLE_D1_NO_CONCURRENT_USERS/);
 assert.match(a,/CLOUDFLARE_D1_DRILL_READ_TOKEN/);
 assert.match(a,/CLOUDFLARE_D1_DRILL_WRITE_TOKEN/);
 assert.doesNotMatch(a,/CLOUDFLARE_PROD_D1_WRITE_TOKEN|d1-production-migration|wrangler deploy|d1 migrations apply|d1 time-travel restore PROD_DB/);
 assert.match(a,/node tools\/cloudflare-hosted-probe-preflight.mjs/);
 assert.match(a,/node tools\/cloudflare-d1-disposable-drill.mjs inspect/);
 assert.match(a,/node tools\/cloudflare-d1-disposable-drill.mjs drill/);
});
test('without enrollment and direct GitHub manual authorization, CLI fails before any API call',()=>{
 const p=spawnSync(process.execPath,[script,'drill'],{
  cwd:root,encoding:'utf8',timeout:12000,
  env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main',
   CLOUDFLARE_API_TOKEN:'synthetic_mock_token_123456',
   G5_DRILL_CONFIRM:'RESTORE_DISPOSABLE_D1_ONLY'}
 });
 assert.equal(p.status,1);
 assert.match(p.stderr,/G5_DISPOSABLE_D1_RESTORE_CHECK_FAILED/);
 assert.equal(p.stdout,'');
 assert.doesNotMatch(p.stderr,/synthetic_mock_token|b882a6e8|2c355bed/);
});

test('destructive CLI fails locally without BOTH independent per-run isolation attestations',()=>{
 const realPin=JSON.parse(fs.readFileSync(path.join(root,'cloudflare/recovery-drill-target.json'),'utf8'));
 const baseEnv={...process.env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',
  GITHUB_SHA:'a'.repeat(40),CLOUDFLARE_ACCOUNT_ID:account,
  CLOUDFLARE_API_TOKEN:'synthetic_mock_token_123456',
  G5_DRILL_CONFIRM:'RESTORE_DISPOSABLE_D1_ONLY',
  G5_DRILL_APPROVED_SHA:'a'.repeat(40),G5_DRILL_APPROVED_ID:realPin.database_id,
  G5_DRILL_APPROVAL:'DISPOSABLE_RESTORE_AUTHORIZED'};
 for(const env of [baseEnv,
  {...baseEnv,G5_DRILL_BINDINGS_ATTESTED:'NO_DISPOSABLE_D1_WORKER_BINDING'},
  {...baseEnv,G5_DRILL_EXCLUSIVE_ATTESTED:'DISPOSABLE_D1_NO_CONCURRENT_USERS'},
  {...baseEnv,G5_DRILL_BINDINGS_ATTESTED:'incorrect',G5_DRILL_EXCLUSIVE_ATTESTED:'DISPOSABLE_D1_NO_CONCURRENT_USERS'}]){
  const p=spawnSync(process.execPath,[script,'drill'],{cwd:root,encoding:'utf8',timeout:12000,env});
  assert.equal(p.status,1);
  assert.equal(p.stdout,'');
  assert.match(p.stderr,/G5_DISPOSABLE_D1_RESTORE_CHECK_FAILED/);
  assert.doesNotMatch(p.stderr,/synthetic_mock_token|cc3fe86d|b882a6e8|2c355bed/);
 }
});
