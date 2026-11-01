'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const mod=import('../tools/cloudflare-d1-rest-batch-lab.mjs');
const ROOT=path.resolve(__dirname,'..');
const UUID='aabbccdd-1111-4111-8111-123456789abc',TOKEN='A'.repeat(28);
const META={success:true,result:{name:'restaurant-business-owner-batch-lab-20261101',uuid:UUID}};
const good=result=>({status:200,ok:true,json:async()=>({success:true,result})});
function sim({name=META.result.name,uuid=UUID,existing=[],atomic=true,
  failureText='D1_ERROR: UNIQUE constraint failed: owner_batch_lab.id',
  deny=false,discardResult=false}={}){
 let table=null,metaReads=0,reads=0,writes=0,batches=0;
 const ids=new Set(),sqlHistory=[];
 const transport=async(url,req)=>{
  assert.equal(req.redirect,'error');
  assert.equal(req.headers.Authorization,'Bearer '+TOKEN);
  assert.match(url,new RegExp('^https://api.cloudflare.com/client/v4/accounts/[a-f0-9]{32}/d1/database/'+UUID));
  if(deny)return {status:403,ok:false,json:async()=>({success:false,errors:[{message:'SECRET'}]})};
  if(req.method==='GET'){
   metaReads++;
   return {status:200,ok:true,json:async()=>({success:true,result:{name,uuid}})};
  }
  assert.equal(req.method,'POST');assert.match(url,/\/query$/);
  const body=JSON.parse(req.body);
  assert.deepEqual(Object.keys(body),[body.batch?'batch':'sql']);
  if(body.batch){
   batches++;writes++;assert.equal(body.batch.length,2);
   assert.ok(body.batch.every(q=>q.sql.startsWith('INSERT INTO owner_batch_lab_')));
   const first=Number(body.batch[0].sql.match(/VALUES \((\d),/)[1]);
   const second=Number(body.batch[1].sql.match(/VALUES \((\d),/)[1]);
   if(first===second){
    if(!atomic)ids.add(first);
    return {status:200,ok:true,json:async()=>({success:false,
      errors:[{code:7500,message:failureText}],result:[]})};
   }
   ids.add(first);ids.add(second);
   return good([
    {success:true,results:[]},{success:true,results:[]}
   ]);
  }
  const sql=body.sql;sqlHistory.push(sql);
  if(sql.startsWith('SELECT name FROM sqlite_master'))return good([{success:true,
    results:existing.map(name=>({name}))}]);
  if(sql.startsWith('CREATE TABLE owner_batch_lab_')){
   writes++;assert.equal(table,null);table=sql.match(/CREATE TABLE (\w+)/)[1];
   assert.match(table,/^owner_batch_lab_[0-9a-f]{16}$/);
   return good([{success:true,results:[]}]);
  }
  if(sql.startsWith('SELECT COUNT(*) AS n FROM owner_batch_lab_')){
   reads++;
   assert.ok(table);assert.ok(sql.includes(table));
   const n=sql.includes('WHERE id=3')?(ids.has(3)?1:0):ids.size;
   return good([{success:true,results:[{n}]}]);
  }
  throw Error('UNEXPECTED_SQL_IN_SIM');
 };
 return {transport,get metaReads(){return metaReads},get writes(){return writes},
  get batches(){return batches},get reads(){return reads},get queries(){return sqlHistory}};
}
function expectPhase(action,phase){
 return assert.rejects(action,e=>e.message==='E_DISPOSABLE_D1_BATCH_LAB'&&e.phase===phase);
}
test('hard-stop on real Production, Staging, Recovery Drill UUID and invalid IDs',async()=>{
 const m=await mod;
 for(const id of [
  'b882a6e8-0e56-49a6-bd41-1a6cadd726c9',
  '2c355bed-d9c3-449c-aa9b-1018f3bc1177',
  'cc3fe86d-1c46-4c2f-a399-0ec3c46d5198'
 ])assert.throws(()=>m.assertScratchUuid(id),e=>e.phase==='PROTECTED_TARGET');
 for(const id of ['','non-uuid','AAAAAAAA-1111-1111-1111-123456789abc'])
  assert.throws(()=>m.assertScratchUuid(id),e=>e.phase==='TARGET');
 assert.equal(m.assertScratchUuid(UUID),UUID);
});
test('rejects untrusted scratch name, mismatched identity, prepopulated tables',async()=>{
 const m=await mod;
 for(const name of ['restaurant-business-prod','restaurant-business-staging',
  'restaurant-business-owner-batch-lab','restaurant-business-owner-batch-lab-!bad']){
  const t=sim({name});
  await expectPhase(()=>m.preflightScratch({uuid:UUID,token:TOKEN,transport:t.transport}),
    'TARGET_METADATA');
  assert.equal(t.writes,0);
 }
 const t=sim({uuid:'00000000-0000-0000-0000-000000000001'});
 await expectPhase(()=>m.preflightScratch({uuid:UUID,token:TOKEN,transport:t.transport}),
   'TARGET_METADATA');assert.equal(t.writes,0);
 for(const tables of [['users'],['d1_migrations'],['owner_batch_lab_old']]){
  const q=sim({existing:tables});
  await expectPhase(()=>m.preflightScratch({uuid:UUID,token:TOKEN,transport:q.transport}),
    'SCRATCH_NOT_EMPTY');assert.equal(q.writes,0);
 }
});
test('metadata and scratch emptiness can be checked without ANY writes',async()=>{
 const m=await mod,t=sim({existing:['_cf_KV']});
 const x=await m.preflightScratch({uuid:UUID,token:TOKEN,transport:t.transport});
 assert.equal(x.status,'SCRATCH_D1_EMPTY_VERIFIED');
 assert.equal(x.production_write_performed,false);
 assert.equal(t.writes,0);assert.equal(t.metaReads,1);
});
test('fresh scratch test proves one failing unique-constraint batch rollback',async()=>{
 const m=await mod,t=sim();
 const result=await m.testDisposableRollback({uuid:UUID,token:TOKEN,
  approval:'RUN_DISPOSABLE_D1_ROLLBACK_EXPERIMENT',transport:t.transport,
  uniqueId:()=> 'cafebabedeadbeef'});
 assert.deepEqual(result,{status:'DISPOSABLE_D1_REST_BATCH_ROLLBACK_PASS',
   control_rows:2,rollback_extra_rows:0,production_write_performed:false,
   disposable_only:true,actual_remote_d1_test:true,scratch_table_retained_for_inspection:true});
 assert.equal(t.writes,3);assert.equal(t.batches,2);assert.equal(t.reads,3);
 assert.doesNotMatch(JSON.stringify(result),/TOKEN|secret|password|account_id|database_id/);
});
test('FIRST statement committed despite SECOND unique violation => FAIL CLOSED',async()=>{
 const m=await mod,t=sim({atomic:false});
 await expectPhase(()=>m.testDisposableRollback({uuid:UUID,token:TOKEN,
  approval:'RUN_DISPOSABLE_D1_ROLLBACK_EXPERIMENT',transport:t.transport,
  uniqueId:()=> 'cafebabedeadbeef'}),'ROLLBACK_NOT_ATOMIC');
 assert.equal(t.batches,2);
});
test('API rejecting batch without UNIQUE execution evidence is not rollback proof',async()=>{
 const m=await mod,t=sim({failureText:'invalid request body'});
 await expectPhase(()=>m.testDisposableRollback({uuid:UUID,token:TOKEN,
  approval:'RUN_DISPOSABLE_D1_ROLLBACK_EXPERIMENT',transport:t.transport,
  uniqueId:()=> 'cafebabedeadbeef'}),'FAILURE_NOT_PROVEN_UNIQUE');
});
test('no approval or malformed IDs never reach remote write',async()=>{
 const m=await mod,t=sim();
 await expectPhase(()=>m.testDisposableRollback({uuid:UUID,token:TOKEN,
  approval:'',transport:t.transport}),'APPROVAL');
 assert.equal(t.metaReads,0);assert.equal(t.writes,0);
 await expectPhase(()=>m.testDisposableRollback({uuid:UUID,token:TOKEN,
  approval:'RUN_DISPOSABLE_D1_ROLLBACK_EXPERIMENT',transport:t.transport,
  uniqueId:()=> '../../production'}),'IDENTIFIER');
 // The target preflight is read-only and runs before identifier generation.
 assert.equal(t.writes,0);
});
test('a permission denial refuses all queries and writes, never reflects API secret',async()=>{
 const m=await mod,t=sim({deny:true});
 await expectPhase(()=>m.preflightScratch({uuid:UUID,token:TOKEN,transport:t.transport}),
  'HTTP_403');
 assert.equal(t.writes,0);
});
test('CLI refuses non-interactive and never prints token sent via redirected input',()=>{
 const p=spawnSync(process.execPath,['tools/cloudflare-d1-rest-batch-lab.mjs',
  '--test',UUID],{cwd:ROOT,encoding:'utf8',timeout:10000,input:TOKEN});
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/E_DISPOSABLE_D1_BATCH_LAB/);
 assert.doesNotMatch(p.stdout+p.stderr,new RegExp(TOKEN));
});
test('Windows/Linux launcher contains only local lab CLI and no Production writes',()=>{
 for(const name of ['run-disposable-d1-batch-lab.bat','run-disposable-d1-batch-lab.sh']){
  const content=fs.readFileSync(path.join(ROOT,name),'utf8');
  assert.match(content,/cloudflare-d1-rest-batch-lab\.mjs/);
  assert.match(content,/--probe/);assert.match(content,/--test/);
  assert.doesNotMatch(content,/prod-owner-operator|CLOUDFLARE_API_TOKEN=|wrangler d1 execute/);
 }
});
