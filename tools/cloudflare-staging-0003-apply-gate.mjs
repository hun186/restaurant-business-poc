// Offline gate for a separately, manually triggered Staging-only 0003 D1 migration.
// This module does not call Cloudflare, SQL execute, Wrangler or any network.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verify0003ReadOnlyConfig,inspect0003ReadOnly} from './cloudflare-staging-access-0003-readonly.mjs';
import {verify0003Transition} from './cloudflare-staging-0003-transition-evidence.mjs';
import {rowsFromWranglerJson} from './check-cloudflare-staging.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DDL='cloudflare/migrations-access-0003/0003_access_identity_links.sql';
const FILES=['ledger','contract','owners','tables','indexes','table','fk','integrity','counts'];
const COUNTS=['users','sessions','locations','user_locations','tasks','stock_moves','audit_logs'];
const fail=code=>{throw Error('E_STAGING_0003_APPLY_'+code);};
const exactKeys=(obj,names)=>!!obj && typeof obj==='object' && !Array.isArray(obj) &&
  JSON.stringify(Object.keys(obj).sort())===JSON.stringify(names.slice().sort());
const rows=(data,key)=>{
  try {return rowsFromWranglerJson(data[key]);}
  catch {fail('INVALID_'+key.toUpperCase());}
};
export function validate0003ApplyPreflight(before,ddl){
  if(inspect0003ReadOnly(before,ddl).result!=='STAGING_0003_READONLY_READY')
    fail('NOT_READY');
  const counts=rows(before,'counts');
  if(counts.length!==1||!exactKeys(counts[0],COUNTS))fail('COUNTS');
  for(const key of COUNTS){
    if(!Number.isSafeInteger(counts[0][key])||counts[0][key] < 0)fail('COUNT_VALUE');
    // Staging 0003 is safe to apply to the current solitary synthetic Owner;
    // any real activity or additional users requires a separate review.
    if(counts[0][key] !== (key==='users'?1:0))fail('NOT_PRISTINE');
  }
  return Object.freeze({result:'STAGING_0003_APPLY_PREFLIGHT_PASS',
    staging_only:true,remote_write_executed:false,identity_enrollment_verified:false});
}
export function validate0003ApplyPostflight(before,after,ddl){
  validate0003ApplyPreflight(before,ddl);
  return verify0003Transition(before,after,ddl);
}
function load(dir,postflight=false){
  if(typeof dir!=='string'||!dir)fail('DIRECTORY');
  const absolute=path.resolve(dir);
  if(!fs.statSync(absolute).isDirectory())fail('DIRECTORY');
  const names=postflight?[...FILES,'link_count']:FILES;
  return Object.fromEntries(names.map(n=>[n,JSON.parse(fs.readFileSync(path.join(absolute,n+'.json'),'utf8'))]));
}
function cli(args){
  if(!['preflight','postflight'].includes(args[0]))fail('MODE');
  if(args.length!==(args[0]==='preflight'?2:3))fail('ARGS');
  verify0003ReadOnlyConfig(ROOT,process.env.CLOUDFLARE_ACCOUNT_ID);
  const ddl=fs.readFileSync(path.join(ROOT,DDL),'utf8');
  const before=load(args[1]);
  const result=args[0]==='preflight'
    ?validate0003ApplyPreflight(before,ddl)
    :validate0003ApplyPostflight(before,load(args[2],true),ddl);
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {cli(process.argv.slice(2));}
  catch {process.stderr.write('STAGING_0003_APPLY_BLOCKED\n');process.exitCode=1;}
}
