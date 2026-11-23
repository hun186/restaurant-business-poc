'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const mod=import('../tools/cloudflare-stock-v4-disposable-inspect.mjs');
const NAME='restaurant-business-stock-v4-disposable';
const ACCOUNT='31b409b04896d260ba0fadf6cc2bb305';
const PROD='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
const STAGE='2c355bed-d9c3-449c-aa9b-1018f3bc1177';
const G5='04566a27-cd95-4415-9bd7-c3e19d60ab6c';
const OLD_G5='cc3fe86d-1c46-4c2f-a399-0ec3c46d5198';
const G6='11112222-3333-4444-8555-666677778888';
const pin=id=>({database_name:NAME,database_id:id});
const old={database_name:'restaurant-business-g5-disposable-recovery-drill',database_id:G5};
const good=x=>({success:true,result:x});
const q=results=>good([{success:true,results}]);
const bookmark='00000001-00000002-00004e2f-0a83ea2fceebc654de0640c422be4653';
function simulator({metadata={},objects=[{type:'table',name:'_cf_KV',tbl_name:'_cf_KV'}],
 invalidQuick=false,invalidBookmark=false}={}){
 const calls=[],base='/accounts/'+ACCOUNT+'/d1/database/'+G6;
 const io=async(method,url,body)=>{
  calls.push({method,url,body});
  if(method==='GET'&&url===base)return good({uuid:G6,name:NAME,version:'production',...metadata});
  if(method==='GET'&&url===base+'/time_travel/bookmark')
   return good({bookmark:invalidBookmark?'broken':bookmark});
  assert.equal(url,base+'/query');assert.equal(method,'POST');
  if(body?.sql?.includes('sqlite_master'))return q(objects);
  if(body?.sql==='PRAGMA quick_check;')return q([{quick_check:invalidQuick?'failed':'ok'}]);
  throw Error('UNEXPECTED_REQUEST');
 };
 return {calls,io};
}
test('disabled G6 placeholder and all protected D1 identifiers fail closed',async()=>{
 const m=await mod;
 for(const id of [PROD,STAGE,G5,OLD_G5,'PENDING_SEPARATE_REVIEWED_TARGET_PR',
  '','not-a-uuid']){
  assert.throws(()=>m.reviewedTarget(pin(id),old),/E_STOCK_V4_DISPOSABLE_TARGET_INSPECT/);
 }
 assert.equal(m.reviewedTarget(pin(G6),old).id,G6);
 for(const other of [
  {...pin(G6),database_name:'restaurant-business-prod'},
  {...pin(G6),extra:'bad'}
 ])assert.throws(()=>m.reviewedTarget(other,old),/E_STOCK_V4_DISPOSABLE_TARGET_INSPECT/);
 assert.throws(()=>m.reviewedTarget(pin(G6),old,'not-the-account'),
  /E_STOCK_V4_DISPOSABLE_TARGET_INSPECT/);
 const file=JSON.parse(fs.readFileSync(
  path.join(root,'cloudflare/stock-v4-disposable-target.json'),'utf8'));
 assert.deepEqual(file,pin('909037ca-bb9d-45d3-b090-bc2af0e5951f'));
 assert.equal(m.reviewedTarget(file,old).id,'909037ca-bb9d-45d3-b090-bc2af0e5951f');
 assert.notEqual(file.database_id,PROD);
 assert.notEqual(file.database_id,STAGE);
 assert.notEqual(file.database_id,G5);
 assert.notEqual(file.database_id,OLD_G5);
});
test('G6 readonly inspect checks exact identity/empty schema and never sends write SQL',async()=>{
 const m=await mod,{calls,io}=simulator();
 const result=await m.inspectIsolated(pin(G6),io,old);
 assert.equal(result.status,'STOCK_V4_DISPOSABLE_PRISTINE_READONLY_PASS');
 assert.equal(result.empty_schema_verified,true);
 assert.equal(result.remote_v4_migration_performed,false);
 assert.equal(result.remote_restore_performed,false);
 assert.equal(result.production_write_performed,false);
 assert.equal(result.no_direct_worker_binding_certified,false);
 assert.equal(result.exclusive_use_verified,false);
 assert.equal(calls.length,4);
 assert.ok(calls.every(c=>(c.method==='GET'&&c.body===null)||
  (c.method==='POST'&&/^(SELECT|PRAGMA)/.test(c.body?.sql))));
 assert.doesNotMatch(JSON.stringify(result),new RegExp(G6.slice(0,8)));
});
test('existing business table, unexpected index or broken identity denies',async()=>{
 const m=await mod;
 for(const options of [
  {objects:[{type:'table',name:'_cf_KV',tbl_name:'_cf_KV'},
   {type:'table',name:'stock_moves',tbl_name:'stock_moves'}]},
  {objects:[{type:'table',name:'_cf_KV',tbl_name:'_cf_KV'},
   {type:'index',name:'fake_index',tbl_name:'stock_moves'}]},
  {metadata:{uuid:PROD}},
  {invalidQuick:true},{invalidBookmark:true}
 ]){
  const t=simulator(options);
  await assert.rejects(()=>m.inspectIsolated(pin(G6),t.io,old),
   /E_STOCK_V4_DISPOSABLE_TARGET_INSPECT/);
  assert.equal(t.calls.filter(c=>c.body?.sql?.startsWith('CREATE')).length,0);
 }
});
test('real SQLite sqlite_master rejects sqliteXbusiness but ignores exact sqlite_ internals',async t=>{
 const m=await mod,db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 // AUTOINCREMENT creates sqlite_sequence, a legitimate SQLite-internal table.
 db.exec('CREATE TABLE _cf_KV (id INTEGER PRIMARY KEY AUTOINCREMENT, marker TEXT)');
 const base='/accounts/'+ACCOUNT+'/d1/database/'+G6;
 const io=async(method,url,body)=>{
  if(method==='GET'&&url===base)
   return good({uuid:G6,name:NAME,version:'production'});
  if(method==='GET'&&url===base+'/time_travel/bookmark')return good({bookmark});
  assert.equal(url,base+'/query');
  assert.equal(method,'POST');
  assert.ok([m.SQL.objects,m.SQL.quick].includes(body.sql));
  return q(db.prepare(body.sql).all());
 };
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='sqlite_sequence'").all().length===1);
 assert.deepEqual(db.prepare(m.SQL.objects).all().map(row=>row.name),['_cf_KV']);
 assert.equal((await m.inspectIsolated(pin(G6),io,old)).empty_schema_verified,true);
 // Underscore is a SQL LIKE wildcard: 'sqliteXbusiness' was previously hidden.
 db.exec('CREATE TABLE sqliteXbusiness (id INTEGER PRIMARY KEY)');
 assert.ok(db.prepare(m.SQL.objects).all().some(row=>row.name==='sqliteXbusiness'));
 await assert.rejects(()=>m.inspectIsolated(pin(G6),io,old),
  /E_STOCK_V4_DISPOSABLE_TARGET_INSPECT/);
});
test('API transport only allows approved G6 metadata/bookmark and fixed readonly SQL',async()=>{
 const m=await mod,base='/accounts/'+ACCOUNT+'/d1/database/'+G6;
 const seen=[],token='synthetic_not_a_real_token_123456789';
 const fake=async(url,opts)=>{seen.push({url,opts});
  return {ok:true,text:async()=>JSON.stringify(good({}))};};
 await m.cloudflareRead(pin(G6),token,'GET',base,null,fake,old);
 await m.cloudflareRead(pin(G6),token,'POST',base+'/query',{sql:m.SQL.objects},fake,old);
 assert.equal(seen.length,2);
 assert.equal(seen[1].opts.method,'POST');
 assert.equal(JSON.parse(seen[1].opts.body).sql,m.SQL.objects);
 for(const [method,url,body] of [
  ['GET','/accounts/'+ACCOUNT+'/d1/database/'+PROD,null],
  ['POST',base+'/query',{sql:'DROP TABLE users'}],
  ['POST',base+'/query',{sql:'SELECT * FROM users'}],
  ['POST',base+'/time_travel/restore?bookmark='+bookmark,null],
  ['DELETE',base,null],
  ['GET',base,{sql:m.SQL.objects}],
  ['POST',base+'/query',{sql:m.SQL.objects,extra:'bad'}]
 ])await assert.rejects(()=>
  m.cloudflareRead(pin(G6),token,method,url,body,fake,old),
  /E_STOCK_V4_DISPOSABLE_TARGET_INSPECT/);
 assert.equal(seen.length,2);
});
test('G6 CLI isolated placeholder fixture refuses before ANY Cloudflare fetch',t=>{
 const temp=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'g6-placeholder-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const toolDir=path.join(temp,'tools'),cfDir=path.join(temp,'cloudflare');
 fs.mkdirSync(toolDir,{recursive:true});
 fs.mkdirSync(cfDir,{recursive:true});
 for(const name of ['cloudflare-stock-v4-disposable-inspect.mjs',
   'check-cloudflare-staging.mjs'])
  fs.copyFileSync(path.join(root,'tools',name),path.join(toolDir,name));
 const placeholder={database_name:NAME,database_id:'PENDING_SEPARATE_REVIEWED_TARGET_PR'};
 fs.writeFileSync(path.join(cfDir,'stock-v4-disposable-target.json'),
  JSON.stringify(placeholder)+'\n','utf8');
 fs.copyFileSync(path.join(root,'cloudflare/recovery-drill-target.json'),
  path.join(cfDir,'recovery-drill-target.json'));
 // An ESM preloader stubs *all* fetch calls and writes an exit counter.
 // This test must fail if the CLI ever reaches a network operation.
 const counter=path.join(temp,'fetch-count.txt'),preload=path.join(temp,'deny-fetch.mjs');
 fs.writeFileSync(preload,[
  "import fs from 'node:fs';",
  'let calls=0;',
  "globalThis.fetch=async()=>{calls++;throw Error('NETWORK_BLOCKED_IN_TEST');};",
  "process.on('exit',()=>fs.writeFileSync(process.env.G6_CALL_COUNTER_FILE,String(calls)));"
 ].join('\n')+'\n','utf8');
 const child=path.join(toolDir,'cloudflare-stock-v4-disposable-inspect.mjs');
 const r=spawnSync(process.execPath,['--import',preload,child,'inspect'],{
  cwd:temp,encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',
   GITHUB_REF:'refs/heads/main',
   STOCK_V4_DISPOSABLE_CONFIRM:'CHECK_STOCK_V4_DISPOSABLE_READONLY',
   CLOUDFLARE_ACCOUNT_ID:ACCOUNT,
   CLOUDFLARE_API_TOKEN:'synthetic_not_a_real_token_123456789',
   G6_CALL_COUNTER_FILE:counter}
 });
 assert.equal(r.status,1,r.stderr);
 assert.equal(r.stdout,'');
 assert.match(r.stderr,/E_STOCK_V4_DISPOSABLE_TARGET_INSPECT/);
 assert.ok(!r.stderr.includes('synthetic_not_a_real_token') &&
  !r.stderr.includes('/d1/database/'));
 assert.equal(fs.readFileSync(counter,'utf8'),'0',
  'even a failed authentication request is an unexpected network call');
});
test('workflow can run only main / approved readonly input and never reads write token',()=>{
 const wf=fs.readFileSync(
  path.join(root,'.github/workflows/d1-stock-v4-disposable-inspect.yml'),'utf8');
 assert.match(wf,/workflow_dispatch:/);
 assert.match(wf,/refs\/heads\/main/);
 assert.match(wf,/CHECK_STOCK_V4_DISPOSABLE_READONLY/);
 assert.match(wf,/environment: d1-recovery-drill-readonly/);
 assert.match(wf,/cloudflare-hosted-probe-preflight\.mjs/);
 assert.match(wf,/CLOUDFLARE_D1_DRILL_READ_TOKEN/);
 assert.doesNotMatch(wf,/WRANGLE|migrations apply|CLOUDFLARE_D1_DRILL_WRITE_TOKEN|time_travel\/restore/);
 assert.ok(wf.indexOf('cloudflare-hosted-probe-preflight.mjs')<
  wf.indexOf('CLOUDFLARE_D1_DRILL_READ_TOKEN'));
});
