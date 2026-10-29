// P0 / G5: Production D1 first-init guard (no automatic deployment or writes).
// Only a protected manual workflow can invoke Wrangler for migration, never this module.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PROD_ID,STAGING_ID,ACCOUNT_ID,rowsFromWranglerJson,verifyStagingConfig} from './check-cloudflare-staging.mjs';
import {APPROVED_TRANSITIVE_DEPENDENCIES_SHA256 as APPROVED} from './cloudflare-hosted-probe-approved-sha256.mjs';

const PROD_CONFIG='wrangler.production-initialize.jsonc';
const BASE_MIGRATIONS=['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql'];
const REQUIRED_INDEXES=new Map([
 ['idx_login_attempts_username_nocase_at',/\bON\s+login_attempts\s*\(\s*username\s+COLLATE\s+NOCASE\s*,\s*at\s*\)/i],
 ['idx_login_attempts_ip_hash_at',/\bON\s+login_attempts\s*\(\s*ip_hash\s*,\s*at\s*\)/i],
 ['idx_login_attempts_at',/\bON\s+login_attempts\s*\(\s*at\s*,\s*id\s*\)/i]
]);
const fail=()=>{throw new Error('E_PROD_D1_G5_GUARD');};
function requireTrue(ok){if(!ok)fail();}
function exactKeys(o,keys){
 requireTrue(o&&typeof o==='object'&&!Array.isArray(o)&&
  JSON.stringify(Object.keys(o).sort())===JSON.stringify([...keys].sort()));
}
function rows(value){try{return rowsFromWranglerJson(value);}catch{fail();}}
function one(value,keys){
 const r=rows(value);
 requireTrue(r.length===1);exactKeys(r[0],keys);return r[0];
}
function properInt(n){requireTrue(Number.isSafeInteger(n)&&n>=0);return n;}
function readObject(file){
 const s=fs.lstatSync(file);requireTrue(s.isFile()&&!s.isSymbolicLink()&&s.size<=65536);
 return JSON.parse(fs.readFileSync(file,'utf8'));
}
export function verifyProductionTarget(worker,staging,prod,account){
 try{verifyStagingConfig(worker,staging);}catch{fail();}
 requireTrue(account===ACCOUNT_ID&&PROD_ID!==STAGING_ID);
 exactKeys(prod,['name','compatibility_date','d1_databases']);
 requireTrue(prod.name==='restaurant-business-poc-prod-d1-initialization-only'&&
   prod.compatibility_date==='2026-10-25'&&prod.d1_databases?.length===1);
 const d=prod.d1_databases[0];
 exactKeys(d,['binding','database_name','database_id','migrations_dir']);
 requireTrue(d.binding==='PROD_DB'&&d.database_name==='restaurant-business-prod'&&
   d.database_id===PROD_ID&&d.migrations_dir==='cloudflare/migrations');
 // Never let the migration config become a Worker deployment config.
 requireTrue(!('main' in prod)&&!('assets' in prod)&&!('vars' in prod));
 return true;
}
export function verifyExactMigrations(dir='cloudflare/migrations'){
 const files=fs.readdirSync(dir).filter(x=>x.endsWith('.sql')).sort();
 requireTrue(JSON.stringify(files)===JSON.stringify(BASE_MIGRATIONS));
 const initial=fs.readFileSync(path.join(dir,BASE_MIGRATIONS[0]),'utf8');
 const delta=fs.readFileSync(path.join(dir,BASE_MIGRATIONS[1]),'utf8');
 const names=[...initial.matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(m=>m[1]);
 requireTrue(names.length===22&&new Set(names).size===22&&names.includes('cloud_schema_contract'));
 for(const [file,body] of [[BASE_MIGRATIONS[0],initial],[BASE_MIGRATIONS[1],delta]]){
   const expected=APPROVED['cloudflare/migrations/'+file];
   requireTrue(/^[0-9a-f]{64}$/.test(expected)&&
     createHash('sha256').update(body.replace(/\r\n/g,'\n'),'utf8').digest('hex')===expected);
 }
 const active=delta.split('\n').filter(x=>!x.trimStart().startsWith('--')).join('\n');
 const statements=active.split(';').map(s=>s.trim()).filter(Boolean);
 requireTrue(statements.length===3&&statements.every(s=>/^CREATE\s+INDEX\s+/i.test(s)));
 for(const [name,pattern] of REQUIRED_INDEXES){
   requireTrue(statements.filter(s=>s.includes(name)&&pattern.test(s)).length===1);
 }
 requireTrue(!/\bINSERT\s+INTO\s+(?:users|sessions|locations|stock_moves)\b/i.test(initial));
 return Object.freeze({schema_tables:22,migrations:2,login_indexes:3});
}
function checkIntegrity(raw){
 const check=one(raw,['quick_check']);
 requireTrue(typeof check.quick_check==='string'&&check.quick_check.toLowerCase()==='ok');
}
export function assertPristineProduction(state){
 exactKeys(state,['objects','quick']);
 const objs=rows(state.objects);
 requireTrue(objs.length>0);
 let kvCount=0;
 for(const o of objs){
   exactKeys(o,['type','name','tbl_name']);
   requireTrue(typeof o.name==='string'&&typeof o.type==='string'&&typeof o.tbl_name==='string');
   if(o.type==='table'&&o.name==='_cf_KV'&&o.tbl_name==='_cf_KV'){kvCount++;continue;}
   // D1 may internally index _cf_KV. No other schema objects are allowed.
   requireTrue(o.type==='index'&&o.tbl_name==='_cf_KV'&&o.name.startsWith('_cf_'));
 }
 requireTrue(kvCount===1);
 checkIntegrity(state.quick);
 return Object.freeze({status:'PROD_D1_PRISTINE_READONLY_PASS',
   production_write_performed:false,production_ready:false});
}
export function verifyInitializedProduction(raw,initialSource){
 exactKeys(raw,['tables','contract','migrations','indexes','foreign_keys','counts','quick']);
 requireTrue(typeof initialSource==='string');
 const expected=[...initialSource.matchAll(/CREATE TABLE\s+([A-Za-z_][A-Za-z_0-9]*)\s*\(/g)].map(m=>m[1]);
 requireTrue(expected.length===22&&new Set(expected).size===22);
 const expectedNames=[...expected,'d1_migrations'].sort();
 const tableNames=rows(raw.tables).map(o=>{
   exactKeys(o,['name']);requireTrue(typeof o.name==='string'&&o.name);return o.name;
 }).sort();
 requireTrue(JSON.stringify(tableNames)===JSON.stringify(expectedNames));
 const contract=one(raw.contract,['contract_version']);
 requireTrue(contract.contract_version===3);
 const migrations=rows(raw.migrations).map(o=>{exactKeys(o,['name']);return o.name;});
 requireTrue(JSON.stringify(migrations)===JSON.stringify(BASE_MIGRATIONS));
 const indexes=rows(raw.indexes);
 requireTrue(indexes.length===3);
 for(const [name,regex] of REQUIRED_INDEXES){
   requireTrue(indexes.filter(o=>{
     exactKeys(o,['name','sql']);return o.name===name&&
       typeof o.sql==='string'&&regex.test(o.sql);
   }).length===1);
 }
 requireTrue(rows(raw.foreign_keys).length===0);
 const counts=one(raw.counts,['users','sessions','locations','purchase_orders','stocktakes','stock_moves','audit_logs']);
 for(const n of Object.values(counts))requireTrue(properInt(n)===0);
 checkIntegrity(raw.quick);
 return Object.freeze({status:'PROD_D1_SCHEMA_ONLY_POSTFLIGHT_PASS',
  schema_version:3,applied_migrations:2,owner_created:false,
  login_enabled:false,operations_write_enabled:false,production_ready:false});
}
export function loadResults(dir,names){
 requireTrue(path.isAbsolute(dir));
 const d=fs.lstatSync(dir);requireTrue(d.isDirectory()&&!d.isSymbolicLink());
 const out={};
 for(const name of names){
   requireTrue(/^[a-z_]+$/.test(name));
   out[name]=readObject(path.join(dir,name+'.json'));
 }
 return out;
}
function localConfig(){
 return verifyProductionTarget(
  readObject('wrangler.jsonc'),
  readObject('wrangler.preview-migrations.jsonc'),
  readObject(PROD_CONFIG),
  process.env.CLOUDFLARE_ACCOUNT_ID
 );
}
const self=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===self){
 try{
  const [mode,...args]=process.argv.slice(2);
  requireTrue(['config','preflight','postflight'].includes(mode));
  localConfig();verifyExactMigrations();
  if(mode==='config'){requireTrue(args.length===0);console.log('PROD_D1_G5_CONFIG_PASS');}
  else if(mode==='preflight'){
    requireTrue(args.length===1);
    console.log(JSON.stringify(assertPristineProduction(loadResults(args[0],['objects','quick']))));
  }else{
    requireTrue(args.length===1);
    const initial=fs.readFileSync('cloudflare/migrations/0001_initial_v3.sql','utf8');
    console.log(JSON.stringify(verifyInitializedProduction(loadResults(args[0],
      ['tables','contract','migrations','indexes','foreign_keys','counts','quick']),initial)));
  }
 }catch{
  console.error('E_PROD_D1_G5_GUARD_FAILED');
  process.exitCode=1;
 }
}
