'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const worker=import('../cloudflare/worker.mjs'),auth=import('../cloudflare/auth-core.mjs');
const tableCount=(db,table)=>db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;

function adapter(db,control={}){
 const statement=(sql,args=[])=>({
   first:async()=>db.prepare(sql).get(...args),
   all:async()=>({results:db.prepare(sql).all(...args)}),
   run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...statement(sql),bind:(...args)=>statement(sql,args)};},
   async batch(entries){
     if(control.beforeBatch)control.beforeBatch();
     db.exec('BEGIN IMMEDIATE');
     try{
       const out=[];
       for(let i=0;i<entries.length;i++){
         if(control.failAt===i)throw Error('SYNTHETIC_BATCH_FAILURE');
         out.push(await entries[i].run());
       }
       db.exec('COMMIT');return out;
     }catch(e){db.exec('ROLLBACK');throw e;}
   }
 };
}
async function fixture(t,control={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
   shopA:randomUUID(),shopB:randomUUID(),ing:randomUUID()};
 const {hashWorkerPassword}=await auth;
 const pass='synthetic-price-uats-password-123';
 const hash=await hashWorkerPassword(pass);
 for(const [role,id] of [['owner',ids.owner],['manager',ids.manager],['staff',ids.staff]]){
   db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
     .run(id,role,'測試'+role,role,hash.password_salt,hash.password_hash);
 }
 for(const [id,name] of [[ids.shopA,'甲門市'],[ids.shopB,'乙門市']])
   db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(ids.manager,ids.shopA);
 db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(ids.staff,ids.shopB);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run(ids.ing,'PRICE-001','米','公斤');
 db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)')
   .run(randomUUID(),ids.ing,ids.shopA,3,'purchase');
 const env={DB:adapter(db,control),CLOUD_AUTH_PHASE:'native-production',
   CLOUD_NATIVE_LOGIN_GATE:'operator-released',CLOUD_NATIVE_PRICE_WRITE_GATE:'operator-released',
   NATIVE_AUTH_SOURCE_PEPPER:'synthetic-price-pepper-at-least-32-characters'};
 const handler=(await worker).default;
 const send=(route,init={},e=env)=>{
   const request=new Request(site+route,init);
   Object.defineProperty(request,'cf',{value:{colo:'TPE'}});
   return handler.fetch(request,e);
 };
 const login=async username=>{
   const r=await send('/api/login',{method:'POST',headers:{
     origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
     'CF-Connecting-IP':'198.51.100.15'},body:JSON.stringify({username,password:pass})});
   assert.equal(r.status,200);
   return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};
 };
 const write=(person,data,opts={})=>send('/api/price',{
   method:'POST',headers:{origin:site,'content-type':'application/json',
     'sec-fetch-site':'same-origin',cookie:person.cookie,
     'x-csrf-token':person.csrf,...opts.headers},
   body:opts.body??JSON.stringify({action:'price.record',data})
 },opts.env||env);
 const input=(location_id=ids.shopA)=>({location_id,ingredient_id:ids.ing,
   unit_price_twd:'81.25',unit:'公斤',supplier:'合成供應商',price_date:'2026-11-17'});
 return {db,ids,send,env,login,write,input,control};
}

test('Cloudflare D1 price gate is independent and default-denied',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 assert.equal((await f.send('/api/native/status').then(x=>x.json())).price_write_enabled,true);
 for(const env of [{...f.env,CLOUD_NATIVE_PRICE_WRITE_GATE:undefined},
   {...f.env,CLOUD_NATIVE_PRICE_WRITE_GATE:'disabled'},
   {...f.env,CLOUD_NATIVE_LOGIN_GATE:'disabled'}]){
   assert.equal((await f.write(owner,f.input(),{env})).status,503);
   assert.equal((await f.send('/api/native/status',{},env).then(x=>x.json()))
     .price_write_enabled,false);
 }
 assert.equal(tableCount(f.db,'ingredient_prices'),0);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'").get().n,0);
 assert.equal((await f.send('/api/price',{method:'GET'})).status,405);
});

test('Owner and in-scope Manager append historical prices with audit, never edit ledger',async t=>{
 const f=await fixture(t),manager=await f.login('manager'),owner=await f.login('owner');
 const first=await f.write(manager,f.input());assert.equal(first.status,200);
 assert.equal((await first.json()).code,'OK');
 const second=await f.write(owner,{...f.input(),unit_price_twd:'123.50',unit:'公克'});
 assert.equal(second.status,200);
 const history=f.db.prepare("SELECT price_date,price_cents,unit,source,created_by FROM ingredient_prices ORDER BY rowid").all();
 assert.deepEqual(history.map(x=>x.price_cents),[8125,12350]);
 assert.deepEqual(history.map(x=>x.unit),['公斤','公克']);
 assert(history.every(x=>x.source==='manual'));
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'").get().n,2);
 assert.equal(tableCount(f.db,'stock_moves'),1,'price record must not touch inventory ledger');
 const prices=await f.send('/api/data?entity=ingredient_prices',{headers:{cookie:manager.cookie}});
 assert.equal(prices.status,200);
 const parsed=await prices.json();
 assert.equal(parsed.rows.length,2);
 assert.equal(parsed.rows[0].location_name,'甲門市');
 assert.deepEqual(parsed.rows.map(x=>x.unit_price_twd).sort((a,b)=>a-b),[81.25,123.5]);
 assert.equal((await f.send('/api/data?entity=inventory_values',{headers:{cookie:manager.cookie}})).status,200);
});

test('Staff, wrong store, missing CSRF and invalid Origin all block price writes',async t=>{
 const f=await fixture(t),manager=await f.login('manager'),staff=await f.login('staff');
 assert.equal((await f.write(staff,f.input(f.ids.shopB))).status,403);
 assert.equal((await f.write(manager,f.input(f.ids.shopB))).status,403);
 assert.equal((await f.write(manager,f.input(),{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.write(manager,f.input(),{headers:{origin:'https://attacker.invalid'}})).status,403);
 assert.equal((await f.send('/api/price',{method:'POST',headers:{
   origin:site,'content-type':'application/json',
   'sec-fetch-site':'same-origin'},body:JSON.stringify({action:'price.record',data:f.input()})})).status,401);
 assert.equal(tableCount(f.db,'ingredient_prices'),0);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'").get().n,0);
});

test('price input validation rejects extra keys, impossible dates, invalid units and values',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 for(const changes of [
   {unit_price_twd:'0'},{unit_price_twd:'-1'},{unit_price_twd:'1.999'},
   {unit_price_twd:'1000000001'},{unit_price_twd:'2e5'},
   {price_date:'2026-02-30'},{price_date:'2026-11-17T00:00:00Z'},
   {unit:'顆'},{unit:'公斤 '},{unit:'x'.repeat(21)},
   {supplier:'x'.repeat(121)},{supplier:'x\nx'},
   {unknown:'secret'},{location_id:'bad'}
 ]){
   const response=await f.write(owner,{...f.input(),...changes});
   assert.equal(response.status,400,'rejected '+JSON.stringify(changes));
 }
 assert.equal(tableCount(f.db,'ingredient_prices'),0);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'").get().n,0);
});

test('partial D1 batch failure rolls back new price and audit',async t=>{
 const control={},f=await fixture(t,control),owner=await f.login('owner');
 control.failAt=1;
 const res=await f.write(owner,f.input());
 assert.equal(res.status,503);
 assert.equal(tableCount(f.db,'ingredient_prices'),0);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'").get().n,0);
});

test('revoked Manager store access in batch blocks price and audit atomically',async t=>{
 let f,revoked=false;
 const control={beforeBatch(){
   if(revoked)f.db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.manager);
 }};
 f=await fixture(t,control);
 const manager=await f.login('manager');revoked=true;
 const res=await f.write(manager,f.input());
 assert.equal(res.status,503);
 assert.equal(tableCount(f.db,'ingredient_prices'),0);
 assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'").get().n,0);
});


test('concurrent catalog unit change before D1 batch rejects explicit incompatible price atomically',async t=>{
  let f,run=false;
  const control={beforeBatch(){
    if(run)f.db.prepare('UPDATE ingredients SET unit=? WHERE id=?')
      .run('公升',f.ids.ing);
  }};
  f=await fixture(t,control);
  // In a real catalog update the ingredient must not yet have inventory,
  // prices, orders or recipes: remove this synthetic fixture's stock movement.
  f.db.prepare('DELETE FROM stock_moves WHERE ingredient_id=?')
    .run(f.ids.ing);
  const owner=await f.login('owner');run=true;
  const response=await f.write(owner,f.input());
  assert.equal(response.status,503);
  assert.equal(f.db.prepare('SELECT unit FROM ingredients WHERE id=?')
    .get(f.ids.ing).unit,'公升');
  assert.equal(tableCount(f.db,'ingredient_prices'),0);
  assert.equal(f.db.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'"
  ).get().n,0);
});

test('concurrent catalog unit change rejects omitted price unit, not just explicit units',async t=>{
  let f,run=false;
  const control={beforeBatch(){
    if(run)f.db.prepare('UPDATE ingredients SET unit=? WHERE id=?')
      .run('公升',f.ids.ing);
  }};
  f=await fixture(t,control);
  f.db.prepare('DELETE FROM stock_moves WHERE ingredient_id=?')
    .run(f.ids.ing);
  const manager=await f.login('manager');run=true;
  const {unit,...withoutUnit}=f.input();
  const response=await f.write(manager,withoutUnit);
  assert.equal(response.status,503);
  assert.equal(tableCount(f.db,'ingredient_prices'),0);
  assert.equal(f.db.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE action='price.record'"
  ).get().n,0);
});

test('local SQLite and Vercel demonstration align on supported cent values and date input',()=>{
 const {money}=require('../src/pricing');
 const win={};
 vm.runInNewContext(fs.readFileSync(path.join(root,'vercel-demo/pricing-demo.js'),'utf8'),
   {window:win,Date,console});
 const mock={locations:[{id:'l1',name:'示範店',active:1}],
   ingredients:[{id:'i1',name:'米',unit:'公斤',active:1}]};
 for(const [raw,expected] of [['0.01',1],['80.50',8050],['1000000000',100000000000]]){
   assert.equal(money(raw),expected);
   assert.equal(win.RestaurantDemoPricing.makePrice(mock,{
     location_id:'l1',ingredient_id:'i1',unit_price_twd:raw,
     price_date:'2026-11-17'},'demo').price_cents,expected);
 }
 for(const raw of ['0','-1','1.001','1000000000.01','1e5','01.00']){
   assert.throws(()=>money(raw),Error);
   assert.throws(()=>win.RestaurantDemoPricing.makePrice(mock,{
     location_id:'l1',ingredient_id:'i1',unit_price_twd:raw,price_date:'2026-11-17'
   },'demo'));
 }
 assert.throws(()=>win.RestaurantDemoPricing.makePrice(mock,{
   location_id:'l1',ingredient_id:'i1',unit_price_twd:'20',price_date:'2026-02-30'
 },'demo'));
});

test('all three deployments agree on weight/volume aliases and reject unrelated units',()=>{
 const {conversion}=require('../cloudflare/pricing-units.cjs');
 const win={};
 vm.runInNewContext(fs.readFileSync(path.join(root,'vercel-demo/pricing-demo.js'),'utf8'),
   {window:win,Date,console});
 const converted=win.RestaurantDemoPricing.converted;
 for(const [qty,from,to] of [
   [1,'千克','公克'],[1,'公斤','克'],[3000,'g','kg'],
   [1,'升','毫升'],[1,'l','mL'],[1,'L','ml'],[500,'毫升','公升'],
   [4,'顆','公斤'],[2,'公升','千克']
 ]){
   assert.equal(converted(qty,from,to),conversion(qty,from,to),
     from+' → '+to+' must match SQLite/Cloudflare units');
 }
});

test('Native UI preserves append-only price view and independent role-specific gate',async()=>{
 const ui=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'vercel-demo/owner-app.html'),'utf8');
 const {nativeOwnerCapability}=await import('../vercel-demo/native-owner-capability.mjs');
 assert.match(ui,/priceWriteEnabled=status\.price_write_enabled===true/);
 assert.match(ui,/api\('\/api\/price'/);
 assert.match(ui,/if\(view==='ingredient_prices'\)await priceActions\(marker\)/);
 assert.match(html,/data-view="ingredient_prices"/);
 assert.equal(nativeOwnerCapability({view:'ingredient_prices',role:'owner',price:true})
   .pageWritable,true);
 assert.equal(nativeOwnerCapability({view:'ingredient_prices',role:'manager',price:true})
   .pageWritable,true);
 assert.equal(nativeOwnerCapability({view:'ingredient_prices',role:'staff',price:true})
   .pageWritable,false);
 assert.equal(nativeOwnerCapability({view:'ingredient_prices',role:'owner',price:false})
   .pageWritable,false);
 assert.equal(nativeOwnerCapability({view:'stock_moves',role:'owner',price:true})
   .pageWritable,false);
 assert.equal(nativeOwnerCapability({view:'inventory_values',role:'owner',price:true})
   .pageWritable,false);
});
