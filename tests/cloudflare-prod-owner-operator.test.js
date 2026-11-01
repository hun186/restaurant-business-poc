'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const modulePromise=import('../tools/cloudflare-prod-owner-operator.mjs');
const baseRow=()=>({
 contract_version:3,migration_total:2,migration_1:1,migration_2:1,
 locations:0,users:0,user_locations:0,sessions:0,login_attempts:0,audit_logs:0,
 tasks:0,ingredients:0,stock_moves:0,purchase_orders:0,stocktakes:0,repairs:0,
 shifts:0,leave_requests:0,training_courses:0,training_records:0,evaluations:0,
 ingredient_prices:0,menu_dishes:0,dish_ingredients:0
});
const afterRow=()=>({contract_version:3,migration_total:2,users:0,owners:0,
 sessions:0,login_attempts:0,audit_logs:0,owner_enrollment_audits:0});
function mockD1({initial='empty',onWrite=()=> 'enrolled',failWrite=false}={}){
 let phase=initial,writes=0,reads=0;
 const calls=[];
 const transport=async(url,req)=>{
  assert.match(url,/^https:\/\/api\.cloudflare\.com\/client\/v4\/accounts\/[a-f0-9]{32}\/d1\/database\/[0-9a-f-]{36}\/query$/);
  assert.equal(req.method,'POST');assert.equal(req.redirect,'error');
  assert.ok(req.signal);
  assert.match(req.headers.Authorization,/^Bearer [A-Z0-9]{24}$/);
  const body=JSON.parse(req.body);
  calls.push(body);
  if(body.batch){
   writes++;
   assert.equal(body.batch.length,2);
   assert.ok(body.batch[0].sql.startsWith('INSERT INTO users('));
   assert.match(body.batch[1].sql,/INSERT INTO audit_logs/);
   assert.doesNotMatch(req.body,/synthetic-only-password/);
   if(failWrite)throw Error('NETWORK_CONTAINS_POSSIBLY_SECRET');
   phase=onWrite();
   return {ok:true,status:200,json:async()=>({success:true,result:[
    {success:true,results:[]},{success:true,results:[]}
   ]})};
  }
  reads++;
  assert.equal(typeof body.sql,'string');assert.equal(Object.keys(body).join(','),'sql');
  let row;
  if(body.sql.includes('FROM cloud_schema_contract')&&body.sql.includes('migration_1')){
   row=baseRow();
   if(phase==='enrolled'||phase==='partial'){row.users=1;row.audit_logs=phase==='enrolled'?1:0;}
  }else if(body.sql.includes('owner_enrollment_audits')){
   row=afterRow();
   if(phase==='enrolled'||phase==='partial'){
    row.users=1;row.owners=1;row.audit_logs=phase==='enrolled'?1:0;
    row.owner_enrollment_audits=phase==='enrolled'?1:0;
   }
  }else if(body.sql==='PRAGMA quick_check;')row={quick_check:'ok'};
  else if(body.sql==='PRAGMA foreign_key_check;')row=null;
  else throw Error('UNKNOWN_SQL_IN_TEST');
  return {ok:true,status:200,json:async()=>({success:true,result:[
   {success:true,results:row===null?[]:[row]}
  ]})};
 };
 return {transport,calls,get reads(){return reads},get writes(){return writes}};
}
const TOKEN='A'.repeat(24);
test('fixed config target is exact production only and never preview or separate DB',async()=>{
 const m=await modulePromise;
 const t=m.localProductionTarget();
 assert.equal(t.databaseId,'b882a6e8-0e56-49a6-bd41-1a6cadd726c9');
 assert.equal(t.accountId,'31b409b04896d260ba0fadf6cc2bb305');
});
test('read-only operator checks v3 Owner readiness without invoking write',async()=>{
 const m=await modulePromise,sim=mockD1();
 const x=await m.inspectProductionOwner(TOKEN,sim.transport);
 assert.equal(x.status,'PRODUCTION_OWNER_READY_TO_ENROLL_READONLY');
 assert.equal(sim.reads,4);assert.equal(sim.writes,0);
 assert.deepEqual(sim.calls.map(x=>Object.keys(x)),[['sql'],['sql'],['sql'],['sql']]);
});
test('one explicit Owner grant submits exactly one remote batch then verifies audited Owner',async()=>{
 const m=await modulePromise,sim=mockD1();
 const x=await m.enrollOneProductionOwner({
  token:TOKEN,password:'synthetic-only-password-12345',
  approval:'CREATE_ONE_PRODUCTION_OWNER_ONCE',transport:sim.transport
 });
 assert.equal(x.status,'PRODUCTION_OWNER_CREATED_AUDITED_READONLY_VERIFIED');
 assert.equal(x.owner_count,1);assert.equal(x.owner_enrollment_audits,1);
 assert.equal(x.login_enabled,false);assert.equal(x.write_attempts,1);
 assert.equal(sim.writes,1);assert.equal(sim.reads,8);
 assert.doesNotMatch(JSON.stringify(x),/password|hash|salt|token|account_id|database_id/i);
});
test('zero remote writes on bad approval, bad password or already enrolled',async()=>{
 const m=await modulePromise,sim=mockD1();
 for(const approval of ['','YES','CREATE_ONE_PRODUCTION_OWNER'])await assert.rejects(()=>
  m.enrollOneProductionOwner({token:TOKEN,password:'synthetic-only-password-12345',
   approval,transport:sim.transport}),/E_PRODUCTION_OWNER_OPERATOR/);
 await assert.rejects(()=>m.enrollOneProductionOwner({token:TOKEN,password:'short',
  approval:'CREATE_ONE_PRODUCTION_OWNER_ONCE',transport:sim.transport}),/E_PRODUCTION_OWNER_OPERATOR/);
 assert.equal(sim.writes,0);assert.equal(sim.reads,0);
 const enrolled=mockD1({initial:'enrolled'});
 await assert.rejects(()=>m.enrollOneProductionOwner({token:TOKEN,password:'synthetic-only-password-12345',
  approval:'CREATE_ONE_PRODUCTION_OWNER_ONCE',transport:enrolled.transport}),/E_PRODUCTION_OWNER_OPERATOR/);
 assert.equal(enrolled.writes,0);
});
test('missing audit, partial D1 writes and uncertain network errors never retry writes',async()=>{
 const m=await modulePromise;
 for(const sim of [
  mockD1({onWrite:()=> 'partial'}),
  mockD1({failWrite:true}),
  mockD1({onWrite:()=> 'empty'})
 ]){
  await assert.rejects(()=>m.enrollOneProductionOwner({
   token:TOKEN,password:'synthetic-only-password-12345',
   approval:'CREATE_ONE_PRODUCTION_OWNER_ONCE',transport:sim.transport
  }),/E_PRODUCTION_OWNER_OPERATOR/);
  assert.equal(sim.writes,1,'never retry a remote write');
 }
});
test('malformed HTTP/API output is denied and never exposes a secret',async()=>{
 const m=await modulePromise,sim=mockD1();
 const invalid=[
  async()=>({ok:false,status:403,json:async()=>({error:'TOKEN_LEAK'})}),
  async()=>({ok:true,status:200,json:async()=>({success:false,result:[]})}),
  async()=>({ok:true,status:200,json:async()=>({success:true,result:[]})}),
  async()=>{throw Error('TOKEN_LEAK')}
 ];
 for(const t of invalid){
  await assert.rejects(()=>m.queryD1(TOKEN,{sql:'SELECT 1'},1,t),
   e=>e.message==='E_PRODUCTION_OWNER_OPERATOR');
 }
 assert.equal(sim.writes,0);
});
test('CLI never accepts non-TTY redirected secret; error has no credentials',()=>{
 const r=spawnSync(process.execPath,['tools/cloudflare-prod-owner-operator.mjs','--enroll'],{
  cwd:root,encoding:'utf8',timeout:10000,input:'synthetic-only-password-12345',
  env:{...process.env,CLOUDFLARE_API_TOKEN:'DELIBERATE_SENTINEL_SECRET'}
 });
 assert.notEqual(r.status,0);
 assert.match(r.stderr,/E_PRODUCTION_OWNER_OPERATOR/);
 assert.doesNotMatch(r.stdout+r.stderr,/DELIBERATE_SENTINEL_SECRET|synthetic-only-password/);
});
test('SQL importer splits exact two guarded INSERTs, never outputs raw password',async()=>{
 const m=await modulePromise;
 const owner=await import('../tools/cloudflare-production-owner.mjs');
 const sql=await owner.buildProductionOwnerSql('synthetic-only-password-12345');
 const batch=m.ownerSqlBatch(sql);
 assert.equal(batch.length,2);
 assert.doesNotMatch(JSON.stringify(batch),/synthetic-only-password/);
 for(const invalid of ['DROP TABLE users;','INSERT INTO users(id) SELECT 1;','SELECT * FROM users;']){
  assert.throws(()=>m.ownerSqlBatch(invalid),/E_PRODUCTION_OWNER_OPERATOR/);
 }
});

test('operator launcher files contain no password/token literals, refer only to local CLI',()=>{
 const fs=require('node:fs');
 for(const name of ['run-production-owner-operator.bat','run-production-owner-operator.sh']){
  const s=fs.readFileSync(path.join(root,name),'utf8');
  assert.match(s,/cloudflare-prod-owner-operator\.mjs/);
  assert.match(s,/--check/);assert.match(s,/--enroll/);
  assert.doesNotMatch(s,/CLOUDFLARE_(API_TOKEN|PROD_D1_WRITE_TOKEN)=|PRODUCTION_OWNER_PASSWORD=/);
  assert.doesNotMatch(s,/wrangler d1 execute|time-travel restore|d1 migrations apply/);
 }
});

test('read-only operator reports only redacted HTTP/API diagnostic categories',async()=>{
 const m=await modulePromise;
 const scenarios=[
  [401,'HTTP_401'],[403,'HTTP_403'],[404,'HTTP_404'],
  [429,'HTTP_429'],[503,'HTTP_5XX'],[418,'HTTP_OTHER']
 ];
 for(const [status,reason] of scenarios){
  await assert.rejects(()=>m.inspectProductionOwner(TOKEN,async()=>({
   ok:false,status,json:async()=>({message:'DO_NOT_PRINT_PRIVATE_TOKEN'})
  })),error=>{
   assert.equal(error.message,'E_PRODUCTION_OWNER_OPERATOR');
   assert.equal(error.safePhase,'READ_BEFORE');
   assert.equal(error.safeReason,reason);
   assert.doesNotMatch(JSON.stringify({reason:error.safeReason,phase:error.safePhase}),
      /DO_NOT_PRINT_PRIVATE_TOKEN/);
   return true;
  });
 }
});
test('read-only operator distinguishes malformed JSON and API response without body leakage',async()=>{
 const m=await modulePromise;
 for(const [transport,reason] of [
  [async()=>({ok:true,status:200,json:async()=>{throw Error('PRIVATE_BODY');}}),'INVALID_JSON'],
  [async()=>({ok:true,status:200,json:async()=>({success:false,result:[],errors:[{message:'PRIVATE_BODY'}]})}),'API_REJECTED'],
  [async()=>({ok:true,status:200,json:async()=>({success:true,result:[]})}),'RESPONSE_SHAPE'],
  [async()=>{throw Error('PRIVATE_ERROR');},'NETWORK_OR_TIMEOUT']
 ]){
  await assert.rejects(()=>m.inspectProductionOwner(TOKEN,transport),error=>{
   assert.equal(error.message,'E_PRODUCTION_OWNER_OPERATOR');
   assert.equal(error.safePhase,'READ_BEFORE');
   assert.equal(error.safeReason,reason);
   assert.doesNotMatch(JSON.stringify(error),/PRIVATE_/);
   return true;
  });
 }
});
test('read-only operator identifies the failing query and never sends D1 writes',async()=>{
 const m=await modulePromise;
 const tasks=['READ_BEFORE','READ_AFTER','READ_QUICK','READ_FOREIGN'];
 for(let i=0;i<4;i++){
  let queries=0;
  const sim=mockD1();
  const transport=async(url,req)=>{
   if(queries++===i)return {ok:false,status:403};
   return sim.transport(url,req);
  };
  await assert.rejects(()=>m.inspectProductionOwner(TOKEN,transport),error=>{
   assert.equal(error.safePhase,tasks[i]);
   assert.equal(error.safeReason,'HTTP_403');return true;
  });
  assert.equal(sim.writes,0);
 }
 const malformed=mockD1();
 const bad=async(url,req)=>{
  const result=await malformed.transport(url,req);
  const body=JSON.parse(req.body);
  if(body.sql.includes('migration_1'))
    return {ok:true,status:200,json:async()=>({success:true,result:[
      {success:true,results:[{contract_version:999}]}
    ]})};
  return result;
 };
 await assert.rejects(()=>m.inspectProductionOwner(TOKEN,bad),error=>{
  assert.equal(error.safePhase,'READ_VALIDATE');
  assert.equal(error.safeReason,'DATABASE_STATE');return true;
 });
 assert.equal(malformed.writes,0);
});
test('short or missing token is rejected before networking with safe phase',async()=>{
 const m=await modulePromise;
 let calls=0;
 const transport=async()=>{calls++;throw Error('NEVER_USE_NETWORK');};
 await assert.rejects(()=>m.inspectProductionOwner('abc',transport),error=>{
  assert.equal(error.safePhase,'READ_BEFORE');
  assert.equal(error.safeReason,'TOKEN_FORMAT');return true;
 });
 assert.equal(calls,0);
});
