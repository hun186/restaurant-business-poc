'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {openDb}=require('../src/db'),{rows,command,balance}=require('../src/service');
const {conversion,inventoryValue}=require('../src/pricing');
const {fingerprint,perform,verifySnapshot,list}=require('../src/backup-manager');
function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-pricing-'));
 const backupDir=path.join(path.dirname(folder),path.basename(folder)+'-copies');
 const opened=openDb(folder),db=opened.db;
 t.after(()=>{try{db.close();}catch{}fs.rmSync(folder,{recursive:true,force:true});fs.rmSync(backupDir,{recursive:true,force:true});});
 const owner=db.prepare("SELECT id,role,username FROM users WHERE role='owner'").get();
 const loc=db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 const ing=command(db,owner,'ingredient.create',{sku:'SAMPLE',name:'示範米',unit:'公斤',min_stock:2}).id;
 const dish=command(db,owner,'dish.create',{name:'示範飯',sale_price_twd:'120'}).id;
 command(db,owner,'recipe.set',{dish_id:dish,ingredient_id:ing,qty:250,unit:'公克'});
 return {folder,db,owner,loc,ing,dish,backupDir};
}
const act=(f,action,data,user=f.owner)=>command(f.db,user,action,data);
test('unit conversion supports compatible metric families only',()=>{
 assert.equal(conversion(250,'公克','公斤'),0.25);
 assert.equal(conversion(500,'毫升','公升'),0.5);
 assert.equal(conversion(1,'顆','公斤'),null);
});
test('missing price cannot be treated as zero cost or positive margin',t=>{
 const f=fixture(t),c=rows(f.db,f.owner,'dish_costs')[0];
 assert.equal(c.estimated_cost_twd,null);
 assert.equal(c.gross_margin_pct,null);
 assert.equal(c.cost_status,'價格或單位不完整');
 assert.throws(()=>act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit:'顆',unit_price_twd:'1'}),/單位/);
});
test('historical effective price and recipe quantity calculate material gross margin',t=>{
 const f=fixture(t);
 act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit:'公斤',unit_price_twd:'80',price_date:'2020-01-01',supplier:'示範供應商'});
 act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit:'公斤',unit_price_twd:'100',price_date:'2019-01-01'});
 act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit:'公斤',unit_price_twd:'120',price_date:'2099-01-01'});
 const c=rows(f.db,f.owner,'dish_costs')[0];
 assert.equal(c.estimated_cost_twd,20);
 assert.equal(c.gross_profit_twd,100);
 assert.equal(c.gross_margin_pct,83.33);
 assert.equal(rows(f.db,f.owner,'ingredient_prices').length,3);
 assert.equal(rows(f.db,f.owner,'dish_cost_lines')[0].line_cost_twd,20);
});
test('order receiving stores exactly one inventory movement and actual price atomically',t=>{
 const f=fixture(t),order=act(f,'order.create',{location_id:f.loc,ingredient_id:f.ing,supplier:'甲',qty:5}).id;
 act(f,'order.approve',{id:order});
 assert.throws(()=>act(f,'order.receive',{id:order,unit_price_twd:'10.123'}),/金額/);
 assert.equal(balance(f.db,f.ing,f.loc),0);
 act(f,'order.receive',{id:order,unit_price_twd:'88.50',price_unit:'公斤',price_date:'2020-02-01'});
 assert.equal(balance(f.db,f.ing,f.loc),5);
 assert.throws(()=>act(f,'order.receive',{id:order,unit_price_twd:'88.50'}),{status:409});
 const history=rows(f.db,f.owner,'ingredient_prices');assert.equal(history.length,1);
 assert.equal(history[0].source,'receiving');assert.equal(history[0].reference_id,order);
});
test('stock purchase price and valuation are estimated, not accounting costs',t=>{
 const f=fixture(t);
 act(f,'stock.purchase',{location_id:f.loc,ingredient_id:f.ing,qty:5,unit_price_twd:'80',price_unit:'公斤',price_date:'2020-01-01'});
 assert.equal(inventoryValue(f.db,f.owner)[0].estimated_value_twd,400);
 act(f,'stock.usage',{location_id:f.loc,ingredient_id:f.ing,qty:2});
 assert.equal(inventoryValue(f.db,f.owner)[0].estimated_value_twd,240);
});
test('branch-level price isolation and owner-only shared recipe changes',t=>{
 const f=fixture(t),loc2=act(f,'location.create',{name:'另一店'}).id;
 const mid=act(f,'user.create',{username:'mgrpricing',display_name:'主管',role:'manager',password:'a-valid-password-123',location_id:f.loc}).id;
 const sid=act(f,'user.create',{username:'stfpricing',display_name:'員工',role:'staff',password:'a-valid-password-123',location_id:f.loc}).id;
 const manager={id:mid,username:'mgrpricing',role:'manager'},staff={id:sid,username:'stfpricing',role:'staff'};
 assert.throws(()=>act(f,'price.record',{location_id:loc2,ingredient_id:f.ing,unit_price_twd:'10'},manager),{status:403});
 assert.throws(()=>act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit_price_twd:'10'},staff),{status:403});
 assert.throws(()=>rows(f.db,staff,'dish_costs'),{status:403});
 assert.throws(()=>act(f,'dish.price',{dish_id:f.dish,sale_price_twd:'9'},manager),{status:403});
 assert.throws(()=>act(f,'recipe.set',{dish_id:f.dish,ingredient_id:f.ing,qty:100,unit:'公克'},manager),{status:403});
 act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit_price_twd:'10'});
 act(f,'price.record',{location_id:loc2,ingredient_id:f.ing,unit_price_twd:'50'});
 assert.equal(rows(f.db,manager,'ingredient_prices').length,1);
 assert.equal(rows(f.db,manager,'dish_costs').length,1);
 assert.equal(rows(f.db,f.owner,'dish_costs').length,2);
});
test('v2 database upgrades to v3 after a verified v2 safety snapshot',t=>{
 const f=fixture(t);
 f.db.exec('DROP TABLE dish_ingredients;DROP TABLE menu_dishes;DROP TABLE ingredient_prices; PRAGMA user_version=2;');f.db.close();
 const previous=process.env.BACKUP_DIR;process.env.BACKUP_DIR=f.backupDir;
 try{
  const reopened=openDb(f.folder);try{
   assert.equal(reopened.db.prepare('PRAGMA user_version').get().user_version,3);
   assert.equal(list(f.backupDir).filter(x=>x.type==='migration').length,1);
  }finally{reopened.db.close();}
 }finally{if(previous===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=previous;fs.rmSync(f.backupDir,{recursive:true,force:true});}
});
test('backup digest and verified backup include price and recipe changes',t=>{
 const f=fixture(t),first=fingerprint(f.db);
 act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit_price_twd:'80'});
 assert.notEqual(fingerprint(f.db),first);
 const second=fingerprint(f.db);
 act(f,'recipe.set',{dish_id:f.dish,ingredient_id:f.ing,qty:200,unit:'公克'});
 assert.notEqual(fingerprint(f.db),second);
 const saved=perform({folder:f.folder,backupDir:f.backupDir,type:'manual'});
 assert.equal(saved.result,'created');
 assert.equal(verifySnapshot(path.join(f.backupDir,saved.name)),fingerprint(f.db));
});
