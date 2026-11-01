// Credential-free, read-only Production D1 Owner status verifier.
// Never accepts account passwords, generates INSERT/DELETE, or writes D1.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  EMPTY_TABLES,preflightSql,postflightSql,checkProductionOwnerPreflight,
  verifyProductionOwnerPostflight
} from './cloudflare-production-owner.mjs';
import {rowsFromWranglerJson} from './check-cloudflare-staging.mjs';

const FAIL='E_PRODUCTION_OWNER_READONLY';
function fail(){throw Error(FAIL);}
const rows=s=>{try{return rowsFromWranglerJson(s);}catch{fail();}};

export function ownerReadinessSql(which){
  if(which==='before')return preflightSql();
  if(which==='after')return postflightSql();
  if(which==='quick')return 'PRAGMA quick_check;';
  if(which==='foreign')return 'PRAGMA foreign_key_check;';
  fail();
}

export function verifyOwnerReadiness(inputs){
  if(!inputs||typeof inputs!=='object'||Array.isArray(inputs) ||
    Object.keys(inputs).sort().join(',')!=='after,before,foreign,quick')fail();
  const quick=rows(inputs.quick),fk=rows(inputs.foreign);
  if(quick.length!==1 || quick[0]?.quick_check!=='ok' ||
    Object.keys(quick[0]).length!==1 || fk.length!==0)fail();

  // Both independent SELECT snapshots must describe the *same* clean phase.
  // Reject mixed/torn snapshots, even if either single validator would pass.
  const pre=rows(inputs.before),post=rows(inputs.after);
  const preKeys=['contract_version','migration_total','migration_1','migration_2',...EMPTY_TABLES];
  const postKeys=['contract_version','migration_total','users','owners','sessions',
    'login_attempts','audit_logs','owner_enrollment_audits'];
  const hasKeys=(obj,keys)=>obj && typeof obj==='object'&&!Array.isArray(obj) &&
    JSON.stringify(Object.keys(obj).sort())===JSON.stringify([...keys].sort());
  if(pre.length!==1||post.length!==1||!hasKeys(pre[0],preKeys)||
    !hasKeys(post[0],postKeys))fail();
  const a=pre[0],b=post[0];
  const integer=x=>Number.isSafeInteger(x)&&x>=0;
  if(![...Object.values(a),...Object.values(b)].every(integer)||
    a.contract_version!==3||b.contract_version!==3||
    a.migration_total!==2||b.migration_total!==2||
    a.migration_1!==1||a.migration_2!==1)fail();
  const zeroExcept=(exceptions)=>EMPTY_TABLES.every(t=>
    a[t]===(exceptions[t]??0));
  let ownerCount;
  if(zeroExcept({}) && b.users===0 && b.owners===0 &&
    b.sessions===0 && b.login_attempts===0 && b.audit_logs===0 &&
    b.owner_enrollment_audits===0) {
    try{checkProductionOwnerPreflight(inputs.before);}catch{fail();}
    ownerCount=0;
  }else if(zeroExcept({users:1,audit_logs:1})){
    try{verifyProductionOwnerPostflight(inputs.after,inputs.foreign);}catch{fail();}
    ownerCount=1;
  }else fail();

  return Object.freeze({
    status:ownerCount?'PRODUCTION_OWNER_ALREADY_ENROLLED_READONLY':
      'PRODUCTION_OWNER_READY_TO_ENROLL_READONLY',
    production_write_performed:false,
    owner_created_by_check:false,
    login_enabled_by_check:false,
    schema_version:3,applied_migrations:2,owner_count:ownerCount
  });
}

export function verifyPrivateEvidenceDirectory(dir){
  if(typeof dir!=='string'||!path.isAbsolute(dir))fail();
  const names=['before','after','quick','foreign'];
  const obj={};
  for(const name of names){
    const p=path.join(dir,name+'.json');
    if(!fs.statSync(p).isFile())fail();
    obj[name]=JSON.parse(fs.readFileSync(p,'utf8'));
  }
  return verifyOwnerReadiness(obj);
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [mode,...rest]=process.argv.slice(2);
    if(mode==='sql'&&rest.length===1){
      process.stdout.write(ownerReadinessSql(rest[0])+'\n');
    }else if(mode==='inspect'&&rest.length===1){
      process.stdout.write(JSON.stringify(verifyPrivateEvidenceDirectory(rest[0]))+'\n');
    }else fail();
  }catch{
    // No D1 response, account ID, credential, SQL result or stack trace is logged.
    process.stderr.write(FAIL+'\n');
    process.exitCode=1;
  }
}
