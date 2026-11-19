/* PUBLIC DEMO ONLY. Pure stock v4 planner for fake, browser-only records.
 * Demo IDs intentionally differ from Production UUIDs; do NOT import this
 * into a persisted SQLite API, Native Worker, or any authorization boundary. */
'use strict';
(function(){
 const actions=['stock.scrap','stock.adjust','stock.supplier_return'];
 const allowed={
  'stock.scrap':['location_id','ingredient_id','qty','reason'],
  'stock.adjust':['location_id','ingredient_id','qty_delta','reason'],
  'stock.supplier_return':['location_id','ingredient_id','qty','reason','reference_id']
 };
 const err=code=>{throw Error('展示庫存異動未成功：'+code);};
 const exact=(obj,fields)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.getPrototypeOf(obj)===Object.prototype&&
  JSON.stringify(Object.keys(obj).sort())===JSON.stringify([...fields].sort());
 const milli=(q,signed=false)=>{
  if(typeof q!=='number'||!Number.isFinite(q)||q===0||(!signed&&q<0)||
    Math.abs(q)>1000000||
    !/^-?(?:0|[1-9][0-9]*)(?:[.][0-9]{1,3})?$/.test(String(q)))err('數量須符合 0.001 精度及上限');
  const n=Math.round(q*1000);
  if(!Number.isSafeInteger(n)||n===0)err('數量精度錯誤');
  return n;
 };
 const storedMilli=q=>{
  if(typeof q!=='number'||!Number.isFinite(q)||Math.abs(q)>1000000||
    Math.abs(q*1000-Math.round(q*1000))>0.0000001)
    err('既有展示庫存精度異常');
  return Math.round(q*1000);
 };
 const find=(db,table,id)=>db[table].find(x=>x.id===id);
 const plan=(db,action,data)=>{
  if(!actions.includes(action)||!exact(data,allowed[action]))err('操作類型或欄位無效');
  const {location_id,ingredient_id,reason}=data;
  if(typeof location_id!=='string'||typeof ingredient_id!=='string'||
    !location_id||!ingredient_id||
    typeof reason!=='string'||reason!==reason.trim()||!reason||
    reason.length>300||/[\u0000-\u001f\u007f-\u009f]/u.test(reason))
    err('請選擇門市、食材並填寫原因（最多 300 字）');
  const loc=find(db,'locations',location_id),ing=find(db,'ingredients',ingredient_id);
  if(!loc||!ing||loc.active===0||ing.active===0)err('門市或食材不存在或已停用');
  const delta=action==='stock.adjust'?milli(data.qty_delta,true):-milli(data.qty);
  const row=db.stock.find(x=>x.location_id===location_id&&x.ingredient_id===ingredient_id);
  const before=storedMilli(row?row.on_hand:0),after=before+delta;
  if(!Number.isSafeInteger(after)||after<0||after>1000000000)
   err('庫存不足或異動後數量超出上限');
  let reference=null;
  if(action==='stock.supplier_return'){
   reference=data.reference_id;
   if(typeof reference!=='string'||!reference)err('請選擇原已驗收叫貨單');
   const po=find(db,'purchase_orders',reference);
   if(!po||po.status!=='received'||po.location_id!==location_id||
      po.ingredient_id!==ingredient_id)err('退貨須對應相同門市食材的已驗收叫貨單');
   const received=milli(po.qty);
   const purchases=db.stock_moves.filter(m=>m.move_type==='purchase'&&m.reference_id===reference);
   if(purchases.length!==1||purchases[0].ingredient_id!==ingredient_id||
      purchases[0].location_id!==location_id||storedMilli(purchases[0].qty_delta)!==received)
    err('無法證明原叫貨單的完整驗收流水');
   let returned=0;
   for(const m of db.stock_moves.filter(m=>m.move_type==='supplier_return'&&m.reference_id===reference)){
    if(m.location_id!==location_id||m.ingredient_id!==ingredient_id||
       storedMilli(m.qty_delta)>=0)err('既有退貨流水不一致');
    returned-=storedMilli(m.qty_delta);
    if(!Number.isSafeInteger(returned)||returned>received)err('既有退貨超出原驗收量');
   }
   if(returned-delta>received)err('退貨數量超出原驗收剩餘額');
  }
  return Object.freeze({
   location_id,ingredient_id,qty_delta:delta/1000,
   after_milli:after,note:reason,reference_id:reference,
   move_type:action==='stock.scrap'?'scrap':action==='stock.adjust'?'adjustment':'supplier_return'
  });
 };
 window.RestaurantDemoStockV4=Object.freeze({plan});
})();
