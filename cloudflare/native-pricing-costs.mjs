// Production Native D1 cost estimates, read-only and manager/Owner scoped.
// Matches local src/pricing.js, using exactly the same pure unit/cents helpers.
// This is NOT FIFO, moving-average valuation or accounting gross profit.
// No dynamic SQL identifiers, client-supplied store IDs, writes or migrations.
import pricingUnits from '../src/pricing-units.cjs';
const {conversion,roundedCents}=pricingUnits;
const OUTPUT_MAX=500,INPUT_MAX=5000;
const ACTIVE_GRANT=' l.id IN (SELECT ul.location_id FROM user_locations ul '+
 'JOIN locations active_l ON active_l.id=ul.location_id AND active_l.active=1 '+
 'WHERE ul.user_id=?)';
const COST_ENTITY_LIST=Object.freeze(['dish_costs','dish_cost_lines','inventory_values']);
export const NATIVE_COST_ENTITIES=COST_ENTITY_LIST;
const today=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
function validDate(asOf){
 if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||
    !Number.isFinite(Date.parse(asOf+'T00:00:00Z'))||
    new Date(asOf+'T00:00:00Z').toISOString().slice(0,10)!==asOf)
  throw Error('E_COST_DATE');
 return asOf;
}
async function query(db,sql,params,limit){
 const statement=db.prepare(sql);
 const result=await (params.length?statement.bind(...params):statement).all();
 const rows=result?.results;
 if(!Array.isArray(rows)||rows.length>limit||rows.some(x=>!x||typeof x!=='object'))
  throw Error('E_COST_DATA_LIMIT');
 return rows;
}
function bounded(rows){
 if(rows.length>OUTPUT_MAX)throw Error('E_COST_RESULT_LIMIT');
 return rows;
}
function finite(n){
 if(typeof n!=='number'||!Number.isFinite(n))throw Error('E_COST_INVALID_NUMBER');
 return n;
}
function key(locationId,ingredientId){return JSON.stringify([locationId,ingredientId]);}
async function shops(db,principal){
 const owner=principal.role==='owner';
 const sql='SELECT l.id,l.name FROM locations l WHERE l.active=1'+
  (owner?'':' AND '+ACTIVE_GRANT)+
  ' ORDER BY l.name,l.id LIMIT 501';
 return query(db,sql,owner?[]:[principal.id],OUTPUT_MAX);
}
async function latestPrices(db,principal,asOf){
 const owner=principal.role==='owner';
 // Include only the latest price effective as-of business day. The final
 // rowid tie-break is the same as the on-prem SQLite latest() implementation.
 const sql='WITH latest AS (SELECT p.ingredient_id,p.location_id,'+
  'p.price_date,p.price_cents,p.unit,'+
  'ROW_NUMBER() OVER (PARTITION BY p.ingredient_id,p.location_id '+
  'ORDER BY p.price_date DESC,p.created_at DESC,p.rowid DESC) AS rn '+
  'FROM ingredient_prices p JOIN locations l ON l.id=p.location_id '+
  'WHERE l.active=1 AND p.price_date<=?'+
  (owner?'':' AND '+ACTIVE_GRANT)+
  ') SELECT ingredient_id,location_id,price_date,price_cents,unit '+
  'FROM latest WHERE rn=1 ORDER BY location_id,ingredient_id LIMIT 5001';
 const rows=await query(db,sql,owner?[asOf]:[asOf,principal.id],INPUT_MAX);
 const prices=new Map();
 for(const x of rows)prices.set(key(x.location_id,x.ingredient_id),x);
 return prices;
}
async function readInventory(db,principal,asOf){
 const owner=principal.role==='owner';
 const sql='SELECT i.id AS ingredient_id,i.name AS ingredient_name,i.unit,'+
  'l.id AS location_id,l.name AS location_name,'+
  'COALESCE(SUM(m.qty_delta),0) AS on_hand '+
  'FROM ingredients i CROSS JOIN locations l '+
  'LEFT JOIN stock_moves m ON m.ingredient_id=i.id AND m.location_id=l.id '+
  'WHERE i.active=1 AND l.active=1'+(owner?'':' AND '+ACTIVE_GRANT)+
  ' GROUP BY i.id,l.id ORDER BY l.name,i.name LIMIT 501';
 const stock=await query(db,sql,owner?[]:[principal.id],OUTPUT_MAX);
 if(!stock.length)return [];
 const prices=await latestPrices(db,principal,asOf);
 return bounded(stock.map(s=>{
  const p=prices.get(key(s.location_id,s.ingredient_id));
  const qty=p?conversion(finite(s.on_hand),s.unit,p.unit):null;
  const amount=qty===null?null:roundedCents(finite(qty),finite(p.price_cents));
  if(amount!==null)finite(amount);
  return {ingredient_name:s.ingredient_name,location_name:s.location_name,
    unit:s.unit,on_hand:s.on_hand,price_date:p?.price_date||null,
    price_unit:p?.unit||null,unit_price_twd:p?finite(p.price_cents)/100:null,
    estimated_value_twd:amount===null?null:amount/100,
    cost_status:!p?'缺少價格':qty===null?'單位不相容':'最新單價估值（非會計成本）'};
 }));
}
async function readDishCosts(db,principal,asOf,entity){
 const stores=await shops(db,principal);
 if(!stores.length)return []; // never read global dishes for a manager with no stores
 const dishes=await query(db,
  'SELECT id,name,sale_price_cents FROM menu_dishes WHERE active=1 '+
  'ORDER BY name LIMIT 501',[],OUTPUT_MAX);
 if(!dishes.length)return [];
 if(stores.length*dishes.length>OUTPUT_MAX)
  throw Error('E_COST_RESULT_LIMIT');
 const recipes=await query(db,
  'SELECT r.dish_id,r.ingredient_id,i.name AS ingredient_name,r.qty,r.unit '+
  'FROM dish_ingredients r JOIN ingredients i ON i.id=r.ingredient_id '+
  'JOIN menu_dishes d ON d.id=r.dish_id AND d.active=1 '+
  'ORDER BY r.rowid LIMIT 5001',[],INPUT_MAX);
 const byDish=new Map();
 for(const rec of recipes){
  if(!byDish.has(rec.dish_id))byDish.set(rec.dish_id,[]);
  byDish.get(rec.dish_id).push(rec);
 }
 if(entity==='dish_cost_lines'&&
   stores.length*recipes.length>OUTPUT_MAX)
  throw Error('E_COST_RESULT_LIMIT');
 const prices=await latestPrices(db,principal,asOf);
 const entries=[],details=[];
 for(const shop of stores)for(const dish of dishes){
  const recipe=byDish.get(dish.id)||[];
  let cents=0,missing=0;
  for(const rec of recipe){
   const p=prices.get(key(shop.id,rec.ingredient_id));
   const qty=p?conversion(finite(rec.qty),rec.unit,p.unit):null;
   const reason=!p?'缺少有效食材單價':qty===null?'單位不相容':null;
   const amount=reason?null:roundedCents(finite(qty),finite(p.price_cents));
   if(reason)missing++;
   else{finite(amount);cents+=amount;finite(cents);}
   details.push({
    dish_name:dish.name,location_name:shop.name,
    ingredient_name:rec.ingredient_name,qty:rec.qty,unit:rec.unit,
    price_date:p?.price_date||null,price_unit:p?.unit||null,
    unit_price_twd:p?finite(p.price_cents)/100:null,
    line_cost_twd:amount===null?null:amount/100,
    cost_status:reason||'可計算'
   });
  }
  const complete=recipe.length>0&&!missing;
  const sale=finite(dish.sale_price_cents),profit=complete?sale-cents:null;
  if(profit!==null)finite(profit);
  entries.push({
   dish_name:dish.name,location_name:shop.name,
   sale_price_twd:sale/100,estimated_cost_twd:complete?cents/100:null,
   gross_profit_twd:profit===null?null:profit/100,
   gross_margin_pct:profit===null||!sale?null:Math.round(profit/sale*10000)/100,
   cost_status:!recipe.length?'尚無配方':missing?'價格或單位不完整':'估算完成'
  });
 }
 return bounded(entity==='dish_costs'?entries:details);
}
export async function nativeCostReadonlyRows(db,principal,entity,asOf=today()){
 if(!NATIVE_COST_ENTITIES.includes(entity)||!principal||
   !['owner','manager'].includes(principal.role)||typeof principal.id!=='string'||
   !principal.id)throw Error('E_COST_FORBIDDEN');
 validDate(asOf);
 return entity==='inventory_values'
  ?readInventory(db,principal,asOf)
  :readDishCosts(db,principal,asOf,entity);
}
