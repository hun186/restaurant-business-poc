// Staging 0003 remote-read snapshot validator. ZERO D1 writes or HTTP calls.
// Not a migration runner: only validates fixed local config and read-only JSON.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ACCOUNT_ID, rowsFromWranglerJson} from './check-cloudflare-staging.mjs';
const STAGING_ID='2c355bed-d9c3-449c-aa9b-1018f3bc1177';
const PRODUCTION_ID='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
const CONFIG='wrangler.staging-access-0003.jsonc';
const BASE='wrangler.preview-migrations.jsonc';
const ISOLATED='cloudflare/migrations-access-0003';
const ACTIVE='cloudflare/migrations';
const MIGRATION='0003_access_identity_links.sql';
const files=['ledger','contract','owners','table','fk','integrity'];
const error=code=>{throw Error('E_STAGING_0003_READONLY_'+code);};
const keys=(obj,expected)=>!!obj && typeof obj==='object' && !Array.isArray(obj) &&
  JSON.stringify(Object.keys(obj).sort())===JSON.stringify([...expected].sort());
const json=(root,file)=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8'));
const ddl=source=>source.slice(source.indexOf('CREATE TABLE access_identity_links (')).trim().replace(/;\s*$/,'');
const sorted=(root,dir)=>fs.readdirSync(path.join(root,dir)).sort();
export function verify0003ReadOnlyConfig(root,accountId) {
  if(accountId!==ACCOUNT_ID)error('ACCOUNT');
  const staging=json(root,CONFIG),baseline=json(root,BASE),prod=json(root,'wrangler.jsonc');
  if(!keys(staging,['name','compatibility_date','d1_databases']) ||
    staging.name!=='restaurant-business-staging-access-link-0003-migrations' ||
    staging.compatibility_date!=='2026-10-25' ||
    !Array.isArray(staging.d1_databases)||staging.d1_databases.length!==1 ||
    !keys(staging.d1_databases[0],['binding','database_name','database_id','migrations_dir']))error('CONFIG');
  const db=staging.d1_databases[0];
  if(db.binding!=='STAGING_DB' || db.database_name!=='restaurant-business-staging' ||
    db.database_id!==STAGING_ID || db.database_id===PRODUCTION_ID ||
    db.migrations_dir!==ISOLATED ||
    baseline.d1_databases?.[0]?.database_id!==STAGING_ID ||
    baseline.d1_databases?.[0]?.migrations_dir!==ACTIVE ||
    prod.d1_databases?.[0]?.database_id!==PRODUCTION_ID)error('BINDING');
  if(JSON.stringify(sorted(root,ACTIVE).filter(x=>x.endsWith('.sql')))!==
      JSON.stringify(['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql']) ||
    JSON.stringify(sorted(root,ISOLATED))!==JSON.stringify([MIGRATION]))error('INVENTORY');
  const actual=fs.readFileSync(path.join(root,ISOLATED,MIGRATION),'utf8');
  const approved=fs.readFileSync(path.join(root,'cloudflare/migration-proposals',MIGRATION),'utf8');
  if(!actual.includes('CREATE TABLE access_identity_links (') || ddl(actual)!==ddl(approved) ||
    !/active INTEGER NOT NULL DEFAULT 0 CHECK\(active IN \(0,1\)\)/.test(actual))error('DDL');
  return true;
}
const rows=(data,name)=>{
  try{
    if(!Object.hasOwn(data,name))error('MISSING_'+name.toUpperCase());
    const entries=rowsFromWranglerJson(data[name]);
    if(!Array.isArray(entries))error('INVALID_'+name.toUpperCase());
    return entries;
  }catch{error('INVALID_'+name.toUpperCase());}
};
export function inspect0003ReadOnly(data,expectedDdl){
  if(!data||typeof data!=='object'||Array.isArray(data))error('SNAPSHOT');
  if(typeof expectedDdl!=='string'||!expectedDdl.includes('CREATE TABLE access_identity_links ('))error('EXPECTED_DDL');
  const ledger=rows(data,'ledger');
  if(ledger.some(x=>!x||typeof x.name!=='string')||new Set(ledger.map(x=>x.name)).size!==ledger.length)error('LEDGER');
  const before=['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'];
  const with3=[...before,MIGRATION];
  const names=ledger.map(x=>x.name);
  const ready=JSON.stringify(names)===JSON.stringify(before);
  const applied=JSON.stringify(names)===JSON.stringify(with3);
  if(!ready&&!applied)error('LEDGER_ORDER');
  const contract=rows(data,'contract');
  if(contract.length!==1||contract[0].contract_version!==3)error('CONTRACT');
  const owners=rows(data,'owners');
  if(owners.length!==1 || owners[0].username!=='owner' || owners[0].role!=='owner' ||
    Number(owners[0].active)!==1 || typeof owners[0].id!=='string' || owners[0].id.length<16)error('OWNER');
  const tables=rows(data,'table');
  if(tables.length!==(ready?0:1))error('TABLE_LEDGER_MISMATCH');
  if(applied&&(tables[0].name!=='access_identity_links'||
    typeof tables[0].sql!=='string'||
    ddl(tables[0].sql)!==ddl(expectedDdl)))error('TABLE_DDL');
  if(rows(data,'fk').length!==0)error('FOREIGN_KEY');
  const integrity=rows(data,'integrity');
  if(integrity.length!==1||integrity[0].quick_check!=='ok')error('INTEGRITY');
  return Object.freeze({result:ready?'STAGING_0003_READONLY_READY':'STAGING_0003_READONLY_ALREADY_APPLIED',
    database:'staging',cloud_auth_ready:false,identity_enrollment_verified:false,
    production_ready:false,remote_write_authorized:false});
}
function run(args){
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  if(args.length===1 && args[0]==='config'){
    verify0003ReadOnlyConfig(root,process.env.CLOUDFLARE_ACCOUNT_ID);
    process.stdout.write('STAGING_0003_READONLY_CONFIG_PASS\n');return;
  }
  if(args.length!==2||args[0]!=='inspect')error('USAGE');
  verify0003ReadOnlyConfig(root,process.env.CLOUDFLARE_ACCOUNT_ID);
  const dir=path.resolve(args[1]);
  if(!fs.statSync(dir).isDirectory())error('SNAPSHOT_PATH');
  const data=Object.fromEntries(files.map(name=>[name,json(dir,name+'.json')]));
  const source=fs.readFileSync(path.join(root,ISOLATED,MIGRATION),'utf8');
  const result=inspect0003ReadOnly(data,source);
  process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{run(process.argv.slice(2));}
  catch{process.stderr.write('STAGING_0003_READONLY_BLOCKED\n');process.exitCode=1;}
}
