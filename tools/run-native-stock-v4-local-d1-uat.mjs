// Real local workerd D1 binding, production Worker fetch handler, synthetic
// sessions and business rows. No remote endpoints, credentials or deployment.
// CI-only: a private temporary process, fixed inputs, no caller arguments.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {inspectHostedProbeStatic} from './cloudflare-hosted-probe-preflight.mjs';
import {isolatedProbeEnvironment} from './pbkdf2-workerd-sandbox.mjs';
import {buildG6WranglerInputs} from './cloudflare-stock-v4-g6-wrangler-plan.mjs';

const HERE=fileURLToPath(import.meta.url),ROOT=path.resolve(path.dirname(HERE),'..');
const SITE='https://stock-local-uat.invalid';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const token=()=>randomBytes(32).toString('base64url');
const id=()=>randomUUID();
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const VERSION='4.152.0';
// Only fixed, SHA-pinned migration/seed strings enter this simple splitter.
// Reject unexpected quoted semicolons, comments or empty fragments instead
// of trying to implement a general SQL parser or accepting caller SQL.
function statements(sql){
 const stripped=sql.replace(/^--.*$/gm,'').trim();
 let quote=false;
 for(let i=0;i<stripped.length;i++){
  if(stripped[i]==="'"){
   if(quote&&stripped[i+1]==="'"){i++;continue;}
   quote=!quote;
  }else if(stripped[i]===';'&&quote)throw Error('E_LOCAL_UAT_SQL_QUOTED_DELIMITER');
 }
 need(!quote&&!/\/\*/.test(stripped)&&stripped.endsWith(';'),'E_LOCAL_UAT_SQL_FORMAT');
 return stripped.split(';').map(s=>s.trim()).filter(Boolean);
}
async function child(){
 let checkpoint='setup',mf;
 try{
  const pkg=path.join(ROOT,'node_modules','wrangler','package.json');
  need(JSON.parse(fs.readFileSync(pkg,'utf8')).version===VERSION,'E_LOCAL_UAT_WRANGLER_VERSION');
  checkpoint='resolve-miniflare';
  const require=createRequire(pkg);
  const {Miniflare,Log,LogLevel}=require('miniflare');
  checkpoint='bundle-worker';
  // Match the production bundling boundary: the Worker imports reviewed CJS
  // helpers. Miniflare's raw module loader is not Wrangler's bundler.
  // Bundle the fixed source in memory using Wrangler's installed dependency;
  // no external modules, config file, plugins, deploy command or output files.
  const {build}=require('esbuild');
  const bundle=await build({
   absWorkingDir:ROOT,entryPoints:[path.join(ROOT,'cloudflare','worker.mjs')],
   bundle:true,format:'esm',platform:'browser',target:'es2022',
   write:false,logLevel:'silent',metafile:true
  });
  need(bundle.outputFiles?.length===1&&bundle.outputFiles[0].text.length>0,
   'E_LOCAL_UAT_BUNDLE_OUTPUT');
  // Reject unresolved external dependencies and sources outside the reviewed
  // checkout. The existing Hosted preflight has already checked its pins.
  for(const name of Object.keys(bundle.metafile.inputs)){
   const relative=path.relative(ROOT,path.resolve(ROOT,name));
   need(relative!==''&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&
    !relative.split(path.sep).includes('node_modules'),'E_LOCAL_UAT_BUNDLE_SOURCE');
  }
  for(const out of Object.values(bundle.metafile.outputs))
   need(out.imports.length===0,'E_LOCAL_UAT_BUNDLE_EXTERNAL');
  checkpoint='miniflare-config';
  // Local dispatchFetch uses Miniflare's own loopback workerd service,
  // never fetch() or a network request to the synthetic .invalid origin.
  mf=new Miniflare({
   modules:true,script:bundle.outputFiles[0].text,
   log:new Log(LogLevel.NONE),
   compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
   d1Databases:{DB:id()},d1Persist:false,
   bindings:{CLOUD_AUTH_PHASE:'native-production',CLOUD_NATIVE_LOGIN_GATE:'operator-released',
    CLOUD_NATIVE_STOCK_V4_WRITE_GATE:'operator-released',
    CLOUD_NATIVE_STOCK_RETURN_WRITE_GATE:'operator-released',
    NATIVE_AUTH_SOURCE_PEPPER:'synthetic-only-local-stock-uat-pepper'}
  });
  checkpoint='miniflare-d1-binding';
  const db=await mf.getD1Database('DB');
  const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
  const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
  const all=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
  const batch=sql=>db.batch(statements(sql).map(s=>db.prepare(s)));
  checkpoint='schema';
  const plan=buildG6WranglerInputs();
  // Local fixture setup only. Versioned Wrangler migration/rollback is
  // independently tested by #263/#266; this test targets real D1 API batches.
  await batch(plan[0].files[0].sql);await batch(plan[0].files[1].sql);
  await run('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)');
  for(const f of plan[0].files)await run('INSERT INTO d1_migrations(name) VALUES(?)',f.name);
  await batch(plan[1].files[0].sql);await batch(plan[2].files[0].sql);
  await run('INSERT INTO d1_migrations(name) VALUES(?)',plan[2].files[0].name);
  await batch(plan[3].files[0].sql);
  checkpoint='fixture';
  const ids={owner:id(),manager:id(),staff:id(),store:id(),other:id(),ing:id(),po:id(),purchase:id()};
  const sessions={};
  for(const [key,name] of [['store','Synthetic Store A'],['other','Synthetic Store B']])
   await run('INSERT INTO locations(id,name) VALUES(?,?)',ids[key],name);
  await run('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)',ids.ing,'LOCAL-UAT-ING','Synthetic ingredient','kg');
  for(const role of ['owner','manager','staff']){
   await run('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)',
    ids[role],'local-uat-'+role,'Synthetic '+role,role,'not-a-real-salt','not-a-real-hash');
   if(role!=='owner')await run('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)',ids[role],ids.store);
   const value=token(),csrf=token();
   await run('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)',
    digest(value),csrf,ids[role],new Date(Date.now()+3600000).toISOString());
   sessions[role]={cookie:'__Host-restaurant_session='+value,csrf};
  }
  await run('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,status,created_by) VALUES(?,?,?,?,?,?,?,?)',
   ids.po,'LOCAL-UAT-PO',ids.store,ids.ing,'Synthetic supplier',10,'received',ids.owner);
  await run('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,actor_id) VALUES(?,?,?,?,?,?,?)',
   ids.purchase,ids.ing,ids.store,10,'purchase',ids.po,ids.owner);
  const original=await first('SELECT * FROM stock_moves WHERE id=?',ids.purchase);
  const po=await first('SELECT * FROM purchase_orders WHERE id=?',ids.po);
  const summary=async()=>({
   moves:await all("SELECT id,qty_delta,move_type,reference_id,actor_id FROM stock_moves WHERE ingredient_id=? ORDER BY id",ids.ing),
   audit:await all("SELECT id,action,entity_id,actor_id,location_id,detail FROM audit_logs WHERE action IN ('stock.scrap','stock.adjust','stock.supplier_return') AND location_id=? ORDER BY id",ids.store)
  });
  const data={ingredient_id:ids.ing,location_id:ids.store};
  const scrap=(qty,loc=ids.store)=>({action:'stock.scrap',data:{...data,location_id:loc,qty,reason:'synthetic expired'}});
  const adjust=qty_delta=>({action:'stock.adjust',data:{...data,qty_delta,reason:'synthetic recount'}});
  const ret=qty=>({action:'stock.supplier_return',data:{...data,reference_id:ids.po,qty,reason:'synthetic return'}});
  async function send(route,who,body,expect,overrides={},key=id()){
   const session=sessions[who]??{};
   const headers={origin:SITE,'content-type':'application/json','sec-fetch-site':'same-origin',
    'x-idempotency-key':key,...(session.cookie?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...overrides};
   const r=await mf.dispatchFetch(SITE+route,{method:'POST',headers,body:JSON.stringify(body)});
   const json=await r.json();
   need(r.status===expect,'E_LOCAL_UAT_HTTP_STATUS');
   if(expect===200)need(json.ok===true&&json.result?.id===key.toLowerCase(),'E_LOCAL_UAT_HTTP_RESULT');
   return json;
  }
  checkpoint='denials';
  const before=await summary();
  await send('/api/stock/v4','none',scrap(1),401);
  await send('/api/stock/v4','staff',scrap(1),403);
  await send('/api/stock/v4','manager',scrap(1,ids.other),403);
  await send('/api/stock/return','staff',ret(1),403);
  await send('/api/stock/return','owner',ret(1),403,{'x-csrf-token':'bad'});
  await send('/api/stock/v4','owner',scrap(1),403,{origin:'https://other.invalid'});
  await send('/api/stock/v4','owner',scrap(11),409);
  assert.deepEqual(await summary(),before);
  checkpoint='writes';
  const replay=id();
  await send('/api/stock/v4','manager',scrap(2),200,{},replay);
  await send('/api/stock/v4','owner',adjust(-1),200);
  await send('/api/stock/v4','owner',adjust(5),200);
  await send('/api/stock/return','owner',ret(2),200);
  await send('/api/stock/return','manager',ret(1),200);
  const committed=await summary();
  need(committed.moves.length===6&&committed.audit.length===5,'E_LOCAL_UAT_COUNTS');
  need(committed.moves.reduce((n,m)=>n+m.qty_delta,0)===9,'E_LOCAL_UAT_BALANCE');
  for(const a of committed.audit)need(committed.moves.some(m=>m.id===a.entity_id&&m.actor_id===a.actor_id),'E_LOCAL_UAT_AUDIT_MATCH');
  checkpoint='real-batch-rollback';
  await send('/api/stock/v4','manager',scrap(2),409,{},replay);
  // 8 is within current stock (9) but exceeds the remaining PO receipt
  // budget (7). It reaches the actual D1 batch's CHECK failure.
  await send('/api/stock/return','owner',ret(8),503);
  assert.deepEqual(await summary(),committed);
  // Force an audit INSERT failure AFTER the stock statement by a local-only
  // trigger. Real D1 batch must undo both stock and audit effects.
  await run("CREATE TRIGGER local_uat_fail_audit BEFORE INSERT ON audit_logs WHEN NEW.action='stock.scrap' BEGIN SELECT RAISE(ABORT,'local_uat_failure'); END");
  await send('/api/stock/v4','owner',scrap(1),503);
  assert.deepEqual(await summary(),committed);
  await run('DROP TRIGGER local_uat_fail_audit');
  checkpoint='integrity';
  assert.deepEqual(await first('SELECT * FROM stock_moves WHERE id=?',ids.purchase),original);
  assert.deepEqual(await first('SELECT * FROM purchase_orders WHERE id=?',ids.po),po);
  assert.deepEqual(await all('PRAGMA foreign_key_check'),[]);
  await run('DELETE FROM sessions WHERE user_id=?',ids.manager);
  await send('/api/stock/v4','manager',scrap(1),401);
  assert.deepEqual(await summary(),committed);
  console.log(JSON.stringify({result:'NATIVE_STOCK_V4_LOCAL_D1_UAT_PASS',
   wrangler_version:VERSION,real_workerd_dispatch:true,real_d1_batch:true,
   synthetic_session_fixture:true,real_login_verified:false,accepted_movements:5,
   matching_audits:5,role_csrf_origin_and_session_checks:true,receipt_budget_rollback:true,
   audit_failure_rollback:true,replay_rejected:true,original_purchase_preserved:true,
   remote_d1_verified:false,production_write_performed:false,production_gate_modified:false}));
 }catch(error){
  // Fixed categories only: do not forward error text, paths, SQL or secrets.
  const code=['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ERR_REQUIRE_ESM','ERR_RUNTIME_FAILURE','ERR_MODULE_RULE','ERR_VALIDATION','ERR_INVALID_MODULE'].includes(error?.code)?error.code:'OTHER';
  console.error('E_LOCAL_STOCK_V4_UAT_CATEGORY_'+code);
  throw Error('E_LOCAL_STOCK_V4_UAT_CHECKPOINT_'+checkpoint);
 }finally{if(mf)await mf.dispose();}
}
function parent(){
 need(process.argv.length===2,'E_LOCAL_UAT_ARGUMENTS');
 need(process.env.GITHUB_ACTIONS==='true','E_LOCAL_UAT_CI_ONLY');
 inspectHostedProbeStatic(ROOT);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-stock-v4-uat-'));
 try{
  const result=spawnSync(process.execPath,[HERE,'isolated-child'],{
   cwd:folder,env:isolatedProbeEnvironment(folder),encoding:'utf8',
   stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:1024*1024
  });
  const output=result.stdout??'';
  const line=output.split('\n').find(s=>s.startsWith('{"result":"NATIVE_STOCK_V4_LOCAL_D1_UAT_PASS"'));
  if(result.status!==0||!line){
   const category=(result.stderr??'').match(/E_LOCAL_STOCK_V4_UAT_CATEGORY_(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ERR_RUNTIME_FAILURE|ERR_MODULE_RULE|ERR_VALIDATION|ERR_INVALID_MODULE|OTHER)\b/);
   if(category)console.error(category[0]);
   const failure=(result.stderr??'').match(/E_LOCAL_STOCK_V4_UAT_CHECKPOINT_[a-z-]+/);
   throw Error(failure?.[0]??'E_LOCAL_UAT_CHILD_FAILED');
  }
  const parsed=JSON.parse(line);
  need(parsed.real_d1_batch===true&&parsed.remote_d1_verified===false&&parsed.production_write_performed===false,'E_LOCAL_UAT_RESULT');
  console.log(JSON.stringify(parsed));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
try{
 if(process.argv.length===3&&process.argv[2]==='isolated-child'){
  // Reject direct invocation with ambient secrets or repository cwd.
  need(process.cwd()===process.env.HOME&&process.cwd()===process.env.TMPDIR&&
   path.basename(process.cwd()).startsWith('restaurant-stock-v4-uat-')&&
   Object.keys(process.env).every(k=>['PATH','HOME','TMPDIR','XDG_CONFIG_HOME','CI','TZ','NO_COLOR','WRANGLER_SEND_METRICS','CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV'].includes(k)),
   'E_LOCAL_UAT_CHILD_ENV');
  await child();
 }else parent();
}catch(error){
 console.error(String(error?.message??'E_LOCAL_UAT_FAILED').match(/^E_LOCAL_[A-Za-z0-9_-]+$/)?.[0]??'E_LOCAL_UAT_FAILED');
 process.exitCode=1;
}
