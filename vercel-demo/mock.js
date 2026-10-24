/* PUBLIC DEMO ONLY — synthetic in-browser records. Never handles real authentication or a database. */
'use strict';
(function(){
 const key='restaurant-public-demo-v1';
 const now=new Date();
 const day=(offset)=>{const d=new Date(now);d.setDate(d.getDate()+offset);return d.toLocaleDateString('sv-SE');};
  const createdAt=()=>new Date().toLocaleDateString('sv-SE')+' '+new Date().toLocaleTimeString('en-GB',{hour12:false});
 const locs=[{id:'l1',name:'台北示範店',active:1},{id:'l2',name:'新北示範店',active:1}];
 const users=[{id:'u1',username:'demo-owner',display_name:'展示業主',role:'owner',locations:'全部門市',active:1},
 {id:'u2',username:'demo-manager',display_name:'示範主管',role:'manager',locations:'台北示範店',active:1},
 {id:'u3',username:'demo-staff-a',display_name:'示範員工甲',role:'staff',locations:'台北示範店',active:1},
 {id:'u4',username:'demo-staff-b',display_name:'示範員工乙',role:'staff',locations:'新北示範店',active:1}];
 const ingredients=[
 {id:'i1',sku:'FR-001',name:'牛番茄',unit:'公斤',min_stock:8},
 {id:'i2',sku:'FR-002',name:'雞胸肉',unit:'公斤',min_stock:12},
 {id:'i3',sku:'FR-003',name:'生菜',unit:'公斤',min_stock:6},
 {id:'i4',sku:'FR-004',name:'雞蛋',unit:'顆',min_stock:50}];
 const initial={
 locations:locs,users:users,ingredients:ingredients,
 stock:[
 {id:'s1',location_id:'l1',location_name:'台北示範店',ingredient_id:'i1',name:'牛番茄',on_hand:6,min_stock:8,unit:'公斤'},
 {id:'s2',location_id:'l1',location_name:'台北示範店',ingredient_id:'i2',name:'雞胸肉',on_hand:20,min_stock:12,unit:'公斤'},
 {id:'s3',location_id:'l1',location_name:'台北示範店',ingredient_id:'i3',name:'生菜',on_hand:4,min_stock:6,unit:'公斤'},
 {id:'s4',location_id:'l2',location_name:'新北示範店',ingredient_id:'i4',name:'雞蛋',on_hand:90,min_stock:50,unit:'顆'}],
 tasks:[
 {id:'t1',title:'確認冷藏庫溫度',location_id:'l1',location_name:'台北示範店',assigned_to:'u3',assigned_name:'示範員工甲',due_date:day(0),status:'todo',description:'開店前檢查'},
 {id:'t2',title:'確認晚班清潔檢核表',location_id:'l1',location_name:'台北示範店',assigned_to:'u2',assigned_name:'示範主管',due_date:day(-1),status:'doing'},
 {id:'t3',title:'檢查設備保養紀錄',location_id:'l2',location_name:'新北示範店',assigned_to:'u4',assigned_name:'示範員工乙',due_date:day(1),status:'done'}],
 purchase_orders:[
 {id:'o1',number:'PO-DEMO-001',location_id:'l1',location_name:'台北示範店',ingredient_id:'i1',ingredient_name:'牛番茄',supplier:'示範蔬果商',qty:18,status:'requested',created_at:day(-2)+' 09:00'},
 {id:'o2',number:'PO-DEMO-002',location_id:'l1',location_name:'台北示範店',ingredient_id:'i3',ingredient_name:'生菜',supplier:'示範生鮮商',qty:10,status:'approved',created_at:day(-1)+' 11:00'}],
 stocktakes:[{id:'c1',location_id:'l1',location_name:'台北示範店',ingredient_id:'i2',ingredient_name:'雞胸肉',expected_qty:20,counted_qty:19,status:'pending',created_at:day(-1)+' 15:00'}],
 stock_moves:[{id:'m1',created_at:day(0)+' 08:30',location_name:'台北示範店',ingredient_name:'牛番茄',move_type:'purchase',qty_delta:6,note:'展示資料'}],
 repairs:[{id:'r1',location_id:'l1',location_name:'台北示範店',equipment:'冷藏展示櫃',description:'溫度顯示異常',assigned_name:'示範主管',status:'reported',created_at:day(-2)+' 12:00'},
 {id:'r2',location_id:'l2',location_name:'新北示範店',equipment:'洗碗機',description:'排水異音',status:'assigned',created_at:day(-1)+' 10:00'}],
 shifts:[{id:'sh1',shift_date:day(0),start_time:'09:00',end_time:'17:00',user_id:'u3',staff_name:'示範員工甲',location_id:'l1',location_name:'台北示範店',note:'早班'},
 {id:'sh2',shift_date:day(0),start_time:'12:00',end_time:'20:00',user_id:'u4',staff_name:'示範員工乙',location_id:'l2',location_name:'新北示範店',note:'晚班'}],
 leave_requests:[{id:'leave1',user_id:'u3',staff_name:'示範員工甲',location_id:'l1',location_name:'台北示範店',start_date:day(5),end_date:day(5),reason:'個人事務（虛構）',status:'pending'}],
 training_courses:[{id:'tr1',title:'食品衛生安全 SOP',description:'溫度與交叉污染預防',required_score:80},
 {id:'tr2',title:'新進員工服務禮儀',description:'點餐與顧客服務流程',required_score:85}],
 training_records:[{id:'trr1',course_id:'tr1',course_title:'食品衛生安全 SOP',user_id:'u3',staff_name:'示範員工甲',location_id:'l1',location_name:'台北示範店',score:null,completed_on:null}],
 evaluations:[{id:'ev1',user_id:'u3',staff_name:'示範員工甲',location_id:'l1',location_name:'台北示範店',period:'2026-10',score:88,feedback:'虛構考核範例'}],
 audit_logs:[{id:'a1',at:day(0)+' 09:00',actor_name:'展示業主',action:'demo.login_sample',entity:'demo',entity_id:'—',ip_address:'192.0.2.20',detail:'{"sample":true,"source_ip":"192.0.2.20"}'}]
 };
 const copy=x=>JSON.parse(JSON.stringify(x));
 let db;
 try{const saved=sessionStorage.getItem(key);db=saved?JSON.parse(saved):copy(initial);}catch{db=copy(initial);}
 if(!db||!Array.isArray(db.tasks)||!Array.isArray(db.stock))db=copy(initial);
  // Old sessionStorage examples predate report dates. Add synthetic metadata
  // without discarding existing mock business edits or overwriting timestamps.
  for(const group of ['purchase_orders','stocktakes','repairs']){
   if(Array.isArray(db[group]))for(const record of db[group]){
    if(!record.created_at)record.created_at=createdAt();
   }
  }
 const orders=window.RestaurantDemoOrders;
 if(!orders)throw Error('缺少虛構廠商分單模組');
 const pricing=window.RestaurantDemoPricing;
 if(!pricing)throw Error('公開示範價格模組載入失敗');
 pricing.seed(db);
 const backups=window.RestaurantDemoBackup;
 if(!backups)throw Error('缺少公開示範備份模組');
 backups.seed(db);
 const save=()=>{try{sessionStorage.setItem(key,JSON.stringify(db));}catch{}};
 const makeId=()=>('demo-'+Date.now()+'-'+Math.random().toString(36).slice(2,8));
 const lookup=(group,id)=>db[group].find(x=>String(x.id)===String(id));
 const lName=id=>lookup('locations',id)?.name||'示範門市';
 const iName=id=>lookup('ingredients',id)?.name||'示範食材';
 const uName=id=>lookup('users',id)?.display_name||'示範員工';
 const log=(action,entity,id)=>{db.audit_logs.unshift({id:makeId(),at:new Date().toLocaleString('zh-TW'),actor_name:'展示業主',action:'demo.'+action,entity,entity_id:id,ip_address:'192.0.2.20',detail:'{"demo":true,"source_ip":"192.0.2.20"}'});};
 const stockFor=(location_id,ingredient_id)=>db.stock.find(x=>x.location_id===location_id&&x.ingredient_id===ingredient_id);
 function changeStock(location_id,ingredient_id,delta,type,note){
  const ing=lookup('ingredients',ingredient_id);
  if(!ing)throw Error('請選擇食材');
  let item=stockFor(location_id,ingredient_id);
  if(!item){item={id:makeId(),location_id,location_name:lName(location_id),ingredient_id,name:ing.name,unit:ing.unit,min_stock:Number(ing.min_stock),on_hand:0};db.stock.push(item);}
  const next=Number(item.on_hand)+Number(delta);
  if(!Number.isFinite(next)||next<0)throw Error('展示庫存不足或數量無效');
  item.on_hand=next;
  db.stock_moves.unshift({id:makeId(),created_at:new Date().toLocaleString('zh-TW'),location_name:lName(location_id),ingredient_name:ing.name,move_type:type,qty_delta:Number(delta),note:note||'瀏覽器示範'});
 }
 const overview=()=>({
  todo:db.tasks.filter(x=>x.status!=='done').length,
  late:db.tasks.filter(x=>x.status!=='done'&&x.due_date&&x.due_date<day(0)).length,
  low:db.stock.filter(x=>Number(x.on_hand)<Number(x.min_stock)).length,
  orders:db.purchase_orders.filter(x=>x.status==='requested').length,
  repairs:db.repairs.filter(x=>x.status!=='closed').length,
  trainingPending:db.training_records.filter(x=>x.score===null).length
 });
 const enrich=(entity,rows)=>{
  if(entity==='staff_directory')return db.users.map(x=>({id:x.id,display_name:x.display_name,role:x.role,active:x.active}));
  if(entity==='purchase_supplier_suggestions')return orders.suppliers(db);
  if(entity==='purchase_orders')return rows.map(r=>({...r,group_number:orders.groupOf(r.number)}));
  const projected=pricing.rows(db,entity);if(projected)return projected;
  return rows;
 };
 function command(action,d){
  if(action.startsWith('order.batch-')){const out=orders.command(db,action,d,{makeId,changeStock,log});save();return out;}
  if(action.startsWith('user.'))throw Error('展示版不提供真實帳號、角色及密碼操作');
  if(['price.record','dish.create','dish.price','recipe.set'].includes(action)){
   const out=pricing.handle(db,action,d,makeId());
   log(action,'pricing',out.id);save();return out;
  }
  if(action==='stock.purchase')throw Error('必須先核准叫貨單，不能直接進貨入庫');
  if(action==='stock.opening'){
   const q=Number(d.qty);
   if(!Number.isFinite(q)||q<=0)throw Error('期初庫存數量須大於零');
   if(stockFor(d.location_id,d.ingredient_id))throw Error('已有庫存資料，不能重複建立期初庫存');
   if(!lookup('locations',d.location_id))throw Error('無效門市');
   changeStock(d.location_id,d.ingredient_id,q,'adjustment','期初庫存：'+String(d.note||'示範資料'));
   log(action,'stock_moves',d.ingredient_id);save();return {ok:true};
  }
  const defs={
   'location.create':'locations','task.create':'tasks','ingredient.create':'ingredients','order.create':'purchase_orders',
   'stocktake.create':'stocktakes','repair.create':'repairs','shift.create':'shifts','leave.create':'leave_requests',
   'course.create':'training_courses','training.assign':'training_records','evaluation.create':'evaluations'
  };
  if(defs[action]){
   const group=defs[action],r={...d,id:makeId(),created_at:createdAt()};
   if(r.location_id)r.location_name=lName(r.location_id);
   if(r.ingredient_id){r.ingredient_name=iName(r.ingredient_id);if(group==='stocktakes'){r.expected_qty=stockFor(r.location_id,r.ingredient_id)?.on_hand||0;r.status='pending';}}
   if(r.user_id){r.staff_name=uName(r.user_id);}
   if(r.assigned_to)r.assigned_name=uName(r.assigned_to);
   if(group==='purchase_orders'){r.number='PO-DEMO-'+String(db[group].length+1).padStart(3,'0');r.status='requested';r.qty=Number(r.qty);}
   if(group==='tasks')r.status='todo';
   if(group==='repairs')r.status='reported';
   if(group==='leave_requests')r.status='pending';
   if(group==='training_records'){r.course_title=lookup('training_courses',r.course_id)?.title||'示範課程';r.score=null;r.completed_on=null;}
   if(group==='ingredients')r.min_stock=Number(r.min_stock);
   if(group==='locations')r.active=1;
   db[group].unshift(r);log(action,group,r.id);save();return r;
  }
  if(action==='stock.usage'){
   const q=Number(d.qty);if(!Number.isFinite(q)||q<=0)throw Error('數量必須大於 0');
   changeStock(d.location_id,d.ingredient_id,-q,'usage',d.note);
  }else{
   const groups={'task.status':'tasks','order.approve':'purchase_orders','order.receive':'purchase_orders','order.cancel':'purchase_orders',
    'stocktake.confirm':'stocktakes','repair.status':'repairs','leave.review':'leave_requests','training.score':'training_records'};
   const group=groups[action];if(!group)throw Error('這個展示操作尚未提供');
   const row=lookup(group,d.id);if(!row)throw Error('找不到示範資料');
    if(group==='purchase_orders'&&orders.groupOf(row.number)!==row.number)throw Error('多品項叫貨須整張處理');
   if(action==='order.approve'){if(row.status!=='requested')throw Error('狀態已變更');row.status='approved';}
   if(action==='order.receive'){
    if(row.status!=='approved')throw Error('請先核准叫貨');
    const ing=lookup('ingredients',row.ingredient_id);
    // Validate price before stock changes; the demo is synchronous and saves as one state.
    const price=d.unit_price_twd===undefined?null:pricing.makePrice(db,{
     ...d,ingredient_id:row.ingredient_id,location_id:row.location_id,
     unit:d.unit||ing.unit,supplier:d.supplier||row.supplier
    },makeId(),'purchase');
    changeStock(row.location_id,row.ingredient_id,Number(row.qty),'purchase','示範叫貨驗收 '+row.number);
    if(price)db.ingredient_prices.push(price);
    row.status='received';
   }
   if(action==='order.cancel'){if(!['requested','approved'].includes(row.status))throw Error('狀態已變更');row.status='cancelled';}
   if(action==='stocktake.confirm'){if(row.status!=='pending')throw Error('已確認盤點');const current=stockFor(row.location_id,row.ingredient_id)?.on_hand||0;if(Number(current)!==Number(row.expected_qty))throw Error('盤點過期，請重新盤點');const diff=Number(row.counted_qty)-Number(current);if(diff)changeStock(row.location_id,row.ingredient_id,diff,'adjustment','示範盤點調整');row.status='confirmed';}
   if(action==='task.status'||action==='repair.status'||action==='leave.review')row.status=d.status;
   if(action==='training.score'){row.score=Number(d.score);row.completed_on=d.completed_on||day(0);}
  }
  log(action,'demo',d.id||null);save();return {ok:true};
 }
 const nativeFetch=window.fetch.bind(window);
 window.fetch=async function(input,options){
  const url=new URL(typeof input==='string'?input:input.url,location.href);
  if(!url.pathname.startsWith('/api/'))return nativeFetch(input,options);
  const method=(options&&options.method||'GET').toUpperCase();
  let result,status=200;
  try{
   if(url.pathname==='/api/demo-backups'){
     if(method==='GET')result=backups.status(db);
     else if(method==='POST'){const b=JSON.parse(options?.body||'{}');result=backups.command(db,b.action,b);save();}
     else result={error:'不支援的展示方法'},status=405;
    }
    else if(url.pathname==='/api/me')result={user:{id:'u1',username:'demo-owner',display_name:'展示業主',role:'owner',locations:['l1','l2']},csrf:'demo-only'};
   else if(url.pathname==='/api/overview')result={overview:overview()};
   else if(url.pathname==='/api/data'){const entity=url.searchParams.get('entity');result={rows:copy(enrich(entity,entity==='staff_directory'?[]:(db[entity]||[])))};}
   else if(url.pathname==='/api/order-batch'&&method==='GET')result=orders.detail(db,url.searchParams.get('number'));
    else if(url.pathname==='/api/command'&&method==='POST'){const body=JSON.parse(options.body);result={ok:true,result:command(body.action,body.data||{})};}
   else if(url.pathname==='/api/logout')result={ok:true};
   else if(url.pathname==='/api/login')result={error:'展示模式沒有真實帳號登入'} ,status=403;
   else result={error:'展示路由不存在'},status=404;
  }catch(e){status=400;result={error:e.message||'示範操作失敗'};}
  return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
 };
 window.restaurantDemoReset=function(){try{sessionStorage.removeItem(key);}catch{}location.reload();};
})();