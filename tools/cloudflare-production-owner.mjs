// One-time Production D1 Owner enrollment; manual GitHub workflow only.
// No public HTTP route, no credentials in logs, and no staging database writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {hashWorkerPassword} from '../cloudflare/auth-core.mjs';
import {verifyProductionTarget} from './cloudflare-prod-d1-init.mjs';
import {rowsFromWranglerJson} from './check-cloudflare-staging.mjs';

const FAIL='E_PROD_OWNER_ENROLL';
export const EMPTY_TABLES=Object.freeze([
 'locations','users','user_locations','sessions','login_attempts','audit_logs',
 'tasks','ingredients','stock_moves','purchase_orders','stocktakes','repairs',
 'shifts','leave_requests','training_courses','training_records','evaluations',
 'ingredient_prices','menu_dishes','dish_ingredients'
]);
const MIGRATIONS=Object.freeze(['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql']);
function fail(){throw Error(FAIL);}
const getRows=data=>{try{return rowsFromWranglerJson(data);}catch{fail();}};
const count=(x)=>Number.isSafeInteger(x)&&x>=0?x:null;
function exactlyOne(data) {
 const arr=getRows(data);
 if(arr.length!==1 || !arr[0] || typeof arr[0]!=='object')fail();
 return arr[0];
}
export function verifyProductionOwnerTarget(worker,staging,prod,accountId) {
 try{verifyProductionTarget(worker,staging,prod,accountId);}catch{fail();}
 return true;
}
export function preflightSql() {
 const cols=[
  '(SELECT contract_version FROM cloud_schema_contract WHERE id=1) AS contract_version',
  '(SELECT COUNT(*) FROM d1_migrations) AS migration_total',
  ...MIGRATIONS.map((name,i)=>
   "(SELECT COUNT(*) FROM d1_migrations WHERE name='"+name+"') AS migration_"+(i+1)),
  ...EMPTY_TABLES.map(t=>'(SELECT COUNT(*) FROM '+t+') AS '+t)
 ];
 return 'SELECT '+cols.join(', ')+';';
}
function validPreflight(row) {
 if(count(row.contract_version)!==3 || count(row.migration_total)!==2 ||
    count(row.migration_1)!==1 || count(row.migration_2)!==1)fail();
 for(const t of EMPTY_TABLES)if(count(row[t])!==0)fail();
 return true;
}
export function checkProductionOwnerPreflight(payload) {
 const row=exactlyOne(payload);
 const keys=['contract_version','migration_total','migration_1','migration_2',...EMPTY_TABLES];
 if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify(keys.sort()))fail();
 return validPreflight(row);
}
export async function buildProductionOwnerSql(password) {
 if(typeof password!=='string'||password.length<12||password.length>256||
    /[\r\n\0]/.test(password))fail();
 const v=await hashWorkerPassword(password);
 if(!/^[0-9a-f]{32}$/.test(v.password_salt)||
    !/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/.test(v.password_hash))fail();
 const id=randomUUID();
 if(!/^[0-9a-f-]{36}$/.test(id))fail();
 const precondition=[
  '(SELECT contract_version FROM cloud_schema_contract WHERE id=1)=3',
  '(SELECT COUNT(*) FROM d1_migrations)=2',
  ...MIGRATIONS.map(n=>"(SELECT COUNT(*) FROM d1_migrations WHERE name='"+n+"')=1"),
  ...EMPTY_TABLES.map(n=>'(SELECT COUNT(*) FROM '+n+')=0')
 ].join(' AND ');
 // No values below are untrusted user input; id, salt and KDF are format checked.
 return `INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active)
SELECT '${id}','owner','餐廳業主','owner','${v.password_salt}','${v.password_hash}',1
WHERE ${precondition};
`;
}
export function savePrivateOwnerSql(file,content,runnerTemp) {
 if(typeof runnerTemp!=='string'||!path.isAbsolute(runnerTemp)||
   typeof file!=='string'||!path.isAbsolute(file)||
   path.resolve(file)!==path.join(path.resolve(runnerTemp),'production-owner-once.sql'))fail();
 fs.writeFileSync(file,content,{flag:'wx',mode:0o600});
 return true;
}
export function verifyProductionOwnerPostflight(payload,fk) {
 const row=exactlyOne(payload);
 const expected=['contract_version','migration_total','users','owners','sessions','login_attempts','audit_logs'];
 if(JSON.stringify(Object.keys(row).sort())!==JSON.stringify(expected.sort()))fail();
 if(count(row.contract_version)!==3||count(row.migration_total)!==2||
   count(row.users)!==1||count(row.owners)!==1||count(row.sessions)!==0||
   count(row.login_attempts)!==0||count(row.audit_logs)!==0||getRows(fk).length!==0)fail();
 return true;
}
export function postflightSql(){
 return "SELECT (SELECT contract_version FROM cloud_schema_contract WHERE id=1) AS contract_version, "+
 "(SELECT COUNT(*) FROM d1_migrations) AS migration_total, "+
 "(SELECT COUNT(*) FROM users) AS users, "+
 "(SELECT COUNT(*) FROM users WHERE username='owner' AND role='owner' AND active=1 "+
 "AND password_hash LIKE 'pbkdf2-sha256$100000$%' AND length(password_hash)=85 AND length(password_salt)=32) AS owners, "+
 "(SELECT COUNT(*) FROM sessions) AS sessions, "+
 "(SELECT COUNT(*) FROM login_attempts) AS login_attempts, "+
 "(SELECT COUNT(*) FROM audit_logs) AS audit_logs;";
}
function config(){
 const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
 verifyProductionOwnerTarget(read('wrangler.jsonc'),read('wrangler.preview-migrations.jsonc'),
  read('wrangler.production-initialize.jsonc'),process.env.CLOUDFLARE_ACCOUNT_ID);
}
async function main(args){
 config();
 const [mode,...rest]=args;
 if(mode==='query-preflight'&&!rest.length)process.stdout.write(preflightSql()+'\n');
 else if(mode==='query-postflight'&&!rest.length)process.stdout.write(postflightSql()+'\n');
 else if(mode==='check-preflight'&&rest.length===1) {
  checkProductionOwnerPreflight(JSON.parse(fs.readFileSync(rest[0],'utf8')));
  process.stdout.write('PROD_OWNER_PREFLIGHT_PASS\n');
 }else if(mode==='write-sql'&&rest.length===1){
  const sql=await buildProductionOwnerSql(process.env.PRODUCTION_OWNER_PASSWORD);
  savePrivateOwnerSql(rest[0],sql,process.env.RUNNER_TEMP);
  process.stdout.write('PROD_OWNER_PRIVATE_SQL_READY\n');
 }else if(mode==='check-postflight'&&rest.length===2){
  verifyProductionOwnerPostflight(...rest.map(p=>JSON.parse(fs.readFileSync(p,'utf8'))));
  process.stdout.write('PROD_OWNER_CREATED_AND_VERIFIED\n');
 }else fail();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 main(process.argv.slice(2)).catch(()=>{process.stderr.write(FAIL+'\n');process.exitCode=1;});
}
