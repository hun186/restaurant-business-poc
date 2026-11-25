// Actual local workerd D1 binding and production login/reset HTTP handlers.
// Only generated synthetic accounts, synthetic edge metadata, no remote targets.
// CI-only: a private temporary process, fixed inputs, no caller arguments.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {randomUUID,randomBytes} from 'node:crypto';
import {hashWorkerPassword} from '../cloudflare/auth-core.mjs';
import {spawnSync} from 'node:child_process';
import {inspectHostedProbeStatic} from './cloudflare-hosted-probe-preflight.mjs';
import {isolatedProbeEnvironment} from './pbkdf2-workerd-sandbox.mjs';
import {buildG6WranglerInputs} from './cloudflare-stock-v4-g6-wrangler-plan.mjs';

const HERE=fileURLToPath(import.meta.url),ROOT=path.resolve(path.dirname(HERE),'..');
const SITE='https://account-reset-local-uat.invalid';
const need=(ok,code)=>{if(!ok)throw Error(code);};
const token=()=>randomBytes(32).toString('base64url');
const id=()=>randomUUID();
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
  const {Miniflare,Log,LogLevel,convertV4MiniflareOptions}=require('miniflare');
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
  // New Miniflare accepts the manifest/config envelope, whereas Wrangler
  // still constructs v4-shaped options via its exported official converter.
  // Source: workers-sdk packages/miniflare/src/config/v4-convert.ts and
  // packages/wrangler/src/d1/execute.ts (upstream main; installed version
  // is verified by the actual CI, not inferred from upstream main).
  const databaseId=id();
  const opts={
   modules:true,script:bundle.outputFiles[0].text,
   log:new Log(LogLevel.NONE),
   compatibilityDate:'2026-10-25',host:'127.0.0.1',port:0,
   cf:false,unsafeRegisterWorker:false,
   d1Databases:{DB:databaseId},
   bindings:{CLOUD_AUTH_PHASE:'native-production',CLOUD_NATIVE_LOGIN_GATE:'operator-released',
    CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE:'operator-released',
    CLOUD_NATIVE_ACCOUNT_PASSWORD_RESET_WRITE_GATE:'operator-released',
    NATIVE_AUTH_SOURCE_PEPPER:'synthetic-only-local-account-reset-pepper'}
  };
  const converted=typeof convertV4MiniflareOptions==='function';
  // No configured persistence: temporary storage under the isolated child
  // TMPDIR is disposable. Do not pass obsolete per-binding d1Persist.
  checkpoint=converted?'miniflare-convert':'miniflare-legacy-config';
  const config=converted?convertV4MiniflareOptions(opts):opts;
  if(converted){
   const workers=config.workers;
   need(Array.isArray(workers)&&workers.length===1&&
    workers[0].config?.env?.DB?.type==='d1'&&
    workers[0].config.env.DB.id===databaseId&&
    !workers[0].config.env.DB.dev?.remote&&
    !workers[0].dev?.remoteProxyConnectionString&&
    !config.enableDevRegistry&&config.host==='127.0.0.1',
    'E_LOCAL_UAT_CONVERTED_SCOPE');
  }
  checkpoint='miniflare-config';
  mf=new Miniflare(config);
  checkpoint='miniflare-d1-binding';
  const db=await mf.getD1Database('DB');
  const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
  const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
  const all=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
  const batch=sql=>db.batch(statements(sql).map(s=>db.prepare(s)));
  checkpoint='schema';
  const plan=buildG6WranglerInputs();
  // The account endpoints currently require v3. Use the fixed v3 migrations
  // only; never alter a live schema or reuse the stock v4 fixture database.
  await batch(plan[0].files[0].sql);await batch(plan[0].files[1].sql);
  checkpoint='fixture';
  const ids={owner:id(),staff:id(),manager:id(),store:id()};
  const passwords={owner:token(),staff:token(),manager:token(),replacement:token(),wrong:token()};
  await run('INSERT INTO locations(id,name) VALUES(?,?)',ids.store,'Synthetic reset UAT store');
  for(const role of ['owner','staff','manager']){
   const hash=await hashWorkerPassword(passwords[role]);
   await run('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)',
    ids[role],'local-reset-'+role,'Synthetic '+role,role,hash.password_salt,hash.password_hash);
   if(role!=='owner')await run('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)',ids[role],ids.store);
  }
  async function send(route,method,body,session,expected,overrides={}){
   const headers={'sec-fetch-site':'same-origin','CF-Connecting-IP':'198.51.100.18',
    ...(method==='POST'?{origin:SITE,'content-type':'application/json'}:{}),
    ...(session?{cookie:session.cookie,'x-csrf-token':session.csrf}:{}),...overrides};
   // Explicit synthetic CF metadata is local only; this is not evidence of
   // real Cloudflare edge provenance or production CPU/rate-limit behavior.
   const response=await mf.dispatchFetch(SITE+route,{method,headers,
    cf:{colo:'TPE'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const json=await response.json();
   need(response.status===expected,'E_LOCAL_UAT_HTTP_STATUS');
   return {json,cookie:response.headers.get('set-cookie')};
  }
  async function login(role,password,expected=200){
   const result=await send('/api/login','POST',{username:'local-reset-'+role,password},null,expected);
   if(expected!==200){
    need(result.json.code==='E_INVALID_CREDENTIALS'&&!result.cookie,'E_LOCAL_UAT_LOGIN_DENIAL');
    return null;
   }
   need(result.json.code==='OK'&&result.json.user?.id===ids[role]&&
    typeof result.json.csrf==='string'&&typeof result.cookie==='string'&&
    result.cookie.startsWith('__Host-restaurant_session='),'E_LOCAL_UAT_LOGIN_RECEIPT');
   return {cookie:result.cookie.split(';')[0],csrf:result.json.csrf};
  }
  async function me(session,expected,role){
   const {json}=await send('/api/me','GET',undefined,session,expected);
   if(expected===200)need(json.user?.id===ids[role]&&json.csrf===session.csrf,'E_LOCAL_UAT_IDENTITY');
  }
  const payload={targetUserId:ids.staff,currentOwnerPassword:passwords.owner,newPassword:passwords.replacement};
  const reset=(session,expected,body=payload,headers={})=>send('/api/accounts/password-reset','POST',body,session,expected,headers);
  const snapshot=async()=>({
   users:await all('SELECT id,username,role,active,password_salt,password_hash FROM users ORDER BY id'),
   grants:await all('SELECT user_id,location_id FROM user_locations ORDER BY user_id,location_id'),
   sessions:await all('SELECT token_hash,user_id,csrf_token,expires_at FROM sessions ORDER BY token_hash'),
   audits:await all("SELECT id,actor_id,entity_id,action,detail FROM audit_logs WHERE action='user.password_reset' ORDER BY id")
  });
  checkpoint='login';
  const owner=await login('owner',passwords.owner);
  const staff1=await login('staff',passwords.staff),staff2=await login('staff',passwords.staff);
  const manager=await login('manager',passwords.manager);
  need(staff1.cookie!==staff2.cookie,'E_LOCAL_UAT_DISTINCT_SESSIONS');
  await me(owner,200,'owner');await me(staff1,200,'staff');await me(staff2,200,'staff');await me(manager,200,'manager');
  checkpoint='denials';
  const before=await snapshot();
  await reset(staff1,403);await reset(manager,403);
  await reset(owner,403,payload,{'x-csrf-token':'invalid'});
  const wrong=await reset(owner,403,{...payload,currentOwnerPassword:passwords.wrong});
  need(wrong.json.code==='E_INVALID_CURRENT_PASSWORD','E_LOCAL_UAT_REAUTH_DENIAL');
  assert.deepEqual(await snapshot(),before);
  checkpoint='rollback';
  // Failure after audit and credential update, while deleting target sessions.
  // The actual D1 batch must undo the prior writes as well.
  await run("CREATE TRIGGER local_reset_revoke_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic_revoke_failure'); END");
  const fault=await reset(owner,503);
  need(fault.json.code==='E_ACCOUNT_RESET_UNCERTAIN_NO_RETRY','E_LOCAL_UAT_ROLLBACK_RESPONSE');
  assert.deepEqual(await snapshot(),before);
  await run('DROP TRIGGER local_reset_revoke_failure');
  await me(staff1,200,'staff');await me(staff2,200,'staff');
  checkpoint='reset';
  const result=await reset(owner,200);
  need(result.json.code==='OK','E_LOCAL_UAT_RESET_RECEIPT');
  const after=await snapshot();
  const target=after.users.find(u=>u.id===ids.staff);
  need(target&&target.password_hash!==before.users.find(u=>u.id===ids.staff).password_hash,'E_LOCAL_UAT_CREDENTIAL_ROTATION');
  assert.deepEqual(after.users.filter(u=>u.id!==ids.staff),before.users.filter(u=>u.id!==ids.staff));
  assert.deepEqual(after.grants,before.grants);
  assert.deepEqual(after.sessions,before.sessions.filter(s=>s.user_id!==ids.staff));
  need(after.audits.length===1&&after.audits[0].actor_id===ids.owner&&
   after.audits[0].entity_id===ids.staff&&after.audits[0].detail==='{}','E_LOCAL_UAT_AUDIT');
  checkpoint='relogin';
  await me(staff1,401);await me(staff2,401);
  await me(owner,200,'owner');await me(manager,200,'manager');
  await login('staff',passwords.staff,401);
  const fresh=await login('staff',passwords.replacement);await me(fresh,200,'staff');
  const audit=await send('/api/audit?category=account','GET',undefined,owner,200);
  const rows=audit.json.rows?.filter(r=>r.action==='user.password_reset');
  need(rows?.length===1&&rows[0].summary==='重設對象（目前帳號）：local-reset-staff'&&
    !JSON.stringify(rows).includes(ids.staff),'E_LOCAL_UAT_AUDIT_PROJECTION');
  assert.deepEqual(await all('PRAGMA foreign_key_check'),[]);
  console.log(JSON.stringify({result:'NATIVE_ACCOUNT_RESET_LOCAL_D1_UAT_PASS',
   wrangler_version:VERSION,real_workerd_dispatch:true,real_d1_batch:true,
   miniflare_config_mode:converted?'official-v4-converter':'legacy-v4-options',
   local_login_http_verified:true,synthetic_edge_metadata:true,
   old_password_denied:true,new_password_login_verified:true,target_sessions_revoked:2,
   other_sessions_and_grants_preserved:true,reauth_and_rbac_denials:true,
   revoke_failure_atomic_rollback:true,redacted_audit_verified:true,
   remote_d1_verified:false,real_edge_provenance_verified:false,
   production_write_performed:false,production_gate_modified:false}));
 }catch(error){
  // Fixed categories only: do not forward error text, paths, SQL or secrets.
  const code=['MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ERR_REQUIRE_ESM','ERR_RUNTIME_FAILURE','ERR_MODULE_RULE','ERR_VALIDATION','ERR_INVALID_MODULE'].includes(error?.code)?error.code:'OTHER';
  console.error('E_LOCAL_ACCOUNT_RESET_UAT_CATEGORY_'+code);
  // Zod validation causes contain inputs and arbitrary messages. Emit only
  // fixed recognized path segments, never the actual message/value.
  const allowed=new Set(['workers','config','manifest','modules','mainModule','modulesRoot',
   'env','DB','id','type','dev','remote','host','port','cf','log','script','scriptPath',
   'd1Databases','d1Persist','bindings','resourcePersistencePath','unsafeRegisterWorker',
   'compatibilityDate','compatibilityFlags','enableDevRegistry','unsafeDevRegistryPath']);
  const issues=error?.cause?.issues??error?.issues;
  if(Array.isArray(issues)){
   const fields=[...new Set(issues.slice(0,12).map(i=>
    (Array.isArray(i?.path)?i.path:[]).map(k=>typeof k==='number'?'index':allowed.has(k)?k:'other').join('.')||'root'))];
   console.error('E_LOCAL_UAT_VALIDATION_FIELDS '+fields.join(','));
  }
  throw Error('E_LOCAL_ACCOUNT_RESET_UAT_CHECKPOINT_'+checkpoint);
 }finally{if(mf)await mf.dispose();}
}
function parent(){
 need(process.argv.length===2,'E_LOCAL_UAT_ARGUMENTS');
 need(process.env.GITHUB_ACTIONS==='true','E_LOCAL_UAT_CI_ONLY');
 inspectHostedProbeStatic(ROOT);
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-account-reset-uat-'));
 try{
  const result=spawnSync(process.execPath,[HERE,'isolated-child'],{
   cwd:folder,env:isolatedProbeEnvironment(folder),encoding:'utf8',
   stdio:['ignore','pipe','pipe'],timeout:180000,maxBuffer:1024*1024
  });
  const output=result.stdout??'';
  const line=output.split('\n').find(s=>s.startsWith('{"result":"NATIVE_ACCOUNT_RESET_LOCAL_D1_UAT_PASS"'));
  if(result.status!==0||!line){
   const category=(result.stderr??'').match(/E_LOCAL_ACCOUNT_RESET_UAT_CATEGORY_(?:MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ERR_REQUIRE_ESM|ERR_RUNTIME_FAILURE|ERR_MODULE_RULE|ERR_VALIDATION|ERR_INVALID_MODULE|OTHER)\b/);
   if(category)console.error(category[0]);
   const fields=(result.stderr??'').match(/E_LOCAL_UAT_VALIDATION_FIELDS [A-Za-z0-9_.,-]{1,400}/);
   if(fields)console.error(fields[0]);
   const failure=(result.stderr??'').match(/E_LOCAL_ACCOUNT_RESET_UAT_CHECKPOINT_[a-z-]+/);
   throw Error(failure?.[0]??'E_LOCAL_UAT_CHILD_FAILED');
  }
  const parsed=JSON.parse(line);
  need(parsed.real_d1_batch===true&&parsed.local_login_http_verified===true&&
   parsed.revoke_failure_atomic_rollback===true&&parsed.target_sessions_revoked===2&&
   parsed.remote_d1_verified===false&&parsed.real_edge_provenance_verified===false&&
   parsed.production_write_performed===false,'E_LOCAL_UAT_RESULT');
  console.log(JSON.stringify(parsed));
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}
try{
 if(process.argv.length===3&&process.argv[2]==='isolated-child'){
  // Reject direct invocation with ambient secrets or repository cwd.
  need(process.cwd()===process.env.HOME&&process.cwd()===process.env.TMPDIR&&
   path.basename(process.cwd()).startsWith('restaurant-account-reset-uat-')&&
   Object.keys(process.env).every(k=>['PATH','HOME','TMPDIR','XDG_CONFIG_HOME','CI','TZ','NO_COLOR','WRANGLER_SEND_METRICS','CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV'].includes(k)),
   'E_LOCAL_UAT_CHILD_ENV');
  await child();
 }else parent();
}catch(error){
 console.error(String(error?.message??'E_LOCAL_UAT_FAILED').match(/^E_LOCAL_[A-Za-z0-9_-]+$/)?.[0]??'E_LOCAL_UAT_FAILED');
 process.exitCode=1;
}
