'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDb}=require('../src/db'),{command}=require('../src/service');
const contract=import('../cloudflare/account-status-contract.mjs');
test('Shared account status policy denies non-owner, self, and owner targets',async()=>{
 const {MANAGED_ACCOUNT_ROLES,canOwnerManageAccountStatus,isAccountStatusTransition}=await contract;
 assert.deepEqual([...MANAGED_ACCOUNT_ROLES],['staff','manager']);
 for(const role of MANAGED_ACCOUNT_ROLES){
  assert.equal(canOwnerManageAccountStatus('owner','actor',role,'target'),true);
  assert.equal(canOwnerManageAccountStatus('manager','actor',role,'target'),false);
  assert.equal(canOwnerManageAccountStatus('owner','actor',role,'actor'),false);
 }
 assert.equal(canOwnerManageAccountStatus('owner','actor','owner','target'),false);
 assert.equal(isAccountStatusTransition(1,false),true);
 assert.equal(isAccountStatusTransition(0,true),true);
 assert.equal(isAccountStatusTransition(1,true),false);
 assert.equal(isAccountStatusTransition(0,false),false);
 assert.equal(isAccountStatusTransition(null,true),false);
});
test('Local SQLite owner can disable staff but not other Owner, and no-op is rejected',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-status-policy-'));
 const {db}=openDb(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const owner=db.prepare("SELECT id,username,role FROM users WHERE role='owner' AND active=1 LIMIT 1").get();
 const loc=db.prepare('SELECT id FROM locations WHERE active=1 LIMIT 1').get().id;
 const add=(username,role)=>command(db,owner,'user.create',{username,display_name:username,role,password:'synthetic-account-password-1234',location_id:loc}).id;
 const staffId=add('policystaff','staff'),ownerId=add('policyowner','owner');
 const change=(id,active)=>command(db,owner,'user.active',{user_id:id,active});
 assert.throws(()=>change(ownerId,false),e=>e.status===403);
 assert.throws(()=>change(staffId,true),e=>e.status===409);
 assert.equal(change(staffId,false).id,staffId);
 assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(staffId).active,0);
 assert.equal(change(staffId,true).id,staffId);
 assert.equal(db.prepare('SELECT active FROM users WHERE id=?').get(ownerId).active,1);
 assert.equal(db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='user.active' AND entity_id=?").get(staffId).n,2);
});
test('SQLite and D1 share server policy and Demo remains mock-only',()=>{
 const root=path.resolve(__dirname,'..');
 const local=fs.readFileSync(path.join(root,'src/service.js'),'utf8');
 const cf=fs.readFileSync(path.join(root,'cloudflare/native-account-management-http.mjs'),'utf8');
 const ui=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
 const demo=fs.readFileSync(path.join(root,'vercel-demo/app.js'),'utf8');
 assert.ok(local.includes("require('../cloudflare/account-status-contract.mjs')"));
 assert.ok(cf.includes("from './account-status-contract.mjs'"));
 for(const s of [local,cf])assert.match(s,/canOwnerManageAccountStatus\(/);
 assert.match(ui,/if\(r\.role==='staff'\|\|r\.role==='manager'\)/);
 assert.match(demo,/if\(false&&page==='users'/);
});
