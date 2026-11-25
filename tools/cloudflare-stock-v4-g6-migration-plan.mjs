// G6 only: deterministic, source-pinned, four-stage SQL proposal.
// This module and CLI NEVER contact Cloudflare, use secrets or execute SQL.
// Future remote execution requires a separate reviewed PR and operator gates.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {approvedG6BindingTarget} from './cloudflare-g5-binding-inventory.mjs';
import {APPROVED_TRANSITIVE_DEPENDENCIES_SHA256} from './cloudflare-hosted-probe-approved-sha256.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const ERROR='G6_VERSIONED_MIGRATION_PLAN_REJECTED';
const need=ok=>{if(!ok)throw Error(ERROR);};
const HASH=s=>createHash('sha256').update(s,'utf8').digest('hex');
const SOURCES=Object.freeze({
 pin:'cloudflare/stock-v4-disposable-target.json',
 v3:'cloudflare/migrations/0001_initial_v3.sql',
 v3indexes:'cloudflare/migrations/0002_login_attempts_window_indexes.sql',
 v4:'cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql'
});
function readReviewed(relative){
 const expected=APPROVED_TRANSITIVE_DEPENDENCIES_SHA256[relative];
 need(typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected));
 const filename=path.join(ROOT,relative);
 const stat=fs.lstatSync(filename);
 need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<65536);
 const content=fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n');
 need(HASH(content)===expected);
 return content;
}
const quoted=s=>"'"+s.replaceAll("'","''")+"'";
const move=(id,qty,kind,reference,note,time)=>
 'INSERT INTO stock_moves (id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at) VALUES ('+
 [quoted(id),quoted('g6-fixture-ingredient'),quoted('g6-fixture-location'),
  String(qty),quoted(kind),reference===null?'NULL':quoted(reference),
  quoted(note),quoted('g6-fixture-owner'),quoted('2026-11-01 '+time)].join(',')+');';
const v3History=Object.freeze([
 "INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES('g6-fixture-owner','g6-synthetic-owner','G6 Synthetic','owner','nonsecret_salt','nonsecret_hash');",
 "INSERT INTO locations(id,name) VALUES('g6-fixture-location','G6 Synthetic Store');",
 "INSERT INTO ingredients(id,sku,name,unit) VALUES('g6-fixture-ingredient','G6-SYNTH-001','G6 Synthetic Ingredient','kg');",
 move('g6-m01',10,'purchase','g6-po-01','synthetic inbound','10:00:00'),
 move('g6-m02',-2,'usage',null,'synthetic usage','11:00:00'),
 "INSERT INTO audit_logs(id,at,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES('g6-audit-01','2026-11-01 11:30:00','g6-fixture-owner','G6 Synthetic','stock.usage','stock_moves','g6-m02','g6-fixture-location','{}');",
 "INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_by) VALUES('g6-price-01','g6-fixture-ingredient','g6-fixture-location','2026-11-01',2300,'kg','G6 Synthetic Supplier','manual','g6-fixture-owner');"
]);
const v4History=Object.freeze([
 move('g6-m03',-1,'supplier_return','g6-po-01','synthetic supplier return','12:00:00'),
 move('g6-m04',-0.5,'scrap',null,'synthetic scrap','13:00:00'),
 move('g6-m05',0.25,'adjustment',null,'synthetic recount','14:00:00')
]);
// Phase 3 must prove that the full reviewed v3 history exists *before*
// rebuilding stock_moves. Merely having two receipts is not sufficient:
// migrating an empty ledger and inserting the old rows afterwards falsely
// claims to have tested historical preservation. Use a transactional SQLite
// CHECK sentinel, not a bare SELECT (which never aborts when a count is wrong).
const v3Evidence=Object.freeze([
 "(SELECT COUNT(*) FROM d1_migrations)=2",
 "(SELECT COUNT(*) FROM d1_migrations WHERE (id=1 AND name='0001_initial_v3.sql') OR (id=2 AND name='0002_login_attempts_window_indexes.sql'))=2",
 "(SELECT contract_version FROM cloud_schema_contract WHERE id=1)=3",
 "(SELECT COUNT(*) FROM users)=1",
 "(SELECT COUNT(*) FROM users WHERE id='g6-fixture-owner' AND username='g6-synthetic-owner' AND display_name='G6 Synthetic' AND role='owner' AND password_salt='nonsecret_salt' AND password_hash='nonsecret_hash' AND active=1)=1",
 "(SELECT COUNT(*) FROM locations)=1",
 "(SELECT COUNT(*) FROM locations WHERE id='g6-fixture-location' AND name='G6 Synthetic Store' AND active=1)=1",
 "(SELECT COUNT(*) FROM ingredients)=1",
 "(SELECT COUNT(*) FROM ingredients WHERE id='g6-fixture-ingredient' AND sku='G6-SYNTH-001' AND name='G6 Synthetic Ingredient' AND unit='kg' AND min_stock=0 AND active=1)=1",
 "(SELECT COUNT(*) FROM stock_moves)=2",
 "(SELECT COUNT(*) FROM stock_moves WHERE (id='g6-m01' AND ingredient_id='g6-fixture-ingredient' AND location_id='g6-fixture-location' AND qty_delta=10 AND move_type='purchase' AND reference_id='g6-po-01' AND note='synthetic inbound' AND actor_id='g6-fixture-owner' AND created_at='2026-11-01 10:00:00') OR (id='g6-m02' AND ingredient_id='g6-fixture-ingredient' AND location_id='g6-fixture-location' AND qty_delta=-2 AND move_type='usage' AND reference_id IS NULL AND note='synthetic usage' AND actor_id='g6-fixture-owner' AND created_at='2026-11-01 11:00:00'))=2",
 "(SELECT COUNT(*) FROM audit_logs)=1",
 "(SELECT COUNT(*) FROM audit_logs WHERE id='g6-audit-01' AND at='2026-11-01 11:30:00' AND actor_id='g6-fixture-owner' AND actor_name='G6 Synthetic' AND action='stock.usage' AND entity='stock_moves' AND entity_id='g6-m02' AND location_id='g6-fixture-location' AND detail='{}')=1",
 "(SELECT COUNT(*) FROM ingredient_prices)=1",
 "(SELECT COUNT(*) FROM ingredient_prices WHERE id='g6-price-01' AND ingredient_id='g6-fixture-ingredient' AND location_id='g6-fixture-location' AND price_date='2026-11-01' AND price_cents=2300 AND unit='kg' AND supplier='G6 Synthetic Supplier' AND source='manual' AND created_by='g6-fixture-owner')=1",
 "(SELECT COUNT(*) FROM sqlite_master WHERE name='stock_move_kind_contract' OR name='stock_moves_v4')=0"
]);
const assertV3BeforeUpgrade=Object.freeze([
 "CREATE TEMP TABLE g6_v3_before_upgrade_guard (verified INTEGER NOT NULL CHECK(verified=1));",
 "INSERT INTO temp.g6_v3_before_upgrade_guard(verified) SELECT CASE WHEN "+v3Evidence.join(' AND ')+" THEN 1 ELSE 0 END;",
 "DROP TABLE temp.g6_v3_before_upgrade_guard;"
]);
function batch(lines){
 need(Array.isArray(lines)&&lines.length>0&&lines.every(s=>
  typeof s==='string'&&s.trim().length>0));
 // A future remote REST execution contract is NOT approved by this plan.
 // Local transaction boundaries are validated only by node:sqlite tests.
 return ['BEGIN IMMEDIATE;',...lines,'COMMIT;'].join('\n')+'\n';
}
const getTarget=()=>{
 const pin=JSON.parse(readReviewed(SOURCES.pin));
 approvedG6BindingTarget(pin);
 return pin;
};
export function buildG6SyntheticPlan(pin=getTarget()){
 const reviewed=getTarget();
 need(pin!==null&&typeof pin==='object'&&!Array.isArray(pin)&&
  Object.keys(pin).sort().join('|')==='database_id|database_name'&&
  pin.database_id===reviewed.database_id&&
  pin.database_name===reviewed.database_name);
 const schema=readReviewed(SOURCES.v3),indexes=readReviewed(SOURCES.v3indexes),
  upgrade=readReviewed(SOURCES.v4);
 need(schema.includes('CREATE TABLE stock_moves')&&
  indexes.includes('CREATE INDEX idx_login_attempts_username_nocase_at')&&
  upgrade.includes('ALTER TABLE stock_moves_v4 RENAME TO stock_moves;'));
 const phases=[
  {name:'v3-schema',receiptCount:2,sql:batch([
   schema,
   // Model the upstream Wrangler migration ledger, not a simplified two-column
   // fixture. Source: workers-sdk helpers.ts blob aad9baecbd073b5cf1bb472476e6ba4e27b47bbd.
   // Exact installed Wrangler version and remote D1 compatibility remain unverified.
   `CREATE TABLE IF NOT EXISTS "d1_migrations"(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);`,
   "INSERT INTO d1_migrations(id,name) VALUES(1,'0001_initial_v3.sql');",
   indexes,
   "INSERT INTO d1_migrations(id,name) VALUES(2,'0002_login_attempts_window_indexes.sql');"
  ])},
  {name:'v3-synthetic-history',receiptCount:2,sql:batch(v3History)},
  {name:'v4-schema',receiptCount:3,sql:batch([
   ...assertV3BeforeUpgrade,
   upgrade,
   "INSERT INTO d1_migrations(id,name) VALUES(3,'0004_stock_move_kinds.sql');"
  ])},
  {name:'v4-synthetic-history',receiptCount:3,sql:batch(v4History)}
 ];
 return Object.freeze(phases.map((p,i)=>Object.freeze({
  order:i+1,name:p.name,expectedMigrationReceipts:p.receiptCount,
  sql:p.sql,sha256:HASH(p.sql),bytes:Buffer.byteLength(p.sql,'utf8')
 })));
}
export function publicPlanReceipt(plan=buildG6SyntheticPlan()){
 need(Array.isArray(plan)&&plan.length===4&&
  plan.every((phase,i)=>phase.order===i+1&&
   ['v3-schema','v3-synthetic-history','v4-schema','v4-synthetic-history'][i]===phase.name&&
   HASH(phase.sql)===phase.sha256));
 return Object.freeze({
  status:'G6_SYNTHETIC_VERSIONED_PLAN_ONLY',
  stages:plan.map(p=>({
   order:p.order,name:p.name,sha256:p.sha256,bytes:p.bytes,
   expectedMigrationReceipts:p.expectedMigrationReceipts
  })),
  cloudflare_requests_made:0,remote_sql_executed:false,
  write_authorization_granted:false,operator_binding_attestation_verified:false,
  exclusive_use_verified:false,production_gate_modified:false
 });
}
const current=fileURLToPath(import.meta.url);
if(process.argv[1]&&path.resolve(process.argv[1])===current){
 try{
  need(process.argv.length===3&&process.argv[2]==='plan'&&
   !process.env.CLOUDFLARE_API_TOKEN);
  console.log(JSON.stringify(publicPlanReceipt()));
 }catch{
  console.error(ERROR+'; no Cloudflare network or database changes.');
  process.exitCode=1;
 }
}
