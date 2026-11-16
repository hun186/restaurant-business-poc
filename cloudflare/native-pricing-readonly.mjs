// Native production D1 price/recipe read-only queries. This module is not
// imported by staging Preview and never executes D1 writes or schema changes.
// Align projection with local src/pricing.js: prices are integer cents converted
// to TWD display units; recipe cost calculations are intentionally NOT claimed.
const ACTIVE_STORE_GRANT='EXISTS (SELECT 1 FROM user_locations g '+
 'JOIN locations l ON l.id=g.location_id AND l.active=1 WHERE g.user_id=?)';
const ASSIGNED_STORE=' IN (SELECT g.location_id FROM user_locations g '+
 'JOIN locations l2 ON l2.id=g.location_id AND l2.active=1 WHERE g.user_id=?)';
export const NATIVE_PRICING_ENTITIES=Object.freeze([
 'ingredient_prices','menu_dishes','dish_ingredients'
]);
export function nativePricingReadonlyPlan(entity,principal){
 if(!NATIVE_PRICING_ENTITIES.includes(entity)||!principal||
    !['owner','manager'].includes(principal.role)||typeof principal.id!=='string'||
    !principal.id)return null;
 const owner=principal.role==='owner';
 if(entity==='ingredient_prices'){
  const scope=owner?'':' WHERE p.location_id'+ASSIGNED_STORE;
  return Object.freeze({
   sql:'SELECT p.price_date,p.price_cents/100.0 AS unit_price_twd,'+
    'p.unit,p.supplier,p.source,i.name AS ingredient_name,'+
    'l.name AS location_name FROM ingredient_prices p '+
    'JOIN ingredients i ON i.id=p.ingredient_id '+
    'JOIN locations l ON l.id=p.location_id'+scope+
    ' ORDER BY p.price_date DESC,p.created_at DESC,p.id DESC LIMIT 500',
   params:owner?[]:[principal.id]
  });
 }
 if(entity==='menu_dishes')
  return Object.freeze({
   sql:'SELECT d.name,d.sale_price_cents/100.0 AS sale_price_twd,'+
    'd.active,COUNT(r.id) AS ingredient_count FROM menu_dishes d '+
    'LEFT JOIN dish_ingredients r ON r.dish_id=d.id'+
    (owner?'':' WHERE '+ACTIVE_STORE_GRANT)+
    ' GROUP BY d.id ORDER BY d.name,d.id LIMIT 500',
   params:owner?[]:[principal.id]
  });
 return Object.freeze({
  sql:'SELECT d.name AS dish_name,i.name AS ingredient_name,'+
   'r.qty,r.unit FROM dish_ingredients r '+
   'JOIN menu_dishes d ON d.id=r.dish_id '+
   'JOIN ingredients i ON i.id=r.ingredient_id '+
   'WHERE d.active=1'+(owner?'':' AND '+ACTIVE_STORE_GRANT)+
   ' ORDER BY d.name,i.name,r.id LIMIT 500',
  params:owner?[]:[principal.id]
 });
}
