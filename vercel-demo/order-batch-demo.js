/* PUBLIC DEMO ONLY: fictional per-supplier purchase orders, no real supplier data. */
(function(root){
'use strict';
const groupOf=n=>String(n||'').match(/^(POB-[A-F0-9]{32})-\d{3}$/)?.[1]||n;
const day=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Taipei'});
function suppliers(db){
 const out=[];
 for(const l of db.locations)for(const i of db.ingredients.filter(i=>i.active!==0)){
  const last=db.ingredient_prices.filter(p=>p.location_id===l.id&&p.ingredient_id===i.id&&p.supplier?.trim()&&p.price_date<=day())
    .sort((a,b)=>b.price_date.localeCompare(a.price_date)||db.ingredient_prices.indexOf(b)-db.ingredient_prices.indexOf(a))[0];
  if(last)out.push({location_id:l.id,ingredient_id:i.id,supplier:last.supplier,ingredient_name:i.name,unit:i.unit});
 }
 return out;
}
function detail(db,number){
 if(!/^POB-[A-F0-9]{32}$/.test(number||''))throw Error('單號格式不正確');
 const rows=db.purchase_orders.filter(r=>groupOf(r.number)===number).sort((a,b)=>a.number.localeCompare(b.number));
 if(!rows.length)throw Error('找不到叫貨單');
 const r=rows[0];
 return {number,rows,location_id:r.location_id,location_name:r.location_name,supplier:r.supplier,created_at:r.created_at,states:[...new Set(rows.map(x=>x.status))],line_manual_confirmation:db.demo_order_sent?.find(x=>x.number===number)||null};
}
function command(db,action,x,{makeId,changeStock,log,makePrice}){
 if(action==='order.batch-create'){
  if(!db.locations.some(l=>l.id===x.location_id&&l.active!==0))throw Error('找不到門市');
  if(!Array.isArray(x.items)||x.items.length<1||x.items.length>60)throw Error('一次限 1～60 筆食材');
  const recommended=new Map(suppliers(db).filter(s=>s.location_id===x.location_id).map(s=>[s.ingredient_id,s.supplier]));
  const groups=new Map(),seen=new Set();
  for(const v of x.items){
   const ing=db.ingredients.find(i=>i.id===v.ingredient_id&&i.active!==0);
   const qty=Number(v.qty),supplier=String(v.supplier||recommended.get(v.ingredient_id)||'').trim();
   if(!ing||!Number.isFinite(qty)||qty<=0||qty>1e9||!supplier||supplier.length>120||/[\r\n\t]/.test(supplier))throw Error('食材、數量或供應商無效');
   if(seen.has(ing.id))throw Error('同一食材不可重複');seen.add(ing.id);
   if(!groups.has(supplier))groups.set(supplier,[]);
   groups.get(supplier).push({ing,qty});
  }
  const output=[];
  for(const [supplier,items] of groups){
   const number='POB-'+Array.from({length:32},()=>Math.floor(Math.random()*16).toString(16)).join('').toUpperCase();
   for(let i=0;i<items.length;i++)db.purchase_orders.unshift({id:makeId(),number:number+'-'+String(i+1).padStart(3,'0'),
    location_id:x.location_id,location_name:db.locations.find(l=>l.id===x.location_id).name,
    ingredient_id:items[i].ing.id,ingredient_name:items[i].ing.name,unit:items[i].ing.unit,
    supplier,qty:items[i].qty,status:'requested',created_at:day()+' 09:00'});
   output.push({number,supplier,item_count:items.length});log(action,'purchase_orders',number);
  }
  return {groups:output};
 }
 const order=detail(db,x.number),lines=order.rows;
 if(action==='order.batch-mark-sent'){
  if(lines.some(r=>r.status!=='approved'))throw Error('尚未核准，無法登記已送出');
  if(order.line_manual_confirmation)throw Error('已記錄人工送出');
  if(!Array.isArray(db.demo_order_sent))db.demo_order_sent=[];
  db.demo_order_sent.push({number:x.number,at:new Date().toLocaleString('zh-TW'),actor_name:'展示業主'});
  log(action,'purchase_orders',x.number);
  return {number:x.number,manual_confirmation:true};
 }
 if(lines.some(r=>r.location_id!==order.location_id||r.supplier!==order.supplier))throw Error('單據資料不一致');
 const accepted=action==='order.batch-cancel'?['requested','approved']:[action==='order.batch-receive'?'approved':'requested'];
 if(lines.some(r=>!accepted.includes(r.status)))throw Error('單據狀態不符或已處理過');
 if(action==='order.batch-approve')lines.forEach(r=>r.status='approved');
 else if(action==='order.batch-cancel')lines.forEach(r=>r.status='cancelled');
 else if(action==='order.batch-receive'){
  // Validate EVERY optional per-line historical price before touching ANY stock.
  // This preserves all-or-nothing receipt behavior like the real SQLite flow.
  const prices=x.prices;
  if(prices!==undefined&&(!prices||typeof prices!=='object'||Array.isArray(prices)))throw Error('驗收單價格式錯誤');
  if(prices&&Object.keys(prices).some(id=>!lines.some(r=>r.id===id)))throw Error('其他單據的進價明細');
  const staged=[];
  for(const r of lines){
   const input=prices?.[r.id];
   if(input!==undefined){
    if(!input||typeof input!=='object'||Array.isArray(input))throw Error('品項單價格式不正確');
    const price=makePrice(db,{...input,ingredient_id:r.ingredient_id,location_id:r.location_id,supplier:r.supplier},makeId(),'purchase');
    staged.push(price);
   }
   const ingredient=db.ingredients.find(i=>i.id===r.ingredient_id&&i.active!==0);
   if(!ingredient||!Number.isFinite(Number(r.qty))||!(Number(r.qty)>0))throw Error('無效品項，不能入庫');
  }
  for(const r of lines){changeStock(r.location_id,r.ingredient_id,r.qty,'purchase','虛構叫貨單 '+x.number);r.status='received';}
  db.ingredient_prices.push(...staged);
 }else throw Error('不支援的操作');
 log(action,'purchase_orders',x.number);return {number:x.number,item_count:lines.length};
}
root.RestaurantDemoOrders={suppliers,groupOf,detail,command};
})(window);
