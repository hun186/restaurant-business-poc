'use strict';
// Disposable synthetic SQLite only. No real customer data or Cloudflare calls.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {runCloneRehearsal,parseArgs}=require('../tools/local-stock-v4-clone-rehearsal');
const root=path.join(__dirname,'..'),schema=fs.readFileSync(path.join(root,'db/schema.sql'),'utf8');
const fileName='restaurant-backup-20261120-090000-aabbccdd-manual.sqlite';
const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const tempDirs=()=>new Set(fs.readdirSync(os.tmpdir()).filter(x=>x.startsWith('restaurant-stock-v4-clone-')));
function fixture(t,{invalid=null}={}){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'v4-rehearsal-test-'));
 t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const backup=path.join(folder,fileName);
 const db=new DatabaseSync(':memory:');
 db.exec('PRAGMA foreign_keys=ON');db.exec(schema);
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('store-1','合成店');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('item-1','FAKE-ONLY','虛構食材','kg');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
  .run('owner-1','fake-owner','合成業主','owner','fake-salt','fake-hash');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
  .run('move-1','item-1','store-1',9.125,'purchase','owner-1');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id,note) VALUES(?,?,?,?,?,?,?)')
  .run('move-2','item-1','store-1',-2.125,'usage','owner-1','合成耗用');
 db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?)')
  .run('audit-1','owner-1','合成業主','stock.usage','stock_moves','move-2','store-1','{}');
 db.prepare('INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_by) VALUES(?,?,?,?,?,?,?,?,?)')
  .run('price-1','item-1','store-1','2026-11-19',3000,'kg','假供應商','manual','owner-1');
 if(invalid==='missing-index')db.exec('DROP INDEX stock_moves_stock');
 if(invalid==='trigger')db.exec('CREATE TRIGGER malformed AFTER INSERT ON stock_moves BEGIN SELECT 1; END');
 if(invalid==='v4'){db.exec('BEGIN IMMEDIATE');try{
  db.exec(fs.readFileSync(path.join(root,'db/migration-proposals/0004_stock_move_kinds.sql'),'utf8'));
  db.exec('PRAGMA user_version=4; COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}}
 if(invalid==='version')db.exec('PRAGMA user_version=5');
 const sql="'"+backup.replace(/'/g,"''")+"'";
 db.exec('VACUUM INTO '+sql);db.close();
 return {backup,folder,sha:digest(backup)};
}
test('independent v3 backup becomes a disposable verified v4 clone, not an operational change',t=>{
 const f=fixture(t),old=tempDirs(),listing=fs.readdirSync(f.folder);
 const mode=fs.statSync(f.backup).mode&0o777;
 const result=runCloneRehearsal({file:f.backup,expectedSha256:f.sha});
 assert.equal(result.status,'LOCAL_STOCK_V4_DISPOSABLE_REHEARSAL_PASS');
 assert.equal(result.original_stock_move_rows,2);
 assert(result.preserved_tables>=15);
 assert.equal(result.source_sha256,f.sha);
 assert.equal(result.original_row_fingerprint_preserved,true);
 assert.equal(result.migration_authorized,false);
 assert.equal(result.production_database_modified,false);
 assert.equal(result.production_gate_enabled,false);
 assert.equal(result.disposable_copies_removed,true);
 assert.equal(result.source_opened_with_sqlite,false);
 assert.equal(digest(f.backup),f.sha);
 assert.equal(fs.statSync(f.backup).mode&0o777,mode);
 assert.deepEqual(fs.readdirSync(f.folder),listing);
 assert.deepEqual(tempDirs(),old);
 for(const ext of ['-wal','-shm'])assert.equal(fs.existsSync(f.backup+ext),false);
});
test('wrong SHA, wrong filename, missing path and link aliases all fail closed',t=>{
 const f=fixture(t),old=tempDirs();
 assert.throws(()=>runCloneRehearsal({file:f.backup,expectedSha256:'0'.repeat(64)}),{code:'E_V4_CLONE_SOURCE_DIGEST'});
 assert.throws(()=>runCloneRehearsal({file:f.backup,expectedSha256:'x'.repeat(64)}),{code:'E_V4_CLONE_EXPECTED_SHA256'});
 assert.throws(()=>runCloneRehearsal({file:path.join(f.folder,'restaurant.sqlite'),expectedSha256:f.sha}),{code:'E_V4_CLONE_FILE_NAME'});
 assert.throws(()=>runCloneRehearsal({file:path.join(f.folder,'restaurant-backup-20261120-090000-11223344-manual.sqlite'),expectedSha256:f.sha}),{code:'E_V4_CLONE_SOURCE_MISSING'});
 const sym=path.join(f.folder,'restaurant-backup-20261120-090001-aabbccdd-manual.sqlite');
 try{fs.symlinkSync(f.backup,sym,'file');
  assert.throws(()=>runCloneRehearsal({file:sym,expectedSha256:f.sha}),{code:'E_V4_CLONE_SOURCE_UNSAFE'});
 }catch(e){if(e.code!=='EPERM'&&e.code!=='EACCES')throw e;}
 assert.equal(digest(f.backup),f.sha);assert.deepEqual(tempDirs(),old);
});
for(const invalid of ['missing-index','trigger','v4','version']){
 test('v3 source preflight refuses '+invalid+' without changing backup',t=>{
  const f=fixture(t,{invalid}),old=tempDirs();
  assert.throws(()=>runCloneRehearsal({file:f.backup,expectedSha256:f.sha}),
   e=>e?.code==='E_V4_CLONE_REHEARSAL_FAILED');
  assert.equal(digest(f.backup),f.sha);assert.deepEqual(tempDirs(),old);
 });
}
test('CLI requires an independently recorded digest, with no implicit write mode',()=>{
 assert.deepEqual(parseArgs(['--file','x','--sha256','123']),{file:'x',expectedSha256:'123'});
 for(const args of [[],['--apply'],['--file','foo'],['--file','foo','--apply','yes']])
  assert.throws(()=>parseArgs(args),{code:'E_V4_CLONE_ARGS'});
 const code=fs.readFileSync(path.join(root,'tools/local-stock-v4-clone-rehearsal.js'),'utf8');
 assert.doesNotMatch(code,/process\.env\.LOCAL_STOCK_V4_WRITE_GATE\s*=|wrangler|fetch\(/);
 assert.doesNotMatch(code,/data\/restaurant\.sqlite|cloudflare\/migrations/);
 assert.match(code,/checkStockV4OfflinePostflight\(before,after,'local'\)/);
 assert.match(code,/PRAGMA user_version=4/);
 const lines=code.indexOf("postflight=checkStockV4OfflinePostflight");
 const marker=code.indexOf("after.exec('PRAGMA user_version=4')");
 assert(lines>=0&&marker>lines,'postflight must run while version marker remains v3');
});
