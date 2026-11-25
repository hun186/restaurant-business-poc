// Pure offline Wrangler input derivation for the fixed G6 synthetic rehearsal.
// No CLI, arbitrary SQL/target/path arguments, file writes, credentials or
// network transport. A content hash is not a remote execution authorization.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildG6SyntheticPlan} from './cloudflare-stock-v4-g6-migration-plan.mjs';
import {APPROVED_TRANSITIVE_DEPENDENCIES_SHA256} from './cloudflare-hosted-probe-approved-sha256.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ERROR='E_G6_WRANGLER_INPUT_CONTRACT';
const need=ok=>{if(!ok)throw Error(ERROR);};
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
function reviewedMigration(name){
 const relative='cloudflare/migrations/'+name;
 const file=path.join(ROOT,relative),stat=fs.lstatSync(file);
 need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<65536);
 const sql=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');
 need(hash(sql)===APPROVED_TRANSITIVE_DEPENDENCIES_SHA256[relative]);
 return sql;
}
function unwrap(phase){
 const start='BEGIN IMMEDIATE;\n',end='COMMIT;\n';
 need(phase.sql.startsWith(start)&&phase.sql.endsWith(end)&&hash(phase.sql)===phase.sha256);
 return phase.sql.slice(start.length,-end.length);
}
function once(s,from,to){
 need(s.split(from).length===2);
 return s.replace(from,to);
}
function artifact(name,sql){
 need(typeof sql==='string'&&sql.length>0&&sql.length<65536);
 // Fixed reviewed sources only; this is a drift check, NOT a sanitizer for
 // user-supplied SQL. Wrangler must own transaction and migration receipts.
 const statements=sql.replace(/^--.*$/gm,'');
 need(!/\b(?:BEGIN IMMEDIATE|BEGIN TRANSACTION|COMMIT|ROLLBACK|CREATE TEMP TABLE)\b/i.test(statements));
 need(!/\b(?:CREATE TABLE(?: IF NOT EXISTS)?|INSERT INTO|UPDATE|DELETE FROM|DROP TABLE)\s+"?d1_migrations\b/i.test(statements));
 return Object.freeze({name,sql,sha256:hash(sql),bytes:Buffer.byteLength(sql,'utf8')});
}
export function buildG6WranglerInputs(...args){
 need(args.length===0);
 const plan=buildG6SyntheticPlan();
 let upgrade=unwrap(plan[2]);
 upgrade=once(upgrade,'CREATE TEMP TABLE g6_v3_before_upgrade_guard (','CREATE TABLE g6_v3_before_upgrade_guard (');
 upgrade=once(upgrade,'INSERT INTO temp.g6_v3_before_upgrade_guard(','INSERT INTO g6_v3_before_upgrade_guard(');
 upgrade=once(upgrade,'DROP TABLE temp.g6_v3_before_upgrade_guard;','DROP TABLE g6_v3_before_upgrade_guard;');
 upgrade=once(upgrade,"INSERT INTO d1_migrations(id,name) VALUES(3,'0004_stock_move_kinds.sql');\n",'');
 const phase=(order,kind,files)=>Object.freeze({order,kind,files:Object.freeze(files)});
 return Object.freeze([
  phase(1,'migrations',[
   artifact('0001_initial_v3.sql',reviewedMigration('0001_initial_v3.sql')),
   artifact('0002_login_attempts_window_indexes.sql',reviewedMigration('0002_login_attempts_window_indexes.sql'))
  ]),
  phase(2,'synthetic-seed',[artifact('v3-synthetic-history.sql',unwrap(plan[1]))]),
  phase(3,'migrations',[artifact('0004_stock_move_kinds.sql',upgrade)]),
  phase(4,'synthetic-seed',[artifact('v4-synthetic-history.sql',unwrap(plan[3]))])
 ]);
}
export function g6WranglerInputReceipt(...args){
 need(args.length===0);
 return Object.freeze({status:'G6_WRANGLER_INPUTS_OFFLINE_ONLY',
  stages:Object.freeze(buildG6WranglerInputs().map(p=>Object.freeze({
   order:p.order,kind:p.kind,files:Object.freeze(p.files.map(f=>Object.freeze({
    name:f.name,sha256:f.sha256,bytes:f.bytes
   })))
  }))),
  cloudflare_requests_made:0,remote_execution_authorized:false,
  operator_attestation_verified:false,exclusive_use_verified:false,
  production_gate_modified:false
 });
}
