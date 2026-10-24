'use strict';
// Estimates follow menu-planner's historical price, recipe and unit-conversion model.
// These calculations are NOT FIFO, moving-average inventory valuation or accounting profit.
const {uuid,cleanText,requiredRole}=require('./security');
const {inTransaction}=require('./db');
function bad(msg,status=400){const e=new Error(msg);e.status=status;throw e;}
const grams=new Map([['kg',1000],['公斤',1000],['千克',1000],['g',1],['公克',1],['克',1]]);
const milliliters=new Map([['L',1000],['l',1000],['公升',1000],['升',1000],['ml',1],['mL',1],['毫升',1]]);
function conversion(qty,from,to){
 if(from===to)return qty;
 if(grams.has(from)&&grams.has(to))return qty*grams.get(from)/grams.get(to);
 if(milliliters.has(from)&&milliliters.has(to))return qty*milliliters.get(from)/milliliters.get(to);
 return null;
}
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:process.env.BUSINESS_TIME_ZONE||'Asia/Taipei'});
function validDate(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)bad('日期格式需為 YYYY-MM-DD');
 return v;
}
function money(v,allowZero=false){
 const s=String(v??'').trim();
 if(!/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(s))bad('金額須為非負數，最多兩位小數');
 const a=s.split('.'), cents=Number(a[0])*100+Number((a[1]||'').padEnd(2,'0'));
 if(!Number.isSafeInteger(cents)||(!allowZero&&cents<=0))bad('金額必須有效且大於零');
 return cents;
}
function locationScope(db,u,locationId){
 requiredRole(u,'manager');
 if(!db.prepare('SELECT 1 FROM locations WHERE id=? AND active=1').get(locationId))bad('找不到門市',404);
 if(u.role!=='owner'&&!db.prepare('SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?').get(u.id,locationId))bad('不允許使用其他門市的價格',403);
}
function ingredient(db,id){
 const x=db.prepare('SELECT id,unit,active FROM ingredients WHERE id=?').get(id);
 if(!x||!x.active)bad('找不到有效食材',404);
 return x;
}
function recordPrice(db,u,d,source='manual',referenceId=null){
 locationScope(db,u,d.location_id);
 const ing=ingredient(db,d.ingredient_id),unit=cleanText(d.unit||ing.unit,20,true);
 if(conversion(1,unit,ing.unit)===null)bad('計價與庫存單位不相容');
 const cents=money(d.unit_price_twd);
 const id=uuid();
 db.prepare('INSERT INTO ingredient_prices(id,ingredient_id,location_id,price_date,price_cents,unit,supplier,source,reference_id,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)').run(
 id,ing.id,d.location_id,validDate(d.price_date||today()),cents,unit,cleanText(d.supplier||'',120),source,referenceId,u.id);
 return {id,price_cents:cents};
}
function latest(db,ingredientId,locationId,asOf){
 return db.prepare('SELECT * FROM ingredient_prices WHERE ingredient_id=? AND location_id=? AND price_date<=? ORDER BY price_date DESC,created_at DESC,rowid DESC LIMIT 1').get(ingredientId,locationId,asOf);
}
function locs(db,u){
 requiredRole(u,'manager');
 if(u.role==='owner')return db.prepare('SELECT id,name FROM locations WHERE active=1 ORDER BY name').all();
 return db.prepare('SELECT l.id,l.name FROM locations l JOIN user_locations ul ON ul.location_id=l.id WHERE ul.user_id=? AND l.active=1 ORDER BY l.name').all(u.id);
}
function costs(db,u,asOf=today()){
 validDate(asOf);const shops=locs(db,u);
 const dishes=db.prepare('SELECT id,name,sale_price_cents FROM menu_dishes WHERE active=1 ORDER BY name').all();
 const ingredients=db.prepare('SELECT r.dish_id,r.ingredient_id,i.name AS ingredient_name,r.qty,r.unit FROM dish_ingredients r JOIN ingredients i ON i.id=r.ingredient_id ORDER BY r.rowid').all();
 const byDish=new Map();
 for(const r of ingredients){if(!byDish.has(r.dish_id))byDish.set(r.dish_id,[]);byDish.get(r.dish_id).push(r);}
 const entries=[],details=[];
 for(const shop of shops)for(const dish of dishes){
  const recipe=byDish.get(dish.id)||[];let cents=0,missing=0;
  for(const r of recipe){
   const p=latest(db,r.ingredient_id,shop.id,asOf),qty=p?conversion(r.qty,r.unit,p.unit):null;
   const reason=!p?'缺少有效食材單價':qty===null?'單位不相容':null;
   const amount=reason?null:Math.round(qty*p.price_cents);
   if(reason)missing++;else cents+=amount;
   details.push({dish_id:dish.id,dish_name:dish.name,location_id:shop.id,location_name:shop.name,
    ingredient_id:r.ingredient_id,ingredient_name:r.ingredient_name,qty:r.qty,unit:r.unit,
    price_date:p?.price_date||null,price_unit:p?.unit||null,
    unit_price_twd:p?p.price_cents/100:null,line_cost_twd:amount===null?null:amount/100,
    cost_status:reason||'可計算'});
  }
  const complete=recipe.length>0&&!missing,profit=complete?dish.sale_price_cents-cents:null;
  entries.push({id:dish.id+':'+shop.id,dish_id:dish.id,dish_name:dish.name,location_id:shop.id,
   location_name:shop.name,sale_price_twd:dish.sale_price_cents/100,estimated_cost_twd:complete?cents/100:null,
   gross_profit_twd:profit===null?null:profit/100,
   gross_margin_pct:profit===null||!dish.sale_price_cents?null:Math.round(profit/dish.sale_price_cents*10000)/100,
   cost_status:!recipe.length?'尚無配方':missing?'價格或單位不完整':'估算完成'});
 }
 return {entries,details};
}
function inventoryValue(db,u,asOf=today()){
 validDate(asOf);const allowed=new Set(locs(db,u).map(l=>l.id));
 const stock=db.prepare("SELECT i.id AS ingredient_id,i.name AS ingredient_name,i.unit,l.id AS location_id,l.name AS location_name,COALESCE(SUM(m.qty_delta),0) AS on_hand FROM ingredients i CROSS JOIN locations l LEFT JOIN stock_moves m ON m.ingredient_id=i.id AND m.location_id=l.id WHERE i.active=1 AND l.active=1 GROUP BY i.id,l.id ORDER BY l.name,i.name").all();
 return stock.filter(s=>allowed.has(s.location_id)).map(s=>{
  const p=latest(db,s.ingredient_id,s.location_id,asOf),converted=p?conversion(s.on_hand,s.unit,p.unit):null;
  return {...s,price_date:p?.price_date||null,price_unit:p?.unit||null,unit_price_twd:p?p.price_cents/100:null,
   estimated_value_twd:converted===null?null:Math.round(converted*p.price_cents)/100,
   cost_status:!p?'缺少價格':converted===null?'單位不相容':'最新單價估值（非會計成本）'};
 });
}
function pricingRows(db,u,name){
 if(name==='dish_costs')return costs(db,u).entries;
 if(name==='dish_cost_lines')return costs(db,u).details;
 if(name==='inventory_values')return inventoryValue(db,u);
 if(name==='menu_dishes'){
  requiredRole(u,'manager');
  return db.prepare('SELECT d.id,d.name,d.sale_price_cents/100.0 AS sale_price_twd,d.active,COUNT(r.id) AS ingredient_count FROM menu_dishes d LEFT JOIN dish_ingredients r ON r.dish_id=d.id GROUP BY d.id ORDER BY d.name').all();
 }
 if(name==='dish_ingredients'){
  requiredRole(u,'manager');
  return db.prepare('SELECT r.id,r.dish_id,d.name AS dish_name,r.ingredient_id,i.name AS ingredient_name,r.qty,r.unit FROM dish_ingredients r JOIN menu_dishes d ON d.id=r.dish_id JOIN ingredients i ON i.id=r.ingredient_id WHERE d.active=1 ORDER BY d.name,i.name').all();
 }
 if(name==='ingredient_prices'){
  requiredRole(u,'manager');
  const q='SELECT p.id,p.ingredient_id,i.name AS ingredient_name,p.location_id,l.name AS location_name,p.price_date,p.price_cents/100.0 AS unit_price_twd,p.unit,p.supplier,p.source,p.reference_id FROM ingredient_prices p JOIN ingredients i ON i.id=p.ingredient_id JOIN locations l ON l.id=p.location_id';
  return u.role==='owner'?db.prepare(q+' ORDER BY p.price_date DESC,p.rowid DESC LIMIT 500').all():
   db.prepare(q+' WHERE EXISTS(SELECT 1 FROM user_locations ul WHERE ul.user_id=? AND ul.location_id=p.location_id) ORDER BY p.price_date DESC,p.rowid DESC LIMIT 500').all(u.id);
 }
 return null;
}
function pricingCommand(db,u,action,x,log){
 if(!['price.record','dish.create','dish.price','dish.active','recipe.set','recipe.delete'].includes(action))return null;
 return inTransaction(db,()=>{
  let id,shop=null,entity='menu_dishes';
  if(action==='price.record'){
   const r=recordPrice(db,u,x);id=r.id;shop=x.location_id;entity='ingredient_prices';
  }else if(action==='dish.create'){
   requiredRole(u,'owner');id=uuid();
   db.prepare('INSERT INTO menu_dishes(id,name,sale_price_cents) VALUES(?,?,?)').run(id,cleanText(x.name,120,true),money(x.sale_price_twd,true));
  }else if(action==='dish.price'){
   requiredRole(u,'owner');id=x.dish_id;
   if(!db.prepare('UPDATE menu_dishes SET sale_price_cents=? WHERE id=? AND active=1').run(money(x.sale_price_twd,true),id).changes)bad('找不到啟用中的菜品',404);
  }else if(action==='dish.active'){
   requiredRole(u,'owner');id=x.id;
   if(typeof id!=='string'||![0,1].includes(x.active))bad('菜品狀態不正確');
   const dish=db.prepare('SELECT id,name,active FROM menu_dishes WHERE id=?').get(id);
   if(!dish)bad('菜品不存在',404);
   if(dish.active===x.active)bad('菜品狀態未變更',409);
   db.prepare('UPDATE menu_dishes SET active=? WHERE id=?').run(x.active,id);
   log(db,u,action,entity,id,null,{pricing:true,name:dish.name,from:dish.active,to:x.active,ingredient_count:db.prepare('SELECT count(*) AS n FROM dish_ingredients WHERE dish_id=?').get(id).n});
   return {id,active:x.active};
  }else if(action==='recipe.delete'){
   requiredRole(u,'owner');id=x.id;
   if(typeof id!=='string'||!id.trim())bad('配方項目識別碼不正確');
   const rec=db.prepare('SELECT r.id,r.dish_id,r.ingredient_id,r.qty,r.unit,d.active,d.name AS dish_name FROM dish_ingredients r JOIN menu_dishes d ON d.id=r.dish_id WHERE r.id=?').get(id);
   if(!rec)bad('配方項目不存在',404);
   if(!rec.active)bad('請先恢復菜品，才能修改其配方',409);
   db.prepare('DELETE FROM dish_ingredients WHERE id=?').run(id);
   entity='dish_ingredients';
   log(db,u,action,entity,id,null,{pricing:true,dish_id:rec.dish_id,dish_name:rec.dish_name,ingredient_id:rec.ingredient_id,qty:rec.qty,unit:rec.unit});
   return {id,dish_id:rec.dish_id};
  }else if(action==='recipe.set'){
   requiredRole(u,'owner');const dish=db.prepare('SELECT id FROM menu_dishes WHERE id=? AND active=1').get(x.dish_id);
   if(!dish)bad('找不到啟用中的菜品',404);
   const ing=ingredient(db,x.ingredient_id),qty=Number(x.qty),unit=cleanText(x.unit||ing.unit,20,true);
   if(!Number.isFinite(qty)||qty<=0||qty>1e9)bad('用量不正確');
   if(conversion(1,unit,ing.unit)===null)bad('配方與庫存單位不相容');
   entity='dish_ingredients';
   id=db.prepare('SELECT id FROM dish_ingredients WHERE dish_id=? AND ingredient_id=?').get(dish.id,ing.id)?.id||uuid();
   db.prepare('INSERT INTO dish_ingredients(id,dish_id,ingredient_id,qty,unit) VALUES(?,?,?,?,?) ON CONFLICT(dish_id,ingredient_id) DO UPDATE SET qty=excluded.qty,unit=excluded.unit').run(id,dish.id,ing.id,qty,unit);
  }
  log(db,u,action,entity,id,shop,{pricing:true});return {id};
 });
}
module.exports={conversion,money,recordPrice,pricingRows,pricingCommand,costs,inventoryValue};
