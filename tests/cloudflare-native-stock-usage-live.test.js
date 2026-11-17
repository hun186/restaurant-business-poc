'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const site='https://restaurant.example.workers.dev',root=path.resolve(__dirname,'..');
const worker=import('../cloudflare/worker.mjs'),auth=import('../cloudflare/auth-core.mjs');
function adapter(db,opt={}){
 const call=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
   all:async()=>({results:db.prepare(sql).all(...args)}),
   run:async()=>({meta:db.prepare(sql).run(...args)})});
 return {prepare(sql){return {...call(sql),bind:(...args)=>call(sql,args)};},
   async batch(steps){
     if(opt.beforeBatch)opt.beforeBatch();
     db.exec('BEGIN IMMEDIATE');
     try{
       const out=[];
       for(let i=0;i<steps.length;i++){
         if(opt.failNow&&i===opt.failAt)throw Error('SYNTHETIC_D1_FAILED');
         out.push(await steps[i].run());
       }
       db.exec('COMMIT');return out;
     }catch(err){db.exec('ROLLBACK');throw err;}
   }
 };
}
async function fixture(t,opt={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
   storeA:randomUUID(),storeB:randomUUID(),ing:randomUUID()};
 const pass='synthetic-stock-usage-password-123',hash=await (await auth).hashWorkerPassword(pass);
 for(const [id,name] of [[ids.storeA,'甲測試店'],[ids.storeB,'乙測試店']])
   db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run(ids.ing,'USAGE-001','米','公斤');
 for(const role of ['owner','manager','staff']){
   db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
     .run(ids[role],role,'測試'+role,role,hash.password_salt,hash.password_hash);
   if(role!=='owner')db.prepare(
     'INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(ids[role],ids.storeA);
 }
 const env={DB:adapter(db,opt),CLOUD_AUTH_PHASE:'native-production',
   CLOUD_NATIVE_LOGIN_GATE:'operator-released',
   CLOUD_NATIVE_STOCK_USAGE_WRITE_GATE:'operator-released',
   NATIVE_AUTH_SOURCE_PEPPER:'synthetic-usage-source-pepper-32-characters'};
 const handler=(await worker).default;
 const send=(url,init={},envOverride=env)=>{
   const req=new Request(site+url,init);
   Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
   return handler.fetch(req,envOverride);
 };
 const login=async who=>{
   const r=await send('/api/login',{method:'POST',headers:{
     origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
     'CF-Connecting-IP':'198.51.100.15'},
     body:JSON.stringify({username:who,password:pass})});
   assert.equal(r.status,200);
   return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf};
 };
 const payload=(qty=2,location_id=ids.storeA)=>({
   ingredient_id:ids.ing,location_id,qty,note:'合成領用'});
 const write=(who,data=payload(),options={})=>send('/api/stock/usage',{
   method:'POST',headers:{origin:site,'content-type':'application/json',
     'sec-fetch-site':'same-origin',cookie:who.cookie,'x-csrf-token':who.csrf,
     'x-idempotency-key':options.key||randomUUID(),...options.headers},
   body:options.body??JSON.stringify({action:'stock.usage',data})
 },options.env||env);
 const stock=(qty,location_id=ids.storeA)=>{
   db.prepare('INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,note) VALUES(?,?,?,?,?,?)')
     .run(randomUUID(),ids.ing,location_id,qty,qty>0?'purchase':'usage','合成進貨/耗用');
 };
 const balance=()=>db.prepare('SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?')
   .get(ids.ing,ids.storeA).n;
 const count=()=>db.prepare("SELECT COUNT(*) AS n FROM stock_moves WHERE move_type='usage' AND actor_id IS NOT NULL").get().n;
 const audit=()=>db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action='stock.usage'").get().n;
 return {db,ids,env,login,send,write,payload,stock,balance,count,audit,opt};
}
test('Manager and Owner append ledger + audit without mutating existing stock entries',async t=>{
 const f=await fixture(t);f.stock(10.5);
 const old=f.db.prepare('SELECT id,qty_delta FROM stock_moves WHERE move_type=?').get('purchase');
 const mgr=await f.login('manager'),owner=await f.login('owner');
 const a=await f.write(mgr,f.payload(2.125));assert.equal(a.status,200);
 const b=await f.write(owner,f.payload(1.5));assert.equal(b.status,200);
 assert.equal(f.balance(),6.875);
 assert.equal(f.count(),2);assert.equal(f.audit(),2);
 assert.deepEqual(f.db.prepare('SELECT id,qty_delta FROM stock_moves WHERE move_type=?').get('purchase'),old);
 const ledger=await f.send('/api/data?entity=stock_moves',{headers:{cookie:mgr.cookie}});
 assert.equal(ledger.status,200);
 assert((await ledger.json()).rows.some(r=>r.move_type==='usage'&&r.qty_delta<0));
});
test('same per-request idempotency key cannot debit or audit twice',async t=>{
 const f=await fixture(t);f.stock(15);
 const owner=await f.login('owner'),key=randomUUID();
 assert.equal((await f.write(owner,f.payload(3),{key})).status,200);
 assert.equal((await f.write(owner,f.payload(3),{key})).status,409);
 assert.equal(f.balance(),12);assert.equal(f.count(),1);assert.equal(f.audit(),1);
 const move=f.db.prepare("SELECT reference_id FROM stock_moves WHERE move_type='usage' AND actor_id=?")
   .get(f.ids.owner);
 assert.equal(move.reference_id,key);
});
test('insufficient stock, zero stock, malformed quantity and extra keys reject without writes',async t=>{
 const f=await fixture(t),owner=await f.login('owner');
 assert.equal((await f.write(owner,f.payload(1))).status,409);
 f.stock(3);
 for(const qty of [-1,0,3.001,1000000.001,0.0001,'1',null]){
   const r=await f.write(owner,f.payload(qty));
   assert.equal(r.status,qty===3.001?409:400,String(qty));
 }
 for(const payload of [{...f.payload(),admin:true},{...f.payload(),note:'x'.repeat(301)},
   {...f.payload(),note:'needs\nnewline'},{...f.payload(),ingredient_id:'not-an-uuid'}]){
   assert.equal((await f.write(owner,payload)).status,400);
 }
 assert.equal(f.balance(),3);assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('three-decimal balance: 0.3 minus 0.1 allows 0.2, then rejects 0.001',async t=>{
 const f=await fixture(t);f.stock(0.3);
 const mgr=await f.login('manager');
 assert.equal((await f.write(mgr,f.payload(0.1))).status,200);
 assert.equal(f.balance(),0.19999999999999998);
 assert.equal((await f.write(mgr,f.payload(0.2))).status,200,
   'legitimate remaining 0.2 must not fail from floating-point SUM');
 assert(Math.abs(f.balance())<0.000000001);
 assert.equal((await f.write(mgr,f.payload(0.001))).status,409,
   'one minimum stock unit beyond the ledger must still be rejected');
 assert.equal(f.count(),2);assert.equal(f.audit(),2);
});

test('transactional rounding also handles stale fractional balance at batch time',async t=>{
 let f,trigger=false;
 const opt={beforeBatch(){if(trigger){f.stock(-0.1);trigger=false;}}};
 f=await fixture(t,opt);f.stock(0.3);
 const mgr=await f.login('manager');trigger=true;
 assert.equal((await f.write(mgr,f.payload(0.2))).status,200,
   'D1 INSERT must apply the same three-place balance check as preflight');
 assert(Math.abs(f.balance())<0.000000001);
 assert.equal(f.count(),1);assert.equal(f.audit(),1);
});

test('transaction rechecks minimum step and refuses a late 0.001 overdraft',async t=>{
 let f,trigger=false;
 const opt={beforeBatch(){if(trigger){f.stock(-0.001);trigger=false;}}};
 f=await fixture(t,opt);f.stock(0.2);
 const mgr=await f.login('manager');trigger=true;
 assert.equal((await f.write(mgr,f.payload(0.2))).status,503);
 assert(Math.abs(f.balance()-0.199)<0.000000001);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});

test('Staff, out-of-store Manager, CSRF mismatch and missing auth fail closed',async t=>{
 const f=await fixture(t);f.stock(10);
 const mgr=await f.login('manager'),staff=await f.login('staff');
 assert.equal((await f.write(staff,f.payload())).status,403);
 assert.equal((await f.write(mgr,f.payload(2,f.ids.storeB))).status,403);
 assert.equal((await f.write(mgr,f.payload(),{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.write(mgr,f.payload(),{headers:{origin:'https://other.example'}})).status,403);
 assert.equal((await f.write(mgr,f.payload(),{headers:{'x-idempotency-key':'bad'}})).status,400);
 assert.equal((await f.send('/api/stock/usage',{method:'POST',headers:{
   origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
   'x-idempotency-key':randomUUID()},body:JSON.stringify({action:'stock.usage',data:f.payload()})})).status,401);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);assert.equal(f.balance(),10);
});
test('default closed independent Gate, disabled login and wrong method never debit',async t=>{
 const f=await fixture(t);f.stock(10);
 const mgr=await f.login('manager');
 for(const env of [{...f.env,CLOUD_NATIVE_STOCK_USAGE_WRITE_GATE:undefined},
   {...f.env,CLOUD_NATIVE_STOCK_USAGE_WRITE_GATE:'disabled'},
   {...f.env,CLOUD_NATIVE_LOGIN_GATE:'disabled'}]){
   assert.equal((await f.write(mgr,f.payload(),{env})).status,503);
   assert.equal((await f.send('/api/native/status',{},env).then(r=>r.json()))
     .stock_usage_write_enabled,false);
 }
 assert.equal((await f.send('/api/stock/usage',{method:'GET'})).status,405);
 const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
 assert.equal(config.keep_vars,true);
 assert.equal(Object.hasOwn(config,'vars'),false);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);assert.equal(f.balance(),10);
});
test('stale balance after another debit rejects atomic insert without negative stock',async t=>{
 let f,trigger=false;
 const opt={beforeBatch(){
   if(trigger)f.stock(-6);
 }};
 f=await fixture(t,opt);f.stock(10);
 const mgr=await f.login('manager');trigger=true;
 const r=await f.write(mgr,f.payload(8));
 assert.equal(r.status,503);
 assert.equal(f.balance(),4);
 assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('revoked store scope before D1 batch rejects stock and audit atomically',async t=>{
 let f,trigger=false;
 const opt={beforeBatch(){
   if(trigger)f.db.prepare('DELETE FROM user_locations WHERE user_id=?')
     .run(f.ids.manager);
 }};
 f=await fixture(t,opt);f.stock(10);
 const mgr=await f.login('manager');trigger=true;
 const r=await f.write(mgr,f.payload(2));
 assert.equal(r.status,503);
 assert.equal(f.balance(),10);assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('failed D1 audit insert rolls back preceding stock debit',async t=>{
 const opt={failAt:1},f=await fixture(t,opt);f.stock(10);
 const owner=await f.login('owner');
 opt.failNow=true;
 assert.equal((await f.write(owner,f.payload(2))).status,503);
 assert.equal(f.balance(),10);assert.equal(f.count(),0);assert.equal(f.audit(),0);
});
test('Local/Vercel stock usage commands exist; Native only appends and never enables direct purchase',async()=>{
 const local=fs.readFileSync(path.join(root,'src/service.js'),'utf8');
 const demo=fs.readFileSync(path.join(root,'vercel-demo/mock.js'),'utf8');
 const ui=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
 const {nativeOwnerCapability}=await import('../vercel-demo/native-owner-capability.mjs');
 assert.match(local,/case 'stock\.usage'/);
 assert.match(demo,/if\(action==='stock\.usage'\)/);
 assert.match(ui,/if\(view==='stock'\)await stockUsageActions\(marker\)/);
 assert.match(ui,/api\('\/api\/stock\/usage'/);
 for(const role of ['owner','manager']){
   assert.equal(nativeOwnerCapability({view:'stock',role,stockUsage:true}).pageWritable,true);
 }
 assert.equal(nativeOwnerCapability({view:'stock',role:'staff',stockUsage:true}).pageWritable,false);
 assert.equal(nativeOwnerCapability({view:'stock_moves',role:'owner',stockUsage:true}).pageWritable,false);
 assert.equal(nativeOwnerCapability({view:'inventory_values',role:'owner',stockUsage:true}).pageWritable,false);
});
