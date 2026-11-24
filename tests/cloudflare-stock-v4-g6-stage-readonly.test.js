'use strict';
// All state transitions are in ephemeral SQLite; network calls are mocked.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const pin=JSON.parse(fs.readFileSync(path.join(root,
 'cloudflare/stock-v4-disposable-target.json'),'utf8'));
const base='/accounts/31b409b04896d260ba0fadf6cc2bb305/d1/database/'+pin.database_id;
const diagnostics=import('../tools/cloudflare-stock-v4-g6-stage-readonly.mjs');
let buildG6SyntheticPlan,SQL;
const deps=Promise.all([
 import('../tools/cloudflare-stock-v4-g6-migration-plan.mjs'),
 import('../tools/cloudflare-stock-v4-g6-postflight.mjs')
]).then(([plan,postflight])=>{
 buildG6SyntheticPlan=plan.buildG6SyntheticPlan;
 SQL=postflight.SQL;
});
const reply=rows=>({success:true,result:[{success:true,results:rows}]});
function fixture(t){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON;');
 return db;
}
function adapter(db,overrides={}){
 let calls=0;
 const seen=[];
 const io=async(method,url,body)=>{
  calls++;
  seen.push([method,url,body]);
  if(method==='GET'){
   assert.equal(url,base);
   assert.equal(body,null);
   return overrides.metadata??{
    success:true,result:{name:pin.database_name,uuid:pin.database_id,version:'production'}
   };
  }
  assert.equal(method,'POST');
  assert.equal(url,base+'/query');
  assert.deepEqual(Object.keys(body),['sql']);
  assert.ok(Object.values(SQL).includes(body.sql),'Only existing allowlisted queries');
  assert.match(body.sql,/^(SELECT|PRAGMA)\b/);
  return overrides[body.sql]??reply(db.prepare(body.sql).all());
 };
 return {io,seen,get calls(){return calls;}};
}
test('all five exact stages classify without authorizing future execution or leaking rows',async t=>{
 await deps;
 const db=fixture(t),plans=buildG6SyntheticPlan(),m=await diagnostics;
 for(let stage=0;stage<=4;stage++){
  if(stage>0)db.exec(plans[stage-1].sql);
  const calls=adapter(db);
  const result=await m.diagnoseG6ReadOnlyStage(pin,calls.io);
  assert.equal(result.status,'G6_STAGE_READONLY_CLASSIFIED');
  assert.equal(result.stage,stage);
  assert.equal(result.migration_receipts_verified,stage<1?0:stage<3?2:3);
  assert.equal(result.synthetic_ledger_rows_verified,stage<2?0:stage<4?2:5);
  assert.equal(result.cloudflare_write_performed,false);
  assert.equal(result.next_stage_execution_authorized,false);
  assert.equal(result.retry_authorized,false);
  assert.equal(result.indirect_access_verified,false);
  assert.equal(result.exclusive_use_verified,false);
  assert.equal(result.production_gate_modified,false);
  assert.ok(calls.calls>3);
  assert.ok(calls.seen.every(([method,url,body])=>
   method==='GET'&&url===base&&body===null||
   method==='POST'&&url===base+'/query'&&Object.values(SQL).includes(body?.sql)));
  assert.doesNotMatch(JSON.stringify(result),/g6-fixture|g6-m01|909037ca|nonsecret_hash|SELECT |PRAGMA /);
 }
});
test('unexpected schema, missing migration receipts and partial history fail closed',async t=>{
 await deps;
 const m=await diagnostics,plan=buildG6SyntheticPlan();
 const bad=async(setup,mutate)=>{
  const db=fixture(t);
  for(let i=0;i<setup;i++)db.exec(plan[i].sql);
  mutate(db);
  await assert.rejects(()=>m.diagnoseG6ReadOnlyStage(pin,adapter(db).io),
   /G6_STAGE_READONLY_DIAGNOSTIC_FAILED/);
 };
 await bad(0,db=>db.exec('CREATE TABLE accidental(id TEXT);'));
 await bad(1,db=>db.exec('CREATE VIEW unexpected_view AS SELECT 1;'));
 await bad(1,db=>db.exec('DROP INDEX idx_login_attempts_username_nocase_at;'));
 await bad(1,db=>db.exec('ALTER TABLE stock_moves ADD COLUMN unexpected TEXT;'));
 await bad(2,db=>db.exec('CREATE INDEX unauthorized_index ON stock_moves(location_id);'));
 await bad(1,db=>db.exec("DELETE FROM d1_migrations WHERE id=2"));
 await bad(1,db=>db.exec("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES('extra','extra','Extra','staff','x','x')"));
 await bad(2,db=>db.exec("UPDATE stock_moves SET qty_delta=-3 WHERE id='g6-m02';"));
 await bad(2,db=>db.exec("UPDATE ingredient_prices SET price_cents=2000 WHERE id='g6-price-01';"));
 await bad(2,db=>db.exec("UPDATE audit_logs SET at='1999-01-01 00:00:00' WHERE id='g6-audit-01';"));
 await bad(3,db=>db.exec("DELETE FROM stock_moves WHERE id='g6-m01';"));
 await bad(3,db=>db.exec("DELETE FROM stock_move_kind_contract WHERE id=1;"));
 {
  const db=fixture(t);
  for(let i=0;i<3;i++)db.exec(buildG6SyntheticPlan()[i].sql);
  await assert.rejects(()=>m.diagnoseG6ReadOnlyStage(pin,
   adapter(db,{[SQL.version]:reply([{kind_version:5}])}).io),
   /G6_STAGE_READONLY_DIAGNOSTIC_FAILED/);
 }
 await bad(4,db=>db.exec("UPDATE stock_moves SET note='changed' WHERE id='g6-m04';"));
});
test('stage 3 refuses rebuilt v4 table missing an originally reviewed CHECK',async t=>{
 await deps;
 const db=fixture(t),plan=buildG6SyntheticPlan(),m=await diagnostics;
 for(let i=0;i<3;i++)db.exec(plan[i].sql);
 const old=db.prepare("SELECT sql FROM sqlite_master WHERE name='stock_moves'").get().sql;
 const broken=old.replace('CHECK(qty_delta != 0)','CHECK(1)');
 assert.notEqual(old,broken,'the fixture must contain the reviewed quantity constraint');
 const changed=broken.replace(/^CREATE TABLE\s+"?stock_moves"?/i,
  'CREATE TABLE stock_moves_bad');
 db.exec('PRAGMA foreign_keys=OFF;');
 db.exec(changed);
 db.exec('INSERT INTO stock_moves_bad SELECT * FROM stock_moves;');
 db.exec('DROP TABLE stock_moves;');
 db.exec('ALTER TABLE stock_moves_bad RENAME TO stock_moves;');
 db.exec('CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id);');
 db.exec('PRAGMA foreign_keys=ON;');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 await assert.rejects(()=>m.diagnoseG6ReadOnlyStage(pin,adapter(db).io),
  /G6_STAGE_READONLY_DIAGNOSTIC_FAILED/);
});
test('wrong target, forged metadata, query failures and alien SQL payload never classify',async t=>{
 await deps;
 const m=await diagnostics,db=fixture(t),unused=adapter(db);
 let touched=0;
 for(const id of [
  'b882a6e8-0e56-49a6-bd41-1a6cadd726c9',
  '2c355bed-d9c3-449c-aa9b-1018f3bc1177',
  '04566a27-cd95-4415-9bd7-c3e19d60ab6c',
  '00000000-0000-4000-8000-000000000000'
 ])await assert.rejects(()=>m.diagnoseG6ReadOnlyStage({...pin,database_id:id},
  async()=>{touched++;return null;}));
 assert.equal(touched,0);
 await assert.rejects(()=>m.diagnoseG6ReadOnlyStage(pin,
  adapter(db,{metadata:{success:true,result:{name:pin.database_name,uuid:'wrong',version:'production'}}}).io),
  /G6_STAGE_READONLY_DIAGNOSTIC_FAILED/);
 await assert.rejects(()=>m.diagnoseG6ReadOnlyStage(pin,
  adapter(db,{[SQL.quick]:reply([{quick_check:'corrupt'}])}).io),
  /G6_STAGE_READONLY_DIAGNOSTIC_FAILED/);
 assert.equal(unused.calls,0);
});
test('CLI refuses manual confirmation errors before touching Cloudflare',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'g6-stage-only-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const preload=path.join(dir,'preload.mjs'),count=path.join(dir,'calls');
 fs.writeFileSync(preload,[
  "import fs from 'node:fs';",
  'let calls=0;',
  "globalThis.fetch=async()=>{calls++;throw Error('UNEXPECTED_NETWORK');};",
  "process.on('exit',()=>fs.writeFileSync(process.env.G6_STAGE_CALL_FILE,String(calls)));"
 ].join('\n'));
 const cli=path.join(root,'tools/cloudflare-stock-v4-g6-stage-readonly.mjs');
 const env={...process.env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',
  CLOUDFLARE_ACCOUNT_ID:'31b409b04896d260ba0fadf6cc2bb305',
  CLOUDFLARE_API_TOKEN:'synthetic_token_never_real',
  G6_STAGE_READONLY_CONFIRM:'INVALID',
  G6_STAGE_CALL_FILE:count};
 const proc=spawnSync(process.execPath,
  ['--import',pathToFileURL(preload).href,cli,'inspect'],{cwd:root,encoding:'utf8',env});
 assert.equal(proc.status,1,proc.stderr);
 assert.equal(proc.stdout,'');
 assert.equal(fs.readFileSync(count,'utf8'),'0');
 assert.doesNotMatch(proc.stderr,/synthetic_token_never_real|909037ca/);
 assert.match(proc.stderr,/G6_STAGE_READONLY_DIAGNOSTIC_FAILED/);
});
test('manual workflow is main-only and cannot access the D1 write token',()=>{
 const workflow=fs.readFileSync(path.join(root,
  '.github/workflows/d1-stock-v4-disposable-stage-readonly.yml'),'utf8');
 assert.match(workflow,/workflow_dispatch:/);
 assert.match(workflow,/refs\/heads\/main/);
 assert.match(workflow,/CHECK_G6_STAGE_READONLY/);
 assert.match(workflow,/environment: d1-recovery-drill-readonly/);
 assert.match(workflow,/cloudflare-hosted-probe-preflight\.mjs/);
 assert.match(workflow,/CLOUDFLARE_D1_DRILL_READ_TOKEN/);
 assert.doesNotMatch(workflow,/CLOUDFLARE_D1_DRILL_WRITE_TOKEN|migrations apply|restore|(?:\s|^)deploy(?:\s|$)|wrangler/);
 assert.ok(workflow.indexOf('cloudflare-hosted-probe-preflight.mjs')<
  workflow.indexOf('CLOUDFLARE_D1_DRILL_READ_TOKEN'));
});
