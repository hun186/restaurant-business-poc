// Separate read-only structural attestation for an ALREADY enrolled Production Owner.
// Never invoke this verifier to authorize initial enrollment, a login gate, D1
// cleanup or a business write. The strict first-enrollment validator is unchanged.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {EMPTY_TABLES,preflightSql,postflightSql} from './cloudflare-production-owner.mjs';
import {rowsFromWranglerJson} from './check-cloudflare-staging.mjs';

const FAIL='E_PROD_ENROLLED_OWNER_READONLY';
const STAGES=new Set(['INVALID_MODE','INVALID_EVIDENCE','RESULT_SHAPE',
  'SCHEMA_CONTRACT','INTEGRITY','SNAPSHOT_DRIFT','OWNER_NOT_READY']);
function fail(stage='OWNER_NOT_READY'){
 const e=Error(FAIL);
 e.safeStage=STAGES.has(stage)?stage:'OWNER_NOT_READY';
 throw e;
}
const rows=input=>{try{return rowsFromWranglerJson(input);}catch{fail('RESULT_SHAPE');}};
const fields=['contract_version','migration_total','migration_1','migration_2',...EMPTY_TABLES];
const afterFields=['contract_version','migration_total','users','owners','sessions',
 'login_attempts','audit_logs','owner_enrollment_audits',
 'exact_owner_credential_format','unrecognized_audits'];
const exactKeys=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 JSON.stringify(Object.keys(x).sort())===JSON.stringify([...keys].sort());

// This extra audit condition is ONLY for already-enrolled Owner inspection.
// The original postflightSql() and verifyProductionOwnerPostflight() still
// demand pristine login_attempts=0/audit_logs=1 for initial enrollment.
// Recognized auth history precisely matches the reviewed D1 login-service
// audit producers; unrelated/badly formed audit events must fail closed.
const OWNER_ID=`(SELECT id FROM users WHERE username='owner' COLLATE NOCASE AND role='owner' AND active=1)`;
// Match the actual auth producers, not merely their event/action labels.
// SQLite GLOB is case-sensitive; negate *any* unexpected character (not just
// check the first character). Never print these stored hashes/names.
const SOURCE_HASH=`ip_hash IS NOT NULL AND length(ip_hash)=64 AND
  ip_hash NOT GLOB '*[^0-9a-f]*'`;
const AUTH_USERNAME=`actor_name IS NOT NULL AND length(actor_name) BETWEEN 1 AND 40
  AND actor_name NOT GLOB '*[^A-Za-z0-9_.-]*'`;
const NO_ENTITY_TARGET=`entity_id IS NULL AND location_id IS NULL`;
const ALLOWED_AUDIT=[
 `(actor_name='production-bootstrap' AND action='auth.owner_bootstrap' AND
    entity='users' AND actor_id IS NULL AND location_id IS NULL AND
    ip_hash IS NULL AND entity_id=${OWNER_ID} AND
    json_extract(detail,'$.hash_version')='pbkdf2-sha256$100000')`,
 `(action='auth.login_failed' AND entity='sessions' AND actor_id IS NULL
    AND ${NO_ENTITY_TARGET} AND ${AUTH_USERNAME} AND ${SOURCE_HASH}
    AND detail='{}')`,
 `(action='auth.login' AND entity='sessions' AND actor_id=${OWNER_ID}
    AND ${NO_ENTITY_TARGET} AND actor_name='owner' COLLATE NOCASE
    AND ${SOURCE_HASH} AND detail='{}')`,
 `(action='auth.logout' AND entity='sessions' AND actor_id=${OWNER_ID}
    AND ${NO_ENTITY_TARGET} AND actor_name='owner' COLLATE NOCASE
    AND ip_hash IS NULL AND detail='{}')`
].join(' OR ');

export function enrolledOwnerSql(which){
 if(which==='before')return preflightSql();
 if(which==='quick')return 'PRAGMA quick_check;';
 if(which==='foreign')return 'PRAGMA foreign_key_check;';
 if(which==='after'){
  const base=postflightSql();
  if(!base.endsWith(';'))fail('INVALID_MODE');
  // Validate the exact lowercase salt/digest character set as well as length.
  // The strict initial Owner enrollment verifier is not changed.
  const validCredentials=`(SELECT COUNT(*) FROM users WHERE
    username='owner' COLLATE NOCASE AND role='owner' AND active=1
    AND length(password_salt)=32 AND password_salt NOT GLOB '*[^0-9a-f]*'
    AND length(password_hash)=85 AND
    substr(password_hash,1,21)='pbkdf2-sha256$100000
 }
 fail('INVALID_MODE');
}

export function inspectEnrolledOwner(inputs){
 if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||
   Object.keys(inputs).sort().join(',')!=='after,before,foreign,quick')
   fail('RESULT_SHAPE');
 const quick=rows(inputs.quick),foreign=rows(inputs.foreign);
 if(quick.length!==1||!exactKeys(quick[0],['quick_check'])||
   quick[0].quick_check!=='ok'||foreign.length!==0)fail('INTEGRITY');
 const pre=rows(inputs.before),post=rows(inputs.after);
 if(pre.length!==1||post.length!==1||!exactKeys(pre[0],fields)||
   !exactKeys(post[0],afterFields))fail('RESULT_SHAPE');
 const a=pre[0],b=post[0];
 if(![...Object.values(a),...Object.values(b)]
  .every(x=>Number.isSafeInteger(x)&&x>=0))fail('SCHEMA_CONTRACT');
 if(a.contract_version!==3||b.contract_version!==3||
   a.migration_total!==2||b.migration_total!==2||
   a.migration_1!==1||a.migration_2!==1)fail('SCHEMA_CONTRACT');
 // Separate SELECT snapshots may drift; any changed auth/account/audit count
 // refuses success instead of taking the more permissive partial picture.
 if(['users','sessions','login_attempts','audit_logs']
  .some(t=>a[t]!==b[t]))fail('SNAPSHOT_DRIFT');
 // All operational tables must still be unused before Production business
 // release. Only login attempt history and its known authentication audits
 // may exist alongside one properly bootstrapped Owner.
 if(EMPTY_TABLES.some(t=>!['users','login_attempts','audit_logs']
  .includes(t)&&a[t]!==0))fail();
 if(a.users!==1||b.users!==1||b.owners!==1||a.sessions!==0||
   b.sessions!==0||a.audit_logs<1||b.audit_logs<1||
   b.owner_enrollment_audits!==1||b.exact_owner_credential_format!==1||
   b.unrecognized_audits!==0)fail();
 return Object.freeze({
  status:'PRODUCTION_ENROLLED_OWNER_READONLY_PASS',
  schema_version:3,applied_migrations:2,owner_count:1,
  retained_login_attempt_history:b.login_attempts>0,
  retained_auth_audit_history:b.audit_logs>1,
  session_count_zero_verified:true,
  business_tables_empty_verified:true,
  production_write_performed:false,owner_created_or_modified:false,
  initial_owner_enrollment_authorized:false,
  login_gate_modified:false,release_authorized:false
 });
}
export function inspectEvidenceDirectory(dir){
 if(typeof dir!=='string'||!path.isAbsolute(dir))fail('INVALID_EVIDENCE');
 const data={};
 for(const name of ['before','after','quick','foreign']){
  const p=path.join(dir,name+'.json');
  try{
   const stat=fs.lstatSync(p);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)
    fail('INVALID_EVIDENCE');
   data[name]=JSON.parse(fs.readFileSync(p,'utf8'));
  }catch{fail('INVALID_EVIDENCE');}
 }
 return inspectEnrolledOwner(data);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,arg,...rest]=process.argv.slice(2);
  if(rest.length)fail('INVALID_MODE');
  if(mode==='sql'&&arg)
   process.stdout.write(enrolledOwnerSql(arg)+'\n');
  else if(mode==='inspect'&&arg)
   process.stdout.write(JSON.stringify(inspectEvidenceDirectory(arg))+'\n');
  else fail('INVALID_MODE');
 }catch(e){
  // Do not expose DB rows, raw errors, SQL, account IDs or credentials.
  process.stderr.write(FAIL+' stage='+
   (STAGES.has(e?.safeStage)?e.safeStage:'OWNER_NOT_READY')+'\n');
  process.exitCode=1;
 }
}
 AND
    substr(password_hash,22) NOT GLOB '*[^0-9a-f]*') AS exact_owner_credential_format`;
  return base.slice(0,-1)+', '+validCredentials+
   ', (SELECT COALESCE(SUM(CASE WHEN ('+
   ALLOWED_AUDIT+') THEN 0 ELSE 1 END),0) FROM audit_logs) AS unrecognized_audits;';
 }
 fail('INVALID_MODE');
}

export function inspectEnrolledOwner(inputs){
 if(!inputs||typeof inputs!=='object'||Array.isArray(inputs)||
   Object.keys(inputs).sort().join(',')!=='after,before,foreign,quick')
   fail('RESULT_SHAPE');
 const quick=rows(inputs.quick),foreign=rows(inputs.foreign);
 if(quick.length!==1||!exactKeys(quick[0],['quick_check'])||
   quick[0].quick_check!=='ok'||foreign.length!==0)fail('INTEGRITY');
 const pre=rows(inputs.before),post=rows(inputs.after);
 if(pre.length!==1||post.length!==1||!exactKeys(pre[0],fields)||
   !exactKeys(post[0],afterFields))fail('RESULT_SHAPE');
 const a=pre[0],b=post[0];
 if(![...Object.values(a),...Object.values(b)]
  .every(x=>Number.isSafeInteger(x)&&x>=0))fail('SCHEMA_CONTRACT');
 if(a.contract_version!==3||b.contract_version!==3||
   a.migration_total!==2||b.migration_total!==2||
   a.migration_1!==1||a.migration_2!==1)fail('SCHEMA_CONTRACT');
 // Separate SELECT snapshots may drift; any changed auth/account/audit count
 // refuses success instead of taking the more permissive partial picture.
 if(['users','sessions','login_attempts','audit_logs']
  .some(t=>a[t]!==b[t]))fail('SNAPSHOT_DRIFT');
 // All operational tables must still be unused before Production business
 // release. Only login attempt history and its known authentication audits
 // may exist alongside one properly bootstrapped Owner.
 if(EMPTY_TABLES.some(t=>!['users','login_attempts','audit_logs']
  .includes(t)&&a[t]!==0))fail();
 if(a.users!==1||b.users!==1||b.owners!==1||a.sessions!==0||
   b.sessions!==0||a.audit_logs<1||b.audit_logs<1||
   b.owner_enrollment_audits!==1||b.unrecognized_audits!==0)fail();
 return Object.freeze({
  status:'PRODUCTION_ENROLLED_OWNER_READONLY_PASS',
  schema_version:3,applied_migrations:2,owner_count:1,
  retained_login_attempt_history:b.login_attempts>0,
  retained_auth_audit_history:b.audit_logs>1,
  session_count_zero_verified:true,
  business_tables_empty_verified:true,
  production_write_performed:false,owner_created_or_modified:false,
  initial_owner_enrollment_authorized:false,
  login_gate_modified:false,release_authorized:false
 });
}
export function inspectEvidenceDirectory(dir){
 if(typeof dir!=='string'||!path.isAbsolute(dir))fail('INVALID_EVIDENCE');
 const data={};
 for(const name of ['before','after','quick','foreign']){
  const p=path.join(dir,name+'.json');
  try{
   const stat=fs.lstatSync(p);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)
    fail('INVALID_EVIDENCE');
   data[name]=JSON.parse(fs.readFileSync(p,'utf8'));
  }catch{fail('INVALID_EVIDENCE');}
 }
 return inspectEnrolledOwner(data);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,arg,...rest]=process.argv.slice(2);
  if(rest.length)fail('INVALID_MODE');
  if(mode==='sql'&&arg)
   process.stdout.write(enrolledOwnerSql(arg)+'\n');
  else if(mode==='inspect'&&arg)
   process.stdout.write(JSON.stringify(inspectEvidenceDirectory(arg))+'\n');
  else fail('INVALID_MODE');
 }catch(e){
  // Do not expose DB rows, raw errors, SQL, account IDs or credentials.
  process.stderr.write(FAIL+' stage='+
   (STAGES.has(e?.safeStage)?e.safeStage:'OWNER_NOT_READY')+'\n');
  process.exitCode=1;
 }
}
