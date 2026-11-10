// Production D1 auth-activity investigation: a fixed SQL SELECT, boolean-only
// results and a fail-closed CLI. Never prints credentials, raw rows or counts.
// This is not an Owner enrollment, D1 cleanup or production release approval.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {rowsFromWranglerJson} from './check-cloudflare-staging.mjs';

const FAIL='E_PROD_AUTH_ACTIVITY_READONLY';
const FIELDS=Object.freeze([
  'schema_ok','migrations_ok','users_present','owner_candidate_present',
  'owner_bootstrap_audit_present','sessions_present',
  'unexpired_active_user_session_present','expired_sessions_present',
  'invalid_session_expiry_present','login_attempts_present',
  'recent_login_attempts_present','successful_login_attempts_present',
  'failed_login_attempts_present'
]);
const stages=new Set(['INVALID_MODE','INVALID_EVIDENCE','INVALID_RESULT',
  'SCHEMA_NOT_READY']);
function fail(stage='INVALID_RESULT'){
 const e=Error(FAIL);
 e.safeStage=stages.has(stage)?stage:'INVALID_RESULT';
 throw e;
}
// One fixed SELECT only. Explicit aliases, EXISTS rather than row data/counts.
// 'unexpired' means a saved session of an active user has a future expiry;
// it does NOT demonstrate working login or an accessible session while gate OFF.
const SQL=[
 "(SELECT contract_version FROM cloud_schema_contract WHERE id=1)=3 AS schema_ok",
 "(SELECT COUNT(*) FROM d1_migrations)=2 AND (SELECT COUNT(*) FROM d1_migrations WHERE name='0001_initial_v3.sql')=1 AND (SELECT COUNT(*) FROM d1_migrations WHERE name='0002_login_attempts_window_indexes.sql')=1 AS migrations_ok",
 "EXISTS(SELECT 1 FROM users) AS users_present",
 "EXISTS(SELECT 1 FROM users WHERE username='owner' COLLATE NOCASE AND role='owner' AND active=1 AND password_hash LIKE 'pbkdf2-sha256$100000$%') AS owner_candidate_present",
 "EXISTS(SELECT 1 FROM audit_logs WHERE actor_name='production-bootstrap' AND action='auth.owner_bootstrap' AND entity='users') AS owner_bootstrap_audit_present",
 "EXISTS(SELECT 1 FROM sessions) AS sessions_present",
 "EXISTS(SELECT 1 FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.active=1 AND unixepoch(s.expires_at)>unixepoch('now')) AS unexpired_active_user_session_present",
 "EXISTS(SELECT 1 FROM sessions WHERE unixepoch(expires_at)<=unixepoch('now')) AS expired_sessions_present",
 "EXISTS(SELECT 1 FROM sessions WHERE unixepoch(expires_at) IS NULL) AS invalid_session_expiry_present",
 "EXISTS(SELECT 1 FROM login_attempts) AS login_attempts_present",
 "EXISTS(SELECT 1 FROM login_attempts WHERE at>=datetime('now','-7 days')) AS recent_login_attempts_present",
 "EXISTS(SELECT 1 FROM login_attempts WHERE success=1) AS successful_login_attempts_present",
 "EXISTS(SELECT 1 FROM login_attempts WHERE success=0) AS failed_login_attempts_present"
].join(',\n  ');
export function productionAuthActivitySql(mode){
 if(mode!=='auth')fail('INVALID_MODE');
 return 'SELECT '+SQL+';';
}
export function inspectProductionAuthActivity(raw){
 let rows;
 try{rows=rowsFromWranglerJson(raw);}catch{fail('INVALID_RESULT');}
 if(rows.length!==1||!rows[0]||typeof rows[0]!=='object'||
   Array.isArray(rows[0]) ||
   JSON.stringify(Object.keys(rows[0]).sort())!==JSON.stringify([...FIELDS].sort()))
   fail('INVALID_RESULT');
 const row=rows[0];
 if(!FIELDS.every(name=>row[name]===0||row[name]===1))fail('INVALID_RESULT');
 if(!row.schema_ok||!row.migrations_ok)fail('SCHEMA_NOT_READY');
 const value=name=>row[name]===1;
 if(!value('sessions_present')&&
   (value('unexpired_active_user_session_present')||
    value('expired_sessions_present')||value('invalid_session_expiry_present')))
   fail('INVALID_RESULT');
 if(!value('users_present')&&
   (value('owner_candidate_present')||value('unexpired_active_user_session_present')))
   fail('INVALID_RESULT');
 if(!value('login_attempts_present')&&
   (value('recent_login_attempts_present')||
    value('successful_login_attempts_present')||
    value('failed_login_attempts_present')))fail('INVALID_RESULT');
 if(value('login_attempts_present')&&
   !value('successful_login_attempts_present')&&
   !value('failed_login_attempts_present'))fail('INVALID_RESULT');
 // Do not leak the raw D1 response, identities, timestamps or counts.
 return Object.freeze({
  status:'PROD_AUTH_ACTIVITY_READONLY_PASS',
  ...Object.fromEntries(FIELDS.filter(name=>!['schema_ok','migrations_ok'].includes(name))
   .map(name=>[name,value(name)])),
  schema_contract_verified:true,
  production_write_performed:false,
  owner_created_or_modified:false,
  login_gate_modified:false,
  cleanup_authorized:false,
  release_authorized:false
 });
}
export function inspectPrivateEvidenceFile(filepath){
 if(typeof filepath!=='string'||!path.isAbsolute(filepath))fail('INVALID_EVIDENCE');
 let raw;
 try{
  const stat=fs.lstatSync(filepath);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)fail('INVALID_EVIDENCE');
  raw=JSON.parse(fs.readFileSync(filepath,'utf8'));
 }catch{fail('INVALID_EVIDENCE');}
 return inspectProductionAuthActivity(raw);
}
const self=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 try{
  const [mode,arg,...rest]=process.argv.slice(2);
  if(rest.length)fail('INVALID_MODE');
  if(mode==='sql'&&arg==='auth')
   process.stdout.write(productionAuthActivitySql('auth')+'\n');
  else if(mode==='inspect'&&arg)
   process.stdout.write(JSON.stringify(inspectPrivateEvidenceFile(arg))+'\n');
  else fail('INVALID_MODE');
 }catch(error){
  // Only fixed allowlisted tokens; never print raw errors or payloads.
  const stage=stages.has(error?.safeStage)?error.safeStage:'INVALID_RESULT';
  process.stderr.write(FAIL+' stage='+stage+'\n');
  process.exitCode=1;
 }
}
