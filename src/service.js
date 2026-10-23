'use strict';
const {uuid,hashPassword,cleanText,nonneg,requiredRole}=require('./security');
const {inTransaction}=require('./db');
const pricing=require('./pricing');
const bad=(msg,status=400)=>{const e=new Error(msg);e.status=status;throw e;};
const day=v=>{const s=cleanText(v,10,true);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(new Date(s+'T00:00:00Z').valueOf())||new Date(s+'T00:00:00Z').toISOString().slice(0,10)!==s)bad('日期格式需為 YYYY-MM-DD');return s;};
const time=v=>{const s=cleanText(v,5,true);if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(s))bad('時間格式錯誤');return s;};
const uid=v=>{if(typeof v!=='string'||!/^[0-9a-f-]{36}$/i.test(v))bad('識別碼格式不正確');return v;};
const canLocation=(db,u,lid)=>u.role==='owner'||!!db.prepare('SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?').get(u.id,lid);
function scope(db,u,locationId,level='staff'){
 if(level==='manager')requiredRole(u,'manager');
 uid(locationId);
 if(!db.prepare('SELECT 1 FROM locations WHERE id=? AND active=1').get(locationId))bad('找不到有效門市',404);
 if(!canLocation(db,u,locationId))bad('此門市無操作權限',403);
}
function hasLocationUser(db,userId,locationId){return !!db.prepare('SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?').get(userId,locationId);}
function activeUser(db,userId,locationId){const v=db.prepare('SELECT id,role FROM users WHERE id=? AND active=1').get(uid(userId));if(!v)bad('找不到有效員工',404);if(!hasLocationUser(db,userId,locationId))bad('員工不屬於該門市',400);return v;}
function exists(db,table,id){const allowed=['ingredients','training_courses','users'];if(!allowed.includes(table))bad('資料表不允許');const v=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(uid(id));if(!v)bad('指定資料不存在',404);return v;}
function audit(db,u,action,entity,entityId,locationId,detail={}){
 const safe=JSON.stringify(detail).slice(0,3000);
 db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) VALUES(?,?,?,?,?,?,?,?)').run(uuid(),u?.id||null,u?.username||'(anonymous)',action,entity,entityId||null,locationId||null,safe);
}
function rows(db,u,name){
 const priced=pricing.pricingRows(db,u,name);if(priced!==null)return priced;
 const read={
  locations:'SELECT id,name,active FROM locations ORDER BY name',
  staff_directory:`SELECT u.id,u.display_name,u.role,u.active,ul.location_id FROM users u JOIN user_locations ul ON ul.user_id=u.id`,
  users:`SELECT u.id,u.username,u.display_name,u.role,u.active,group_concat(l.name,'、') AS locations FROM users u LEFT JOIN user_locations ul ON ul.user_id=u.id LEFT JOIN locations l ON l.id=ul.location_id GROUP BY u.id ORDER BY u.role,u.display_name`,
  tasks:`SELECT t.*,u.display_name AS assigned_name,l.name AS location_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to JOIN locations l ON l.id=t.location_id ORDER BY t.created_at DESC LIMIT 500`,
  ingredients:`SELECT i.id,i.sku,i.name,i.unit,i.min_stock,i.active FROM ingredients i ORDER BY i.name`,
  stock:`SELECT i.id AS ingredient_id,i.sku,i.name,i.unit,i.min_stock,l.id AS location_id,l.name AS location_name,COALESCE(SUM(m.qty_delta),0) AS on_hand FROM ingredients i CROSS JOIN locations l LEFT JOIN stock_moves m ON m.ingredient_id=i.id AND m.location_id=l.id WHERE i.active=1 AND l.active=1 GROUP BY i.id,l.id ORDER BY l.name,i.name`,
  stock_moves:`SELECT m.*,i.name AS ingredient_name,l.name AS location_name FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id JOIN locations l ON l.id=m.location_id ORDER BY m.created_at DESC LIMIT 300`,
  purchase_orders:`SELECT o.*,i.name AS ingredient_name,i.unit,l.name AS location_name FROM purchase_orders o JOIN ingredients i ON i.id=o.ingredient_id JOIN locations l ON l.id=o.location_id ORDER BY o.created_at DESC LIMIT 500`,
  stocktakes:`SELECT s.*,i.name AS ingredient_name,l.name AS location_name FROM stocktakes s JOIN ingredients i ON i.id=s.ingredient_id JOIN locations l ON l.id=s.location_id ORDER BY s.created_at DESC LIMIT 500`,
  repairs:`SELECT r.*,l.name AS location_name,u.display_name AS assigned_name FROM repairs r JOIN locations l ON l.id=r.location_id LEFT JOIN users u ON u.id=r.assigned_to ORDER BY r.created_at DESC LIMIT 500`,
  shifts:`SELECT s.*,u.display_name AS staff_name,l.name AS location_name FROM shifts s JOIN users u ON u.id=s.user_id JOIN locations l ON l.id=s.location_id ORDER BY s.shift_date DESC,s.start_time LIMIT 500`,
  leave_requests:`SELECT r.*,u.display_name AS staff_name,l.name AS location_name FROM leave_requests r JOIN users u ON u.id=r.user_id JOIN locations l ON l.id=r.location_id ORDER BY r.created_at DESC LIMIT 500`,
  training_courses:'SELECT id,title,description,required_score,active FROM training_courses ORDER BY title',
  training_records:`SELECT r.*,c.title AS course_title,c.required_score,u.display_name AS staff_name,l.name AS location_name FROM training_records r JOIN training_courses c ON c.id=r.course_id JOIN users u ON u.id=r.user_id JOIN locations l ON l.id=r.location_id ORDER BY r.completed_on DESC,r.rowid DESC LIMIT 500`,
  evaluations:`SELECT e.*,u.display_name AS staff_name,l.name AS location_name FROM evaluations e JOIN users u ON u.id=e.user_id JOIN locations l ON l.id=e.location_id ORDER BY e.period DESC,e.created_at DESC LIMIT 500`,
  audit_logs:'SELECT a.id,a.at,a.actor_name,a.action,a.entity,a.entity_id,a.location_id,a.detail FROM audit_logs a ORDER BY a.at DESC,a.rowid DESC LIMIT 500'
 };
 if(!read[name])bad('不支援的資料分類',404);
 if(['users','audit_logs'].includes(name))requiredRole(u,'owner');
 let data=db.prepare(read[name]).all();
 if(u.role!=='owner'){
  const allowed=new Set(db.prepare('SELECT location_id FROM user_locations WHERE user_id=?').all(u.id).map(x=>x.location_id));
  if(name==='locations')data=data.filter(x=>allowed.has(x.id));
  else if(name==='stock')data=data.filter(x=>allowed.has(x.location_id));
  else if(name==='staff_directory')data=data.filter(x=>allowed.has(x.location_id));
  else if(name==='tasks') data=data.filter(x=>allowed.has(x.location_id) && (u.role==='manager'||x.assigned_to===u.id));
  else if(['purchase_orders','stock_moves','stocktakes','repairs','shifts','leave_requests','training_records','evaluations'].includes(name)) data=data.filter(x=>allowed.has(x.location_id) && (u.role==='manager'||name==='stock_moves'||name==='purchase_orders'&&x.created_by===u.id||name==='stocktakes'&&x.created_by===u.id||name==='repairs'&&x.created_by===u.id||name==='shifts'&&x.user_id===u.id||name==='leave_requests'&&x.user_id===u.id||name==='training_records'&&x.user_id===u.id||name==='evaluations'&&x.user_id===u.id));
 }
 return data;
}
function balance(db,ingredient,location){return Number(db.prepare('SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?').get(ingredient,location).n);}
function move(db,u,x,kind,reference){
 const ingredient=exists(db,'ingredients',x.ingredient_id);
 if(!ingredient.active)bad('食材已停用');
 scope(db,u,x.location_id,kind==='adjustment'?'manager':'staff');
 requiredRole(u,'manager');
 const raw=nonneg(x.qty,true), delta=kind==='usage'?-raw:kind==='adjustment'?Number(x.qty_delta):raw;
 if(!Number.isFinite(delta)||delta===0)bad('調整量不可為零');
 const next=balance(db,ingredient.id,x.location_id)+delta;
 if(next < -0.000001)bad('庫存不足，禁止負庫存',409);
 const id=uuid();
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)').run(id,ingredient.id,x.location_id,delta,kind,reference||null,cleanText(x.note||'',300),u.id);
 audit(db,u,'stock.'+kind,'stock_moves',id,x.location_id,{ingredient_id:ingredient.id,qty_delta:delta});return {id,on_hand:next};
}
function command(db,u,action,x={}){
 if(!x||typeof x!=='object'||Array.isArray(x))bad('資料格式錯誤');
 const priced=pricing.pricingCommand(db,u,action,x,audit);if(priced!==null)return priced;
 return inTransaction(db,()=>{
 let id=uuid(),l=x.location_id;
 switch(action){
 case 'location.create':{
  requiredRole(u,'owner');const name=cleanText(x.name,60,true);
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);audit(db,u,action,'locations',id,null,{name});return {id};
 }
 case 'user.create':{
  requiredRole(u,'owner');const name=cleanText(x.username,40,true),display=cleanText(x.display_name,80,true),role=cleanText(x.role,12,true);
  if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(name)||!['owner','manager','staff'].includes(role))bad('帳號或角色無效');
  scope(db,u,l);const ph=hashPassword(x.password);
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)').run(id,name,display,role,ph.salt,ph.hash);
  db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,l);
  audit(db,u,action,'users',id,l,{username:name,role});return {id};
 }
 case 'user.role':{
  requiredRole(u,'owner');const target=exists(db,'users',x.user_id),role=cleanText(x.role,12,true);
  if(!['owner','manager','staff'].includes(role)||target.id===u.id)bad('無法修改自身角色或指定無效角色');
  if(target.role==='owner'&&role!=='owner'&&db.prepare("SELECT count(*) AS n FROM users WHERE role='owner' AND active=1").get().n<=1)bad('不可移除最後一名業主');
  db.prepare('UPDATE users SET role=? WHERE id=?').run(role,target.id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  audit(db,u,action,'users',target.id,null,{from:target.role,to:role});return {id:target.id};
 }
 case 'user.active':{
  requiredRole(u,'owner');const target=exists(db,'users',x.user_id);if(target.id===u.id)bad('不可停用自己');
  if(target.role==='owner'&&Number(x.active)===0&&db.prepare("SELECT count(*) AS n FROM users WHERE role='owner' AND active=1").get().n<=1)bad('不可停用最後一名業主');
  const active=x.active===true?1:x.active===false?0:bad('active 需為布林值');db.prepare('UPDATE users SET active=? WHERE id=?').run(active,target.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  audit(db,u,action,'users',target.id,null,{active});return {id:target.id};
 }
 case 'user.password':{
  const target=exists(db,'users',x.user_id);if(u.role!=='owner'&&target.id!==u.id)bad('權限不足',403);
  const ph=hashPassword(x.password);db.prepare('UPDATE users SET password_salt=?,password_hash=? WHERE id=?').run(ph.salt,ph.hash,target.id);db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);
  audit(db,u,action,'users',target.id,null,{password_changed:true});return {id:target.id};
 }
 case 'user.assign-location':{
  requiredRole(u,'owner');const target=exists(db,'users',x.user_id);scope(db,u,l);
  db.prepare('INSERT OR IGNORE INTO user_locations(user_id,location_id) VALUES(?,?)').run(target.id,l);
  audit(db,u,action,'user_locations',target.id,l,{});return {id:target.id};
 }
 case 'task.create':{
  scope(db,u,l,'manager');const title=cleanText(x.title,120,true),assign=x.assigned_to?uid(x.assigned_to):null;
  if(assign)activeUser(db,assign,l);
  db.prepare('INSERT INTO tasks(id,location_id,title,due_date,assigned_to,description,created_by) VALUES(?,?,?,?,?,?,?)').run(id,l,title,x.due_date?day(x.due_date):null,assign,cleanText(x.description||'',1000),u.id);
  audit(db,u,action,'tasks',id,l,{title});return {id};
 }
 case 'task.status':{
  const t=db.prepare('SELECT * FROM tasks WHERE id=?').get(uid(x.id));if(!t)bad('找不到工作',404);scope(db,u,t.location_id);
  if(u.role==='staff'&&t.assigned_to!==u.id)bad('只能更新分派給自己的工作',403);
  if(!['todo','doing','done'].includes(x.status))bad('不支援的狀態');db.prepare('UPDATE tasks SET status=? WHERE id=?').run(x.status,t.id);
  audit(db,u,action,'tasks',t.id,t.location_id,{status:x.status});return {id:t.id};
 }
 case 'ingredient.create':{
  requiredRole(u,'manager');const sku=cleanText(x.sku,40,true),name=cleanText(x.name,120,true),unit=cleanText(x.unit,20,true),minimum=nonneg(x.min_stock??0);
  db.prepare('INSERT INTO ingredients(id,sku,name,unit,min_stock) VALUES(?,?,?,?,?)').run(id,sku,name,unit,minimum);
  audit(db,u,action,'ingredients',id,null,{sku,name,unit,min_stock:minimum});return {id};
 }
 case 'stock.purchase':case 'stock.usage':{
  const moved=move(db,u,{...x,qty:x.qty},action.slice(6),null);
  if(action==='stock.purchase'&&x.unit_price_twd!==undefined){
   const p=pricing.recordPrice(db,u,{location_id:x.location_id,ingredient_id:x.ingredient_id,unit:x.price_unit,unit_price_twd:x.unit_price_twd,price_date:x.price_date,supplier:x.supplier},'direct_purchase',moved.id);
   audit(db,u,'price.direct_purchase','ingredient_prices',p.id,x.location_id,{reference_id:moved.id});
  }
  return moved;
 }
 case 'order.create':{
  scope(db,u,l);exists(db,'ingredients',x.ingredient_id);
  const qty=nonneg(x.qty,true),supplier=cleanText(x.supplier,120,true),number='PO-'+Date.now().toString(36).toUpperCase()+'-'+id.slice(0,6).toUpperCase();
  db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)').run(id,number,l,x.ingredient_id,supplier,qty,u.id);
  audit(db,u,action,'purchase_orders',id,l,{number,ingredient_id:x.ingredient_id,qty});return {id,number};
 }
 case 'order.approve':case 'order.receive':case 'order.cancel':{
  const o=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(uid(x.id));if(!o)bad('找不到叫貨單',404);
  scope(db,u,o.location_id,'manager');
  if(action==='order.approve'&&o.status==='requested'){
   db.prepare("UPDATE purchase_orders SET status='approved',approved_by=? WHERE id=?").run(u.id,o.id);
  }else if(action==='order.receive'&&o.status==='approved'){
   move(db,u,{location_id:o.location_id,ingredient_id:o.ingredient_id,qty:o.qty,note:'叫貨單 '+o.number},'purchase',o.id);
   if(x.unit_price_twd!==undefined){
    const p=pricing.recordPrice(db,u,{location_id:o.location_id,ingredient_id:o.ingredient_id,unit:x.price_unit,unit_price_twd:x.unit_price_twd,price_date:x.price_date,supplier:o.supplier},'receiving',o.id);
    audit(db,u,'price.receiving','ingredient_prices',p.id,o.location_id,{reference_id:o.id});
   }
   db.prepare("UPDATE purchase_orders SET status='received',received_at=CURRENT_TIMESTAMP WHERE id=?").run(o.id);
  }else if(action==='order.cancel'&&['requested','approved'].includes(o.status)){
   db.prepare("UPDATE purchase_orders SET status='cancelled' WHERE id=?").run(o.id);
  }else bad('不合法的狀態轉換',409);
  audit(db,u,action,'purchase_orders',o.id,o.location_id,{from:o.status});return {id:o.id};
 }
 case 'stocktake.create':{
  scope(db,u,l);exists(db,'ingredients',x.ingredient_id);const counted=nonneg(x.counted_qty),expected=balance(db,x.ingredient_id,l);
  db.prepare('INSERT INTO stocktakes(id,location_id,ingredient_id,expected_qty,counted_qty,created_by) VALUES(?,?,?,?,?,?)').run(id,l,x.ingredient_id,expected,counted,u.id);
  audit(db,u,action,'stocktakes',id,l,{expected,counted});return {id};
 }
 case 'stocktake.confirm':{
  const t=db.prepare('SELECT * FROM stocktakes WHERE id=?').get(uid(x.id));if(!t)bad('找不到盤點紀錄',404);scope(db,u,t.location_id,'manager');if(t.status!=='pending')bad('已確認的盤點不能重複入帳',409);
  const current=balance(db,t.ingredient_id,t.location_id);if(Math.abs(current-t.expected_qty)>0.000001)bad('盤點後庫存已異動，請重新盤點',409);
  const delta=t.counted_qty-current;
  if(Math.abs(delta)>0.000001){ const mid=uuid();db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) VALUES(?,?,?,?,?,?,?,?)').run(mid,t.ingredient_id,t.location_id,delta,'adjustment',t.id,'盤點確認',u.id); }
  db.prepare("UPDATE stocktakes SET status='confirmed',confirmed_by=? WHERE id=?").run(u.id,t.id);
  audit(db,u,action,'stocktakes',t.id,t.location_id,{delta});return {id:t.id,delta};
 }
 case 'repair.create':{
  scope(db,u,l);const equipment=cleanText(x.equipment,120,true),description=cleanText(x.description,1000,true);
  db.prepare('INSERT INTO repairs(id,location_id,equipment,description,created_by) VALUES(?,?,?,?,?)').run(id,l,equipment,description,u.id);
  audit(db,u,action,'repairs',id,l,{equipment});return {id};
 }
 case 'repair.status':{
  const r=db.prepare('SELECT * FROM repairs WHERE id=?').get(uid(x.id));if(!r)bad('找不到報修',404);scope(db,u,r.location_id,'manager');
  if(!['assigned','closed'].includes(x.status))bad('狀態錯誤');const assigned=x.assigned_to?uid(x.assigned_to):null;if(assigned)activeUser(db,assigned,r.location_id);
  db.prepare('UPDATE repairs SET status=?,assigned_to=? WHERE id=?').run(x.status,assigned,r.id);audit(db,u,action,'repairs',r.id,r.location_id,{status:x.status});return {id:r.id};
 }
 case 'shift.create':{
  scope(db,u,l,'manager');activeUser(db,x.user_id,l);
  const sd=day(x.shift_date),start=time(x.start_time),end=time(x.end_time);if(start>=end)bad('目前排班需在同日結束（跨日班待擴充）');
  const overlap=db.prepare('SELECT 1 FROM shifts WHERE user_id=? AND shift_date=? AND start_time<? AND end_time>?').get(x.user_id,sd,end,start);
  if(overlap)bad('員工同一天已有時間重疊班表',409);
  db.prepare('INSERT INTO shifts(id,location_id,user_id,shift_date,start_time,end_time,note,created_by) VALUES(?,?,?,?,?,?,?,?)').run(id,l,x.user_id,sd,start,end,cleanText(x.note||'',200),u.id);
  audit(db,u,action,'shifts',id,l,{user_id:x.user_id,shift_date:sd,start,end});return {id};
 }
 case 'leave.create':{
  scope(db,u,l);const target=x.user_id&&u.role!=='staff'?uid(x.user_id):u.id;activeUser(db,target,l);
  const from=day(x.start_date),to=day(x.end_date);if(from>to)bad('結束日不可早於起始日');
  db.prepare('INSERT INTO leave_requests(id,user_id,location_id,start_date,end_date,reason) VALUES(?,?,?,?,?,?)').run(id,target,l,from,to,cleanText(x.reason,400,true));
  audit(db,u,action,'leave_requests',id,l,{user_id:target,from,to});return {id};
 }
 case 'leave.review':{
  const r=db.prepare('SELECT * FROM leave_requests WHERE id=?').get(uid(x.id));if(!r)bad('找不到請假單',404);scope(db,u,r.location_id,'manager');
  if(r.status!=='pending'||!['approved','rejected'].includes(x.status))bad('不合法的審核狀態',409);
  if(r.user_id===u.id)bad('不得核准自己的請假',403);
  db.prepare('UPDATE leave_requests SET status=?,reviewer_id=? WHERE id=?').run(x.status,u.id,r.id);audit(db,u,action,'leave_requests',r.id,r.location_id,{status:x.status});return {id:r.id};
 }
 case 'course.create':{
  requiredRole(u,'manager');const title=cleanText(x.title,150,true),description=cleanText(x.description||'',1200),score=nonneg(x.required_score??80);if(score>100)bad('及格分數需小於 100');
  db.prepare('INSERT INTO training_courses(id,title,description,required_score) VALUES(?,?,?,?)').run(id,title,description,score);
  audit(db,u,action,'training_courses',id,null,{title});return {id};
 }
 case 'training.assign':{
  scope(db,u,l,'manager');activeUser(db,x.user_id,l);exists(db,'training_courses',x.course_id);
  db.prepare('INSERT INTO training_records(id,course_id,user_id,location_id) VALUES(?,?,?,?)').run(id,x.course_id,x.user_id,l);
  audit(db,u,action,'training_records',id,l,{user_id:x.user_id,course_id:x.course_id});return {id};
 }
 case 'training.score':{
  const t=db.prepare('SELECT * FROM training_records WHERE id=?').get(uid(x.id));if(!t)bad('找不到訓練紀錄',404);scope(db,u,t.location_id,'manager');
  const score=nonneg(x.score);if(score>100)bad('分數範圍為 0–100');
  db.prepare('UPDATE training_records SET score=?,completed_on=?,assessor_id=? WHERE id=?').run(score,day(x.completed_on),u.id,t.id);
  audit(db,u,action,'training_records',t.id,t.location_id,{score});return {id:t.id};
 }
 case 'evaluation.create':{
  scope(db,u,l,'manager');activeUser(db,x.user_id,l);const score=nonneg(x.score);if(score>100)bad('分數範圍為 0–100');
  db.prepare('INSERT INTO evaluations(id,user_id,location_id,period,score,feedback,reviewer_id) VALUES(?,?,?,?,?,?,?)').run(id,x.user_id,l,cleanText(x.period,30,true),score,cleanText(x.feedback||'',1000),u.id);
  audit(db,u,action,'evaluations',id,l,{user_id:x.user_id,period:x.period,score});return {id};
 }
 default:bad('不支援的操作',404);
 }
 });
}
function overview(db,u){const own=rows(db,u,'tasks'),stock=rows(db,u,'stock'),repairs=rows(db,u,'repairs'),orders=rows(db,u,'purchase_orders'),training=rows(db,u,'training_records');
 return {todo:own.filter(x=>x.status!=='done').length,late:own.filter(x=>x.due_date&&x.due_date<new Date().toISOString().slice(0,10)&&x.status!=='done').length,low:stock.filter(x=>x.on_hand<x.min_stock).length,orders:orders.filter(x=>x.status==='requested').length,repairs:repairs.filter(x=>x.status!=='closed').length,trainingPending:training.filter(x=>x.score===null).length};}
module.exports={rows,command,overview,audit,scope,balance};
