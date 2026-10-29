// P0 #34 / G1: read-only staging D1 live snapshot verifier.
// This code never contacts Cloudflare, changes D1, or certifies production readiness.
// Real Cloudflare queries are performed ONLY by the manual staging GitHub workflow.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyStagingConfig,rowsFromWranglerJson,ACCOUNT_ID} from './check-cloudflare-staging.mjs';
export {ACCOUNT_ID};

const STAGING_ONLY_FILES=Object.freeze(['tables','contract','migrations','indexes','fk','counts']);
const REQUIRED_INDEXES=Object.freeze(new Map([
  ['idx_login_attempts_username_nocase_at',/\bON\s+login_attempts\s*\(\s*username\s+COLLATE\s+NOCASE\s*,\s*at\s*\)/i],
  ['idx_login_attempts_ip_hash_at',/\bON\s+login_attempts\s*\(\s*ip_hash\s*,\s*at\s*\)/i],
  ['idx_login_attempts_at',/\bON\s+login_attempts\s*\(\s*at\s*,\s*id\s*\)/i]
]));
const REQUIRED_MIGRATIONS=Object.freeze(['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql']);
const fail=()=>{throw new Error('E_STAGING_G1_READONLY_CONTRACT');};
function exactKeys(obj,keys){
  if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    JSON.stringify(Object.keys(obj).sort())!==JSON.stringify([...keys].sort()))fail();
}
function rows(value){try{return rowsFromWranglerJson(value);}catch{fail();}}
function single(value,keys){
  const list=rows(value);if(list.length!==1)fail();
  exactKeys(list[0],keys);return list[0];
}
function strings(value,keys,label){
  return rows(value).map(item=>{
    exactKeys(item,keys);
    for(const k of keys)if(typeof item[k]!=='string'||!item[k])fail();
    return item;
  });
}
function nonnegativeInteger(value){
  if(!Number.isSafeInteger(value)||value<0)fail();
  return value;
}
export function verifyLocalTarget(worker,staging,accountId){
  try{verifyStagingConfig(worker,staging);}catch{fail();}
  if(accountId!==ACCOUNT_ID)fail();
  if(staging?.d1_databases?.length!==1||
      staging.d1_databases[0].binding!=='STAGING_DB')fail();
  return true;
}
export function auditStagingSnapshot(raw,initialSql){
  exactKeys(raw,STAGING_ONLY_FILES);
  if(typeof initialSql!=='string')fail();
  const tables=[...initialSql.matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)]
    .map(v=>v[1]);
  if(tables.length!==22||new Set(tables).size!==22)fail();
  const expectedTables=[...tables,'d1_migrations'].sort();
  const receivedTables=strings(raw.tables,['name'],'table').map(v=>v.name).sort();
  if(new Set(receivedTables).size!==receivedTables.length||
      JSON.stringify(receivedTables)!==JSON.stringify(expectedTables))fail();

  const contract=single(raw.contract,['contract_version']);
  if(contract.contract_version!==3)fail();

  const migrationList=strings(raw.migrations,['name'],'migration').map(x=>x.name);
  if(JSON.stringify(migrationList)!==JSON.stringify(REQUIRED_MIGRATIONS))fail();

  const idx=strings(raw.indexes,['name','sql'],'index');
  if(idx.length!==3||new Set(idx.map(x=>x.name)).size!==3)fail();
  for(const [name,pattern] of REQUIRED_INDEXES){
    const item=idx.find(x=>x.name===name);
    if(!item||!pattern.test(item.sql))fail();
  }
  if(rows(raw.fk).length!==0)fail();

  const count=single(raw.counts,['total_users','active_owners','total_owners','sessions','purchase_orders','stocktakes','stock_moves']);
  for(const val of Object.values(count))nonnegativeInteger(val);
  // Synthetic staging already has its seed Owner. No user identifiers,
  // password hashes, user rows, or tokens are retrieved or printed.
  if(count.total_users<1||count.total_owners!==1||count.active_owners!==1)fail();
  return Object.freeze({
    status:'STAGING_G1_READONLY_REMOTE_SNAPSHOT_CONSISTENT',
    schema_version:3,
    index_migration:'0002_verified',
    foreign_keys:'verified_empty',
    owner_count:'exactly_one_active',
    data_read_scope:'aggregate_counts_only',
    live_access_verified:false,
    hosted_cpu_verified:false,
    production_d1_verified:false,
    production_deploy_authorized:false,
    operations_write_enabled:false
  });
}
export function loadSnapshot(dir){
  if(!path.isAbsolute(dir))fail();
  const stat=fs.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())fail();
  const out={};
  for(const name of STAGING_ONLY_FILES){
    const file=path.join(dir,name+'.json');
    const info=fs.lstatSync(file);
    if(!info.isFile()||info.isSymbolicLink()||info.size>65536)fail();
    out[name]=JSON.parse(fs.readFileSync(file,'utf8'));
  }
  return out;
}
const script=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===script){
  try{
    const [mode,...args]=process.argv.slice(2);
    if(mode==='config'&&args.length===0){
      verifyLocalTarget(
        JSON.parse(fs.readFileSync('wrangler.jsonc','utf8')),
        JSON.parse(fs.readFileSync('wrangler.preview-migrations.jsonc','utf8')),
        process.env.CLOUDFLARE_ACCOUNT_ID
      );
      console.log('STAGING_G1_CONFIG_PASS');
    }else if(mode==='verify'&&args.length===1){
      verifyLocalTarget(
        JSON.parse(fs.readFileSync('wrangler.jsonc','utf8')),
        JSON.parse(fs.readFileSync('wrangler.preview-migrations.jsonc','utf8')),
        process.env.CLOUDFLARE_ACCOUNT_ID
      );
      const sql=fs.readFileSync('cloudflare/migrations/0001_initial_v3.sql','utf8');
      console.log(JSON.stringify(auditStagingSnapshot(loadSnapshot(args[0]),sql)));
    }else fail();
  }catch{
    // Do not reveal raw JSON, account ids, DB rows, local secret paths or SQL.
    console.error('E_STAGING_G1_READONLY_AUDIT_FAILED');
    process.exitCode=1;
  }
}
