'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDb}=require('../src/db'),{command}=require('../src/service');
const {checkPassword}=require('../src/security');
const {list,verifySnapshot}=require('../src/backup-manager');
const {recoverOwner}=require('../tools/reset-owner-password');

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-password-recover-'));
 const folder=path.join(root,'data'),backupDir=path.join(root,'backups');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const created=openDb(folder);
 const owner=created.db.prepare("SELECT * FROM users WHERE username='owner'").get();
 const locationId=created.db.prepare("SELECT id FROM locations LIMIT 1").get().id;
 return {root,folder,backupDir,...created,owner,locationId};
}
test('offline owner recovery preserves business data, makes verified pre-change backup and revokes sessions',t=>{
 const f=fixture(t);
 const managerId=command(f.db,f.owner,'user.create',{username:'manager1',display_name:'測試主管',role:'manager',password:'manager-password-123',location_id:f.locationId}).id;
 command(f.db,f.owner,'ingredient.create',{sku:'SAFE-101',name:'番茄',unit:'公斤',min_stock:5});
 const managerBefore=f.db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(managerId);
 f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run('session-key','csrf',f.owner.id,'2099-01-01T00:00:00Z');
 f.db.prepare('INSERT INTO login_attempts(id,username,ip_hash,success) VALUES(?,?,?,?)').run('attempt1','owner','hashed-address',0);
 f.db.close();
 const result=recoverOwner({folder:f.folder,backupDir:f.backupDir});
 assert.match(result.password,/^[A-Za-z0-9_-]{20,}$/);
 const old=list(f.backupDir);assert.equal(old.length,1);assert.equal(old[0].type,'manual');
 assert.equal(result.backupPath,path.join(f.backupDir,old[0].name));
 const oldSnapshot=verifySnapshot(result.backupPath);assert.equal(oldSnapshot.length,64);
 const db=openDb(f.folder).db;
 try{
  assert.equal(db.prepare('SELECT count(*) n FROM ingredients WHERE sku=?').get('SAFE-101').n,1);
  const owner=db.prepare("SELECT * FROM users WHERE username='owner'").get();
  assert.ok(checkPassword(result.password,owner.password_salt,owner.password_hash));
  assert.equal(checkPassword(f.bootstrapPassword,owner.password_salt,owner.password_hash),false);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(owner.id).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM login_attempts WHERE username=?').get('owner').n,0);
  const manager=db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').get(managerId);
  assert.deepEqual(manager,managerBefore);
  const audit=db.prepare("SELECT * FROM audit_logs WHERE action='auth.owner_password_recovered'").all();
  assert.equal(audit.length,1);
  assert.equal(audit[0].detail.includes(result.password),false);
  assert.equal(audit[0].detail.includes(f.bootstrapPassword),false);
  assert.equal(audit[0].actor_name,'(offline recovery)');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
 }finally{db.close();}
});
test('recovery requires existing trusted installed DB; never bootstraps an absent database',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-recover-empty-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const folder=path.join(root,'data'),backupDir=path.join(root,'backups');
 assert.throws(()=>recoverOwner({folder,backupDir}),{code:'E_RECOVERY'});
 assert.equal(fs.existsSync(path.join(folder,'restaurant.sqlite')),false);
 assert.equal(fs.existsSync(backupDir),false);
});
test('missing or unsafe .installed marker refuses recovery without altering password',t=>{
 const f=fixture(t),initial=f.owner.password_hash;
 f.db.close();fs.unlinkSync(path.join(f.folder,'.installed'));
 assert.throws(()=>recoverOwner({folder:f.folder,backupDir:f.backupDir}),{code:'E_RECOVERY'});
 assert.equal(fs.existsSync(f.backupDir),false);
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(f.folder,'restaurant.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare("SELECT password_hash FROM users WHERE username='owner'").get().password_hash,initial);}
 finally{db.close();}
});
test('failed backup rejects password change with no credential writes or session revocation',t=>{
 const f=fixture(t);
 const before=f.owner.password_hash;
 f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run('old-session','csrf',f.owner.id,'2099-01-01T00:00:00Z');
 f.db.close();
 // Use an invalid backup path located under DATA_DIR; getPaths forbids this.
 assert.throws(()=>recoverOwner({folder:f.folder,backupDir:path.join(f.folder,'unsafe-backups')}),{code:'E_CONFIG'});
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(f.folder,'restaurant.sqlite'),{readOnly:true});
 try{
  assert.equal(db.prepare("SELECT password_hash FROM users WHERE username='owner'").get().password_hash,before);
  assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE user_id=?').get(f.owner.id).n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE action='auth.owner_password_recovered'").get().n,0);
 }finally{db.close();}
});
test('disabled or missing owner is refused; no new account is silently created',t=>{
 const f=fixture(t);f.db.prepare("UPDATE users SET active=0 WHERE username='owner'").run();f.db.close();
 assert.throws(()=>recoverOwner({folder:f.folder,backupDir:f.backupDir}),{code:'E_RECOVERY'});
 assert.equal(fs.existsSync(f.backupDir),false);
 const {DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(path.join(f.folder,'restaurant.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare("SELECT count(*) n FROM users WHERE username='owner'").get().n,1);}
 finally{db.close();}
});
