// Local only. Manual, one-attempt recovery for an EXISTING Production D1 Owner.
// This file is NEVER imported by the Cloudflare Worker and exposes no HTTP API.
import {createInterface} from 'node:readline/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createServer,createConnection} from 'node:net';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashWorkerPassword} from '../cloudflare/auth-core.mjs';
import {EMPTY_TABLES} from './cloudflare-production-owner.mjs';
import {queryD1,assertTrustedMainCheckout,localProductionTarget} from './cloudflare-prod-owner-operator.mjs';

const FAIL='E_PROD_OWNER_PASSWORD_RECOVERY';
export const RESET_APPROVAL='RESET_EXISTING_OWNER_PASSWORD_ONCE';
const business=EMPTY_TABLES.filter(x=>!['users','sessions','login_attempts','audit_logs'].includes(x));
const stages=new Set(['LOCAL_CHECKOUT','TOKEN_INPUT','READ_PRECHECK','PASSWORD_INPUT',
 'EXPLICIT_APPROVAL','REMOTE_WRITE_UNCERTAIN','READ_POSTCHECK','LOCAL_WORKER','WRANGLER_BINDING','INVALID_STATE']);
const fail=stage=>{const e=Error(FAIL);e.safeStage=stages.has(stage)?stage:'INVALID_STATE';throw e;};
const safeCount=n=>Number.isSafeInteger(n)&&n>=0;
export const ownerRecoveryReadSql=`SELECT u.id AS owner_id, u.password_salt AS password_salt,
 u.password_hash AS password_hash,
 (SELECT contract_version FROM cloud_schema_contract WHERE id=1) AS contract_version,
 (SELECT COUNT(*) FROM d1_migrations) AS migration_total,
 (SELECT COUNT(*) FROM d1_migrations WHERE name='0001_initial_v3.sql') AS migration_1,
 (SELECT COUNT(*) FROM d1_migrations WHERE name='0002_login_attempts_window_indexes.sql') AS migration_2,
 (SELECT COUNT(*) FROM users WHERE role='owner') AS total_owners,
 (SELECT COUNT(*) FROM users WHERE role='owner' AND active=1) AS active_owners,
 (SELECT COUNT(*) FROM users WHERE username='owner' COLLATE NOCASE) AS owner_usernames,
 (SELECT COUNT(*) FROM audit_logs WHERE actor_name='production-bootstrap'
  AND action='auth.owner_bootstrap' AND entity='users'
  AND entity_id=u.id AND json_extract(detail,'$.hash_version')='pbkdf2-sha256$100000') AS bootstrap_audits,
 (SELECT COUNT(*) FROM audit_logs WHERE actor_name='production-password-recovery'
  AND action='auth.password_reset' AND entity='users' AND entity_id=u.id) AS recovery_audits,
 (SELECT COUNT(*) FROM sessions WHERE user_id=u.id) AS active_session_rows,
 ${business.map(t=>`(SELECT COUNT(*) FROM ${t})`).join(' +\n ')} AS business_rows
 FROM users u WHERE u.username='owner' COLLATE NOCASE AND u.role='owner' AND u.active=1;`;
const expectedKeys=['owner_id','password_salt','password_hash','contract_version','migration_total',
 'migration_1','migration_2','total_owners','active_owners','owner_usernames',
 'bootstrap_audits','recovery_audits','active_session_rows','business_rows'];
const resultRows=data=>{
 if(!Array.isArray(data)||data.length!==1||!Array.isArray(data[0]?.results))fail('INVALID_STATE');
 return data[0].results;
};
export function validateRecoveryState(results){
 const rows=resultRows(results);
 if(rows.length!==1||!rows[0]||typeof rows[0]!=='object'||Array.isArray(rows[0]))
   fail('INVALID_STATE');
 const row=rows[0];
 if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify([...expectedKeys].sort()))
   fail('INVALID_STATE');
 if(typeof row.owner_id!=='string'||!/^[0-9a-f-]{36}$/i.test(row.owner_id)||
   typeof row.password_salt!=='string'||!/^[0-9a-f]{32}$/.test(row.password_salt)||
   typeof row.password_hash!=='string'||
   !/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/.test(row.password_hash))
   fail('INVALID_STATE');
 for(const k of expectedKeys.filter(k=>!['owner_id','password_salt','password_hash'].includes(k)))
   if(!safeCount(row[k]))fail('INVALID_STATE');
 if(row.contract_version!==3||row.migration_total!==2||
   row.migration_1!==1||row.migration_2!==1||row.total_owners!==1||
   row.active_owners!==1||row.owner_usernames!==1||row.bootstrap_audits!==1)
   fail('INVALID_STATE');
 return Object.freeze({...row});
}
async function limitedQuery(token,body,transport){
 return queryD1(token,body,1,transport);
}
export async function inspectProductionOwnerRecovery(token,transport=fetch){
 let row;
 try{
  row=validateRecoveryState(await limitedQuery(token,{sql:ownerRecoveryReadSql},transport));
  const quick=resultRows(await limitedQuery(token,{sql:'PRAGMA quick_check;'},transport));
  const foreign=resultRows(await limitedQuery(token,{sql:'PRAGMA foreign_key_check;'},transport));
  if(quick.length!==1||quick[0]?.quick_check!=='ok'||foreign.length!==0)
   fail('INVALID_STATE');
 }catch{fail('READ_PRECHECK');}
 return row;
}
// The former REST batch reset is intentionally disabled; no safe REST write fallback.
export async function resetExistingProductionOwner(){fail('UNSAFE_REST_DISABLED');}
export const safeRecoverySummary=()=>Object.freeze({
 status:'PRODUCTION_OWNER_PASSWORD_RECOVERY_PRECHECK_PASS',
 schema_version:3,owner_count:1,
 write_performed:false,password_in_output:false,
 permission_to_reset_granted:false
});
async function hidden(prompt,maxBytes=4096){
 if(!process.stdin.isTTY||!process.stdout.isTTY||
   typeof process.stdin.setRawMode!=='function')fail('TOKEN_INPUT');
 process.stdout.write(prompt);
 return new Promise((resolve,reject)=>{
  let bytes=Buffer.alloc(0),done=false;
  const wasRaw=process.stdin.isRaw;
  function finish(bad){
   if(done)return;
   done=true;process.stdin.off('data',onData);
   process.stdin.setRawMode(!!wasRaw);
   process.stdin.pause();
   process.stdout.write('\n');
   if(bad){bytes.fill(0);reject(Error(FAIL));return;}
   try{const value=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    bytes.fill(0);resolve(value);}catch{bytes.fill(0);reject(Error(FAIL));}
  }
  function onData(chunk){
   for(const byte of chunk){
    if(byte===13||byte===10){finish(false);return;}
    if(byte===3||byte===27){finish(true);return;}
    if(byte===127||byte===8){
     let i=bytes.length-1;while(i>0&&(bytes[i]&0xc0)===0x80)i--;
     bytes=Buffer.from(bytes.subarray(0,Math.max(0,i)));
    }else if(byte>=32){
     if(bytes.length>=maxBytes){finish(true);return;}
     bytes=Buffer.concat([bytes,Buffer.from([byte])]);
    }else{finish(true);return;}
   }
  }
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.on('data',onData);
 });
}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
function approvedBinding(){
 const config=JSON.parse(fs.readFileSync(path.join(root,
  'cloudflare/wrangler.owner-recovery.local.jsonc'),'utf8'));
 const target=localProductionTarget();
 const db=config.d1_databases;
 if(config.name!=='restaurant-business-owner-recovery-local-only'||
    config.main!=='./owner-recovery-local-worker.mjs'||
    config.workers_dev!==false||config.preview_urls!==false||
    config.vars?.RECOVERY_LOCAL_MODE!=='operator-loopback-only'||
    !Array.isArray(db)||db.length!==1||db[0].binding!=='DB'||
    db[0].remote!==true||db[0].preview_database_id!==undefined||
    db[0].database_id!==target.databaseId||db[0].database_name!=='restaurant-business-prod')
  fail('WRANGLER_BINDING');
}
async function unusedLocalPort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const port=server.address().port;
   server.close(e=>e?reject(e):resolve(port));
  });
 });
}
async function rpc(base,route,body){
 const text=body===undefined?null:JSON.stringify(body);
 const response=await fetch(base+route,{
  method:text===null?'GET':'POST',redirect:'error',cache:'no-store',
  headers:text===null?{}:{'Content-Type':'application/json',
   'Content-Length':String(Buffer.byteLength(text))},
  ...(text===null?{}:{body:text}),signal:AbortSignal.timeout(9000)
 });
 if(!/^application\/json(?:;|$)/i.test(response.headers.get('content-type')||''))
  fail('LOCAL_WORKER');
 let data;try{data=await response.json();}catch{fail('LOCAL_WORKER');}
 if(!response.ok||!data||typeof data.code!=='string')fail('LOCAL_WORKER');
 return data.code;
}
// The operator Worker holds a live PRODUCTION D1 binding. A leaked workerd child
// after npx/cmd exits must never be treated as a clean maintenance shutdown.
function killWorkerTree(child,force=true){
 if(!Number.isSafeInteger(child?.pid)||child.pid<=0)return false;
 try{
  if(process.platform==='win32'){
   // Taskkill /T tracks descendants while the launcher still exists. Unlike
   // child.kill(), this terminates npx/cmd plus nested Wrangler/workerd.
   execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{
    windowsHide:true,stdio:'ignore',timeout:10000
   });
  }else{
   // Detached Wrangler/npx/workerd share a dedicated process group.
   // SIGTERM may be ignored and a not-yet-listening descendant can revive.
   // SIGKILL prevents a delayed privileged listener from ever starting.
   process.kill(-child.pid,force?'SIGKILL':'SIGTERM');
  }
  return true;
 }catch(e){
  return process.platform!=='win32'&&e?.code==='ESRCH';
 }
}
function workerTreeStillAlive(local){
 const pid=local?.child?.pid;
 if(!Number.isSafeInteger(pid)||pid<=0)return true;
 if(process.platform==='win32'){
  // Success of taskkill /PID ... /T /F is mandatory on Windows. A missing
  // parent PID alone cannot prove that its descendants were removed.
  if(!local.windowsTreeKillConfirmed)return true;
  try{process.kill(pid,0);return true;}
  catch(e){return e?.code!=='ESRCH';}
 }
 try{
  // kill(-pgid, 0) also sees zombies. Read pgid and process state instead:
  // only non-zombie processes can later start a privileged listener.
  // Unknown/unparseable process snapshots fail CLOSED.
  const listing=execFileSync('ps',['-eo','pgid=,stat='],{
   encoding:'utf8',timeout:4000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']
  });
  const lines=listing.split(/\r?\n/).filter(Boolean);
  if(!lines.length)return true;
  return lines.some(line=>{
   const parts=line.trim().split(/\s+/);
   return Number(parts[0])===pid&&!/^Z/.test(parts[1]||'');
  });
 }catch{return true;}
}
async function terminateWorkerTree(local){
 const {child,port}=local;
 for(let attempt=0;attempt<32;attempt++){
  const killed=killWorkerTree(child,true);
  if(process.platform==='win32'&&killed)local.windowsTreeKillConfirmed=true;
  // A closed port alone is NEVER enough: delayed startup can reopen it.
  // Termination MUST be proven independently before listener verification.
  const processGone=!workerTreeStillAlive(local);
  const socketGone=!await listenerOpen(port);
  if(processGone&&socketGone){
   // Recheck after a short grace interval so a late workerd bind cannot
   // appear between the process snapshot and this return.
   await new Promise(resolve=>setTimeout(resolve,100));
   if(!workerTreeStillAlive(local)&&!await listenerOpen(port))return;
  }
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 fail('LOCAL_WORKER');
}
function listenerOpen(port){
 return new Promise(resolve=>{
  if(!Number.isSafeInteger(port)||port<1||port>65535){resolve(true);return;}
  let done=false;
  const socket=createConnection({host:'127.0.0.1',port});
  const settle=open=>{
   if(done)return;done=true;socket.destroy();resolve(open);
  };
  socket.once('connect',()=>settle(true));
  socket.once('error',()=>settle(false));
  socket.setTimeout(350,()=>settle(true));
 });
}
async function listenerClosed(port){
 for(let attempt=0;attempt<20;attempt++){
  if(!await listenerOpen(port))return true;
  await new Promise(resolve=>setTimeout(resolve,250));
 }
 return false;
}
export async function stopRecoveryWorkerProcess(local){
 if(!local)return;
 // Never let a second SIGINT/SIGTERM accept an early closed startup port.
 if(local.stopPromise)return local.stopPromise;
 local.stopPromise=terminateWorkerTree(local);
 return local.stopPromise;
}

// Install while the detached child is spawned, BEFORE startup polling.
// Node's default SIGTERM/SIGINT termination skips the normal async finally.
// The signal handler must finish verified descendant cleanup before exit.
export function installRecoverySignalGuard(local,{
 eventSource=process,
 exit=code=>process.exit(code)
}={}){
 if(!local||!Number.isSafeInteger(local.child?.pid)||
    !Number.isSafeInteger(local.port))fail('LOCAL_WORKER');
 let disposed=false,interruptionStarted=false;
 const emergency=()=>killWorkerTree(local.child,true);
 const onSignal=signal=>{
  local.interrupted=true;
  if(interruptionStarted||disposed)return;
  interruptionStarted=true;
  void (async()=>{
   let safe=false;
   try{await stopRecoveryWorkerProcess(local);safe=true;}catch{}
   // Even on a verification failure, do not exit just because the socket is
   // presently closed: the Worker may still be in its startup phase.
   while(!safe){
    process.stderr.write(FAIL+' stage=LOCAL_WORKER tree_not_confirmed; retrying.\\n');
    try{await terminateWorkerTree(local);safe=true;}catch{
     await new Promise(resolve=>setTimeout(resolve,1000));
    }
   }
   dispose();
   exit(signal==='SIGINT'?130:143);
  })();
 };
 const sigint=()=>onSignal('SIGINT'),sigterm=()=>onSignal('SIGTERM');
 const dispose=()=>{
  if(disposed)return;
  disposed=true;
  eventSource.off('SIGINT',sigint);eventSource.off('SIGTERM',sigterm);
  eventSource.off('exit',emergency);
 };
 eventSource.on('SIGINT',sigint);
 eventSource.on('SIGTERM',sigterm);
 eventSource.on('exit',emergency);
 return dispose;
}

async function localWorker(){
 approvedBinding();
 const port=await unusedLocalPort(),base='http://127.0.0.1:'+port;
 const args=['--yes','wrangler@4','dev','--config',
  'wrangler.owner-recovery.local.jsonc',
  '--ip','127.0.0.1','--port',String(port)];
 const win=process.platform==='win32';
 const child=spawn(win?'cmd.exe':'npx',
  win?['/d','/s','/c','npx '+args.join(' ')]:args,{
   cwd:path.join(root,'cloudflare'),stdio:['ignore','ignore','ignore'],windowsHide:true,
   detached:true
  });
 const local={base,child,port,interrupted:false};
 // No await or timer between spawn and installing the signal handlers.
 local.disposeSignals=installRecoverySignalGuard(local);
 let failed=false;
 child.on('error',()=>{failed=true;});child.on('exit',()=>{failed=true;});
 try{
  for(let n=0;n<160&&!failed&&!local.interrupted;n++){
   try{
    if(await rpc(base,'/__recovery/ready')==='LOCAL_WORKER_READY'&&
       !local.interrupted)return local;
   }catch{}
   if(local.interrupted)break;
   await new Promise(resolve=>setTimeout(resolve,750));
  }
  fail('LOCAL_WORKER');
 }catch(e){
  try{await stopRecoveryWorkerProcess(local);}finally{local.disposeSignals();}
  throw e;
 }
}
async function cli(args){
 if(args.length!==1||!['--inspect','--reset'].includes(args[0]))fail('LOCAL_CHECKOUT');
 localProductionTarget();
 if(!process.stdin.isTTY||!process.stdout.isTTY)fail('TOKEN_INPUT');
 if(args[0]==='--inspect'){
  const token=await hidden('Production D1 Read Token (hidden): ');
  if(token.length<20||token.length>4096)fail('TOKEN_INPUT');
  await inspectProductionOwnerRecovery(token);
  process.stdout.write(JSON.stringify(safeRecoverySummary())+'\n');return;
 }
 try{assertTrustedMainCheckout();}catch{fail('LOCAL_CHECKOUT');}
 if(process.env.GITHUB_ACTIONS==='true')fail('LOCAL_CHECKOUT');
 let local;
 try{local=await localWorker();}catch{fail('LOCAL_WORKER');}
 let outcomeMessage;
 try{
  if(local.interrupted)fail('LOCAL_WORKER');
  const check=await rpc(local.base,'/__recovery/inspect',{});
  if(local.interrupted||check!=='OWNER_RECOVERY_PRECHECK_PASS')fail('READ_PRECHECK');
  process.stdout.write('Production Owner: precheck passed. Worker Binding atomic batch only.\n');
  const rl=createInterface({input:process.stdin,output:process.stdout});
  let approval='';
  try{approval=await rl.question('Type '+RESET_APPROVAL+' to authorize: ');}
  finally{rl.close();}
  if(approval!==RESET_APPROVAL)fail('EXPLICIT_APPROVAL');
  const first=await hidden('New Owner password (hidden, 12-256 characters): ');
  const second=await hidden('Confirm new Owner password (hidden): ');
  if(first!==second||first.length<12||first.length>256||
     /[\u0000-\u001f\u007f]/.test(first))fail('PASSWORD_INPUT');
  const credentials=await hashWorkerPassword(first);
  if(local.interrupted)fail('LOCAL_WORKER');
  let outcome;
  try{
   outcome=await rpc(local.base,'/__recovery/reset',{
    approval,audit_id:randomUUID(),...credentials
   });
  }catch{fail('REMOTE_WRITE_UNCERTAIN');}
  if(outcome!=='OWNER_RECOVERY_ATOMIC_VERIFIED')fail('READ_POSTCHECK');
  // Only report a verified recovery after privileged Workerd descendants
  // are terminated and the localhost listener has been confirmed closed.
  outcomeMessage=Object.freeze({
   status:'PRODUCTION_OWNER_PASSWORD_RESET_VERIFIED',
   worker_d1_atomic_batch:true,all_prior_owner_sessions_revoked:true,
   business_row_counts_unchanged:true,audit_recorded:true,
   password_in_output:false,write_batch_attempts:1
  });
 }finally{
  try{await stopRecoveryWorkerProcess(local);}
  finally{local.disposeSignals();}
 }
 if(outcomeMessage)process.stdout.write(JSON.stringify(outcomeMessage)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 cli(process.argv.slice(2)).catch(e=>{
  const stage=stages.has(e?.safeStage)?e.safeStage:'INVALID_STATE';
  process.stderr.write(FAIL+' stage='+stage+'; NO AUTOMATIC REMOTE WRITE RETRY.\n');
  process.exitCode=1;
 });
}
