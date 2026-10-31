// D1 staging 0003 BEFORE/AFTER evidence validator: zero remote calls and zero writes.
// Future protected manual workflow may use this after separately approved APPLY.
// Never creates users, identity links, sessions, or invokes Wrangler migrations.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {rowsFromWranglerJson} from './check-cloudflare-staging.mjs';
import {inspect0003ReadOnly,verify0003ReadOnlyConfig} from './cloudflare-staging-access-0003-readonly.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DDL='cloudflare/migrations-access-0003/0003_access_identity_links.sql';
const SNAPSHOT_FILES=['ledger','contract','owners','tables','indexes','table','fk','integrity','counts'];
const COUNT_KEYS=['users','sessions','locations','user_locations','tasks','stock_moves','audit_logs'];
function fail(code){throw Error('E_STAGING_0003_TRANSITION_'+code);}
function rows(raw,key){
  try {
    if(!raw||!Object.hasOwn(raw,key))fail('MISSING_'+key);
    return rowsFromWranglerJson(raw[key]);
  }catch{fail('INVALID_'+key);}
}
function counts(raw){
  const values=rows(raw,'counts');
  if(values.length!==1 || !values[0] || typeof values[0]!=='object' ||
      JSON.stringify(Object.keys(values[0]).sort())!==JSON.stringify(COUNT_KEYS.slice().sort()))
    fail('COUNTS');
  const result={};
  for(const key of COUNT_KEYS){
    const n=values[0][key];
    if(!Number.isSafeInteger(n)||n<0)fail('COUNT_VALUE');
    result[key]=n;
  }
  return result;
}
const copyRows=(raw,key)=>{
  const data=rows(raw,key);
  // No raw SQL or row values included in errors; only compare private evidence.
  return JSON.stringify(data);
};
export function verify0003Transition(before,after,expectedSql){
  if(inspect0003ReadOnly(before,expectedSql).result!=='STAGING_0003_READONLY_READY')
    fail('BEFORE_NOT_READY');
  if(inspect0003ReadOnly(after,expectedSql).result!=='STAGING_0003_READONLY_ALREADY_APPLIED')
    fail('AFTER_NOT_APPLIED');
  for(const key of ['contract','owners','indexes'])
    if(copyRows(before,key)!==copyRows(after,key))fail('PRESERVATION_'+key.toUpperCase());
  const b=counts(before),a=counts(after);
  for(const key of COUNT_KEYS)if(b[key]!==a[key])fail('BUSINESS_DATA_CHANGED');
  const links=rows(after,'link_count');
  if(links.length!==1||!links[0]||Object.keys(links[0]).length!==1||
    !Number.isSafeInteger(links[0].n)||links[0].n!==0)fail('LINKS_NOT_EMPTY');
  return Object.freeze({
    result:'STAGING_0003_ADD_ONLY_OFFLINE_TRANSITION_VERIFIED',
    staging_transition_verified:true,
    real_cloudflare_migration_performed_by_this_tool:false,
    identity_enrollment_verified:false,
    live_access_policy_verified:false,
    production_ready:false,
    remote_write_authorized:false
  });
}
function load(dir,after=false){
  if(typeof dir!=='string'||!dir)fail('DIRECTORY');
  const resolved=path.resolve(dir);
  if(!fs.statSync(resolved).isDirectory())fail('DIRECTORY');
  const files=after?[...SNAPSHOT_FILES,'link_count']:SNAPSHOT_FILES;
  return Object.fromEntries(files.map(name=>
    [name,JSON.parse(fs.readFileSync(path.join(resolved,name+'.json'),'utf8'))]));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==5||process.argv[2]!=='verify')fail('USAGE');
    verify0003ReadOnlyConfig(ROOT,process.env.CLOUDFLARE_ACCOUNT_ID);
    const sql=fs.readFileSync(path.join(ROOT,DDL),'utf8');
    const result=verify0003Transition(load(process.argv[3]),load(process.argv[4],true),sql);
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{
    process.stderr.write('STAGING_0003_TRANSITION_BLOCKED\n');
    process.exitCode=1;
  }
}
