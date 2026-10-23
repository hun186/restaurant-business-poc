'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path'),fs=require('node:fs');
const {openDb}=require('../src/db'),{command,rows,balance,overview}=require('../src/service'),{hashPassword,checkPassword,uuid}=require('../src/security');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-poc-'));const {db,bootstrapPassword}=openDb(dir);t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});const owner=db.prepare("SELECT id,username,role FROM users WHERE role='owner'").get();const loc=db.prepare('SELECT id FROM locations').get().id;return {db,owner,loc,bootstrapPassword};}
const cmd=(f,act,data)=>command(f.db,f.owner,act,data);
const addIngredient=(f,sku='RICE')=>cmd(f,'ingredient.create',{sku,name:'白米',unit:'公斤',min_stock:5}).id;
test('bootstrap creates random owner password, SQLite schema, and preserves credentials',t=>{
 const f=fixture(t);assert.ok(f.bootstrapPassword.length>=20);
 const u=f.db.prepare("SELECT * FROM users WHERE role='owner'").get();assert.ok(checkPassword(f.bootstrapPassword,u.password_salt,u.password_hash));assert.notEqual(u.password_hash,f.bootstrapPassword);
 assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,2);
 const h=hashPassword('secure-password-123');assert.ok(checkPassword('secure-password-123',h.salt,h.hash));assert.equal(checkPassword('wrong',h.salt,h.hash),false);
});
test('staff cannot approve orders, mutate inventory, read audit, or create users',t=>{
 const f=fixture(t),ingredient=addIngredient(f);const x=cmd(f,'user.create',{username:'worker1',display_name:'測試員',role:'staff',password:'test-password-234',location_id:f.loc});
 const staff={id:x.id,username:'worker1',role:'staff'};
 assert.throws(()=>command(f.db,staff,'stock.purchase',{location_id:f.loc,ingredient_id:ingredient,qty:10}),{status:403});
 assert.throws(()=>command(f.db,staff,'user.create',{username:'fakemgr',display_name:'Fake',role:'manager',password:'test-password-234',location_id:f.loc}),{status:403});
 assert.throws(()=>rows(f.db,staff,'audit_logs'),{status:403});
 const order=command(f.db,staff,'order.create',{location_id:f.loc,ingredient_id:ingredient,qty:10,supplier:'示範供應商'}).id;
 assert.throws(()=>command(f.db,staff,'order.approve',{id:order}),{status:403});
 assert.equal(balance(f.db,ingredient,f.loc),0);
});
test('order approval and receiving increment inventory exactly once',t=>{
 const f=fixture(t),ingredient=addIngredient(f);const id=cmd(f,'order.create',{location_id:f.loc,ingredient_id:ingredient,qty:11,supplier:'測試供應商'}).id;
 assert.equal(balance(f.db,ingredient,f.loc),0);
 cmd(f,'order.approve',{id});cmd(f,'order.receive',{id});assert.equal(balance(f.db,ingredient,f.loc),11);
 assert.throws(()=>cmd(f,'order.receive',{id}),{status:409});assert.equal(balance(f.db,ingredient,f.loc),11);
 assert.ok(rows(f.db,f.owner,'audit_logs').some(a=>a.action==='order.receive'));
});
test('stocktake confirms delta once and rejects stale expected quantity',t=>{
 const f=fixture(t),ingredient=addIngredient(f);cmd(f,'stock.opening',{location_id:f.loc,ingredient_id:ingredient,qty:8,note:'測試期初庫存'});
 const s=cmd(f,'stocktake.create',{location_id:f.loc,ingredient_id:ingredient,counted_qty:6}).id;
 cmd(f,'stocktake.confirm',{id:s});assert.equal(balance(f.db,ingredient,f.loc),6);
 assert.throws(()=>cmd(f,'stocktake.confirm',{id:s}),{status:409});
 const stale=cmd(f,'stocktake.create',{location_id:f.loc,ingredient_id:ingredient,counted_qty:4}).id;
 const order=cmd(f,'order.create',{location_id:f.loc,ingredient_id:ingredient,qty:2,supplier:'測試商'}).id;cmd(f,'order.approve',{id:order});cmd(f,'order.receive',{id:order});
 assert.throws(()=>cmd(f,'stocktake.confirm',{id:stale}),{status:409});assert.equal(balance(f.db,ingredient,f.loc),8);
});
test('manager restricted to assigned location and cannot approve own leave',t=>{
 const f=fixture(t);const other=cmd(f,'location.create',{name:'分店'}).id;
 const m=cmd(f,'user.create',{username:'mgr',display_name:'主管',role:'manager',password:'test-password-234',location_id:f.loc});
 const manager={id:m.id,username:'mgr',role:'manager'};
 assert.throws(()=>command(f.db,manager,'task.create',{location_id:other,title:'不應建立'}),{status:403});
 const leave=command(f.db,manager,'leave.create',{location_id:f.loc,start_date:'2026-10-24',end_date:'2026-10-25',reason:'休假'}).id;
 assert.throws(()=>command(f.db,manager,'leave.review',{id:leave,status:'approved'}),{status:403});
 assert.equal(rows(f.db,manager,'locations').length,1);
});
test('shifts cannot overlap and evaluations are restricted to their employee',t=>{
 const f=fixture(t);const employee=cmd(f,'user.create',{username:'staff2',display_name:'甲',role:'staff',password:'test-password-234',location_id:f.loc});
 const staff={id:employee.id,username:'staff2',role:'staff'};
 cmd(f,'shift.create',{location_id:f.loc,user_id:staff.id,shift_date:'2026-11-01',start_time:'09:00',end_time:'17:00'});
 assert.throws(()=>cmd(f,'shift.create',{location_id:f.loc,user_id:staff.id,shift_date:'2026-11-01',start_time:'16:00',end_time:'20:00'}),{status:409});
 cmd(f,'evaluation.create',{location_id:f.loc,user_id:staff.id,period:'2026-10',score:83,feedback:'正常'});
 assert.equal(rows(f.db,staff,'evaluations').length,1);
 assert.equal(overview(f.db,staff).low,0);
});
test('reject corrupt legacy databases instead of silently resetting',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-corrupt-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));fs.writeFileSync(path.join(folder,'restaurant.sqlite'),'');
 assert.throws(()=>openDb(folder),/E_DB/);
});
test('deleted installed database is not silently re-created',t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-delete-'));t.after(()=>fs.rmSync(folder,{recursive:true,force:true}));
 const {db}=openDb(folder);db.close();fs.rmSync(path.join(folder,'restaurant.sqlite'));
 assert.throws(()=>openDb(folder),/E_DB: 既有資料目錄內資料庫遺失/);
});
test('changing password revokes all active sessions for the target user',t=>{
 const f=fixture(t),u=cmd(f,'user.create',{location_id:f.loc,username:'worker3',display_name:'測試三',password:'first-password-123',role:'staff'});
 f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run('abcd','csrf',u.id,'2099-12-01T00:00:00.000Z');
 cmd(f,'user.password',{user_id:u.id,password:'next-password-123'});
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(u.id).n,0);
});
test('usage cannot make inventory negative',t=>{
 const f=fixture(t),i=addIngredient(f);cmd(f,'stock.opening',{location_id:f.loc,ingredient_id:i,qty:1,note:'測試期初庫存'});
 assert.throws(()=>cmd(f,'stock.usage',{location_id:f.loc,ingredient_id:i,qty:2}),{status:409});
 assert.equal(balance(f.db,i,f.loc),1);
});

test('direct purchase cannot bypass approval; only owner may seed a one-time initial stock',t=>{
 const f=fixture(t),ingredient=addIngredient(f);
 const managerId=cmd(f,'user.create',{username:'managerseed',display_name:'測試主管',role:'manager',password:'test-password-234',location_id:f.loc}).id;
 const manager={id:managerId,username:'managerseed',role:'manager'};
 assert.throws(()=>cmd(f,'stock.purchase',{location_id:f.loc,ingredient_id:ingredient,qty:4}),{status:409});
 assert.throws(()=>command(f.db,manager,'stock.opening',{location_id:f.loc,ingredient_id:ingredient,qty:4,note:'不合法'}),{status:403});
 cmd(f,'stock.opening',{location_id:f.loc,ingredient_id:ingredient,qty:4,note:'來源憑證 A'});
 assert.throws(()=>cmd(f,'stock.opening',{location_id:f.loc,ingredient_id:ingredient,qty:4,note:'來源憑證 B'}),{status:409});
 const order=cmd(f,'order.create',{location_id:f.loc,ingredient_id:ingredient,qty:2,supplier:'示範供應商'}).id;
 assert.throws(()=>cmd(f,'order.receive',{id:order}),{status:409});
 cmd(f,'order.approve',{id:order});cmd(f,'order.receive',{id:order});
 assert.equal(balance(f.db,ingredient,f.loc),6);
});
test('new location grant revokes recipient sessions but duplicate grant preserves sessions',t=>{
 const f=fixture(t),other=cmd(f,'location.create',{name:'測試分店'}).id;
 const id=cmd(f,'user.create',{username:'granttest',display_name:'門市員工',role:'staff',password:'test-password-234',location_id:f.loc}).id;
 f.db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run('sess1','token1',id,'2099-01-01');
 cmd(f,'user.assign-location',{user_id:id,location_id:f.loc});
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(id).n,1);
 cmd(f,'user.assign-location',{user_id:id,location_id:other});
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get(id).n,0);
});
test('location and ownership filters precede row LIMIT',t=>{
 const f=fixture(t),second=cmd(f,'location.create',{name:'業主第二店'}).id;
 const id=cmd(f,'user.create',{username:'filtertest',display_name:'門市員工',role:'staff',password:'test-password-234',location_id:f.loc}).id;
 const staff={id,username:'filtertest',role:'staff'};
 cmd(f,'order.create',{location_id:f.loc,ingredient_id:addIngredient(f),qty:1,supplier:'門市 A'});
 for(let i=0;i<505;i++)f.db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)').run(uuid(),'PO-X-'+i,second,f.db.prepare('SELECT id FROM ingredients LIMIT 1').get().id,'第二店',1,f.owner.id);
 assert.equal(rows(f.db,staff,'purchase_orders').length,0);
 assert.equal(rows(f.db,f.owner,'purchase_orders').length,500);
 // Staff can still see own order despite other store's newer 505 rows.
 command(f.db,staff,'order.create',{location_id:f.loc,ingredient_id:f.db.prepare('SELECT id FROM ingredients LIMIT 1').get().id,qty:2,supplier:'授權門市'});
 assert.equal(rows(f.db,staff,'purchase_orders').length,1);
});
