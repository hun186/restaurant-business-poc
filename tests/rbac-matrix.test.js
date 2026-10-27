'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {openDb}=require('../src/db');
const {command,rows,balance,overview,scope}=require('../src/service');
const {details}=require('../src/order-batches');
const {fingerprint}=require('../src/backup-manager');
const {makeHandler}=require('../server');
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-rbac-'));
 const {db,bootstrapPassword}=openDb(dir);
 t.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
 const owner=db.prepare("SELECT id,username,role FROM users WHERE role='owner'").get();
 const a=db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 const b=command(db,owner,'location.create',{name:'隔離測試分店'}).id;
 function user(role,username,loc){const id=command(db,owner,'user.create',{username,display_name:username,role,password:'test-password-234',location_id:loc}).id;return {id,username,role};}
 const ma=user('manager','scope-ma',a),mb=user('manager','scope-mb',b);
 const sa=user('staff','scope-sa',a),sa2=user('staff','scope-sa2',a),sb=user('staff','scope-sb',b);
 const ingredient=command(db,owner,'ingredient.create',{sku:'RBAC-ING',name:'測試食材',unit:'公斤',min_stock:1}).id;
 const course=command(db,owner,'course.create',{title:'隔離測試課程',required_score:80}).id;
 const dish=command(db,owner,'dish.create',{name:'測試菜品',sale_price_twd:'120'}).id;
 const recipe=command(db,owner,'recipe.set',{dish_id:dish,ingredient_id:ingredient,qty:1,unit:'公斤'}).id;
 const refs=new Map();
 for(const [who,loc] of [[sa,a],[sa2,a],[sb,b]]){
  const call=(name,data)=>command(db,who,name,data);
  const item={location:loc,user:who};
  item.task=command(db,owner,'task.create',{location_id:loc,title:'專屬工作',assigned_to:who.id}).id;
  item.order=call('order.create',{location_id:loc,ingredient_id:ingredient,qty:2,supplier:'測試供應商'}).id;
  item.stocktake=call('stocktake.create',{location_id:loc,ingredient_id:ingredient,counted_qty:1}).id;
  item.repair=call('repair.create',{location_id:loc,equipment:'冷藏設備',description:'異常'}).id;
  item.shift=command(db,owner,'shift.create',{location_id:loc,user_id:who.id,shift_date:'2026-11-01',start_time:'09:00',end_time:'17:00'}).id;
  item.leave=call('leave.create',{location_id:loc,start_date:'2026-11-02',end_date:'2026-11-03',reason:'休假'}).id;
  item.training=command(db,owner,'training.assign',{location_id:loc,user_id:who.id,course_id:course}).id;
  item.evaluation=command(db,owner,'evaluation.create',{location_id:loc,user_id:who.id,period:'2026-10',score:90}).id;
  refs.set(who.id,item);
 }
 for(const [loc,supplier] of [[a,'A供應商'],[b,'B供應商']]){
  command(db,owner,'stock.opening',{location_id:loc,ingredient_id:ingredient,qty:10,note:'權限測試'});
  command(db,owner,'price.record',{location_id:loc,ingredient_id:ingredient,unit_price_twd:'90',price_date:'2020-01-01',supplier});
 }
 return {db,owner,bootstrapPassword,a,b,ma,mb,sa,sa2,sb,ingredient,course,dish,recipe,refs};
}
const write=(f,u,action,data)=>command(f.db,u,action,data);
const auditCount=f=>f.db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get().n;
test('RB-003 read matrix: owner across stores, manager assigned store, staff assigned self',t=>{
 const f=fixture(t);
 const personal=['tasks','purchase_orders','stocktakes','repairs','shifts','leave_requests','training_records','evaluations'];
 for(const entity of personal){
  const ownerRows=rows(f.db,f.owner,entity),managerRows=rows(f.db,f.ma,entity),staffRows=rows(f.db,f.sa,entity);
  assert.equal(ownerRows.length,3,entity+' owner all stores');
  assert.equal(managerRows.length,2,entity+' manager only assigned store');
  assert.equal(staffRows.length,1,entity+' staff only own rows');
  assert.equal(managerRows.every(r=>r.location_id===f.a),true,entity+' manager location');
  assert.equal(staffRows[0].location_id,f.a,entity+' staff location');
  assert.equal(staffRows[0].id,f.refs.get(f.sa.id)[{
   tasks:'task',purchase_orders:'order',stocktakes:'stocktake',repairs:'repair',shifts:'shift',
   leave_requests:'leave',training_records:'training',evaluations:'evaluation'
  }[entity]],entity+' staff own id');
 }
 for(const entity of ['locations','stock','stock_moves','inventory_values','ingredient_prices','staff_directory','purchase_supplier_suggestions']){
  const visible=rows(f.db,f.ma,entity);
  const scoped=entity==='locations'?'id':'location_id';
  assert.ok(visible.length>0,entity+' exists');
  assert.ok(visible.every(x=>x[scoped]===f.a),entity+' manager may not read other store');
 }
 for(const entity of ['users','audit_logs']){
  assert.throws(()=>rows(f.db,f.ma,entity),{status:403});
  assert.throws(()=>rows(f.db,f.sa,entity),{status:403});
  assert.ok(rows(f.db,f.owner,entity).length>0,entity+' owner can read');
 }
 assert.throws(()=>rows(f.db,f.sa,'dish_costs'),{status:403});
 assert.throws(()=>rows(f.db,f.sa,'menu_dishes'),{status:403});
 assert.equal(rows(f.db,f.ma,'dish_costs').every(x=>x.location_id===f.a),true);
 assert.equal(overview(f.db,f.sa).orders,1);
 assert.equal(overview(f.db,f.ma).orders,2);
 assert.equal(overview(f.db,f.owner).orders,3);
});
test('RB-003 cross-store writes and batch details deny manager without changing ledger/audit',t=>{
 const f=fixture(t),foreign=f.refs.get(f.sb.id);
 const group=write(f,f.sb,'order.batch-create',{location_id:f.b,items:[{ingredient_id:f.ingredient,qty:1,supplier:'其他店商家'}]}).groups[0].number;
 const denied=[
  ['task.status',{id:foreign.task,status:'done'}],
  ['order.approve',{id:foreign.order}],
  ['stocktake.confirm',{id:foreign.stocktake}],
  ['repair.status',{id:foreign.repair,status:'closed'}],
  ['leave.review',{id:foreign.leave,status:'approved'}],
  ['training.score',{id:foreign.training,score:95,completed_on:'2026-11-04'}],
  ['shift.create',{location_id:f.b,user_id:f.sb.id,shift_date:'2026-11-05',start_time:'09:00',end_time:'17:00'}],
  ['evaluation.create',{location_id:f.b,user_id:f.sb.id,period:'2026-11',score:90}],
  ['stock.usage',{location_id:f.b,ingredient_id:f.ingredient,qty:1}],
  ['price.record',{location_id:f.b,ingredient_id:f.ingredient,unit_price_twd:'88'}],
  ['order.batch-approve',{number:group}],
  ['order.batch-create',{location_id:f.b,items:[{ingredient_id:f.ingredient,qty:2,supplier:'其他店商家'}]}]
 ];
 const prior=fingerprint(f.db),n=auditCount(f),stock=balance(f.db,f.ingredient,f.b);
 for(const [action,payload]of denied)assert.throws(()=>write(f,f.ma,action,payload),{status:403},action);
 assert.throws(()=>details(f.db,f.ma,group,scope),{status:403});
 assert.equal(fingerprint(f.db),prior,'no unauthorized persistent writes');
 assert.equal(auditCount(f),n,'denied mutation must not produce success audit');
 assert.equal(balance(f.db,f.ingredient,f.b),stock,'no unauthorized stock movement');
});
test('RB-003 staff cannot modify peer data, approve stock or change tenant administration',t=>{
 const f=fixture(t),peer=f.refs.get(f.sa2.id);
 const group=write(f,f.sa2,'order.batch-create',{location_id:f.a,items:[{ingredient_id:f.ingredient,qty:1,supplier:'同店商家'}]}).groups[0].number;
 write(f,f.ma,'order.batch-approve',{number:group});
 const prior=fingerprint(f.db),n=auditCount(f);
 const denied=[
  ['task.status',{id:peer.task,status:'done'}],
  ['order.approve',{id:peer.order}],
  ['stocktake.confirm',{id:peer.stocktake}],
  ['repair.status',{id:peer.repair,status:'closed'}],
  ['leave.review',{id:peer.leave,status:'approved'}],
  ['training.score',{id:peer.training,score:95,completed_on:'2026-11-04'}],
  ['stock.usage',{location_id:f.a,ingredient_id:f.ingredient,qty:1}],
  ['price.record',{location_id:f.a,ingredient_id:f.ingredient,unit_price_twd:'90'}],
  ['user.role',{user_id:f.sa2.id,role:'owner'}],
  ['user.assign-location',{user_id:f.sa.id,location_id:f.b}],
  ['dish.active',{id:f.dish,active:0}],
  ['recipe.delete',{id:f.recipe}],
  ['order.batch-mark-sent',{number:group}],
  ['order.batch-receive',{number:group}]
 ];
 for(const [action,payload]of denied)assert.throws(()=>write(f,f.sa,action,payload),{status:403},action);
 assert.equal(fingerprint(f.db),prior);
 assert.equal(auditCount(f),n);
 assert.equal(rows(f.db,f.owner,'menu_dishes').find(d=>d.id===f.dish).active,1);
});
function request(port,route,{method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{
 const json=body===undefined?null:JSON.stringify(body);
 const req=http.request({hostname:'127.0.0.1',port,path:route,method,headers:{...(json?{'content-type':'application/json','content-length':Buffer.byteLength(json)}:{}),...headers}},res=>{
  let raw='';res.on('data',x=>raw+=x);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(raw),cookies:res.headers['set-cookie']});}catch(e){reject(e);}});
 });req.on('error',reject);req.end(json);
});}
test('RB-003 live HTTP role/assignment changes invalidate existing cookies; disabled users cannot relogin',async t=>{
 const f=fixture(t),server=http.createServer(makeHandler(f.db));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));});
 const port=server.address().port;
 async function login(username,password){const r=await request(port,'/api/login',{method:'POST',body:{username,password}});assert.equal(r.status,200);const cookie=r.cookies[0].split(';')[0];const me=await request(port,'/api/me',{headers:{Cookie:cookie}});assert.equal(me.status,200);return {cookie,csrf:me.body.csrf};}
 const owner=await login('owner',f.bootstrapPassword),manager=await login(f.ma.username,'test-password-234');
 const auth=h=>({Cookie:h.cookie,'x-csrf-token':h.csrf});
 const get=async(h,entity)=>request(port,'/api/data?entity='+entity,{headers:{Cookie:h.cookie}});
 let list=await get(manager,'purchase_orders');assert.equal(list.status,200);assert.equal(list.body.rows.length,2);
 const denied=await request(port,'/api/command',{method:'POST',headers:auth(manager),body:{action:'order.approve',data:{id:f.refs.get(f.sb.id).order}}});
 assert.equal(denied.status,403);
 let mutation=await request(port,'/api/command',{method:'POST',headers:auth(owner),body:{action:'user.assign-location',data:{user_id:f.ma.id,location_id:f.b}}});
 assert.equal(mutation.status,200);
 assert.equal((await request(port,'/api/me',{headers:{Cookie:manager.cookie}})).status,401,'location change revokes original session');
 const newManager=await login(f.ma.username,'test-password-234');
 list=await get(newManager,'purchase_orders');assert.equal(list.status,200);assert.equal(list.body.rows.length,3,'newly authorized store is visible only after re-login');
 mutation=await request(port,'/api/command',{method:'POST',headers:auth(owner),body:{action:'user.role',data:{user_id:f.ma.id,role:'staff'}}});
 assert.equal(mutation.status,200);
 assert.equal((await request(port,'/api/me',{headers:{Cookie:newManager.cookie}})).status,401);
 const retyped=await login(f.ma.username,'test-password-234');
 assert.equal((await request(port,'/api/data?entity=audit_logs',{headers:{Cookie:retyped.cookie}})).status,403);
 mutation=await request(port,'/api/command',{method:'POST',headers:auth(owner),body:{action:'user.active',data:{user_id:f.ma.id,active:false}}});
 assert.equal(mutation.status,200);
 assert.equal((await request(port,'/api/me',{headers:{Cookie:retyped.cookie}})).status,401);
 assert.equal((await request(port,'/api/login',{method:'POST',body:{username:f.ma.username,password:'test-password-234'}})).status,401);
});
