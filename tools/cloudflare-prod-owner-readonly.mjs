// Credential-free, read-only Production D1 Owner status verifier.
// Never accepts account passwords, generates INSERT/DELETE, or writes D1.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  preflightSql,postflightSql,checkProductionOwnerPreflight,
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
  if(!inputs||typeof inputs!=='object' || Array.isArray(inputs) ||
    Object.keys(inputs).sort().join(',')!=='after,before,foreign,quick')fail();
  const quick=rows(inputs.quick);
  if(quick.length!==1 || quick[0]?.quick_check!=='ok' ||
     Object.keys(quick[0]).length!==1)fail();
  if(rows(inputs.foreign).length!==0)fail();
  let pristine=false,ownerExists=false;
  try {pristine=checkProductionOwnerPreflight(inputs.before)===true;}catch{}
  try {ownerExists=verifyProductionOwnerPostflight(inputs.after,inputs.foreign)===true;}catch{}
  if(pristine===ownerExists)fail(); // Both false = inconsistent/malformed; both true = impossible.
  return Object.freeze({
    status:pristine?'PRODUCTION_OWNER_READY_TO_ENROLL_READONLY':'PRODUCTION_OWNER_ALREADY_ENROLLED_READONLY',
    production_write_performed:false,
    owner_created_by_check:false,
    login_enabled_by_check:false,
    schema_version:3,
    applied_migrations:2,
    owner_count:ownerExists?1:0
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
