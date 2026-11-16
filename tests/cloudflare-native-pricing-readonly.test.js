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
 assert.match(native,/NATIVE_PRICING_ENTITIES\.includes\(entity\)\|\|NATIVE_COST_ENTITIES\.includes\(entity\)/);
 assert.match(native,/nativePricingReadonlyPlan\(entity,principal\)/);
 for(const source of [js,html]){
  assert(!source.includes('mock.js'));
  assert(!source.includes('localStorage'));
  assert(!source.includes('sessionStorage'));
 }
});

test('D1 cost, cost line and stock valuation exactly match on-prem pricingRows across two stores',async t=>{
 const f=await fixture(t);
 const owner=await f.login('owner');
 const manager=await f.login('manager');
 const managerNoStore=await f.login('managerNoStore');
 const staff=await f.login('staff');
 const {pricingRows}=require('../src/pricing.js');
 const {presentNativeRows}=await display;
 const {nativeOwnerReportSheet}=await report;
 const {NATIVE_COST_ENTITIES,nativeCostReadonlyRows}=await import('../cloudflare/native-pricing-costs.mjs');
 assert.deepEqual([...NATIVE_COST_ENTITIES],['dish_costs','dish_cost_lines','inventory_values']);
 const db=f.db;
 db.prepare("INSERT INTO ingredients(id,sku,name,unit) VALUES('milk','MILK','牛奶','L')").run();
 db.prepare("INSERT INTO menu_dishes(id,name,sale_price_cents) VALUES('dishB','牛奶餐',10000)").run();
 db.prepare("INSERT INTO menu_dishes(id,name,sale_price_cents) VALUES('dishC','無配方餐',0)").run();
 db.prepare("INSERT INTO dish_ingredients(id,dish_id,ingredient_id,qty,unit) VALUES('recB','dishB','milk',150,'ml')").run();
 db.prepare("INSERT INTO dish_ingredients(id,dish_id,ingredient_id,qty,unit) VALUES('recC','dishB','ing',1,'kg')").run();
 // Same effective date + created_at: newest rowid decides, matching SQLite latest().
 for(const [id,price] of [['milk1',5000],['milk2',6250]]){
  db.prepare("INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,created_at) VALUES(?,?,?,?,?,?,?,?,'2026-11-01 10:00:00')")
   .run(id,'milk','storeA','2026-11-01',price,'L','合成供應商','manual');
 }
 db.prepare("INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source) VALUES('future','milk','storeA','2099-01-01',999999,'L','合成供應商','manual')").run();
 for(const [id,loc,qty,type] of [
  ['mv1','storeA',1.234,'purchase'],['mv2','storeA',-0.234,'usage'],
  ['mv3','storeB',-0.5,'usage']
 ])db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)')
  .run(id,'ing',loc,qty,type);
 const before=db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
 for(const entity of NATIVE_COST_ENTITIES){
  const keys=presentNativeRows(entity,[]).columns.map(x=>x.key);
  for(const [name,cookie,principal] of [
   ['owner',owner,{id:'owner-id',role:'owner'}],
   ['manager',manager,{id:'manager-1',role:'manager'}]
  ]){
   const response=await f.send('/api/data?entity='+entity,{headers:{cookie}});
   assert.equal(response.status,200,entity+'/'+name);
   assert.equal(response.headers.get('cache-control'),'private, no-store, max-age=0');
   const actual=(await response.json()).rows;
   const baseline=pricingRows(db,principal,entity).map(row=>
    Object.fromEntries(keys.map(k=>[k,row[k]])));
   assert.deepEqual(actual,baseline,entity+'/'+name+' must equal SQLite');
   assert(!JSON.stringify(actual).includes('owner-id'));
   assert(!JSON.stringify(actual).includes('manager-1'));
   assert(!JSON.stringify(actual).includes('password_hash'));
   assert(actual.length>0);
   const sheet=nativeOwnerReportSheet(entity,actual,{name:entity});
   assert(sheet.rows.length===actual.length);
   for(const cell of sheet.rows.flat())assert(cell===null||typeof cell!=='object');
   const ui=presentNativeRows(entity,actual);
   assert(ui.entries.every(x=>x.cells.length===keys.length));
  }
  const empty=await f.send('/api/data?entity='+entity,{headers:{cookie:managerNoStore}});
  assert.equal(empty.status,200,entity+'/no store');
  assert.deepEqual((await empty.json()).rows,[]);
  const denied=await f.send('/api/data?entity='+entity,{headers:{cookie:staff}});
  assert.equal(denied.status,403,entity+'/staff');
  assert.equal((await f.send('/api/data?entity='+entity)).status,401);
  assert.equal((await f.send('/api/data?entity='+entity,{method:'POST',
   headers:{cookie:owner},body:'{}'})).status,405);
 }
 assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,before);
 const cost=await f.send('/api/data?entity=dish_costs',{headers:{cookie:owner}});
 const rows=(await cost.json()).rows;
 assert(rows.some(x=>x.cost_status==='尚無配方'));
 assert(rows.some(x=>x.cost_status==='價格或單位不完整'));
 assert(rows.some(x=>x.gross_profit_twd<0));
 const negative=rows.find(x=>x.gross_profit_twd<0);
 const cell=presentNativeRows('dish_costs',[negative]).entries[0].cells;
 assert(cell.some(x=>x.text.startsWith('-')&&x.tone==='warn'),'negative margin visible');
 const lines=(await (await f.send('/api/data?entity=dish_cost_lines',{headers:{cookie:manager}})).json()).rows;
 assert(lines.some(x=>x.ingredient_name==='牛奶'&&x.unit==='ml'&&x.price_unit==='L'&&x.line_cost_twd===9.38),
  '0.15L * 6250 cents rounds to 938 cents, future prices ignored');
 const stock=(await (await f.send('/api/data?entity=inventory_values',{headers:{cookie:owner}})).json()).rows;
 assert(stock.some(x=>x.location_name==='B門市'&&x.ingredient_name==='米'&&x.estimated_value_twd<0));
 const stockUI=presentNativeRows('inventory_values',stock);
 assert(stockUI.entries.some(x=>x.cells.some(c=>c.text.startsWith('-')&&c.tone==='warn')));
 db.prepare("UPDATE locations SET active=0 WHERE id='storeA'").run();
 for(const entity of NATIVE_COST_ENTITIES){
  const x=await f.send('/api/data?entity='+entity,{headers:{cookie:manager}});
  assert.equal(x.status,200,entity+'/revoked manager');
  assert.deepEqual((await x.json()).rows,[],'inactive store must revoke all cost rows');
 }
 await assert.rejects(nativeCostReadonlyRows(f.env.DB,{id:'owner-id',role:'owner'},'dish_costs','2026-02-30'));
 await assert.rejects(nativeCostReadonlyRows(f.env.DB,{id:'staff-id',role:'staff'},'dish_costs','2026-11-16'));
});
test('cost view capacity uses fail-closed 503 instead of silently truncated or misleading totals',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 for(let i=0;i<500;i++)f.db.prepare(
  'INSERT INTO menu_dishes(id,name,sale_price_cents) VALUES(?,?,?)')
  .run('batch'+i,'批次'+String(i).padStart(4,'0'),1);
 const res=await f.send('/api/data?entity=dish_costs',{headers:{cookie:owner}});
 assert.equal(res.status,503);
 assert.equal((await res.json()).code,'E_BUSINESS_UNAVAILABLE');
});
test('shared unit conversion never changes SQLite weights, volumes or half-cent rounding',()=>{
 const {conversion,roundedCents}=require('../cloudflare/pricing-units.cjs');
 const local=fs.readFileSync(path.join(base,'src/pricing.js'),'utf8');
 const cloud=fs.readFileSync(path.join(base,'cloudflare/native-pricing-costs.mjs'),'utf8');
 for(const [qty,from,to,expected] of [
  [150,'ml','L',0.15],[1.5,'公斤','g',1500],[50,'克','kg',0.05],
  [3,'升','mL',3000],[1,'kg','L',null],[1,'毫升','公升',0.001]
 ])assert.equal(conversion(qty,from,to),expected);
 assert.equal(roundedCents(0.15,6250),938);
 assert.equal(roundedCents(1,999),999);
 assert.match(local,/require\('\.\.\/cloudflare\/pricing-units\.cjs'\)/);
 assert.match(cloud,/import pricingUnits from '\.\/pricing-units\.cjs'/);
 assert(!cloud.includes('INSERT INTO'));
 assert(!cloud.includes('UPDATE '));
 assert(!cloud.includes('DELETE FROM'));
 const preview=fs.readFileSync(path.join(base,'cloudflare/operations-readonly.mjs'),'utf8');
 assert(!preview.includes('nativeCostReadonlyRows'));
 const html=fs.readFileSync(path.join(base,'vercel-demo/owner-app.html'),'utf8');
 const js=fs.readFileSync(path.join(base,'vercel-demo/owner-app.js'),'utf8');
 for(const entity of ['dish_costs','dish_cost_lines','inventory_values']){
  assert(html.includes('data-view="'+entity+'" hidden'));
  assert(js.includes(entity));
 }
 assert(js.includes("button.hidden=!['owner','manager'].includes(role)"));
 assert(!js.includes('mock.js'));
});

test('configured business timezone selects same historical effective price across UTC/Taipei midnight',async t=>{
 const f=await fixture(t);
 const {costs}=require('../src/pricing.js');
 const {nativeBusinessDate,nativeCostReadonlyRows}=await import('../cloudflare/native-pricing-costs.mjs');
 const now=new Date('2026-11-15T20:00:00.000Z');
 const owner={id:'owner-id',role:'owner'};
 f.db.prepare("UPDATE dish_ingredients SET qty=1 WHERE id='recipe'").run();
 for(const [id,date,cents] of [
  ['tz1511','2026-11-15',100],['tz1611','2026-11-16',200]
 ])f.db.prepare('INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source) VALUES(?,?,?,?,?,?,?,?)')
  .run(id,'ing','storeA',date,cents,'kg','合成商','manual');
 const cases=[['UTC','2026-11-15',1],['Asia/Taipei','2026-11-16',2]];
 for(const [zone,expectedDate,expectedCost] of cases){
  const asOf=nativeBusinessDate({BUSINESS_TIME_ZONE:zone},now);
  assert.equal(asOf,expectedDate);
  const local=costs(f.db,owner,asOf).entries;
  const remote=await nativeCostReadonlyRows(f.env.DB,owner,'dish_costs',asOf);
  const a=local.find(x=>x.dish_name==='便當'&&x.location_name==='A門市');
  const b=remote.find(x=>x.dish_name==='便當'&&x.location_name==='A門市');
  assert.equal(a.estimated_cost_twd,expectedCost,zone+' baseline');
  assert.equal(b.estimated_cost_twd,a.estimated_cost_twd,zone+' cloud parity');
  assert.equal(b.gross_margin_pct,a.gross_margin_pct,zone+' margin parity');
 }
 assert.equal(nativeBusinessDate({},now),'2026-11-16','default is Taiwan');
 assert.throws(()=>nativeBusinessDate({BUSINESS_TIME_ZONE:'Invalid/Zone'},now),/E_COST_TIME_ZONE/);
 assert.throws(()=>nativeBusinessDate({BUSINESS_TIME_ZONE:123},now),/E_COST_TIME_ZONE/);
 const backend=fs.readFileSync(path.join(base,'cloudflare/native-business-http.mjs'),'utf8');
 assert(backend.includes('nativeCostReadonlyRows(env.DB,principal,entity,nativeBusinessDate(env))'),
  'actual Worker HTTP must use the runtime business timezone');
 const local=fs.readFileSync(path.join(base,'src/pricing.js'),'utf8');
 assert(local.includes("process.env.BUSINESS_TIME_ZONE||'Asia/Taipei'"));
});

test('Native D1 historical cost as_of matches SQLite and rejects future/malformed/stock override',async t=>{
 const f=await fixture(t);
 const owner=await f.login('owner'),manager=await f.login('manager'),staff=await f.login('staff');
 const {pricingRows}=require('../src/pricing.js');
 const {nativeRequestedCostDate}=await import('../cloudflare/native-pricing-costs.mjs');
 f.db.prepare("INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source) VALUES('oldA','ing','storeA','2026-10-01',2300,'kg','合成供應商','manual')").run();
 const initial=f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
 for(const entity of ['dish_costs','dish_cost_lines']){
  for(const asOf of ['2026-10-01','2026-11-01']){
   const response=await f.send('/api/data?entity='+entity+'&as_of='+asOf,
     {headers:{cookie:manager}});
   assert.equal(response.status,200,entity+' '+asOf);
   const data=await response.json();
   assert.equal(data.as_of,asOf);
   assert.match(data.business_date,/^\d{4}-\d{2}-\d{2}$/);
   const columns=(await display).presentNativeRows(entity,[]).columns.map(c=>c.key);
   assert.deepEqual(data.rows,pricingRows(f.db,{id:'manager-1',role:'manager'},entity,asOf)
     .map(row=>Object.fromEntries(columns.map(key=>[key,row[key]]))),entity+' '+asOf);
   assert(data.rows.every(x=>x.location_name==='A門市'));
  }
  for(const q of [
   '?entity='+entity+'&as_of=2026-02-30',
   '?entity='+entity+'&as_of=2099-12-31',
   '?entity='+entity+'&as_of=',
   '?entity='+entity+'&as_of=2026-11-01&as_of=2026-10-01',
   '?entity='+entity+'&as_of=2026-10-01&wrong=1'
  ]){
   const response=await f.send('/api/data'+q,{headers:{cookie:owner}});
   assert.equal(response.status,400,q);
  }
  const forbidden=await f.send('/api/data?entity='+entity+'&as_of=2026-10-01',
    {headers:{cookie:staff}});
  assert.equal(forbidden.status,403);
  assert.equal((await f.send('/api/data?entity='+entity+'&as_of=2026-10-01')).status,401);
 }
 const noHistory=await f.send('/api/data?entity=inventory_values&as_of=2026-10-01',
   {headers:{cookie:owner}});
 assert.equal(noHistory.status,400,'current stock can never be presented as an older stock snapshot');
 const current=await f.send('/api/data?entity=inventory_values',{headers:{cookie:owner}});
 assert.equal(current.status,200);
 const status=await current.json();
 assert.equal(status.as_of,status.business_date);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,initial);
 assert.equal(nativeRequestedCostDate(null,'2026-11-16'),'2026-11-16');
 assert.equal(nativeRequestedCostDate('2026-11-15','2026-11-16'),'2026-11-15');
 assert.throws(()=>nativeRequestedCostDate('2026-11-17','2026-11-16'),/E_COST_FUTURE_DATE/);
 assert.throws(()=>nativeRequestedCostDate('2026-02-30','2026-11-16'),/E_COST_DATE/);
});

test('Native cost date UI is session-epoch guarded and cannot revalue current stock historically',()=>{
 const vm=require('node:vm');
 const source=fs.readFileSync(path.join(base,'vercel-demo/owner-app.js'),'utf8');
 const a=source.indexOf('function render(data){'),b=source.indexOf('\nconst taskId=',a);
 assert(a>=0&&b>a,'real Native cost UI function must be callable');
 class Node{
  constructor(tag,text=''){this.tag=tag;this.textContent=text;this.children=[];this.events={};
    this.value='';this.className='';}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(name,listener){this.events[name]=listener;}
 }
 const pane=new Node('div');
 const context=vm.createContext({
  $:id=>{assert.equal(id,'content');return pane;},
  view:'dish_costs',revision:10,authEpoch:2,csrf:'tokenA',costAsOf:'',
  HISTORICAL_COST_VIEWS:new Set(['dish_costs','dish_cost_lines']),
  COST_VIEWS:new Set(['dish_costs','dish_cost_lines','inventory_values']),
  el:(tag,label)=>new Node(tag,label===undefined?'':String(label)),
  labeledField:(label,input)=>{const n=new Node('label',label);n.append(input);return n;},
  liveAuth:(epoch,token)=>epoch===context.authEpoch&&token===context.csrf,
  refresh:()=>{context.refreshed=(context.refreshed||0)+1;},
  table:()=>new Node('table'),metrics:{},
 });
 vm.runInContext(source.slice(a,b)+'\nthis.mount=render;',context);
 const find=(n,tag)=>{
  if(n.tag===tag)return n;
  for(const child of n.children){const x=find(child,tag);if(x)return x;}
  return null;
 };
 const response={mode:'native_d1',entity:'dish_costs',rows:[],
  as_of:'2026-11-16',business_date:'2026-11-16'};
 context.mount(response);
 const form=find(pane,'form'),date=find(form,'input');
 assert(form&&date);
 assert.equal(date.type,'date');assert.equal(date.max,'2026-11-16');
 date.value='2026-10-01';form.events.submit({preventDefault(){}});
 assert.equal(context.costAsOf,'2026-10-01');assert.equal(context.refreshed,1);
 context.revision=11;date.value='2026-09-01';
 form.events.submit({preventDefault(){}});
 assert.equal(context.costAsOf,'2026-10-01','old view cannot change current cost date');
 context.view='inventory_values';
 context.mount({...response,entity:'inventory_values'});
 assert.equal(find(pane,'form'),null,'today stock cannot offer historical date picker');
 assert(pane.children.some(n=>n.children.some(c=>c.textContent.includes('不是歷史庫存快照'))));
 context.view='dish_cost_lines';context.revision=12;context.csrf='tokenB';
 context.mount({...response,entity:'dish_cost_lines'});
 const nextForm=find(pane,'form'),nextDate=find(nextForm,'input');
 nextDate.value='2026-08-01';
 context.authEpoch=3;nextForm.events.submit({preventDefault(){}});
 assert.equal(context.costAsOf,'2026-10-01','revoked session cannot change cost date');
 assert.equal(context.refreshed,1);
 assert.match(source,/HISTORICAL_COST_VIEWS\.has\(view\)&&costAsOf/);
 assert.match(source,/if\(view!==b\.dataset\.view\)costAsOf=''/);
});
