'use strict';
const {uuid,cleanText,nonneg,requiredRole}=require('./security');
const {inTransaction}=require('./db');
const GROUP=/^POB-[A-F0-9]{32}$/;
const bad=(s,status=400)=>{throw Object.assign(new Error(s),{status});};
function groupOf(n){const m=String(n||'').match(/^(POB-[A-F0-9]{32})-\d{3}$/);return m?m[1]:n;}
function suggestions(db,u){
 const date=new Date().toLocaleDateString('sv-SE',{timeZone:process.env.BUSINESS_TIME_ZONE||'Asia/Taipei'});
 const query='SELECT p.ingredient_id,p.location_id,p.supplier,i.name AS ingredient_name,i.unit FROM ingredient_prices p JOIN ingredients i ON i.id=p.ingredient_id WHERE i.active=1 AND length(trim(p.supplier))>0 AND p.price_date<=? AND p.rowid=(SELECT p2.rowid FROM ingredient_prices p2 WHERE p2.ingredient_id=p.ingredient_id AND p2.location_id=p.location_id AND length(trim(p2.supplier))>0 AND p2.price_date<=? ORDER BY p2.price_date DESC,p2.created_at DESC,p2.rowid DESC LIMIT 1) ORDER BY p.location_id,i.name';
 const result=db.prepare(query).all(date,date);
 if(u.role==='owner')return result;
 const allowed=new Set(db.prepare('SELECT location_id FROM user_locations WHERE user_id=?').all(u.id).map(r=>r.location_id));
 return result.filter(r=>allowed.has(r.location_id));
}
function confirmedSent(db,number){
 return db.prepare("SELECT at,actor_name FROM audit_logs WHERE action='order.batch-mark-sent' AND json_extract(detail,'$.number')=? ORDER BY rowid DESC LIMIT 1").get(number)||null;
}
function handle(db,u,action,x,{scope,audit,move,pricing}){
 if(!['order.batch-create','order.batch-approve','order.batch-cancel','order.batch-receive','order.batch-mark-sent'].includes(action))return null;
 return inTransaction(db,()=>{
  if(action==='order.batch-create'){
   scope(db,u,x.location_id);
   if(!Array.isArray(x.items)||x.items.length<1||x.items.length>60)bad('每批限 1～60 個食材項目');
   const recommended=new Map(suggestions(db,u).filter(r=>r.location_id===x.location_id).map(r=>[r.ingredient_id,r.supplier]));
   const batches=new Map(),unique=new Set();
   for(const line of x.items){
    if(!line||typeof line!=='object'||Array.isArray(line))bad('食材明細格式不正確');
    const ing=db.prepare('SELECT id,name,unit FROM ingredients WHERE id=? AND active=1').get(line.ingredient_id);
    if(!ing)bad('食材不存在或已停用',404);
    if(unique.has(ing.id))bad('同批食材不可重複，請合併數量');unique.add(ing.id);
    const qty=nonneg(line.qty,true),supplier=cleanText(line.supplier||recommended.get(ing.id)||'',120,true);
    if(/[\r\n\t]/.test(supplier))bad('供應商不得含換行');
    if(!batches.has(supplier))batches.set(supplier,[]);
    batches.get(supplier).push({ing,qty});
   }
   const groups=[];
   for(const [supplier,items] of batches){
    const number='POB-'+uuid().replace(/-/g,'').toUpperCase(),ids=[];
    for(let i=0;i<items.length;i++){
     const id=uuid();
     db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)')
      .run(id,number+'-'+String(i+1).padStart(3,'0'),x.location_id,items[i].ing.id,supplier,items[i].qty,u.id);
     ids.push(id);
    }
    audit(db,u,action,'purchase_orders',ids[0],x.location_id,{number,supplier,line_count:ids.length});
    groups.push({number,supplier,item_count:ids.length,ids});
   }
   return {groups};
  }
  if(action!=='order.batch-mark-sent')requiredRole(u,'manager');
  if(!GROUP.test(x.number||''))bad('單號格式不正確');
  const lines=db.prepare('SELECT * FROM purchase_orders WHERE number LIKE ? ORDER BY number').all(x.number+'-%').filter(r=>groupOf(r.number)===x.number);
  if(!lines.length)bad('找不到這張廠商叫貨單',404);
  scope(db,u,lines[0].location_id,action==='order.batch-mark-sent'?'staff':'manager');
  if(lines.some(r=>r.location_id!==lines[0].location_id||r.supplier!==lines[0].supplier))bad('單據明細異常',409);
  if(action==='order.batch-mark-sent'){
   if(u.role==='staff'&&lines.some(r=>r.created_by!==u.id))bad('僅可確認自己建立的叫貨單',403);
   if(lines.some(r=>r.status!=='approved'))bad('叫貨單尚未核准，無法登記已傳送',409);
   if(confirmedSent(db,x.number))bad('此單已有人記錄傳送確認，不能重複登記',409);
   audit(db,u,action,'purchase_orders',lines[0].id,lines[0].location_id,
    {number:x.number,supplier:lines[0].supplier,manual_confirmation:true,
     note:'僅代表操作者自行確認送出 LINE，並非 LINE 平台送達或已讀回執'});
   return {number:x.number,manual_confirmation:true};
  }
  const allowed=action==='order.batch-cancel'?['requested','approved']:[action==='order.batch-receive'?'approved':'requested'];
  if(lines.some(r=>!allowed.includes(r.status)))bad('此單已部分處理或狀態不符，拒絕重複操作',409);
  if(action==='order.batch-approve'){
   for(const r of lines)db.prepare("UPDATE purchase_orders SET status='approved',approved_by=? WHERE id=?").run(u.id,r.id);
  }else if(action==='order.batch-cancel'){
   for(const r of lines)db.prepare("UPDATE purchase_orders SET status='cancelled' WHERE id=?").run(r.id);
  }else{
   const prices=x.prices;
   if(prices!==undefined&&(!prices||typeof prices!=='object'||Array.isArray(prices)))bad('進價格式錯誤');
   if(prices&&Object.keys(prices).some(id=>!lines.some(l=>l.id===id)))bad('包含其他單據價格',400);
   for(const r of lines){
    move(db,u,{location_id:r.location_id,ingredient_id:r.ingredient_id,qty:r.qty,note:'多品項叫貨單 '+x.number},'purchase',r.id);
    const price=prices?.[r.id];
    if(price!==undefined){
     if(!price||typeof price!=='object'||Array.isArray(price))bad('品項進價格式錯誤');
     const result=pricing.recordPrice(db,u,{...price,location_id:r.location_id,ingredient_id:r.ingredient_id,supplier:r.supplier},'receiving',r.id);
     audit(db,u,'price.receiving','ingredient_prices',result.id,r.location_id,{reference_id:r.id,group_number:x.number});
    }
    db.prepare("UPDATE purchase_orders SET status='received',received_at=CURRENT_TIMESTAMP WHERE id=?").run(r.id);
   }
  }
  audit(db,u,action,'purchase_orders',lines[0].id,lines[0].location_id,{number:x.number,count:lines.length,supplier:lines[0].supplier});
  return {number:x.number,item_count:lines.length};
 });
}
function details(db,u,number,scope){
 if(!GROUP.test(number||''))bad('單號格式不正確');
 const data=db.prepare('SELECT o.*,i.name AS ingredient_name,i.unit,l.name AS location_name FROM purchase_orders o JOIN ingredients i ON i.id=o.ingredient_id JOIN locations l ON l.id=o.location_id WHERE o.number LIKE ? ORDER BY o.number')
  .all(number+'-%').filter(r=>groupOf(r.number)===number);
 if(!data.length)bad('找不到叫貨單',404);
 const first=data[0];
 scope(db,u,first.location_id);
 if(data.some(r=>r.location_id!==first.location_id||r.supplier!==first.supplier))bad('叫貨單資料異常',409);
 if(u.role==='staff'&&data.some(r=>r.created_by!==u.id))bad('無權查詢其他人叫貨單',403);
 return {number,supplier:first.supplier,location_id:first.location_id,location_name:first.location_name,created_at:first.created_at,
  rows:data,states:[...new Set(data.map(r=>r.status))],line_manual_confirmation:confirmedSent(db,number)};
}
module.exports={groupOf,suggestions,handle,details};
