'use strict';
// Only synthetic SQLite :memory: databases are created. Never upgrades real data.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {integrity,verifySnapshot,fingerprint}=require('../src/backup-manager.js');
const {DatabaseSync}=require('node:sqlite');
const {verifyInstalledSchema}=require('../src/db.js');
const root=path.join(__dirname,'..'),read=f=>fs.readFileSync(path.join(root,f),'utf8');
const v3=read('db/schema.sql'),proposal=read('db/migration-proposals/0004_stock_move_kinds.sql');
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(v3);return db;
}
function v4(db){
 db.exec('BEGIN IMMEDIATE');
 try{db.exec(proposal);db.exec('PRAGMA user_version=4; COMMIT');}
 catch(e){db.exec('ROLLBACK');throw e;}
}
test('existing v3 remains supported and v4 is accepted only with explicit version and full schema',t=>{
 const db=fixture(t);
 assert.doesNotThrow(()=>verifyInstalledSchema(db,3));
 const before=db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n;
 assert.throws(()=>verifyInstalledSchema(db,4),/E_DB/);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get().n,before);
 v4(db);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,4);
 assert.doesNotThrow(()=>verifyInstalledSchema(db,4));
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('partial/manual migration, missing marker row and incorrect version fail closed',t=>{
 const db=fixture(t);
 db.exec("CREATE TABLE stock_move_kind_contract (id INTEGER PRIMARY KEY,kind_version INTEGER)");
 db.exec('INSERT INTO stock_move_kind_contract VALUES(1,4)');
 assert.throws(()=>verifyInstalledSchema(db,3),/E_DB/);
 db.exec('DROP TABLE stock_move_kind_contract');
 db.exec("CREATE TABLE stock_moves_v4 (id TEXT PRIMARY KEY)");
 assert.throws(()=>verifyInstalledSchema(db,3),/E_DB/);
 db.exec('DROP TABLE stock_moves_v4');
 v4(db);
 assert.doesNotThrow(()=>verifyInstalledSchema(db,4));
 db.exec('DELETE FROM stock_move_kind_contract');
 assert.throws(()=>verifyInstalledSchema(db,4),/E_DB/);
 db.exec('INSERT INTO stock_move_kind_contract(id,kind_version) VALUES(1,4)');
 db.exec('PRAGMA user_version=3');
 assert.throws(()=>verifyInstalledSchema(db,3),/E_DB/);
 db.exec('PRAGMA user_version=5');
 assert.throws(()=>verifyInstalledSchema(db,5),/E_DB/);
});
test('v4 structural verification rejects missing stock index and altered ledger constraints',t=>{
 const db=fixture(t);v4(db);
 db.exec('DROP INDEX stock_moves_stock');
 assert.throws(()=>verifyInstalledSchema(db,4),/E_DB/);
});
test('verifying a v4 clone does not run any real operator migration or change data',t=>{
 const db=fixture(t);v4(db);
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)')
  .run('00000000-0000-4000-8000-000000000001','Synthetic Store');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('00000000-0000-4000-8000-000000000002','V4-TEST','Synthetic Ingredient','kg');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,note) VALUES(?,?,?,?,?,?)')
  .run('00000000-0000-4000-8000-000000000003',
   '00000000-0000-4000-8000-000000000002',
   '00000000-0000-4000-8000-000000000001',-0.125,'scrap','合成報廢');
 const rows=db.prepare('SELECT * FROM stock_moves').all();
 verifyInstalledSchema(db,4);
 assert.deepEqual(db.prepare('SELECT * FROM stock_moves').all(),rows);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,4);
 const dbCode=read('src/db.js');
 assert.match(dbCode,/if\(version===4\)expected\.exec/);
 assert.doesNotMatch(dbCode,/db\.exec\(fs\.readFileSync\(path\.join\(__dirname,[\s\S]*?0004_stock_move_kinds\.sql/);
 assert.doesNotMatch(read('db/schema.sql'),/stock_move_kind_contract/);
});

test('v4 backup source and verified independent snapshot remain restorable/identical',t=>{
 const db=fixture(t);v4(db);
 assert.doesNotThrow(()=>integrity(db));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-v4-clone-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'synthetic.sqlite');
 db.exec("VACUUM INTO '"+file.replace(/'/g,"''")+"'");
 assert.equal(verifySnapshot(file),fingerprint(db));
 const copy=new DatabaseSync(file,{readOnly:true});
 try{
  assert.equal(copy.prepare('PRAGMA user_version').get().user_version,4);
  assert.doesNotThrow(()=>integrity(copy));
 }finally{copy.close();}
 // A structurally invalid snapshot must never be accepted for restore.
 db.exec('DELETE FROM stock_move_kind_contract');
 assert.throws(()=>integrity(db),/E_DB/);
});
test('backup integrity still rejects unsupported versions and does not mutate v3',t=>{
 const db=fixture(t);
 const prev=db.prepare('PRAGMA user_version').get().user_version;
 assert.equal(prev,3);assert.doesNotThrow(()=>integrity(db));
 db.exec('PRAGMA user_version=5');
 assert.throws(()=>integrity(db),{code:'E_DB'});
 db.exec('PRAGMA user_version=3');
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,prev);
});
