'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.join(__dirname,'..');
const proposal=fs.readFileSync(path.join(root,'cloudflare/migration-proposals/0003_access_identity_links.sql'),'utf8');
const initial=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const ISS='https://demo.cloudflareaccess.com',AUD='a'.repeat(64);
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys = ON;');
 db.exec(initial);
 return db;
}
function seedUser(db,id='synthetic-user'){
 db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(id,id,'Synthetic Test Only','staff','fake-salt','fake-hash');
}
function createLink(db,{issuer=ISS,audience=AUD,subject='synthetic-subject',user='synthetic-user',active}={}) {
 if(active===undefined)db.prepare('INSERT INTO access_identity_links(issuer,audience,subject,user_id) VALUES(?,?,?,?)')
  .run(issuer,audience,subject,user);
 else db.prepare('INSERT INTO access_identity_links(issuer,audience,subject,user_id,active) VALUES(?,?,?,?,?)')
  .run(issuer,audience,subject,user,active);
}
test('proposal is strictly additive SQL and never registers users, sessions or passwords',t=>{
 const db=fixture(t);
 const before=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
 const contract=db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').get().contract_version;
 assert.doesNotMatch(proposal,/^\s*(?:INSERT|UPDATE|DELETE|DROP|ALTER|PRAGMA)\s/mi);
 db.exec(proposal);
 const after=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(x=>x.name);
 assert.deepEqual(after.filter(x=>!before.includes(x)),['access_identity_links']);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0);
 assert.equal(db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').get().contract_version,contract);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('new subject binding is inactive by default; explicit activation is required',t=>{
 const db=fixture(t);seedUser(db);db.exec(proposal);
 createLink(db);
 const get=()=>db.prepare('SELECT active FROM access_identity_links WHERE issuer=? AND audience=? AND subject=?')
  .get(ISS,AUD,'synthetic-subject')?.active;
 assert.equal(get(),0);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_identity_links WHERE active=1').get().n,0);
 db.prepare('UPDATE access_identity_links SET active=1 WHERE issuer=? AND audience=? AND subject=? AND active=0')
  .run(ISS,AUD,'synthetic-subject');
 assert.equal(get(),1);
 assert.throws(()=>db.prepare('UPDATE access_identity_links SET active=2').run(),/CHECK constraint failed/);
});
test('ambiguous subject or multiple subject mappings to a user are prohibited',t=>{
 const db=fixture(t);seedUser(db);db.exec(proposal);createLink(db,{active:1});
 assert.throws(()=>createLink(db,{active:0}),/UNIQUE constraint failed/);
 assert.throws(()=>createLink(db,{subject:'other-subject'}),/UNIQUE constraint failed/);
 // Explicitly different trusted audience may have a separate mapping, but
 // JWT verifier still pins one exact audience and issuer before DB lookup.
 createLink(db,{audience:'b'.repeat(64),subject:'other-subject'});
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,2);
});
test('invalid audience, subject, active state and unknown user are rejected',t=>{
 const db=fixture(t);seedUser(db);db.exec(proposal);
 for(const x of [AUD.slice(1),'z'.repeat(64)])
   assert.throws(()=>createLink(db,{audience:x}),/CHECK constraint failed/);
 assert.throws(()=>createLink(db,{subject:''}),/CHECK constraint failed/);
 assert.throws(()=>createLink(db,{subject:'x'.repeat(257)}),/CHECK constraint failed/);
 assert.throws(()=>createLink(db,{user:'missing-user'}),/FOREIGN KEY constraint failed/);
 assert.throws(()=>createLink(db,{active:3}),/CHECK constraint failed/);
});
test('foreign key cascade revokes bindings when an existing user is removed',t=>{
 const db=fixture(t);seedUser(db);db.exec(proposal);createLink(db,{active:1});
 db.prepare('DELETE FROM users WHERE id=?').run('synthetic-user');
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM access_identity_links').get().n,0);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('proposal stays outside active D1 migrations and no remote apply workflow references it',()=>{
 const actual=fs.readdirSync(path.join(root,'cloudflare/migrations')).filter(f=>f.endsWith('.sql')).sort();
 assert.deepEqual(actual,['0001_initial_v3.sql','0002_login_attempts_window_indexes.sql']);
 const yaml=fs.readFileSync(path.join(root,'.github/workflows/d1-staging-incremental-0002.yml'),'utf8');
 assert.doesNotMatch(yaml,/0003_access_identity_links|migration-proposals\//);
});
