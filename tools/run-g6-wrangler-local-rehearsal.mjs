// Actual Wrangler LOCAL D1 rehearsal only: no external target, credentials,
// deployment or remote transport. The disposable DB is not the real G6 UUID.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {isolatedProbeEnvironment} from './pbkdf2-workerd-sandbox.mjs';
import {inspectHostedProbeStatic} from './cloudflare-hosted-probe-preflight.mjs';
import {buildG6SyntheticPlan} from './cloudflare-stock-v4-g6-migration-plan.mjs';
import {diagnoseG6ReadOnlyStage} from './cloudflare-stock-v4-g6-stage-readonly.mjs';
import {SQL} from './cloudflare-stock-v4-g6-postflight.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const VERSION='4.152.0';
const binding='G6_LOCAL_SYNTHETIC';
const rows=(db,sql)=>db.prepare(sql).all().map(x=>({...x}));
const need=(ok,code)=>{if(!ok)throw Error(code);};
function unwrap(phase){
 const start='BEGIN IMMEDIATE;\n',end='COMMIT;\n';
 need(phase.sql.startsWith(start)&&phase.sql.endsWith(end),'E_LOCAL_PLAN_BOUNDARY');
 return phase.sql.slice(start.length,-end.length);
}
function once(s,from,to){
 need(s.split(from).length===2,'E_LOCAL_PLAN_SUBSTITUTION');
 return s.replace(from,to);
}
function snapshot(db){
 const schema=rows(db,'SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name');
 const data=schema.filter(x=>x.type==='table').map(x=>{
  const id='"'+x.name.replaceAll('"','""')+'"';
  return [x.name,rows(db,'SELECT * FROM '+id).map(r=>JSON.stringify(r)).sort()];
 });
 return {schema,data,foreign:rows(db,'PRAGMA foreign_key_check'),quick:rows(db,'PRAGMA quick_check')};
}
function findDatabase(dir){
 const found=[];
 function walk(folder){
  for(const item of fs.readdirSync(folder,{withFileTypes:true})){
   const child=path.join(folder,item.name);
   need(!item.isSymbolicLink(),'E_LOCAL_PERSISTENCE_SYMLINK');
   if(item.isDirectory())walk(child);
   else if(item.isFile()&&item.name.endsWith('.sqlite')){
    const db=new DatabaseSync(child,{readOnly:true});
    try{if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='d1_migrations'").get())found.push(child);}
    finally{db.close();}
   }
  }
 }
 walk(dir);
 need(found.length===1,'E_LOCAL_DATABASE_AMBIGUOUS');
 return found[0];
}
// Diagnostics are confined to the generated local sandbox. Compare with the
// reviewed in-memory model; never log query rows, raw SQL, IDs or arbitrary
// CLI output. Object names are printed only when in the reviewed schema.
function reportLocalMismatch(db,plan,stage,lastQuery){
 const reference=new DatabaseSync(':memory:');
 const hash=x=>createHash('sha256').update(String(x??''),'utf8').digest('hex');
 try{
  for(let i=0;i<stage;i++)reference.exec(plan[i].sql);
  const expected=rows(reference,SQL.schemaInventory);
  const actual=rows(db,SQL.schemaInventory);
  const key=r=>r.type+':'+r.name;
  const byKey=new Map(actual.map(x=>[key(x),x]));
  const known=new Set(expected.map(key));
  const missing=expected.filter(x=>!byKey.has(key(x))).map(key);
  const extra=actual.filter(x=>!known.has(key(x)));
  const different=expected.filter(x=>byKey.has(key(x))&&!isDeepStrictEqual(x,byKey.get(key(x)))).map(x=>{
   const y=byKey.get(key(x));
   return {object:key(x),expected_sha256:hash(x.sql),actual_sha256:hash(y.sql),
    ascii_whitespace_only:typeof x.sql==='string'&&typeof y.sql==='string'&&
     x.sql.replace(/[ \t\r\n\v\f]/g,'')===y.sql.replace(/[ \t\r\n\v\f]/g,''),
    expected_ddl_bytes:Buffer.byteLength(x.sql??''),actual_ddl_bytes:Buffer.byteLength(y.sql??'')};
  });
  const ledgerColumns=rows(db,'PRAGMA table_info(d1_migrations)').map(x=>({
   column:['id','name','applied_at'].includes(x.name)?x.name:'other',
   type:['INTEGER','TEXT','TIMESTAMP','DATETIME'].includes(x.type)?x.type:'other',
   notnull:x.notnull,pk:x.pk
  }));
  console.error(JSON.stringify({diagnostic:'G6_LOCAL_CLASSIFIER_MISMATCH',
   expected_stage:stage,last_query:lastQuery,expected_objects:expected.length,
   actual_objects:actual.length,missing,different,extra_count:extra.length,
   extra_platform_like:extra.filter(x=>typeof x.name==='string'&&x.name.startsWith('_cf_')).length,
   ledger_columns:ledgerColumns}));
 }catch{
  console.error(JSON.stringify({diagnostic:'G6_LOCAL_MISMATCH_DETAILS_UNAVAILABLE',expected_stage:stage,last_query:lastQuery}));
 }finally{reference.close();}
}
async function run(){
 need(process.argv.length===2,'E_LOCAL_NO_ARGUMENTS');
 inspectHostedProbeStatic(ROOT);
 const pkg=path.join(ROOT,'node_modules','wrangler');
 const version=JSON.parse(fs.readFileSync(path.join(pkg,'package.json'),'utf8')).version;
 need(version===VERSION,'E_LOCAL_WRANGLER_VERSION');
 const entry=path.join(pkg,'bin','wrangler.js');
 const plan=buildG6SyntheticPlan();
 const pin=JSON.parse(fs.readFileSync(path.join(ROOT,'cloudflare/stock-v4-disposable-target.json'),'utf8'));
 const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-g6-wrangler-local-'));
 let checkpoint='setup';
 try{
  const migrationDir=path.join(workspace,'migrations'),state=path.join(workspace,'state');
  const cfg=path.join(workspace,'wrangler.json');
  fs.mkdirSync(migrationDir);fs.mkdirSync(state);
  const localId=randomUUID();
  need(localId!==pin.database_id,'E_LOCAL_ID_COLLISION');
  fs.writeFileSync(cfg,JSON.stringify({
   name:'restaurant-g6-local-rehearsal',compatibility_date:'2026-10-25',
   workers_dev:false,preview_urls:false,send_metrics:false,
   d1_databases:[{binding,database_name:'g6-local-synthetic',database_id:localId,migrations_dir:'migrations'}]
  }));
  for(const file of ['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'])
   fs.copyFileSync(path.join(ROOT,'cloudflare/migrations',file),path.join(migrationDir,file));
  const env=isolatedProbeEnvironment(workspace);
  function cli(kind,filename){
   need(kind==='apply'||kind==='seed','E_LOCAL_COMMAND');
   const command=kind==='apply'?['d1','migrations','apply',binding]:
    ['d1','execute',binding,'--file',filename];
   const result=spawnSync(process.execPath,[entry,...command,'--local','--persist-to',state,'--config',cfg],{
    cwd:workspace,env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90000,maxBuffer:4*1024*1024
   });
   need(!result.error&&Number.isInteger(result.status),'E_LOCAL_WRANGLER_PROCESS');
   return result;
  }
  const apply=()=>need(cli('apply').status===0,'E_LOCAL_APPLY');
  function seed(phase){
   const file=path.join(workspace,'seed.sql');
   fs.writeFileSync(file,unwrap(phase),{mode:0o600});
   need(cli('seed',file).status===0,'E_LOCAL_SEED');
   fs.unlinkSync(file);
  }
  async function classify(expected){
   // Read the persisted LOCAL SQLite database; mock ONLY the metadata envelope.
   // This is not a Cloudflare API call or a remote identity verification.
   let db;
   let lastQuery='open-local-database';
   try{
    db=new DatabaseSync(findDatabase(state),{readOnly:true});
    const result=await diagnoseG6ReadOnlyStage(pin,async(method,url,body)=>{
     if(method==='GET'){
      lastQuery='mock-metadata';
      need(url.endsWith('/'+pin.database_id)&&body===null,'E_LOCAL_METADATA');
      return {success:true,result:{uuid:pin.database_id,name:pin.database_name,version:'production'}};
     }
     need(method==='POST'&&url.endsWith('/'+pin.database_id+'/query')&&
      Object.values(SQL).includes(body?.sql),'E_LOCAL_QUERY');
     lastQuery=Object.keys(SQL).find(key=>SQL[key]===body.sql)??'unknown';
     return {success:true,result:[{success:true,results:rows(db,body.sql)}]};
    });
    need(result.stage===expected&&result.next_stage_execution_authorized===false,'E_LOCAL_STAGE');
    lastQuery='snapshot';
    return snapshot(db);
   }catch(error){
    if(db)reportLocalMismatch(db,plan,expected,lastQuery);
    else console.error(JSON.stringify({diagnostic:'G6_LOCAL_DATABASE_OPEN_FAILED',expected_stage:expected,last_query:lastQuery,
     reason:['E_LOCAL_PERSISTENCE_SYMLINK','E_LOCAL_DATABASE_AMBIGUOUS'].includes(error?.message)?error.message:'other'}));
    throw error;
   }finally{db?.close();}
  }
  checkpoint='v3-apply';apply();
  checkpoint='stage1';await classify(1);
  checkpoint='v3-seed';seed(plan[1]);
  checkpoint='stage2';const before=await classify(2);
  // Wrangler owns its migration transaction and automatic ledger receipt.
  // Convert the exact pinned local TEMP guard to a regular transactional
  // CHECK guard as in #261. Never embed explicit transaction statements.
  let upgrade=unwrap(plan[2]);
  upgrade=once(upgrade,'CREATE TEMP TABLE g6_v3_before_upgrade_guard (','CREATE TABLE g6_v3_before_upgrade_guard (');
  upgrade=once(upgrade,'INSERT INTO temp.g6_v3_before_upgrade_guard(','INSERT INTO g6_v3_before_upgrade_guard(');
  upgrade=once(upgrade,'DROP TABLE temp.g6_v3_before_upgrade_guard;','DROP TABLE g6_v3_before_upgrade_guard;');
  upgrade=once(upgrade,"INSERT INTO d1_migrations(id,name) VALUES(3,'0004_stock_move_kinds.sql');\n",'');
  need(!/\b(?:BEGIN IMMEDIATE|COMMIT|CREATE TEMP TABLE)\b/i.test(upgrade.replace(/^--.*$/gm,'')),'E_LOCAL_TRANSACTION_COMMAND');
  const migration=path.join(migrationDir,'0004_stock_move_kinds.sql');
  // Force a unique-key failure AFTER the old table is replaced, BEFORE
  // Wrangler can record the successful migration. Only this local fixture
  // may subsequently replace the deliberately broken migration and reapply.
  fs.writeFileSync(migration,upgrade+"\nINSERT INTO d1_migrations(id,name) VALUES(1,'g6-local-deliberate-failure');\n");
  checkpoint='deliberate-failure';
  const failed=cli('apply');
  need(failed.status!==0&&/UNIQUE constraint failed:\s*d1_migrations\.id/i.test(failed.stdout+'\n'+failed.stderr),'E_LOCAL_EXPECTED_FAILURE');
  checkpoint='rollback-stage2';
  assert.deepEqual(await classify(2),before,'local failed migration must preserve every schema object and table row');
  checkpoint='v4-apply';fs.writeFileSync(migration,upgrade);apply();
  checkpoint='stage3';await classify(3);
  checkpoint='v4-seed';seed(plan[3]);
  checkpoint='stage4';const final=await classify(4);
  checkpoint='replay';apply();assert.deepEqual(await classify(4),final,'no-op apply must preserve full state');
  console.log(JSON.stringify({result:'G6_WRANGLER_LOCAL_REHEARSAL_PASS',wrangler_version:version,
   local_stages_verified:[1,2,3,4],deliberate_failure_rollback_verified:true,
   automatic_migration_receipts_verified:3,replay_noop_verified:true,
   remote_d1_verified:false,remote_write_authorized:false,production_gate_modified:false}));
 }catch{
  // Fixed checkpoint only: never print CLI outputs, rows, paths or secrets.
  throw Error('E_G6_WRANGLER_LOCAL_CHECKPOINT_'+checkpoint);
 }finally{fs.rmSync(workspace,{recursive:true,force:true});}
}
run().catch(e=>{console.error('G6_WRANGLER_LOCAL_REHEARSAL_FAILED: '+String(e.message).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,120));process.exitCode=1;});
