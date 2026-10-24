/* PUBLIC DEMO: browser-only illustrative pricing, not accounting or a backend. */
(function(root){
'use strict';
const DAY=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
const grammar=/^\d{4}-\d{2}-\d{2}$/;
function validDate(value){
 if(typeof value!=='string'||!grammar.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('日期格式須為 YYYY-MM-DD');
 return value;
}
function positive(value,allowZero=false){
 const s=String(value??'').trim();
 if(!/^(0|[1-9]\d{0,8})(\.\d{1,2})?$/.test(s))throw Error('金額須為有效非負數，最多兩位小數');
 const cents=Math.round(Number(s)*100);
 if(!Number.isSafeInteger(cents)||(!allowZero&&cents<=0))throw Error('金額必須大於零');
 return cents;
}
function qty(value){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>1000000)throw Error('配方用量須大於零');return n;}
const unitWeight={'kg':1000,'公斤':1000,'公克':1,'g':1,'克':1};
const unitVolume={'L':1000,'公升':1000,'ml':1,'mL':1,'毫升':1};
function converted(amount,from,to){
 if(from===to)return amount;
 if(Object.hasOwn(unitWeight,from)&&Object.hasOwn(unitWeight,to))return amount*unitWeight[from]/unitWeight[to];
 if(Object.hasOwn(unitVolume,from)&&Object.hasOwn(unitVolume,to))return amount*unitVolume[from]/unitVolume[to];
 return null;
}
const byId=(db,table,id)=>db[table].find(x=>String(x.id)===String(id));
function requireItem(db,table,id){const found=byId(db,table,id);if(!found||found.active===0)throw Error('找不到有效的示範資料：'+table);return found;}
function seed(db){
 // Upgrade existing sessionStorage without deleting the user's current demo changes.
 if(!Array.isArray(db.ingredient_prices))db.ingredient_prices=[
  {id:'dp1',ingredient_id:'i1',location_id:'l1',price_date:'2026-08-01',price_cents:9000,unit:'公斤',supplier:'示範蔬果商',source:'demo'},
  {id:'dp2',ingredient_id:'i1',location_id:'l1',price_date:'2026-10-01',price_cents:9500,unit:'公斤',supplier:'示範蔬果商',source:'demo'},
  {id:'dp3',ingredient_id:'i2',location_id:'l1',price_date:'2026-09-01',price_cents:18500,unit:'公斤',supplier:'示範肉品商',source:'demo'},
  {id:'dp4',ingredient_id:'i3',location_id:'l1',price_date:'2026-09-01',price_cents:6500,unit:'公斤',supplier:'示範農場',source:'demo'},
  {id:'dp5',ingredient_id:'i1',location_id:'l2',price_date:'2026-09-01',price_cents:9200,unit:'公斤',supplier:'示範蔬果商',source:'demo'},
  {id:'dp6',ingredient_id:'i4',location_id:'l2',price_date:'2026-09-01',price_cents:700,unit:'顆',supplier:'示範蛋品商',source:'demo'}];
 if(!Array.isArray(db.menu_dishes))db.menu_dishes=[
  {id:'dish1',name:'香煎雞胸沙拉',sale_price_cents:19900,active:1},
  {id:'dish2',name:'番茄蛋料理',sale_price_cents:15900,active:1}];
 if(!Array.isArray(db.dish_ingredients))db.dish_ingredients=[
  {id:'ri1',dish_id:'dish1',ingredient_id:'i2',qty:180,unit:'公克'},
  {id:'ri2',dish_id:'dish1',ingredient_id:'i3',qty:120,unit:'公克'},
  {id:'ri3',dish_id:'dish1',ingredient_id:'i1',qty:100,unit:'公克'},
  {id:'ri4',dish_id:'dish2',ingredient_id:'i1',qty:150,unit:'公克'},
  {id:'ri5',dish_id:'dish2',ingredient_id:'i4',qty:2,unit:'顆'}];
}
function latest(db,ing,loc,at=DAY()){
 return db.ingredient_prices.filter(x=>x.ingredient_id===ing&&x.location_id===loc&&x.price_date<=at)
  .sort((a,b)=>b.price_date.localeCompare(a.price_date)||db.ingredient_prices.indexOf(b)-db.ingredient_prices.indexOf(a))[0]||null;
}
function makePrice(db,d,id,source='manual'){
 const ing=requireItem(db,'ingredients',d.ingredient_id),loc=requireItem(db,'locations',d.location_id);
 const unit=String(d.unit||ing.unit).trim();
 if(converted(1,unit,ing.unit)===null)throw Error('食材價格單位與食材庫存單位不相容');
 return {id,ingredient_id:ing.id,location_id:loc.id,price_date:validDate(d.price_date||DAY()),price_cents:positive(d.unit_price_twd),unit,supplier:String(d.supplier||'').trim().slice(0,120),source};
}
function handle(db,action,d,id){
 if(action==='price.record'){
  const p=makePrice(db,d,id);db.ingredient_prices.push(p);return {id:p.id};
 }
 if(action==='dish.create'){
  const name=String(d.name||'').trim();
  if(!name||name.length>120)throw Error('請輸入菜品名稱（最多 120 字）');
  if(db.menu_dishes.some(x=>x.name===name))throw Error('菜品名稱不可重複');
  db.menu_dishes.push({id,name,sale_price_cents:positive(d.sale_price_twd,true),active:1});return {id};
 }
 if(action==='dish.price'){
  const dish=requireItem(db,'menu_dishes',d.dish_id);
  dish.sale_price_cents=positive(d.sale_price_twd,true);return {id:dish.id};
 }
 if(action==='recipe.set'){
  const dish=requireItem(db,'menu_dishes',d.dish_id),ing=requireItem(db,'ingredients',d.ingredient_id);
  const unit=String(d.unit||ing.unit).trim(),amount=qty(d.qty);
  if(converted(1,unit,ing.unit)===null)throw Error('配方單位與食材單位不相容');
  const old=db.dish_ingredients.find(x=>x.dish_id===dish.id&&x.ingredient_id===ing.id);
  if(old){old.qty=amount;old.unit=unit;return {id:old.id};}
  db.dish_ingredients.push({id,dish_id:dish.id,ingredient_id:ing.id,qty:amount,unit});return {id};
 }
 throw Error('未支援的價格示範操作');
}
function rows(db,name){
 const locName=id=>byId(db,'locations',id)?.name||'未知門市';
 const ingName=id=>byId(db,'ingredients',id)?.name||'未知食材';
 const dishName=id=>byId(db,'menu_dishes',id)?.name||'未知菜品';
 if(name==='ingredient_prices')return db.ingredient_prices.map(x=>({...x,location_name:locName(x.location_id),ingredient_name:ingName(x.ingredient_id),unit_price_twd:x.price_cents/100}))
  .sort((a,b)=>b.price_date.localeCompare(a.price_date));
 if(name==='menu_dishes')return db.menu_dishes.map(x=>({...x,sale_price_twd:x.sale_price_cents/100,ingredient_count:db.dish_ingredients.filter(r=>r.dish_id===x.id).length}));
 if(name==='dish_ingredients')return db.dish_ingredients.map(x=>({...x,dish_name:dishName(x.dish_id),ingredient_name:ingName(x.ingredient_id)}));
 if(name==='inventory_values')return db.stock.map(s=>{
  const p=latest(db,s.ingredient_id,s.location_id),q=p?converted(Number(s.on_hand),s.unit,p.unit):null;
  return {id:s.id,location_id:s.location_id,location_name:s.location_name,ingredient_name:s.name,unit:s.unit,on_hand:s.on_hand,
   price_unit:p?.unit||null,unit_price_twd:p?p.price_cents/100:null,
   estimated_value_twd:q===null?null:Math.round(q*p.price_cents)/100,
   cost_status:!p?'缺少價格':q===null?'單位不相容':'最新單價估值（非會計成本）'};
 });
 if(name==='dish_costs'||name==='dish_cost_lines'){
  const summary=[],lines=[];
  for(const shop of db.locations.filter(x=>x.active!==0))for(const dish of db.menu_dishes.filter(x=>x.active!==0)){
   const recipe=db.dish_ingredients.filter(x=>x.dish_id===dish.id);let total=0,missing=0;
   for(const rec of recipe){
    const price=latest(db,rec.ingredient_id,shop.id),amount=price?converted(rec.qty,rec.unit,price.unit):null;
    const reason=!price?'缺少有效食材單價':amount===null?'單位不相容':null;
    const cents=reason?null:Math.round(amount*price.price_cents);
    if(reason)missing++;else total+=cents;
    lines.push({id:rec.id+':'+shop.id,dish_id:dish.id,dish_name:dish.name,location_id:shop.id,location_name:shop.name,
     ingredient_name:ingName(rec.ingredient_id),qty:rec.qty,unit:rec.unit,price_unit:price?.unit||null,
     unit_price_twd:price?price.price_cents/100:null,line_cost_twd:cents===null?null:cents/100,cost_status:reason||'可計算'});
   }
   const good=recipe.length>0&&missing===0,profit=good?dish.sale_price_cents-total:null;
   summary.push({id:dish.id+':'+shop.id,dish_id:dish.id,dish_name:dish.name,location_id:shop.id,location_name:shop.name,
    sale_price_twd:dish.sale_price_cents/100,estimated_cost_twd:good?total/100:null,
    gross_profit_twd:profit===null?null:profit/100,
    gross_margin_pct:profit===null||dish.sale_price_cents===0?null:Math.round(profit/dish.sale_price_cents*10000)/100,
    cost_status:!recipe.length?'尚無配方':missing?'價格或單位不完整':'估算完成'});
  }
  return name==='dish_costs'?summary:lines;
 }
 return null;
}
root.RestaurantDemoPricing={seed,rows,handle,makePrice,converted};
})(window);
