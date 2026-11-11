// Local only. Manual, one-attempt recovery for an EXISTING Production D1 Owner.
// This file is NEVER imported by the Cloudflare Worker and exposes no HTTP API.
import {createInterface} from 'node:readline/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hashWorkerPassword} from '../cloudflare/auth-core.mjs';
import {EMPTY_TABLES} from './cloudflare-production-owner.mjs';
import {queryD1,assertTrustedMainCheckout,localProductionTarget} from './cloudflare-prod-owner-operator.mjs';

const FAIL='E_PROD_OWNER_PASSWORD_RECOVERY';
export const RESET_APPROVAL='RESET_EXISTING_OWNER_PASSWORD_ONCE';
const business=EMPTY_TABLES.filter(x=>!['users','sessions','login_attempts','audit_logs'].includes(x));
const stages=new Set(['LOCAL_CHECKOUT','TOKEN_INPUT','READ_PRECHECK','PASSWORD_INPUT',
 'EXPLICIT_APPROVAL','REMOTE_WRITE_UNCERTAIN','READ_POSTCHECK','INVALID_STATE']);
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
export function recoveryBatch(before,credentials,auditId){
 if(!before||!/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/.test(credentials?.password_hash||'')||
   !/^[0-9a-f]{32}$/.test(credentials?.password_salt||'')||
   !/^[0-9a-f-]{36}$/i.test(auditId||''))fail('INVALID_STATE');
 // Guard target identity, pristine bootstrap history and old credential CAS.
 const update=`UPDATE users SET password_salt=?,password_hash=?
 WHERE id=? AND username='owner' COLLATE NOCASE AND role='owner' AND active=1
 AND password_salt=? AND password_hash=?
 AND (SELECT COUNT(*) FROM users WHERE role='owner')=1
 AND (SELECT COUNT(*) FROM audit_logs WHERE actor_name='production-bootstrap'
  AND action='auth.owner_bootstrap' AND entity='users' AND entity_id=?)=1
 AND (SELECT contract_version FROM cloud_schema_contract WHERE id=1)=3`;
 const deletion=`DELETE FROM sessions WHERE user_id=? AND EXISTS(
 SELECT 1 FROM users WHERE id=? AND password_salt=? AND password_hash=?)`;
 const audit=`INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail)
 SELECT ?,'production-password-recovery','auth.password_reset','users',id,'{}'
 FROM users WHERE id=? AND password_salt=? AND password_hash=?`;
 return [
  {sql:update,params:[credentials.password_salt,credentials.password_hash,
    before.owner_id,before.password_salt,before.password_hash,before.owner_id]},
  {sql:deletion,params:[before.owner_id,before.owner_id,
    credentials.password_salt,credentials.password_hash]},
  {sql:audit,params:[auditId,before.owner_id,credentials.password_salt,credentials.password_hash]}
 ];
}
export async function resetExistingProductionOwner({token,newPassword,approval,transport=fetch}){
 // Disabled until a verified Worker D1Database.batch() path replaces REST batch.
 // The Cloudflare REST batch rollback guarantee has not been established.
 fail('UNSAFE_REST_DISABLED');
 if(approval!==RESET_APPROVAL)fail('EXPLICIT_APPROVAL');
 if(typeof newPassword!=='string'||newPassword.length<12||newPassword.length>256||
    /[\u0000-\u001f\u007f]/.test(newPassword))fail('PASSWORD_INPUT');
 const before=await inspectProductionOwnerRecovery(token,transport);
 const credentials=await hashWorkerPassword(newPassword);
 const batch=recoveryBatch(before,credentials,crypto.randomUUID());
 try{
  // A single explicitly approved remote write batch; NEVER retry on timeouts.
  await queryD1(token,{batch},3,transport);
 }catch{fail('REMOTE_WRITE_UNCERTAIN');}
 let after;
 try{after=await inspectProductionOwnerRecovery(token,transport);}
 catch{fail('READ_POSTCHECK');}
 if(after.owner_id!==before.owner_id||
   after.password_salt!==credentials.password_salt||
   after.password_hash!==credentials.password_hash||
   after.recovery_audits!==before.recovery_audits+1||
   after.active_session_rows!==0||
   after.business_rows!==before.business_rows||
   after.bootstrap_audits!==before.bootstrap_audits)fail('READ_POSTCHECK');
 return Object.freeze({
  status:'PRODUCTION_OWNER_PASSWORD_RESET_VERIFIED',
  schema_version:3,owner_count:1,
  all_prior_owner_sessions_revoked:true,
  business_row_counts_unchanged:true,
  audit_recorded:true,
  write_batch_attempts:1,
  owner_recreated:false,
  login_gate_changed:false,
  password_in_output:false,
  remote_restore_performed:false
 });
}
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
async function cli(args){
 if(args.length!==1||!['--inspect','--reset'].includes(args[0]))fail('LOCAL_CHECKOUT');
 localProductionTarget();
 // For reset, require reviewed local MAIN, git clean, not GitHub CI.
 if(args[0]==='--reset'){try{assertTrustedMainCheckout();}catch{fail('LOCAL_CHECKOUT');}}
 if(!process.stdin.isTTY||!process.stdout.isTTY)fail('TOKEN_INPUT');
 const token=await hidden(args[0]==='--reset'
  ?'Cloudflare Production D1 Write Token (hidden): '
  :'Cloudflare Production D1 Read Token (hidden): ');
 if(token.length<20||token.length>4096)fail('TOKEN_INPUT');
 await inspectProductionOwnerRecovery(token);
 if(args[0]==='--inspect'){
  process.stdout.write(JSON.stringify(safeRecoverySummary())+'\n');return;
 }
 process.stdout.write('Unique active Owner and D1 integrity verified. No other data will be edited.\n');
 process.stdout.write('One remote write batch; NEVER retry after an uncertain result.\n');
 const rl=createInterface({input:process.stdin,output:process.stdout});
 let approval='';
 try{approval=await rl.question('Type '+RESET_APPROVAL+' to authorize: ');}
 finally{rl.close();}
 if(approval!==RESET_APPROVAL)fail('EXPLICIT_APPROVAL');
 const first=await hidden('New Owner password (hidden, 12-256 chars): ');
 const second=await hidden('Confirm new Owner password (hidden): ');
 if(first!==second||first.length<12||first.length>256)fail('PASSWORD_INPUT');
 const result=await resetExistingProductionOwner({token,newPassword:first,approval});
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 cli(process.argv.slice(2)).catch(e=>{
  const stage=stages.has(e?.safeStage)?e.safeStage:'INVALID_STATE';
  process.stderr.write(FAIL+' stage='+stage+'; NO AUTOMATIC REMOTE WRITE RETRY.\n');
  process.exitCode=1;
 });
}
