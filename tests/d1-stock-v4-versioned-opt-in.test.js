'use strict';
// D1 v4 versioned release candidate: disposable SQLite proof, never D1 calls.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const v3=read('cloudflare/migrations/0001_initial_v3.sql');
const idx=read('cloudflare/migrations/0002_login_attempts_window_indexes.sql');
const proposal=read('cloudflare/migration-proposals/0004_stock_move_kinds.sql');
const candidate=read('cloudflare/migrations-stock-v4-opt-in/0004_stock_move_kinds.sql');
function fakeDb(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(v3+'\n'+idx);
 db.exec('CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL)');
 db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(1,'0001_initial_v3.sql');
 db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)').run(2,'0002_login_attempts_window_indexes.sql');
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
  .run('fake-owner','owner','Synthetic Owner','owner','SALT','HASH');
 db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run('fake-store','Synthetic store');
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
  .run('fake-item','MOCK-01','Synthetic ingredient','kg');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
  .run('first','fake-item','fake-store',9.125,'purchase','fake-owner');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)')
  .run('second','fake-item','fake-store',-1.125,'usage','fake-owner');
 db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail) VALUES(?,?,?,?,?,?)')
  .run('fake-audit','Synthetic Owner','stock.usage','stock_moves','second','{}');
 return db;
}
test('v4 opt-in candidate matches both inert proposals and is absent from active migrations',()=>{
 assert.equal(candidate,proposal);
 assert.equal(candidate,read('db/migration-proposals/0004_stock_move_kinds.sql'));
 assert.equal(fs.existsSync(path.join(root,'cloudflare/migrations/0004_stock_move_kinds.sql')),false);
 const staging=read('.github/workflows/d1-staging-migration.yml');
 assert.doesNotMatch(staging,/migrations-stock-v4-opt-in/);
 const configs=['wrangler.jsonc','cloudflare/wrangler.preview-migrations.example.jsonc'];
 for(const cfg of configs)assert.doesNotMatch(read(cfg),/migrations-stock-v4-opt-in/);
});
test('v3 synthetic history survives versioned candidate with explicit migration receipt',t=>{
 const db=fakeDb(t);
 const before=db.prepare('SELECT * FROM stock_moves ORDER BY id').all();
 const audit=db.prepare('SELECT * FROM audit_logs ORDER BY id').all();
 const owner=db.prepare('SELECT id,username,role FROM users').all();
 db.exec('BEGIN IMMEDIATE');
 try{
  db.exec(candidate);
  db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)')
   .run(3,'0004_stock_move_kinds.sql');
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e}
 assert.deepEqual(db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),before);
 assert.deepEqual(db.prepare('SELECT * FROM audit_logs ORDER BY id').all(),audit);
 assert.deepEqual(db.prepare('SELECT id,username,role FROM users').all(),owner);
 assert.deepEqual(db.prepare('SELECT id,name FROM d1_migrations ORDER BY id').all().map(x=>({id:x.id,name:x.name})),
  [{id:1,name:'0001_initial_v3.sql'},
   {id:2,name:'0002_login_attempts_window_indexes.sql'},
   {id:3,name:'0004_stock_move_kinds.sql'}]);
 assert.equal(db.prepare('SELECT kind_version FROM stock_move_kind_contract WHERE id=1').get().kind_version,4);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});
test('failed versioned stock candidate transaction leaves v3 ledger and rows unmodified',t=>{
 const db=fakeDb(t);
 const before=db.prepare('SELECT * FROM stock_moves ORDER BY id').all();
 db.exec('BEGIN IMMEDIATE');
 assert.throws(()=>{
  db.exec(candidate);
  db.prepare('INSERT INTO d1_migrations(id,name) VALUES(?,?)')
   .run(2,'0004_stock_move_kinds.sql'); // explicit migration record collides
 });
 db.exec('ROLLBACK');
 assert.deepEqual(db.prepare('SELECT * FROM stock_moves ORDER BY id').all(),before);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='stock_move_kind_contract'").get().n,0);
 assert.equal(db.prepare("SELECT count(*) AS n FROM d1_migrations").get().n,2);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
