'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const base=path.resolve(__dirname,'..'),site='https://restaurant.example.workers.dev';
const core=import('../cloudflare/auth-core.mjs'),
 worker=import('../cloudflare/worker.mjs'),
 pricing=import('../cloudflare/native-pricing-readonly.mjs'),
 display=import('../vercel-demo/native-owner-display.mjs'),
 report=import('../vercel-demo/native-owner-report.mjs');
function adapter(db){
 const stmt=(sql,args=[])=>({
  first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
  async batch(xs){db.exec('BEGIN IMMEDIATE');try{
   const ret=[];for(const x of xs)ret.push(await x.run());
   db.exec('COMMIT');return ret;
  }catch(err){db.exec('ROLLBACK');throw err;}}};
}
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(base,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 const {hashWorkerPassword}=await core;
 const pwd='test-manager-scoped-prices-password-123',hash=await hashWorkerPassword(pwd);
 for(const [id,username,role] of [
  ['owner-id','owner','owner'],['manager-1','manager','manager'],
  ['manager-2','managerNoStore','manager'],['staff-id','staff','staff']
 ])db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
  .run(id,username,'測試 '+username,role,hash.password_salt,hash.password_hash);
 for(const [id,name] of [['storeA','A門市'],['storeB','B門市']])
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare("INSERT INTO user_locations(user_id,location_id) VALUES('manager-1','storeA')").run();
 db.prepare("INSERT INTO user_locations(user_id,location_id) VALUES('staff-id','storeB')").run();
 db.prepare("INSERT INTO ingredients(id,sku,name,unit) VALUES('ing','ING','米','kg')").run();
 for(const [suffix,store] of [['A','storeA'],['B','storeB']]){
  db.prepare("INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source) VALUES(?,?,?,?,?,?,?,?)")
    .run('price'+suffix,'ing',store,'2026-11-01',suffix==='A'?12345:56789,'kg','合成廠商','manual');
 }
 db.prepare("INSERT INTO menu_dishes(id,name,sale_price_cents) VALUES('dish','便當',12500)").run();
 db.prepare("INSERT INTO dish_ingredients(id,dish_id,ingredient_id,qty,unit) VALUES('recipe','dish','ing',0.125,'kg')").run();
 const env={DB:adapter(db),CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  NATIVE_AUTH_SOURCE_PEPPER:'test-price-pepper-32-characters-at-least-aaa',
  ASSETS:{fetch:async()=>new Response('STATIC')}};
 const app=(await worker).default;
 const send=(route,init={},e=env)=>{
  const request=new Request(site+route,init);
  Object.defineProperty(request,'cf',{value:{colo:'TPE'}});
  return app.fetch(request,e);
 };
 const login=async name=>{
  const response=await send('/api/login',{method:'POST',headers:{
   origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
   'CF-Connecting-IP':'198.51.100.56'
  },body:JSON.stringify({username:name,password:pwd})});
  assert.equal(response.status,200,'login '+name);
  return response.headers.get('set-cookie').split(';')[0];
 };
 return {db,send,login,env};
}
test('real Native D1 prices/menus/recipes are Owner/Manager-only with active-store financial scope',async t=>{
 const f=await fixture(t);
 const cookies={};
 for(const name of ['owner','manager','managerNoStore','staff'])cookies[name]=await f.login(name);
 const before=f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
 const entities=['ingredient_prices','menu_dishes','dish_ingredients'];
 for(const entity of entities){
  let res=await f.send('/api/data?entity='+entity,{headers:{cookie:cookies.owner}});
  assert.equal(res.status,200,entity+'/owner');
  assert.equal(res.headers.get('cache-control'),'private, no-store, max-age=0');
  const owner=await res.json();
  assert.equal(owner.mode,'native_d1');assert.equal(owner.entity,entity);
  assert.equal(owner.rows.length,entity==='ingredient_prices'?2:1);
  assert(!JSON.stringify(owner).includes('manager-1'));
  assert(!JSON.stringify(owner).includes('priceB'));
  assert(!JSON.stringify(owner).includes('recipe'));
  res=await f.send('/api/data?entity='+entity,{headers:{cookie:cookies.manager}});
  assert.equal(res.status,200,entity+'/manager');
  const manager=await res.json();
  assert.equal(manager.rows.length,1,entity+' manager within granted store');
  if(entity==='ingredient_prices'){
   assert.equal(manager.rows[0].location_name,'A門市');
   assert.equal(manager.rows[0].unit_price_twd,123.45);
   assert(!JSON.stringify(manager).includes('B門市'));
  }
  if(entity==='menu_dishes')assert.equal(manager.rows[0].sale_price_twd,125);
  if(entity==='dish_ingredients')assert.equal(manager.rows[0].qty,0.125);
  const noGrant=await f.send('/api/data?entity='+entity,
    {headers:{cookie:cookies.managerNoStore}});
  assert.equal(noGrant.status,200);
  assert.equal((await noGrant.json()).rows.length,0,entity+' must not leak to manager without grant');
  const staff=await f.send('/api/data?entity='+entity,{headers:{cookie:cookies.staff}});
  assert.equal(staff.status,403,entity+' staff cannot read financials');
  assert.equal((await f.send('/api/data?entity='+entity)).status,401);
 }
 assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n,before,
  'read-only queries must not append audit/business writes');
 f.db.prepare("UPDATE locations SET active=0 WHERE id='storeA'").run();
 const removed=await f.send('/api/data?entity=menu_dishes',{headers:{cookie:cookies.manager}});
 assert.equal(removed.status,200);assert.equal((await removed.json()).rows.length,0,
  'deactivated store must revoke global menu/price visibility');
 const prices=await f.send('/api/data?entity=ingredient_prices',{headers:{cookie:cookies.manager}});
 assert.equal((await prices.json()).rows.length,0);
});
test('Native D1 pricing plans and no Preview allowlist expansion',async()=>{
 const {NATIVE_PRICING_ENTITIES,nativePricingReadonlyPlan}=await pricing;
 assert.deepEqual([...NATIVE_PRICING_ENTITIES],['ingredient_prices','menu_dishes','dish_ingredients']);
 for(const entity of NATIVE_PRICING_ENTITIES){
  const owner=nativePricingReadonlyPlan(entity,{id:'O',role:'owner'});
  const manager=nativePricingReadonlyPlan(entity,{id:'M',role:'manager'});
  assert.deepEqual(owner.params,[]);
  assert.deepEqual(manager.params,['M']);
  assert.match(manager.sql,/WHERE | AND /);
  assert.match(manager.sql,/active=1|l2\.active=1/);
  assert.match(manager.sql,/LIMIT 500$/);
  assert.match(owner.sql,/LIMIT 500$/);
  assert(!manager.sql.includes("user_id='M'"),'must use bound parameters');
  assert(Object.isFrozen(owner)&&Object.isFrozen(manager));
 }
 assert.equal(nativePricingReadonlyPlan('menu_dishes',{id:'s',role:'staff'}),null);
 assert.equal(nativePricingReadonlyPlan('__proto__',{id:'o',role:'owner'}),null);
 const preview=fs.readFileSync(path.join(base,'cloudflare/operations-readonly.mjs'),'utf8');
 assert(!preview.includes('nativePricingReadonlyPlan'));
});
test('Native pricing UI and XLSX use allowlisted values, not hidden identifiers or secrets',async()=>{
 const {presentNativeRows}=await display;
 const {nativeOwnerReportSheet}=await report;
 const examples={
  ingredient_prices:[{location_name:'A門市',ingredient_name:'米',price_date:'2026-11-01',
    unit_price_twd:123.45,unit:'kg',supplier:'合成供應商',source:'manual',
    token_hash:'HIDDEN_TOKEN',id:'HIDDEN_UUID'}],
  menu_dishes:[{name:'便當',sale_price_twd:125,active:1,ingredient_count:1,
    password_hash:'HIDDEN_PASSWORD'}],
  dish_ingredients:[{dish_name:'便當',ingredient_name:'米',qty:0.125,unit:'kg',
    credential:'HIDDEN_CREDENTIAL'}]
 };
 for(const [entity,rows] of Object.entries(examples)){
  const view=presentNativeRows(entity,rows);
  assert(view.entries.length===1&&view.columns.length>=4);
  for(const key of ['HIDDEN_TOKEN','HIDDEN_UUID','HIDDEN_PASSWORD','HIDDEN_CREDENTIAL'])
   assert(!JSON.stringify(view).includes(key),entity);
  const sheet=nativeOwnerReportSheet(entity,rows,{name:entity});
  assert(sheet.rows.length===1);
  for(const key of ['HIDDEN_TOKEN','HIDDEN_UUID','HIDDEN_PASSWORD','HIDDEN_CREDENTIAL'])
   assert(!JSON.stringify(sheet).includes(key),entity+' sheet');
 }
 assert.equal(nativeOwnerReportSheet('ingredient_prices',examples.ingredient_prices,
  {name:'食材歷史價格'}).rows[0][3],123.45,'TWD prices remain numeric');
 assert.equal(nativeOwnerReportSheet('menu_dishes',examples.menu_dishes,
  {name:'菜品與售價'}).rows[0][1],125,'sale price remains numeric');
 assert.equal(presentNativeRows('ingredient_prices',examples.ingredient_prices).entries[0].cells.at(-1).text,'手動登錄');
});
test('Native menu/price UI is explicit readonly, hidden from staff, and never routes Preview',()=>{
 const html=fs.readFileSync(path.join(base,'vercel-demo/owner-app.html'),'utf8'),
  js=fs.readFileSync(path.join(base,'vercel-demo/owner-app.js'),'utf8'),
  native=fs.readFileSync(path.join(base,'cloudflare/native-business-http.mjs'),'utf8');
 for(const entity of ['ingredient_prices','menu_dishes','dish_ingredients']){
  assert(html.includes('data-view="'+entity+'" hidden'));
  assert(js.includes(entity));
 }
 assert(js.includes("button.hidden=!['owner','manager'].includes(role)"));
 assert(js.includes("role==='staff'&&pricingViews.includes(view)"));
 assert.match(native,/NATIVE_PRICING_ENTITIES\.includes\(entity\)&&!hasAccess\(principal,'manager'\)/);
 assert.match(native,/nativePricingReadonlyPlan\(entity,principal\)/);
 for(const source of [js,html]){
  assert(!source.includes('mock.js'));
  assert(!source.includes('localStorage'));
  assert(!source.includes('sessionStorage'));
 }
});
