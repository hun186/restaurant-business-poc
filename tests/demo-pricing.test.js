'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'../vercel-demo');
function demo(existing){
 const store=new Map(existing?[['restaurant-public-demo-v1',JSON.stringify(existing)]]:[]);
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const loc={href:'https://restaurant-business-poc.vercel.app/',reload:()=>{}};
 const window={fetch:async()=>{throw Error('Unexpected network call')},confirm:()=>true};
 const context=vm.createContext({window,sessionStorage:storage,location:loc,URL,Response,Date,console});
 for(const name of ['pricing-demo.js','backup-demo.js','mock.js'])vm.runInContext(fs.readFileSync(path.join(dir,name),'utf8'),context,{filename:name});
 const request=async (path,action,data)=>{
  const res=await window.fetch(path,{method:'POST',body:JSON.stringify({action,data})});
  return {status:res.status,body:await res.json()};
 };
 const rows=async name=>(await (await window.fetch('/api/data?entity='+encodeURIComponent(name))).json()).rows;
 const state=()=>JSON.parse(storage.getItem('restaurant-public-demo-v1')||'null');
 return {window,storage,request,rows,state,pricing:window.RestaurantDemoPricing};
}
test('demo has initial historical price, recipe, estimated per-store margins and missing-price warnings',async()=>{
 const d=demo();
 const items=await d.rows('dish_costs');
 const salad=items.find(x=>x.dish_id==='dish1'&&x.location_id==='l1');
 assert.equal(salad.estimated_cost_twd,50.6);
 assert.equal(salad.gross_profit_twd,148.4);
 assert.equal(salad.cost_status,'估算完成');
 const second=items.find(x=>x.dish_id==='dish1'&&x.location_id==='l2');
 assert.equal(second.estimated_cost_twd,null);
 assert.equal(second.gross_profit_twd,null);
 assert.equal(second.cost_status,'價格或單位不完整');
 assert.ok((await d.rows('dish_cost_lines')).some(x=>x.cost_status==='缺少有效食材單價'));
 assert.equal((await d.rows('ingredient_prices')).find(x=>x.ingredient_id==='i1'&&x.location_id==='l1').unit_price_twd,95);
});
test('new price changes costs, while a future-dated price is not effective yet',async()=>{
 const d=demo();
 let r=await d.request('/api/command','price.record',{location_id:'l1',ingredient_id:'i1',unit_price_twd:'120.00',unit:'公斤',price_date:'2026-10-23'});
 assert.equal(r.status,200);
 let row=(await d.rows('dish_costs')).find(x=>x.dish_id==='dish1'&&x.location_id==='l1');
 assert.equal(row.estimated_cost_twd,53.1);
 r=await d.request('/api/command','price.record',{location_id:'l1',ingredient_id:'i1',unit_price_twd:'999',unit:'公斤',price_date:'2099-01-01'});
 assert.equal(r.status,200);
 row=(await d.rows('dish_costs')).find(x=>x.dish_id==='dish1'&&x.location_id==='l1');
 assert.equal(row.estimated_cost_twd,53.1);
 for(const invalid of [{unit_price_twd:'-1',unit:'公斤'}, {unit_price_twd:'3.456',unit:'公斤'}, {unit_price_twd:'99',unit:'顆'}]){
  const before=(await d.rows('ingredient_prices')).length;
  const response=await d.request('/api/command','price.record',{location_id:'l1',ingredient_id:'i1',price_date:'2026-10-23',...invalid});
  assert.equal(response.status,400);
  assert.equal((await d.rows('ingredient_prices')).length,before);
 }
});
test('dish create, sale price editing and recipe setting are interactive and validated',async()=>{
 const d=demo();
 let result=await d.request('/api/command','dish.create',{name:'示範番茄湯',sale_price_twd:'80'});
 assert.equal(result.status,200);
 const id=result.body.result.id;
 let cost=(await d.rows('dish_costs')).find(x=>x.dish_id===id&&x.location_id==='l1');
 assert.equal(cost.cost_status,'尚無配方');assert.equal(cost.estimated_cost_twd,null);
 result=await d.request('/api/command','recipe.set',{dish_id:id,ingredient_id:'i1',qty:200,unit:'公克'});
 assert.equal(result.status,200);
 cost=(await d.rows('dish_costs')).find(x=>x.dish_id===id&&x.location_id==='l1');
 assert.equal(cost.estimated_cost_twd,19);
 result=await d.request('/api/command','dish.price',{dish_id:id,sale_price_twd:'100.50'});
 assert.equal(result.status,200);
 cost=(await d.rows('dish_costs')).find(x=>x.dish_id===id&&x.location_id==='l1');
 assert.equal(cost.gross_profit_twd,81.5);
 await d.request('/api/command','recipe.set',{dish_id:id,ingredient_id:'i1',qty:100,unit:'公克'});
 assert.equal((await d.rows('dish_ingredients')).filter(x=>x.dish_id===id).length,1);
 result=await d.request('/api/command','recipe.set',{dish_id:id,ingredient_id:'i1',qty:1,unit:'顆'});
 assert.equal(result.status,400);
});
test('approved order receipt can add purchase price; invalid price and repeated receipts never alter stock',async()=>{
 const d=demo();
 assert.equal((await d.request('/api/command','stock.purchase',{location_id:'l1',ingredient_id:'i1',qty:50})).status,400);
 assert.equal((await d.request('/api/command','order.receive',{id:'o1',unit_price_twd:'135'})).status,400);
 assert.equal((await d.request('/api/command','order.approve',{id:'o1'})).status,200);
 const stock=()=>(d.state().stock.find(x=>x.location_id==='l1'&&x.ingredient_id==='i1')).on_hand;
 const before=stock(),oldPrices=(await d.rows('ingredient_prices')).length;
 assert.equal((await d.request('/api/command','order.receive',{id:'o1',unit_price_twd:'bad'})).status,400);
 assert.equal(stock(),before);
 assert.equal((await d.rows('ingredient_prices')).length,oldPrices);
 assert.equal((await d.request('/api/command','order.receive',{id:'o1',unit_price_twd:'135',unit:'公斤'})).status,200);
 assert.equal(stock(),before+18);
 assert.equal((await d.rows('ingredient_prices')).length,oldPrices+1);
 assert.ok((await d.rows('ingredient_prices')).some(x=>x.source==='purchase'&&x.unit_price_twd===135));
 assert.equal((await d.request('/api/command','order.receive',{id:'o1',unit_price_twd:'99'})).status,400);
 assert.equal(stock(),before+18);
});
test('one-time opening balance for a fresh ingredient cannot be repeated',async()=>{
 const d=demo();
 const ing=await d.request('/api/command','ingredient.create',{sku:'TEST-888',name:'展示新品',unit:'公斤',min_stock:2});
 assert.equal(ing.status,200);
 const payload={location_id:'l1',ingredient_id:ing.body.result.id,qty:3,note:'初始化'};
 assert.equal((await d.request('/api/command','stock.opening',payload)).status,200);
 assert.equal((await d.request('/api/command','stock.opening',payload)).status,400);
 assert.equal((await d.rows('stock')).find(x=>x.ingredient_id===payload.ingredient_id).on_hand,3);
});
test('older sessionStorage state migrates without wiping existing tasks',async()=>{
 const base=demo().state()||null;
 const d=demo();
 await d.request('/api/command','task.create',{title:'保留工作',location_id:'l1'});
 const saved=d.state();
 delete saved.ingredient_prices;delete saved.menu_dishes;delete saved.dish_ingredients;
 const migrated=demo(saved);
 assert.ok((await migrated.rows('tasks')).some(x=>x.title==='保留工作'));
 assert.ok((await migrated.rows('menu_dishes')).length>0);
 migrated.window.restaurantDemoReset();
 assert.equal(migrated.storage.getItem('restaurant-public-demo-v1'),null);
});
test('demo UI exposes pricing navigation/actions but never loads live SQLite code',()=>{
 const html=fs.readFileSync(path.join(dir,'index.html'),'utf8'),ui=fs.readFileSync(path.join(dir,'app.js'),'utf8');
 for(const page of ['ingredient_prices','inventory_values','menu_dishes','dish_ingredients','dish_costs','dish_cost_lines'])assert.ok(html.includes('data-page="'+page+'"'),page);
 assert.ok(html.indexOf('pricing-demo.js')<html.indexOf('mock.js'));
 for(const action of ['price.record','dish.create','dish.price','recipe.set'])assert.ok(ui.includes(action));
 assert.equal(ui.includes("'stock.purchase':"),false);
 assert.ok(!html.includes('backup-ui.js'));
});


test('demo archive hides cost and recipe but preserves dish to restore later',async()=>{
 const d=demo(),dish='dish1';
 const before=(await d.rows('dish_ingredients')).filter(x=>x.dish_id===dish);
 assert.ok(before.length>=2);
 const cost=(await d.rows('dish_costs')).find(x=>x.dish_id===dish&&x.location_id==='l1');
 assert.ok(cost);
 let res=await d.request('/api/command','dish.active',{id:dish,active:0});
 assert.equal(res.status,200);
 assert.equal((await d.rows('menu_dishes')).find(x=>x.id===dish).active,0);
 assert.equal((await d.rows('dish_costs')).some(x=>x.dish_id===dish),false);
 assert.equal((await d.rows('dish_ingredients')).some(x=>x.dish_id===dish),false);
 assert.equal(d.state().dish_ingredients.filter(x=>x.dish_id===dish).length,before.length);
 assert.equal((await d.request('/api/command','dish.price',{dish_id:dish,sale_price_twd:'1'})).status,400);
 assert.equal((await d.request('/api/command','recipe.delete',{id:before[0].id})).status,400);
 res=await d.request('/api/command','dish.active',{id:dish,active:1});
 assert.equal(res.status,200);
 assert.equal((await d.rows('dish_ingredients')).filter(x=>x.dish_id===dish).length,before.length);
 assert.equal((await d.rows('dish_costs')).find(x=>x.dish_id===dish&&x.location_id==='l1').estimated_cost_twd,cost.estimated_cost_twd);
 const persisted=demo(d.state());
 assert.equal((await persisted.rows('menu_dishes')).find(x=>x.id===dish).active,1);
});
test('demo deleting one recipe row recalculates material cost without touching prices',async()=>{
 const d=demo();
 const before=(await d.rows('dish_costs')).find(x=>x.dish_id==='dish1'&&x.location_id==='l1');
 const priceCount=(await d.rows('ingredient_prices')).length;
 const rec=(await d.rows('dish_ingredients')).find(x=>x.dish_id==='dish1'&&x.ingredient_id==='i2');
 const res=await d.request('/api/command','recipe.delete',{id:rec.id});
 assert.equal(res.status,200);
 assert.equal((await d.rows('dish_ingredients')).some(x=>x.id===rec.id),false);
 const after=(await d.rows('dish_costs')).find(x=>x.dish_id==='dish1'&&x.location_id==='l1');
 assert.equal(after.estimated_cost_twd,17.3);
 assert.ok(after.estimated_cost_twd<before.estimated_cost_twd);
 assert.equal((await d.rows('ingredient_prices')).length,priceCount);
 assert.equal((await d.request('/api/command','recipe.delete',{id:rec.id})).status,400);
 assert.ok(d.state().audit_logs.some(x=>x.action==='demo.recipe.delete'));
});
test('menu archive and recipe remove buttons exist for both apps with explicit confirmation',()=>{
 for(const file of ['../public/app.js','app.js']){
  const s=fs.readFileSync(path.resolve(dir,file),'utf8');
  assert.ok(s.includes("btn('dish.active','封存菜品'"),file);
  assert.ok(s.includes("btn('dish.active','恢復菜品'"),file);
  assert.ok(s.includes("btn('recipe.delete','移除食材'"),file);
  assert.ok(s.includes('data-toggle-archived'),file);
  assert.ok(s.includes('if(!window.confirm(prompt))return'),file);
  assert.ok(s.includes("if(action==='dish.active')data={id,active:status==='on'?1:0}"),file);
 }
});
