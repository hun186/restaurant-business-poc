'use strict';
// The plan is executed only inside ephemeral node:sqlite. No Cloudflare calls.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const imported=import('../tools/cloudflare-stock-v4-g6-migration-plan.mjs');
const postflight=import('../tools/cloudflare-stock-v4-g6-postflight.mjs');
const pin=JSON.parse(fs.readFileSync(path.join(root,
 'cloudflare/stock-v4-disposable-target.json'),'utf8'));
const base='/accounts/31b409b04896d260ba0fadf6cc2bb305/d1/database/'+pin.database_id;
const reply=rows=>({success:true,result:[{success:true,results:rows}]});
const synthetic=t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON;');
 return db;
};
const verify=async(db)=>{
 const {verifyG6V4Postflight,SQL}=await postflight;
 let calls=0;
 const result=await verifyG6V4Postflight(pin,async(method,url,body)=>{
  calls++;
  if(method==='GET'){
   assert.equal(url,base);
   assert.equal(body,null);
   return {success:true,result:{
    name:pin.database_name,uuid:pin.database_id,version:'production'
   }};
  }
  assert.equal(method,'POST');
  assert.equal(url,base+'/query');
  assert.ok(Object.values(SQL).includes(body.sql));
  assert.match(body.sql,/^(SELECT|PRAGMA)\b/);
  return reply(db.prepare(body.sql).all());
 });
 assert.equal(calls,Object.keys(SQL).length+1);
 return result;
};
test('plan is exactly four pinned ordered phases and never exposes raw SQL or UUID in receipt',async()=>{
 const {buildG6SyntheticPlan,publicPlanReceipt}=await imported;
 const p=buildG6SyntheticPlan(),r=publicPlanReceipt(p);
 assert.deepEqual(p.map(x=>x.name),[
  'v3-schema','v3-synthetic-history','v4-schema','v4-synthetic-history'
 ]);
 assert.deepEqual(p.map(x=>x.expectedMigrationReceipts),[2,2,3,3]);
 assert.equal(r.status,'G6_SYNTHETIC_VERSIONED_PLAN_ONLY');
 assert.equal(r.cloudflare_requests_made,0);
 assert.equal(r.remote_sql_executed,false);
 assert.equal(r.write_authorization_granted,false);
 assert.equal(r.operator_binding_attestation_verified,false);
 assert.equal(r.stages.length,4);
 assert.deepEqual(buildG6SyntheticPlan().map(x=>x.sha256),p.map(x=>x.sha256));
 assert.doesNotMatch(JSON.stringify(r),/909037ca|g6-fixture|CREATE TABLE|INSERT INTO|BEGIN/);
 for(const phase of p){
  assert.match(phase.sha256,/^[a-f0-9]{64}$/);
  assert.ok(phase.bytes>100);
  assert.equal(phase.sql.match(/\bBEGIN IMMEDIATE\b/g)?.length,1);
  assert.equal(phase.sql.match(/\bCOMMIT\b/g)?.length,1);
  assert.equal(phase.sql.trim().startsWith('BEGIN IMMEDIATE;'),true);
  assert.equal(phase.sql.trim().endsWith('COMMIT;'),true);
 }
 assert.match(p[0].sql,/VALUES\(1,'0001_initial_v3\.sql'\)/);
 assert.match(p[0].sql,/VALUES\(2,'0002_login_attempts_window_indexes\.sql'\)/);
 assert.match(p[2].sql,/VALUES\(3,'0004_stock_move_kinds\.sql'\)/);
 assert.doesNotMatch(p.map(x=>x.sql).join('\n'),/restaurant-business-prod|b882a6e8|CLOUDFLARE_API_TOKEN/);
});
test('execute exactly proposed phases in isolated SQLite and pass previously merged G6 remote postflight',async t=>{
 const {buildG6SyntheticPlan}=await imported;
 const db=synthetic(t),steps=buildG6SyntheticPlan();
 db.exec(steps[0].sql);
 assert.deepEqual(db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),[
  {id:1,name:'0001_initial_v3.sql'},
  {id:2,name:'0002_login_attempts_window_indexes.sql'}
 ]);
 assert.deepEqual(db.prepare('SELECT contract_version FROM cloud_schema_contract').all(),
  [{contract_version:3}]);
 db.exec(steps[1].sql);
 assert.deepEqual(db.prepare('SELECT id,move_type,qty_delta FROM stock_moves ORDER BY id').all(),[
  {id:'g6-m01',move_type:'purchase',qty_delta:10},
  {id:'g6-m02',move_type:'usage',qty_delta:-2}
 ]);
 db.exec(steps[2].sql);
 assert.deepEqual(db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all(),[
  {id:1,name:'0001_initial_v3.sql'},
  {id:2,name:'0002_login_attempts_window_indexes.sql'},
  {id:3,name:'0004_stock_move_kinds.sql'}
 ]);
 db.exec(steps[3].sql);
 const pass=await verify(db);
 assert.equal(pass.status,'G6_STOCK_V4_REMOTE_READONLY_POSTFLIGHT_PASS');
 assert.equal(pass.synthetic_ledger_rows_verified,5);
 assert.equal(pass.foreign_key_definitions_verified,3);
 assert.equal(pass.exact_reviewed_v4_ddl_verified,true);
 assert.equal(pass.other_business_tables_verified_empty,true);
 assert.equal(pass.remote_write_performed,false);
});
test('partial/out-of-order plans and any implicit replay fail locally instead of silently succeeding',async t=>{
 const {buildG6SyntheticPlan}=await imported;
 const steps=buildG6SyntheticPlan();
 const db=synthetic(t);
 const rejected=sql=>{
  assert.throws(()=>db.exec(sql));
  // SQLite leaves an explicit transaction active after an invalid statement;
  // the future executor must never replay it without an independent check.
  db.exec('ROLLBACK;');
 };
 rejected(steps[2].sql);
 rejected(steps[1].sql);
 assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all(),[]);
 db.exec(steps[0].sql);
 rejected(steps[0].sql);
 rejected(steps[3].sql);
 db.exec(steps[1].sql);
 rejected(steps[1].sql);
 db.exec(steps[2].sql);
 rejected(steps[2].sql);
 db.exec(steps[3].sql);
 rejected(steps[3].sql);
 assert.equal((await verify(db)).status,'G6_STOCK_V4_REMOTE_READONLY_POSTFLIGHT_PASS');
});
test('wrong target, missing reviewed fields and altered stage digest are rejected',async()=>{
 const m=await imported,p=m.buildG6SyntheticPlan();
 for(const bad of [
  {...pin,database_id:'b882a6e8-0e56-49a6-bd41-1a6cadd726c9'},
  {...pin,database_name:'restaurant-business-prod'},
  {...pin,extra:'ignored'},
  {...pin,database_id:'00000000-0000-4000-8000-000000000000'}
 ])assert.throws(()=>m.buildG6SyntheticPlan(bad));
 assert.throws(()=>m.publicPlanReceipt(p.map((x,i)=>i===1?{
  ...x,sql:x.sql+'INSERT INTO users VALUES();'
 }:x)));
 assert.throws(()=>m.publicPlanReceipt(p.slice(0,3)));
});
test('CLI is plan-only and refuses Cloudflare credentials without attempting network',t=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'g6-staged-plan-'));
 t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
 const preload=path.join(temp,'network-guard.mjs'),counter=path.join(temp,'calls');
 fs.writeFileSync(preload,[
  "import fs from 'node:fs';",
  'let count=0;',
  "globalThis.fetch=async()=>{count++;throw Error('NO_NETWORK_PERMITTED');};",
  "process.on('exit',()=>fs.writeFileSync(process.env.G6_NO_NETWORK_COUNTER,String(count)));"
 ].join('\n'));
 const script=path.join(root,'tools/cloudflare-stock-v4-g6-migration-plan.mjs');
 const args=['--import',pathToFileURL(preload).href,script,'plan'];
 const env={...process.env,G6_NO_NETWORK_COUNTER:counter};
 delete env.CLOUDFLARE_API_TOKEN;
 const ok=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',env});
 assert.equal(ok.status,0,ok.stderr);
 const result=JSON.parse(ok.stdout);
 assert.equal(result.status,'G6_SYNTHETIC_VERSIONED_PLAN_ONLY');
 assert.equal(result.stages.length,4);
 assert.equal(fs.readFileSync(counter,'utf8'),'0');
 const denied=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',
  env:{...env,CLOUDFLARE_API_TOKEN:'synthetic_never_use_me'}});
 assert.equal(denied.status,1);
 assert.equal(fs.readFileSync(counter,'utf8'),'0');
 assert.doesNotMatch(denied.stderr,/synthetic_never_use_me/);
 const other=spawnSync(process.execPath,
  ['--import',pathToFileURL(preload).href,script,'execute'],{cwd:root,encoding:'utf8',env});
 assert.equal(other.status,1);
 assert.equal(fs.readFileSync(counter,'utf8'),'0');
});
