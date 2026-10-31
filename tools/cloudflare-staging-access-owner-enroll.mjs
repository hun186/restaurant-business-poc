// Operator-initiated single synthetic owner enrollment, STAGING ONLY.
// This CLI builds a private SQL file for a protected workflow; it NEVER calls
// Cloudflare, runs Wrangler, provisions Access policies or changes Production.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verify0003ReadOnlyConfig,inspect0003ReadOnly} from './cloudflare-staging-access-0003-readonly.mjs';
import {rowsFromWranglerJson} from './check-cloudflare-staging.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DDL=path.join(ROOT,'cloudflare/migrations-access-0003/0003_access_identity_links.sql');
const READS=['ledger','contract','owners','tables','indexes','table','fk','integrity','counts','links','audits'];
const COUNT_KEYS=['users','sessions','locations','user_locations','login_attempts','audit_logs',
 'tasks','ingredients','stock_moves','purchase_orders','stocktakes','repairs','shifts',
 'leave_requests','training_courses','training_records','evaluations','backup_settings',
 'ingredient_prices','menu_dishes','dish_ingredients','access_identity_links'];
const err=()=>{throw Error('E_STAGING_ACCESS_OWNER_ENROLL_BLOCKED')};
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
const keys=(v,expected)=>v&&typeof v==='object'&&!Array.isArray(v)&&
 JSON.stringify(Object.keys(v).sort())===JSON.stringify([...expected].sort());
const dbRows=(data,key)=>{
 try{return rowsFromWranglerJson(data[key]);}catch{err();}
};
function assertConfig(){
 verify0003ReadOnlyConfig(ROOT,process.env.CLOUDFLARE_ACCOUNT_ID);
}
export function validateInputs({issuer,audience,subject}={}){
 if(typeof issuer!=='string'||
    !/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/.test(issuer)||
    typeof audience!=='string'||!/^[a-fA-F0-9]{64}$/.test(audience)||
    typeof subject!=='string'||!/^[A-Za-z0-9._:@-]{1,128}$/.test(subject)||
    subject.includes('--'))err();
 return Object.freeze({issuer,audience,subject});
}
function assertBaseline(data){
 if(!data||typeof data!=='object'||Array.isArray(data))err();
 const ddl=fs.readFileSync(DDL,'utf8');
 if(inspect0003ReadOnly(data,ddl).result!=='STAGING_0003_READONLY_ALREADY_APPLIED')err();
 const owners=dbRows(data,'owners');
 if(owners.length!==1||typeof owners[0]?.id!=='string'||
    !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(owners[0].id)||
    owners[0].role!=='owner'||owners[0].username!=='owner'||Number(owners[0].active)!==1)err();
 const counts=dbRows(data,'counts');
 if(counts.length!==1||!keys(counts[0],COUNT_KEYS))err();
 for(const field of COUNT_KEYS){
  if(!Number.isSafeInteger(counts[0][field])||counts[0][field] !== (field==='users'||field==='backup_settings'?1:0))err();
 }
 if(dbRows(data,'links').length!==0||dbRows(data,'audits').length!==0)err();
 return owners[0].id;
}
export function assertEnrollmentPreflight(data,config){
 validateInputs(config);
 const id=assertBaseline(data);
 return Object.freeze({result:'STAGING_ACCESS_OWNER_ENROLL_READY',
  owner_id:id,staging_only:true,remote_write_performed:false});
}
export function generateEnrollmentSql(config,{auditId=randomUUID()}={}){
 const v=validateInputs(config);
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(auditId))err();
 const [iss,aud,sub]=[v.issuer,v.audience,v.subject].map(quote);
 const id=quote(auditId);
 const scope="l.issuer="+iss+" AND l.audience="+aud+" AND l.subject="+sub;
 const exists="EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3)";
 // Recheck all pristine tables in the actual D1 mutation statements:
 // the preceding remote preflight snapshot cannot prevent concurrent writes.
 const pristine=phase=>COUNT_KEYS.map(table=>{
  const expected=table==='users'||table==='backup_settings'?1:
   table==='audit_logs'?(phase==='activate'?1:0):
   table==='access_identity_links'?(phase==='stage'?0:1):0;
  return '(SELECT COUNT(*) FROM "'+table+'")='+expected;
 }).join(' AND ');
 const staged=[
  "INSERT INTO access_identity_links(issuer,audience,subject,user_id,active)",
  "SELECT "+iss+","+aud+","+sub+",u.id,0 FROM users u",
  "WHERE u.username='owner' AND u.role='owner' AND u.active=1",
  "AND (SELECT COUNT(*) FROM users)=1 AND "+exists,
  "AND NOT EXISTS(SELECT 1 FROM access_identity_links)",
  'AND '+pristine('stage')
 ].join(' ')+';';
 const audit=[
  "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail)",
  "SELECT "+id+",NULL,'staging_access_operator','access.owner.enrollment','access_identity_links',l.user_id,NULL,",
  quote('{"stage":"operator-approved-enrollment"}'),
  "FROM access_identity_links l JOIN users u ON u.id=l.user_id",
  "WHERE "+scope+" AND l.active=0",
  "AND u.username='owner' AND u.role='owner' AND u.active=1",
  "AND NOT EXISTS(SELECT 1 FROM audit_logs)",
  'AND '+pristine('audit')
 ].join(' ')+';';
 const activate=[
  "UPDATE access_identity_links SET active=1 WHERE issuer="+iss+" AND audience="+aud+" AND subject="+sub,
  "AND active=0 AND "+exists,
  "AND EXISTS(SELECT 1 FROM users u WHERE u.id=access_identity_links.user_id",
  "AND u.username='owner' AND u.role='owner' AND u.active=1)",
  "AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id="+id,
  "AND a.action='access.owner.enrollment' AND a.entity='access_identity_links'",
  "AND a.entity_id=access_identity_links.user_id AND a.actor_name='staging_access_operator')",
  'AND '+pristine('activate')
 ].join(' ')+';';
 return Object.freeze({statements:Object.freeze([staged,audit,activate]),auditId});
}
export function assertEnrollmentPostflight(data,config,auditId){
 const v=validateInputs(config);
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(auditId))err();
 if(inspect0003ReadOnly(data,fs.readFileSync(DDL,'utf8')).result!=='STAGING_0003_READONLY_ALREADY_APPLIED')err();
 const owners=dbRows(data,'owners'),links=dbRows(data,'links'),audits=dbRows(data,'audits'),counts=dbRows(data,'counts');
 if(owners.length!==1||!keys(counts[0],COUNT_KEYS)||counts.length!==1||
    !COUNT_KEYS.every(k=>Number.isSafeInteger(counts[0][k])&&
       counts[0][k]===(['users','backup_settings','audit_logs','access_identity_links'].includes(k)?1:0)))err();
 const owner=owners[0];
 if(owner.username!=='owner'||owner.role!=='owner'||Number(owner.active)!==1||
    links.length!==1||!keys(links[0],['issuer','audience','subject','user_id','active'])||
    links[0].issuer!==v.issuer||links[0].audience!==v.audience||
    links[0].subject!==v.subject||links[0].user_id!==owner.id||Number(links[0].active)!==1)err();
 if(audits.length!==1||!keys(audits[0],['id','actor_id','actor_name','action','entity','entity_id','location_id','detail'])||
    audits[0].id!==auditId||audits[0].actor_id!==null||
    audits[0].actor_name!=='staging_access_operator'||audits[0].action!=='access.owner.enrollment'||
    audits[0].entity!=='access_identity_links'||audits[0].entity_id!==owner.id||
    audits[0].location_id!==null||audits[0].detail!=='{"stage":"operator-approved-enrollment"}')err();
 return Object.freeze({result:'STAGING_ACCESS_OWNER_ENROLLED_AND_AUDITED',
  staging_only:true,production_ready:false,access_policy_verified:false,write_gate_enabled:false});
}
function load(dir){
 if(typeof dir!=='string'||!dir||!fs.statSync(dir).isDirectory())err();
 return Object.fromEntries(READS.map(k=>[k,JSON.parse(fs.readFileSync(path.join(dir,k+'.json'),'utf8'))]));
}
function privateSqlPath(input){
 if(typeof process.env.RUNNER_TEMP!=='string'||!process.env.RUNNER_TEMP||
    input!==path.join(process.env.RUNNER_TEMP,'staging-access-owner-once.sql'))err();
 return input;
}
function configFromEnv(){
 return validateInputs({issuer:process.env.STAGING_ACCESS_ISSUER,
  audience:process.env.STAGING_ACCESS_AUDIENCE,subject:process.env.STAGING_ACCESS_OWNER_SUBJECT});
}
function cli(args){
 if(!['config','preflight','write-sql','postflight'].includes(args[0]))err();
 assertConfig();
 if(args[0]==='config'&&args.length===1){console.log('STAGING_ACCESS_OWNER_CONFIG_PASS');return;}
 const conf=configFromEnv();
 if(args[0]==='preflight'&&args.length===2){
  assertEnrollmentPreflight(load(args[1]),conf);
  console.log('STAGING_ACCESS_OWNER_PREFLIGHT_PASS');return;
 }
 if(args[0]==='write-sql'&&args.length===2){
  const sql=generateEnrollmentSql(conf);
  const target=privateSqlPath(args[1]);
  fs.writeFileSync(target,sql.statements.join('\n')+'\n',{flag:'wx',mode:0o600});
  // audit id kept in another protected Runner temp file, never public output.
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'staging-access-owner-audit-id'),sql.auditId,
   {flag:'wx',mode:0o600});
  console.log('STAGING_ACCESS_OWNER_SQL_PREPARED');return;
 }
 if(args[0]==='postflight'&&args.length===2){
  const id=fs.readFileSync(path.join(process.env.RUNNER_TEMP,'staging-access-owner-audit-id'),'utf8');
  assertEnrollmentPostflight(load(args[1]),conf,id);
  console.log('STAGING_ACCESS_OWNER_ENROLL_VERIFIED');return;
 }
 err();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{cli(process.argv.slice(2));}
 catch{console.error('STAGING_ACCESS_OWNER_ENROLL_BLOCKED; review private Staging state manually; never retry blindly');process.exitCode=1;}
}
