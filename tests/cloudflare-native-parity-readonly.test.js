'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..'),site='https://restaurant.example.workers.dev';
const auth=import('../cloudflare/auth-core.mjs'),worker=import('../cloudflare/worker.mjs');
const parity=import('../cloudflare/native-parity-readonly.mjs'),display=import('../vercel-demo/native-owner-display.mjs');
function d1(db){
 const stmt=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
  all:async()=>({results:db.prepare(sql).all(...args)}),
  run:async()=>({meta:db.prepare(sql).run(...args)})});
 return {prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
  async batch(statements){db.exec('BEGIN IMMEDIATE');try{
   const ret=[];for(const q of statements)ret.push(await q.run());
   db.exec('COMMIT');return ret;
  }catch(e){db.exec('ROLLBACK');throw e;}}};
}
async function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 const {hashWorkerPassword}=await auth,hash=await hashWorkerPassword('test-parity-owner-password-123');
 const ids={owner:'owner-id',manager:'manager-id',staffA:'staff-A',staffB:'staff-B'};
 for(const [id,name,role] of [[ids.owner,'owner','owner'],[ids.manager,'manager','manager'],
  [ids.staffA,'staffA','staff'],[ids.staffB,'staffB','staff']])
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
    .run(id,name,'測試'+name,role,hash.password_salt,hash.password_hash);
 for(const [id,name] of [['storeA','第一店'],['storeB','第二店']])
  db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 for(const [id,store] of [[ids.manager,'storeA'],[ids.staffA,'storeA'],[ids.staffB,'storeB']])
  db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,store);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)').run('ingA','SKU-A','麵條','包');
 for(const [suffix,store,staff] of [['A','storeA',ids.staffA],['B','storeB',ids.staffB]]){
  db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,note,actor_id) VALUES(?,?,?,?,?,?,?)')
    .run('move'+suffix,'ingA',store,suffix==='A'?-2:3,suffix==='A'?'usage':'purchase','合成流水'+suffix,staff);
  db.prepare('INSERT INTO leave_requests(id,user_id,location_id,start_date,end_date,reason) VALUES(?,?,?,?,?,?)')
    .run('leave'+suffix,staff,store,'2026-11-01','2026-11-02','合成請假'+suffix);
  db.prepare('INSERT INTO training_courses(id,title) VALUES(?,?) ON CONFLICT DO NOTHING')
    .run('course1','消防安全');
  db.prepare('INSERT INTO training_records(id,course_id,user_id,location_id,score,completed_on) VALUES(?,?,?,?,?,?)')
    .run('training'+suffix,'course1',staff,store,suffix==='A'?90:60,'2026-11-05');
  db.prepare('INSERT INTO evaluations(id,user_id,location_id,period,score,feedback,reviewer_id) VALUES(?,?,?,?,?,?,?)')
    .run('eval'+suffix,staff,store,'2026-Q4',suffix==='A'?80:72,'合成考核'+suffix,ids.owner);
 }
 const env={DB:d1(db),CLOUD_AUTH_PHASE:'native-production',
  CLOUD_NATIVE_LOGIN_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:'synthetic-parity-test-pepper-longer-than-32',
  ASSETS:{fetch:async()=>new Response('STATIC')}};
 const {default:app}=await worker;
 const send=(route,init={},environ=env)=>{
  const req=new Request(site+route,init);
  Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
  return app.fetch(req,environ);
 };
 const login=async username=>{
  const response=await send('/api/login',{method:'POST',headers:{
   origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
   'CF-Connecting-IP':'198.51.100.56'
  },body:JSON.stringify({username,password:'test-parity-owner-password-123'})});
  assert.equal(response.status,200,'login '+username);
  return response.headers.get('set-cookie').split(';')[0];
 };
 return {db,env,send,login};
}
test('Native HR and stock read-only entities enforce Owner, store-manager and employee row scope',async t=>{
 const f=await fixture(t),cookies={};
 for(const name of ['owner','manager','staffA','staffB'])cookies[name]=await f.login(name);
 const entities=['stock_moves','leave_requests','training_records','evaluations'];
 const before=f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n;
 for(const entity of entities){
  for(const [user,expectedStore] of [['owner',['第一店','第二店']],
   ['manager',['第一店']],['staffA',['第一店']],['staffB',['第二店']]]){
   const res=await f.send('/api/data?entity='+entity,{headers:{cookie:cookies[user]}});
   assert.equal(res.status,200,entity+'/'+user);
   assert.equal(res.headers.get('cache-control'),'private, no-store, max-age=0');
   const data=await res.json();
   assert.equal(data.mode,'native_d1');assert.equal(data.entity,entity);
   assert.deepEqual(data.rows.map(x=>x.location_name).sort(),expectedStore,entity+'/'+user);
   assert(data.rows.every(x=>!Object.hasOwn(x,'password_hash')&&!Object.hasOwn(x,'csrf_token')));
  }
 }
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM audit_logs').get().n,before);
 for(const name of ['stock_moves','leave_requests','training_records','evaluations']){
  assert.equal((await f.send('/api/data?entity='+name)).status,401);
  assert.equal((await f.send('/api/data?entity='+name,{method:'POST',body:'{}'})).status,405);
 }
 assert.equal((await f.send('/api/data?entity=users',
  {headers:{cookie:cookies.owner}})).status,404);
 assert.equal((await f.send('/api/data?entity=audit_logs',
  {headers:{cookie:cookies.owner}})).status,404);
});
test('New read-only SQL plans filter by role/store before ORDER BY/LIMIT without exposing Preview',async()=>{
 const {nativeParityReadonlyPlan,NATIVE_READONLY_PARITY_ENTITIES}=await parity;
 assert.deepEqual([...NATIVE_READONLY_PARITY_ENTITIES].sort(),
  ['stock_moves','leave_requests','training_records','evaluations'].sort());
 for(const entity of NATIVE_READONLY_PARITY_ENTITIES){
  const owner=nativeParityReadonlyPlan(entity,{id:'own',role:'owner'});
  const manager=nativeParityReadonlyPlan(entity,{id:'mgr',role:'manager'});
  const staff=nativeParityReadonlyPlan(entity,{id:'s',role:'staff'});
  assert.deepEqual(owner.params,[]);assert.deepEqual(manager.params,['mgr']);
  assert.deepEqual(staff.params,entity==='stock_moves'?['s']:['s','s']);
  assert.match(manager.sql,/ WHERE [a-z]\.location_id IN/);
  assert.match(staff.sql,/ ORDER BY [a-z]\./);
  assert.match(owner.sql,/LIMIT 500$/);
  assert(!manager.sql.includes('owner-id'));
  assert(Object.isFrozen(owner));
 }
 assert.equal(nativeParityReadonlyPlan('__proto__',{id:'owner',role:'owner'}),null);
 assert.equal(nativeParityReadonlyPlan('evaluations',{id:'s',role:'guest'}),null);
 const operations=fs.readFileSync(path.join(root,'cloudflare/operations-readonly.mjs'),'utf8');
 assert(!operations.includes('nativeParityReadonlyPlan'));
});
test('Native D1 display projects only allowlisted HR/ledger columns and keeps old status tones',async()=>{
 const {presentNativeRows}=await display;
 const examples={
  stock_moves:{location_name:'第一店',ingredient_name:'米',qty_delta:-2,unit:'包',
   move_type:'usage',note:'必要領用',created_at:'2026-11-16 02:00:00',token_hash:'secret'},
  leave_requests:{location_name:'第一店',staff_name:'小王',start_date:'2026-11-01',
   end_date:'2026-11-02',reason:'家庭',status:'approved',password_hash:'secret'},
  training_records:{location_name:'第一店',staff_name:'小王',course_title:'消防',
   score:91,required_score:80,completed_on:'2026-11-05',csrf_token:'secret'},
  evaluations:{location_name:'第一店',staff_name:'小王',period:'2026-Q4',score:80,
   feedback:'表現佳',created_at:'2026-11-16 02:00:00',password:'secret'}
 };
 for(const [entity,row] of Object.entries(examples)){
  const view=presentNativeRows(entity,[row]);
  assert.equal(view.entries.length,1);
  assert(view.columns.length>=5);
  assert(!JSON.stringify(view).includes('secret'),entity);
  assert(view.columns.every(x=>!/_id$/.test(x.label)));
 }
 const move=presentNativeRows('stock_moves',[examples.stock_moves]);
 assert(move.entries[0].cells.some(x=>x.text==='-2'));
 assert(move.entries[0].cells.some(x=>x.text==='耗用'));
 const leave=presentNativeRows('leave_requests',[examples.leave_requests]);
 assert(leave.entries[0].cells.some(x=>x.text==='已核准'&&x.tone==='ok'));
 const purchase=presentNativeRows('purchase_orders',[{status:'approved'}]);
 assert.equal(purchase.entries[0].cells[6].tone,'warn','existing purchase approved remains warning');
});
test('Native Owner parity navigation uses real D1 and never silently enables writes',()=>{
 const html=fs.readFileSync(path.join(root,'vercel-demo/owner-app.html'),'utf8');
 const js=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
 const worker=fs.readFileSync(path.join(root,'cloudflare/native-business-http.mjs'),'utf8');
 for(const key of ['stock_moves','leave_requests','training_records','evaluations']){
  assert(html.includes('data-view="'+key+'"'));
  assert(js.includes(key));
 }
 assert.match(worker,/nativeParityReadonlyPlan\(entity,principal\)/);
 assert.doesNotMatch(js,/mock\.js|localStorage|sessionStorage/);
 assert.doesNotMatch(js,/\.innerHTML\s*=/);
});
