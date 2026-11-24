'use strict';
// Entirely synthetic in-memory SQLite; no Cloudflare calls or customer databases.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const os=require('node:os');
const root=path.join(__dirname,'..');
const importPostflight=import('../tools/cloudflare-stock-v4-g6-postflight.mjs');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pin=JSON.parse(read('cloudflare/stock-v4-disposable-target.json'));
const account='31b409b04896d260ba0fadf6cc2bb305';
const base='/accounts/'+account+'/d1/database/'+pin.database_id;
const reply=result=>({success:true,result:[{success:true,results:result}]});
const metadata=()=>({success:true,result:{uuid:pin.database_id,
 name:pin.database_name,version:'production'}});
function synthetic(t,{migration=true,postMoves=true}={}){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON;');
 db.exec(read('cloudflare/migrations/0001_initial_v3.sql'));
 db.exec(read('cloudflare/migrations/0002_login_attempts_window_indexes.sql'));
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL);');
 for(const [id,name] of [
  [1,'0001_initial_v3.sql'],[2,'0002_login_attempts_window_indexes.sql']
 ])db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
  .run('g6-fixture-owner','g6-synthetic-owner','G6 Synthetic','owner','nonsecret_salt','nonsecret_hash');
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)')
  .run('g6-fixture-location','G6 Synthetic Store');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('g6-fixture-ingredient','G6-SYNTH-001','G6 Synthetic Ingredient','kg');
 const move=(id,qty,kind,ref,note,time)=>db.prepare(
  'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
  .run(id,'g6-fixture-ingredient','g6-fixture-location',qty,kind,ref,note,
   'g6-fixture-owner','2026-11-01 '+time);
 move('g6-m01',10,'purchase','g6-po-01','synthetic inbound','10:00:00');
 move('g6-m02',-2,'usage',null,'synthetic usage','11:00:00');
 db.prepare(
  'INSERT INTO audit_logs(id,at,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('g6-audit-01','2026-11-01 11:30:00','g6-fixture-owner','G6 Synthetic',
   'stock.usage','stock_moves','g6-m02','g6-fixture-location','{}');
 db.prepare(
  'INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('g6-price-01','g6-fixture-ingredient','g6-fixture-location',
   '2026-11-01',2300,'kg','G6 Synthetic Supplier','manual','g6-fixture-owner');
 if(migration){
  db.exec('BEGIN IMMEDIATE');
  try{
   db.exec(read('cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql'));
   db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)')
    .run(3,'0004_stock_move_kinds.sql');
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 if(postMoves){
  assert.equal(migration,true);
  move('g6-m03',-1,'supplier_return','g6-po-01','synthetic supplier return','12:00:00');
  move('g6-m04',-0.5,'scrap',null,'synthetic scrap','13:00:00');
  move('g6-m05',0.25,'adjustment',null,'synthetic recount','14:00:00');
 }
 return db;
}
function simulator(db,overrides={},options={}){
 const calls=[];
 const io=async(method,url,body)=>{
  calls.push({method,url,body});
  if(method==='GET'){
   assert.equal(url,base);assert.equal(body,null);
   return Object.hasOwn(overrides,'metadata')?overrides.metadata:metadata();
  }
  assert.equal(method,'POST');assert.equal(url,base+'/query');
  const sql=body?.sql;
  assert.equal(typeof sql,'string');
  assert.match(sql,/^(?:SELECT|PRAGMA)\b/);
  const rows=db.prepare(sql).all();
  // Simulate a legal REST serializer that changes object property ordering.
  const results=options.reverseKeys?rows.map(row=>Object.fromEntries(
   Object.entries(row).reverse())):rows;
  return Object.hasOwn(overrides,sql)?overrides[sql]:reply(results);
 };
 return {calls,io};
}
test('real v3->v4 migration and synthetic positive data pass strict remote postflight adapter',async t=>{
 const db=synthetic(t),m=await importPostflight,s=simulator(db);
 const result=await m.verifyG6V4Postflight(pin,s.io);
 assert.equal(result.status,'G6_STOCK_V4_REMOTE_READONLY_POSTFLIGHT_PASS');
 assert.equal(result.versioned_migration_receipts_verified,3);
 assert.equal(result.synthetic_ledger_rows_verified,5);
 assert.equal(result.exact_business_table_inventory_verified,true);
 assert.equal(result.other_business_tables_verified_empty,true);
 assert.equal(result.unexpected_views_and_triggers_absent,true);
 assert.equal(result.exact_reviewed_v4_ddl_verified,true);
 assert.equal(result.foreign_key_definitions_verified,3);
 assert.equal(result.exact_migration_id_sequence_verified,true);
 assert.equal(result.remote_write_performed,false);
 assert.equal(result.release_authorized,false);
 assert.equal(result.production_gate_modified,false);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(s.calls.length,Object.keys(m.SQL).length+1);
 assert.ok(s.calls.every(c=>c.method==='GET'&&c.body===null||
  c.method==='POST'&&Object.values(m.SQL).includes(c.body?.sql)));
 assert.doesNotMatch(JSON.stringify(result),/g6-m0|909037ca|g6-fixture/);
});
test('reordered D1 REST JSON properties retain all field-value invariants',async t=>{
 const db=synthetic(t),m=await importPostflight;
 const shuffled=simulator(db,{}, {reverseKeys:true});
 const result=await m.verifyG6V4Postflight(pin,shuffled.io);
 assert.equal(result.status,'G6_STOCK_V4_REMOTE_READONLY_POSTFLIGHT_PASS');
 assert.equal(result.exact_reviewed_v4_ddl_verified,true);
 assert.equal(result.foreign_key_definitions_verified,3);
});
test('real mutated v4 DDL missing quantity CHECK or all FK constraints is rejected',async t=>{
 const m=await importPostflight;
 for(const mutate of [
  ddl=>ddl.replace('CHECK(qty_delta != 0)',''),
  ddl=>ddl.replace(/\s+REFERENCES\s+(?:ingredients|locations|users)\(id\)/g,''),
  ddl=>ddl.replace("DEFAULT CURRENT_TIMESTAMP",'')
 ]){
  const db=synthetic(t);
  const ddl=db.prepare("SELECT sql FROM sqlite_master WHERE name='stock_moves'").get().sql;
  const invalid=mutate(ddl);
  assert.notEqual(invalid,ddl,'mutation must remove an actual constraint or default');
  const create=invalid.replace(/^CREATE TABLE\s+"?stock_moves"?/i,'CREATE TABLE stock_moves_broken');
  db.exec('PRAGMA foreign_keys=OFF;');
  db.exec(create);
  db.exec('INSERT INTO stock_moves_broken SELECT * FROM stock_moves;');
  db.exec('DROP TABLE stock_moves;');
  db.exec('ALTER TABLE stock_moves_broken RENAME TO stock_moves;');
  db.exec('CREATE INDEX stock_moves_stock ON stock_moves(ingredient_id,location_id);');
  db.exec('PRAGMA foreign_keys=ON;');
  if(!invalid.includes('REFERENCES'))assert.deepEqual(
   db.prepare('PRAGMA foreign_key_list(stock_moves)').all(),[]);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  await assert.rejects(()=>m.verifyG6V4Postflight(pin,simulator(db).io),
   /E_G6_STOCK_V4_READONLY_POSTFLIGHT/);
 }
});
test('incomplete migration, missing receipt, schema/index drift and historical alteration all reject',async t=>{
 const m=await importPostflight;
 const bad=async mutate=>{
  const db=synthetic(t);
  mutate(db);
  await assert.rejects(()=>m.verifyG6V4Postflight(pin,simulator(db).io),
   /E_G6_STOCK_V4_READONLY_POSTFLIGHT/);
 };
 await bad(db=>db.exec("DELETE FROM d1_migrations WHERE id=3"));
 await bad(db=>db.exec("UPDATE d1_migrations SET id=4 WHERE id=3"));
 await bad(db=>db.exec("UPDATE cloud_schema_contract SET contract_version=3 WHERE id=1; DELETE FROM stock_move_kind_contract"));
 await bad(db=>db.exec("DROP INDEX stock_moves_stock"));
 await bad(db=>db.exec("UPDATE stock_moves SET note='tampered' WHERE id='g6-m02'"));
 await bad(db=>db.exec("UPDATE audit_logs SET detail='{\"broken\":true}' WHERE id='g6-audit-01'"));
 await bad(db=>db.exec("UPDATE ingredient_prices SET price_cents=3100 WHERE id='g6-price-01'"));
 await bad(db=>db.exec("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES('extraneous','extraneous','EXTRA','staff','x','x')"));
 await bad(db=>db.exec("INSERT INTO user_locations(user_id,location_id) VALUES('g6-fixture-owner','g6-fixture-location')"));
 await bad(db=>db.exec('CREATE TABLE extra_customer_data (payload TEXT)'));
 await bad(db=>db.exec('CREATE VIEW extra_view AS SELECT id FROM stock_moves'));
 await bad(db=>db.exec('CREATE TRIGGER extra_trigger AFTER INSERT ON stock_moves BEGIN SELECT 1; END'));
 await bad(db=>db.exec('UPDATE backup_settings SET retention_count=51 WHERE id=1'));
 await bad(db=>db.exec("UPDATE backup_settings SET last_fingerprint='unexpected-live' WHERE id=1"));
 await bad(db=>db.exec("UPDATE users SET password_hash='unexpected-real-password-hash' WHERE id='g6-fixture-owner'"));
 await bad(db=>db.exec("UPDATE users SET display_name='OTHER USER' WHERE id='g6-fixture-owner'"));
 await bad(db=>db.exec("UPDATE locations SET active=0 WHERE id='g6-fixture-location'"));
 await bad(db=>db.exec("UPDATE ingredients SET min_stock=12 WHERE id='g6-fixture-ingredient'"));
});
test('forged movement column type/flags cannot satisfy v4 shape contract',async t=>{
 const m=await importPostflight,db=synthetic(t);
 const columns=db.prepare(m.SQL.columns).all();
 for(const forged of [
  columns.map(x=>x.name==='qty_delta'?{...x,type:'TEXT'}:x),
  columns.map(x=>x.name==='note'?{...x,notnull:0}:x),
  columns.map(x=>x.name==='id'?{...x,pk:0}:x)
 ])await assert.rejects(()=>m.verifyG6V4Postflight(pin,
  simulator(db,{[m.SQL.columns]:reply(forged)}).io),
  /E_G6_STOCK_V4_READONLY_POSTFLIGHT/);
});
test('v3-only DB cannot falsely be certified as v4',async t=>{
 const m=await importPostflight,db=synthetic(t,{migration:false,postMoves:false});
 await assert.rejects(()=>m.verifyG6V4Postflight(pin,simulator(db).io),
  /E_G6_STOCK_V4_READONLY_POSTFLIGHT/);
});
test('missing FK/quick_check, forged account identity and malformed D1 replies reject',async t=>{
 const m=await importPostflight,db=synthetic(t);
 for(const [key,data] of [
  ['metadata',{success:true,result:{...metadata().result,uuid:'00000000-0000-4000-8000-000000000000'}}],
  [m.SQL.foreign,reply([{table:'stock_moves',rowid:1,parent:'ingredients',fkid:0}])],
  [m.SQL.quick,reply([{quick_check:'corrupt'}])],
  [m.SQL.receipts,{success:true,result:[]}],
  [m.SQL.schema,{success:false,result:[{success:true,results:[{contract_version:3}]}]}]
 ])await assert.rejects(()=>m.verifyG6V4Postflight(pin,simulator(db,{[key]:data}).io),
  /E_G6_STOCK_V4_READONLY_POSTFLIGHT/);
});
test('protected, fake and mutated G6 targets cannot reach network',async t=>{
 const m=await importPostflight,db=synthetic(t);
 let calls=0;
 for(const id of [
  'b882a6e8-0e56-49a6-bd41-1a6cadd726c9',
  '2c355bed-d9c3-449c-aa9b-1018f3bc1177',
  '04566a27-cd95-4415-9bd7-c3e19d60ab6c',
  'cc3fe86d-1c46-4c2f-a399-0ec3c46d5198',
  '00000000-0000-4000-8000-000000000000'
 ]){
  const bad={...pin,database_id:id};
  await assert.rejects(()=>m.verifyG6V4Postflight(bad,()=>{calls++;return metadata();}),
   /E_G5_BINDING_READONLY_INVENTORY/);
 }
 assert.equal(calls,0);
 await assert.rejects(()=>m.verifyG6V4Postflight({...pin,extra:'anything'},simulator(db).io),
  /E_G5_BINDING_READONLY_INVENTORY/);
});
test('read-only transport denies arbitrary SQL, other destinations, PUT/restore and redirects',async()=>{
 const m=await importPostflight;
 const calls=[],token='synthetic_token_not_real_12345';
 const mocked=async(url,opts)=>{
  calls.push({url,opts});
  return {ok:true,text:async()=>JSON.stringify(reply([]))};
 };
 await m.cloudflarePostflightRead(pin,token,'GET',base,null,mocked);
 await m.cloudflarePostflightRead(pin,token,'POST',base+'/query',{sql:m.SQL.receipts},mocked);
 assert.equal(calls.length,2);
 for(const args of [
  ['POST',base+'/query',{sql:'DROP TABLE users;'}],
  ['POST',base+'/query',{sql:'SELECT * FROM users;'}],
  ['POST',base+'/query',{sql:m.SQL.receipts,extra:'ignored'}],
  ['POST',base+'/time_travel/restore?bookmark=fake',null],
  ['GET','/accounts/'+account+'/d1/database/b882a6e8-0e56-49a6-bd41-1a6cadd726c9',null],
  ['DELETE',base,null],['GET',base,{sql:m.SQL.receipts}]
 ])await assert.rejects(()=>m.cloudflarePostflightRead(pin,token,...args,mocked),
  /E_G6_STOCK_V4_READONLY_POSTFLIGHT/);
 assert.equal(calls.length,2);
 assert.equal(calls[1].opts.method,'POST');
 assert.equal(JSON.parse(calls[1].opts.body).sql,m.SQL.receipts);
});
test('CLI invalid confirmation is rejected before any credentialed Cloudflare fetch',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'g6-postflight-preload-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const preload=path.join(tmp,'preload.mjs'),counter=path.join(tmp,'counter');
 fs.writeFileSync(preload,[
  "import fs from 'node:fs';",
  'let calls=0;',
  "globalThis.fetch=async()=>{calls++;throw Error('CLOUD_NETWORK_FORBIDDEN');};",
  "process.on('exit',()=>fs.writeFileSync(process.env.G6_POSTFLIGHT_CALLS,String(calls)));"
 ].join('\n'));
 const cli=path.join(root,'tools/cloudflare-stock-v4-g6-postflight.mjs');
 const proc=spawnSync(process.execPath,['--import',pathToFileURL(preload).href,cli,'inspect'],{
  cwd:root,encoding:'utf8',env:{
   ...process.env,GITHUB_ACTIONS:'true',GITHUB_REF:'refs/heads/main',
   G6_V4_POSTFLIGHT_CONFIRM:'INVALID',
   CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:'synthetic_token_not_real_12345',
   G6_POSTFLIGHT_CALLS:counter
  }
 });
 assert.equal(proc.status,1,proc.stderr);
 assert.equal(proc.stdout,'');
 assert.equal(fs.readFileSync(counter,'utf8'),'0');
 assert.match(proc.stderr,/G6_STOCK_V4_POSTFLIGHT_READONLY_FAILED/);
 assert.doesNotMatch(proc.stderr,/synthetic_token_not_real/);
});
test('workflow is main-only, requires explicit confirm and has no D1 mutation credential',()=>{
 const wf=read('.github/workflows/d1-stock-v4-disposable-postflight-readonly.yml');
 assert.match(wf,/workflow_dispatch:/);
 assert.match(wf,/refs\/heads\/main/);
 assert.match(wf,/CHECK_G6_V4_POSTFLIGHT_READONLY/);
 assert.match(wf,/environment: d1-recovery-drill-readonly/);
 assert.match(wf,/cloudflare-hosted-probe-preflight\.mjs/);
 assert.match(wf,/CLOUDFLARE_D1_DRILL_READ_TOKEN/);
 assert.doesNotMatch(wf,/CLOUDFLARE_D1_DRILL_WRITE_TOKEN|migrations apply|time_travel\/restore|wrangler|(?:^|\s)deploy(?:\s|$)/);
 assert.ok(wf.indexOf('cloudflare-hosted-probe-preflight.mjs')<
  wf.indexOf('CLOUDFLARE_D1_DRILL_READ_TOKEN'));
});
