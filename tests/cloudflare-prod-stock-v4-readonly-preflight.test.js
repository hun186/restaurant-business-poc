'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const subject=import('../tools/cloudflare-prod-stock-v4-readonly-preflight.mjs');
const ACCOUNT='31b409b04896d260ba0fadf6cc2bb305';
const PROD='b882a6e8-0e56-49a6-bd41-1a6cadd726c9';
const STAGE='2c355bed-d9c3-449c-aa9b-1018f3bc1177';
const GOOD={success:true,result:{uuid:PROD,name:'restaurant-business-prod',version:'production'}};
const wrap=results=>({success:true,result:[{success:true,results}]});
function setup(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8'));
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL)');
 db.exec("INSERT INTO d1_migrations VALUES(1,'0001_initial_v3.sql')");
 db.exec("INSERT INTO d1_migrations VALUES(2,'0002_login_attempts_window_indexes.sql')");
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store1','synthetic-store');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
 .run('ingredient1','fake','synthetic-item','kg');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
 .run('owner1','synthetic','synthetic-owner','owner','salt','hash');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
 .run('move1','ingredient1','store1',3,'purchase','owner1');
 return db;
}
function responder(db,queries,meta=GOOD){
 const calls=[];
 const io=async(method,sql)=>{
 calls.push({method,sql});
 if(method==='GET')return meta;
 assert.ok(Object.values(queries).includes(sql));
 assert.match(sql,/^(SELECT|PRAGMA)\b/);
 return wrap(db.prepare(sql).all());
 };
 return {calls,io};
}
test('synthetic v3 remote-shaped query sequence preserves ledger with no writes',async t=>{
 const m=await subject,db=setup(t),{io,calls}=responder(db,m.QUERIES);
 const before=db.prepare('SELECT * FROM stock_moves ORDER BY id').all();
 const r=await m.inspectRemote(io);
 assert.equal(r.status,'PROD_STOCK_V4_REMOTE_V3_READONLY_PREFLIGHT_PASS');
 assert.equal(r.legacy_stock_move_rows,1);
 assert.equal(r.migration_executed,false);assert.equal(r.production_write_performed,false);
 assert.equal(r.release_authorized,false);
 assert.deepEqual(db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),before);
 assert.equal(calls.filter(c=>c.method==='GET').length,1);
 assert.equal(calls.filter(c=>c.method==='POST').length,Object.keys(m.QUERIES).length);
 assert.doesNotMatch(JSON.stringify(r),/synthetic|owner1|ingredient1/);
});
test('partial v4 migration or unexpected index must deny release',async t=>{
 const m=await subject,db=setup(t);
 db.exec("INSERT INTO d1_migrations VALUES(3,'0004_stock_move_kinds.sql')");
 await assert.rejects(()=>m.inspectRemote(responder(db,m.QUERIES).io),/E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
 db.exec('DELETE FROM d1_migrations WHERE id=3');
 db.exec('CREATE TABLE stock_move_kind_contract(id INTEGER)');
 await assert.rejects(()=>m.inspectRemote(responder(db,m.QUERIES).io),/E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
 db.exec('DROP TABLE stock_move_kind_contract');
 db.exec('CREATE INDEX unexpected_stock_index ON stock_moves(move_type)');
 await assert.rejects(()=>m.inspectRemote(responder(db,m.QUERIES).io),/E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
});
test('stock DDL drift and incoming unexpected view or trigger deny',async t=>{
 const m=await subject,db=setup(t);
 db.exec('ALTER TABLE stock_moves ADD COLUMN suspicious TEXT');
 await assert.rejects(()=>m.inspectRemote(responder(db,m.QUERIES).io),/E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
});
test('wrong Production identity and malformed API results deny',async t=>{
 const m=await subject,db=setup(t);
 await assert.rejects(()=>m.inspectRemote(responder(db,m.QUERIES,
 {...GOOD,result:{...GOOD.result,uuid:STAGE}}).io),/E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
 await assert.rejects(()=>m.inspectRemote(async method=>method==='GET'?GOOD:
 {success:true,result:[{success:false,results:[]}]}),/E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
});
test('strict Cloudflare transport excludes other DB, arbitrary SQL and write methods',async()=>{
 const m=await subject,base='/accounts/'+ACCOUNT+'/d1/database/'+PROD;
 const seen=[],transport=async(url,opts)=>{seen.push({url,opts});return {ok:true,text:async()=>JSON.stringify(GOOD)};};
 const token='synthetic_test_credential_123456789';
 await m.cloudflareReadOnly(base,token,'GET',null,transport);
 await m.cloudflareReadOnly(base,token,'POST',m.QUERIES.migrations,transport);
 assert.equal(seen.length,2);assert.equal(seen[0].opts.method,'GET');
 assert.deepEqual(JSON.parse(seen[1].opts.body),{sql:m.QUERIES.migrations});
 assert.equal(seen[0].opts.redirect,'error');
 for(const [target,method,sql] of [
 ['/accounts/'+ACCOUNT+'/d1/database/'+STAGE,'GET',null],
 [base,'POST','DELETE FROM users'],[base,'POST','SELECT * FROM users'],
 [base,'GET',m.QUERIES.migrations],['https://example.invalid','GET',null]
 ])await assert.rejects(()=>m.cloudflareReadOnly(target,token,method,sql,transport),
 /E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
 assert.equal(seen.length,2);
});
test('CLI rejects absent GitHub approval before network request',()=>{
 const script=path.join(root,'tools/cloudflare-prod-stock-v4-readonly-preflight.mjs');
 const p=spawnSync(process.execPath,[script,'inspect'],{cwd:root,encoding:'utf8',env:{
 ...process.env,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main',
 STOCK_V4_READONLY_CONFIRM:'CHECK_PROD_STOCK_V3_READONLY',
 CLOUDFLARE_API_TOKEN:'synthetic_secret_token_123456'}});
 assert.equal(p.status,1);assert.equal(p.stdout,'');
 assert.match(p.stderr,/E_PROD_STOCK_V4_READONLY_PREFLIGHT/);
 assert.doesNotMatch(p.stderr,/synthetic_secret|accounts|sqlite/i);
});
test('manual workflow guards readonly token behind SHA preflight',()=>{
 const s=fs.readFileSync(path.join(root,'.github/workflows/d1-production-stock-v4-readonly.yml'),'utf8');
 assert.match(s,/workflow_dispatch:/);
 assert.match(s,/environment: d1-production-readonly/);
 assert.match(s,/CHECK_PROD_STOCK_V3_READONLY/);
 assert.match(s,/CLOUDFLARE_PROD_D1_READ_TOKEN/);
 assert.match(s,/cloudflare-hosted-probe-preflight\.mjs/);
 assert.doesNotMatch(s,/wrangler d1 migrations apply|time_travel\/restore|CLOUDFLARE_PROD_D1_WRITE_TOKEN/);
 assert.ok(s.indexOf('cloudflare-hosted-probe-preflight.mjs')<
 s.indexOf('CLOUDFLARE_PROD_D1_READ_TOKEN'));
});
