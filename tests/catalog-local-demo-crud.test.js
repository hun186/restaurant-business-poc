'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
const {command}=require('../src/service');
function ready(){
 const db=new DatabaseSync(':memory:');
 db.exec(fs.readFileSync(path.join(root,'db/schema.sql'),'utf8'));
 const actor={id:crypto.randomUUID(),username:'owner-demo',role:'owner',locations:[]};
 db.prepare("INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)")
  .run(actor.id,actor.username,'虛構業主',actor.role,'salt','hash');
 return {db,actor};
}
const expectFail=(fn,status)=>assert.throws(fn,e=>e&&e.status===status);
test('local SQLite ingredient edit preserves SKU, rejects stale state and audits',()=>{
 const {db,actor}=ready();
 try{
  const id=command(db,actor,'ingredient.create',{sku:'TEST-A',name:'米',unit:'kg',min_stock:1}).id;
  const expected={sku:'TEST-A',name:'米',unit:'kg',min_stock:1};
  const data={id,expected,changes:{name:'白米',unit:'公斤',min_stock:2}};
  command(db,actor,'ingredient.update',data);
  const row=db.prepare('SELECT * FROM ingredients WHERE id=?').get(id);
  assert.deepEqual([row.sku,row.name,row.unit,row.min_stock],['TEST-A','白米','公斤',2]);
  expectFail(()=>command(db,actor,'ingredient.update',data),409);
  expectFail(()=>command(db,actor,'ingredient.update',{id,expected:{...expected,name:'白米',unit:'公斤',min_stock:2},changes:{sku:'DIFFERENT',name:'米',unit:'kg',min_stock:1}}),400);
  const audit=db.prepare("SELECT action,detail FROM audit_logs WHERE entity_id=? AND action='ingredient.update'").all(id);
  assert.equal(audit.length,1);
  assert.equal(JSON.parse(audit[0].detail).after.name,'白米');
 }finally{db.close();}
});
test('local SQLite deactivates/reenables ingredient without deleting ledger; staff cannot mutate',()=>{
 const {db,actor}=ready();
 try{
  const store=command(db,actor,'location.create',{name:'總店'}).id;
  const ing=command(db,actor,'ingredient.create',{sku:'B',name:'茶',unit:'包',min_stock:0}).id;
  const move=crypto.randomUUID();
  db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,note,actor_id) VALUES(?,?,?,?,?,?,?)")
   .run(move,ing,store,5,'purchase','保留歷史',actor.id);
  command(db,actor,'ingredient.active',{id:ing,expected_active:1,active:0});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stock_moves WHERE id=?').get(move).n,1);
  expectFail(()=>command(db,{...actor,role:'staff'},'ingredient.active',{id:ing,expected_active:0,active:1}),403);
  expectFail(()=>command(db,actor,'ingredient.active',{id:ing,expected_active:1,active:0}),409);
  command(db,actor,'ingredient.active',{id:ing,expected_active:0,active:1});
  assert.equal(db.prepare('SELECT active FROM ingredients WHERE id=?').get(ing).active,1);
 }finally{db.close();}
});
test('local store edit, last-active guard and session revocation on deactivate',()=>{
 const {db,actor}=ready();
 try{
  const one=command(db,actor,'location.create',{name:'第一店'}).id;
  const two=command(db,actor,'location.create',{name:'第二店'}).id;
  const prior={name:'第一店'};
  command(db,actor,'location.update',{id:one,expected:prior,changes:{name:'新第一店'}});
  expectFail(()=>command(db,actor,'location.update',{id:one,expected:prior,changes:{name:'改壞的'}}),409);
  db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(actor.id,two);
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run('synthetic-hash','synthetic-csrf',actor.id,'2099-01-01T00:00:00Z');
  command(db,actor,'location.active',{id:two,expected_active:1,active:0});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
  expectFail(()=>command(db,actor,'location.active',{id:one,expected_active:1,active:0}),409);
  command(db,actor,'location.active',{id:two,expected_active:0,active:1});
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM locations').get().n,2);
  assert.equal(db.prepare('SELECT active FROM locations WHERE id=?').get(two).active,1);
 }finally{db.close();}
});
test('shared contract served in local/Vercel and demo never reuses real D1 authentication',()=>{
 const read=x=>fs.readFileSync(path.join(root,x),'utf8');
 const source=read('src/catalog-crud-contract.mjs');
 for(const target of ['public/catalog-crud-contract.mjs','vercel-demo/catalog-crud-contract.mjs'])
  assert.equal(read(target),source,'browser contract must match canonical source: '+target);
 for(const code of [read('public/app.js'),read('vercel-demo/app.js')]){
  assert.match(code,/ingredient\.update/);assert.match(code,/location\.update/);
  assert.match(code,/ingredient\.active/);assert.match(code,/location\.active/);
  assert.match(code,/import\('\/catalog-crud-contract\.mjs'\)/);
  assert.match(code,/expected_active/);
 }
 assert.match(read('server.js'),/\/catalog-crud-contract\.mjs/);
 assert.match(read('vercel-demo/mock.js'),/await command\(body\.action/);
 assert.doesNotMatch(read('vercel-demo/owner-app.js'),/mock\.js|sessionStorage|localStorage/);
 assert.match(read('wrangler.jsonc'),/"CLOUD_AUTH_PHASE": "disabled"/);
});
