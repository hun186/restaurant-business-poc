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
test('approved purchase receipt price and valuation are estimated, not accounting costs',t=>{
 const f=fixture(t);
 // PR #1 safety contract: a price must never reopen direct stock.purchase.
 assert.throws(()=>act(f,'stock.purchase',{location_id:f.loc,ingredient_id:f.ing,qty:5,unit_price_twd:'80',price_unit:'公斤',price_date:'2020-01-01'}),{status:409});
 assert.equal(balance(f.db,f.ing,f.loc),0);
 const order=act(f,'order.create',{location_id:f.loc,ingredient_id:f.ing,qty:5,supplier:'測試供應商'}).id;
 act(f,'order.approve',{id:order});
 act(f,'order.receive',{id:order,unit_price_twd:'80',price_unit:'公斤',price_date:'2020-01-01'});
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


// Codex P1 regression: quick_check alone misses missing tables/columns/indexes.
async function brokenV2Fixture(t,brokenSql){
 const f=fixture(t);
 f.db.exec('DROP TABLE dish_ingredients; DROP TABLE menu_dishes; DROP TABLE ingredient_prices; PRAGMA user_version=2;');
 f.db.exec(brokenSql);
 f.db.close();
 const backupDir=path.join(f.folder,'..',path.basename(f.folder)+'-migration-blocked');
 t.after(()=>fs.rmSync(backupDir,{recursive:true,force:true}));
 const old=process.env.BACKUP_DIR;process.env.BACKUP_DIR=backupDir;
 let caught;
 try{assert.throws(()=>openDb(f.folder),e=>{caught=e;return /E_DB: v2 .*?(缺少必要|結構不符合)/.test(e.message);});}
 finally{if(old===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=old;}
 assert.ok(caught?.message.includes('拒絕升級'),caught?.message);
 const reader=new (require('node:sqlite').DatabaseSync)(path.join(f.folder,'restaurant.sqlite'),{readOnly:true});
 try{
  assert.equal(reader.prepare('PRAGMA user_version').get().user_version,2,'failed preflight must not advance version');
  assert.equal(reader.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('ingredient_prices','menu_dishes','dish_ingredients')").get().n,0,'failed preflight must not create v3 objects');
 }finally{reader.close();}
 assert.equal(fs.existsSync(backupDir),false,'no misleading migration snapshot before verifying schema');
}
test('v2 -> v3 refuses missing repairs/stocktakes/evaluations even when quick_check is ok',async t=>{
 for(const table of ['repairs','stocktakes','evaluations'])await t.test('missing '+table,async sub=>{
  await brokenV2Fixture(sub,'DROP TABLE '+table+';');
 });
});
test('v2 -> v3 refuses malformed existing table columns and missing business index',async t=>{
 await t.test('missing description column',async sub=>{
  await brokenV2Fixture(sub,'ALTER TABLE repairs DROP COLUMN description;');
 });
 await t.test('missing indexed stock ledger',async sub=>{
  await brokenV2Fixture(sub,'DROP INDEX stock_moves_stock;');
 });
});
test('v3 opening refuses missing base business table without silently healing it',t=>{
 const f=fixture(t);
 f.db.exec('DROP TABLE repairs;');f.db.close();
 assert.throws(()=>openDb(f.folder),/E_DB: v3 資料庫缺少必要資料表 repairs/);
});


// Codex P1: existing v3 must check full price/recipe schema and indexes.
test('v3 rejects corrupt ingredient_prices column and missing recipe price index',async t=>{
 for(const [label,sql,re] of [
  ['price column missing','ALTER TABLE ingredient_prices DROP COLUMN supplier;',/E_DB: v3 資料庫結構不符合既有 Schema：ingredient_prices/],
  ['recipe index missing','DROP INDEX idx_dish_ingredients_dish;',/E_DB: v3 資料庫缺少必要索引 idx_dish_ingredients_dish/],
  ['price index missing','DROP INDEX idx_ingredient_prices_effective;',/E_DB: v3 資料庫缺少必要索引 idx_ingredient_prices_effective/]
 ])await t.test(label,sub=>{
  const f=fixture(sub);f.db.exec(sql);
  assert.equal(f.db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  f.db.close();assert.throws(()=>openDb(f.folder),re);
  const db=new (require('node:sqlite').DatabaseSync)(path.join(f.folder,'restaurant.sqlite'),{readOnly:true});
  try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);}finally{db.close();}
 });
});
// Codex P2: reject partial migrations *before* creating any upgrade snapshot.
test('v1 rejects stray backup_settings prior to migration snapshot',t=>{
 const f=fixture(t);
 f.db.exec('DROP TABLE dish_ingredients;DROP TABLE menu_dishes;DROP TABLE ingredient_prices;PRAGMA user_version=1;');
 f.db.close();
 const backupDir=path.join(path.dirname(f.folder),path.basename(f.folder)+'-v1-blocked');
 t.after(()=>fs.rmSync(backupDir,{recursive:true,force:true}));
 const previous=process.env.BACKUP_DIR;process.env.BACKUP_DIR=backupDir;
 try{assert.throws(()=>openDb(f.folder),/E_DB: v1 資料庫意外包含新版資料表 backup_settings，拒絕升級/);}
 finally{if(previous===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=previous;}
 assert.equal(fs.existsSync(backupDir),false,'rejected v1 must not publish migration snapshot');
 const db=new (require('node:sqlite').DatabaseSync)(path.join(f.folder,'restaurant.sqlite'),{readOnly:true});
 try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,1);}finally{db.close();}
});
test('v2 rejects stray v3-named price index prior to migration snapshot',t=>{
 const f=fixture(t);
 f.db.exec('DROP TABLE dish_ingredients;DROP TABLE menu_dishes;DROP TABLE ingredient_prices;PRAGMA user_version=2;');
 f.db.exec('CREATE INDEX idx_dish_ingredients_dish ON ingredients(name);');
 f.db.close();
 const backupDir=path.join(path.dirname(f.folder),path.basename(f.folder)+'-v2-index-blocked');
 t.after(()=>fs.rmSync(backupDir,{recursive:true,force:true}));
 const previous=process.env.BACKUP_DIR;process.env.BACKUP_DIR=backupDir;
 try{assert.throws(()=>openDb(f.folder),/E_DB: v2 資料庫意外包含新版索引 idx_dish_ingredients_dish，拒絕升級/);}
 finally{if(previous===undefined)delete process.env.BACKUP_DIR;else process.env.BACKUP_DIR=previous;}
 assert.equal(fs.existsSync(backupDir),false);
});


test('owner can archive and restore a dish without erasing its recipe, prices or inventory',t=>{
 const f=fixture(t);
 const history=act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit_price_twd:'90',price_date:'2026-10-23'});
 const originalRecipe=rows(f.db,f.owner,'dish_ingredients').find(x=>x.dish_id===f.dish);
 const priced=rows(f.db,f.owner,'dish_costs').find(x=>x.dish_id===f.dish);
 assert.ok(priced);assert.equal(priced.estimated_cost_twd,22.5);
 const first=fingerprint(f.db);
 assert.deepEqual(act(f,'dish.active',{id:f.dish,active:0}),{id:f.dish,active:0});
 assert.notEqual(fingerprint(f.db),first);
 assert.equal(rows(f.db,f.owner,'menu_dishes').find(x=>x.id===f.dish).active,0,'archived menu row persists');
 assert.equal(rows(f.db,f.owner,'dish_costs').find(x=>x.dish_id===f.dish),undefined);
 assert.equal(rows(f.db,f.owner,'dish_cost_lines').find(x=>x.dish_id===f.dish),undefined);
 assert.equal(rows(f.db,f.owner,'dish_ingredients').find(x=>x.dish_id===f.dish),undefined);
 assert.equal(f.db.prepare('SELECT count(*) AS n FROM dish_ingredients WHERE dish_id=?').get(f.dish).n,1,'recipe still stored');
 assert.throws(()=>act(f,'dish.price',{dish_id:f.dish,sale_price_twd:'110'}),{status:404});
 assert.throws(()=>act(f,'recipe.set',{dish_id:f.dish,ingredient_id:f.ing,qty:100,unit:'公克'}),{status:404});
 assert.throws(()=>act(f,'recipe.delete',{id:originalRecipe.id}),{status:409});
 assert.equal(rows(f.db,f.owner,'ingredient_prices').find(x=>x.id===history.id).unit_price_twd,90);
 assert.deepEqual(act(f,'dish.active',{id:f.dish,active:1}),{id:f.dish,active:1});
 assert.equal(rows(f.db,f.owner,'dish_ingredients').find(x=>x.id===originalRecipe.id).qty,250);
 assert.equal(rows(f.db,f.owner,'dish_costs').find(x=>x.dish_id===f.dish).estimated_cost_twd,22.5);
 const logs=f.db.prepare("SELECT detail FROM audit_logs WHERE action='dish.active' ORDER BY rowid").all().map(x=>JSON.parse(x.detail));
 assert.equal(logs.length,2);
 assert.deepEqual(logs.map(x=>[x.from,x.to]),[[1,0],[0,1]]);
});
test('deleting exactly one recipe ingredient recomputes costs but retains price, ingredient and audit evidence',t=>{
 const f=fixture(t);
 act(f,'price.record',{location_id:f.loc,ingredient_id:f.ing,unit_price_twd:'80',price_date:'2026-10-23'});
 const extra=act(f,'ingredient.create',{sku:'EXTRA',name:'示範雞蛋',unit:'顆',min_stock:1}).id;
 act(f,'price.record',{location_id:f.loc,ingredient_id:extra,unit_price_twd:'10',price_date:'2026-10-23'});
 act(f,'recipe.set',{dish_id:f.dish,ingredient_id:extra,qty:2,unit:'顆'});
 const before=rows(f.db,f.owner,'dish_costs').find(x=>x.dish_id===f.dish);
 assert.equal(before.estimated_cost_twd,40);
 const rec=rows(f.db,f.owner,'dish_ingredients').find(x=>x.dish_id===f.dish&&x.ingredient_id===f.ing);
 const oldDigest=fingerprint(f.db);
 assert.deepEqual(act(f,'recipe.delete',{id:rec.id}),{id:rec.id,dish_id:f.dish});
 assert.notEqual(fingerprint(f.db),oldDigest);
 assert.equal(rows(f.db,f.owner,'dish_ingredients').some(x=>x.id===rec.id),false);
 assert.equal(rows(f.db,f.owner,'dish_costs').find(x=>x.dish_id===f.dish).estimated_cost_twd,20);
 assert.equal(rows(f.db,f.owner,'ingredient_prices').length,2);
 assert.ok(rows(f.db,f.owner,'ingredients').some(x=>x.id===f.ing));
 assert.throws(()=>act(f,'recipe.delete',{id:rec.id}),{status:404});
 const log=f.db.prepare("SELECT detail,entity,entity_id FROM audit_logs WHERE action='recipe.delete'").get();
 assert.equal(log.entity,'dish_ingredients');assert.equal(log.entity_id,rec.id);
 assert.deepEqual(Object.assign({},JSON.parse(log.detail)),{
  pricing:true,dish_id:f.dish,dish_name:'示範飯',ingredient_id:f.ing,qty:250,unit:'公克'
 });
 assert.equal(rows(f.db,f.owner,'dish_cost_lines').filter(x=>x.dish_id===f.dish).length,1);
 const other=rows(f.db,f.owner,'dish_ingredients').find(x=>x.dish_id===f.dish);
 act(f,'recipe.delete',{id:other.id});
 assert.equal(rows(f.db,f.owner,'dish_costs').find(x=>x.dish_id===f.dish).cost_status,'尚無配方');
 assert.equal(rows(f.db,f.owner,'dish_costs').find(x=>x.dish_id===f.dish).estimated_cost_twd,null);
});
test('archive and recipe removal enforce owner-only role and validate targets atomically',t=>{
 const f=fixture(t);
 const staff=act(f,'user.create',{username:'staffdish',display_name:'一般員工',password:'password-is-long-12',role:'staff',location_id:f.loc}).id;
 const manager=act(f,'user.create',{username:'managerdish',display_name:'主管人員',password:'password-is-long-12',role:'manager',location_id:f.loc}).id;
 const rec=rows(f.db,f.owner,'dish_ingredients').find(x=>x.dish_id===f.dish);
 for(const user of [{id:staff,role:'staff'},{id:manager,role:'manager'}]){
  assert.throws(()=>act(f,'dish.active',{id:f.dish,active:0},user),{status:403});
  assert.throws(()=>act(f,'recipe.delete',{id:rec.id},user),{status:403});
 }
 for(const active of ['0',true,-1,2,null]){
  assert.throws(()=>act(f,'dish.active',{id:f.dish,active}),{status:400});
 }
 assert.throws(()=>act(f,'dish.active',{id:'missing',active:0}),{status:404});
 assert.throws(()=>act(f,'recipe.delete',{id:'missing'}),{status:404});
 assert.throws(()=>act(f,'recipe.delete',{}),{status:400});
 assert.equal(rows(f.db,f.owner,'dish_ingredients').length,1);
 assert.equal(rows(f.db,f.owner,'menu_dishes')[0].active,1);
 const archived=act(f,'dish.active',{id:f.dish,active:0});
 assert.equal(archived.active,0);
 assert.throws(()=>act(f,'dish.active',{id:f.dish,active:0}),{status:409});
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_logs WHERE action='dish.active'").get().n,1);
});
