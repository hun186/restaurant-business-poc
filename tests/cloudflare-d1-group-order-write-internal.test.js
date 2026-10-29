'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const authPromise=import('../cloudflare/auth-core.mjs');
const groupedPromise=import('../cloudflare/group-order-write-internal.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const schema=fs.readFileSync(path.join(__dirname,'..','cloudflare','migrations','0001_initial_v3.sql'),'utf8');
const A='POB-'+'A'.repeat(32),B='POB-'+'B'.repeat(32);
const number=(base,i)=>base+'-'+String(i).padStart(3,'0');
function d1(db,options={}){
 const statement=(sql,args=[])=>({
   first:async()=>db.prepare(sql).get(...args),
   all:async()=>({results:db.prepare(sql).all(...args)}),
   run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {
   prepare(sql){return {...statement(sql),bind:(...args)=>statement(sql,args)};},
   async batch(stmts){
     options.beforeBatch?.();
     db.exec('BEGIN IMMEDIATE');
     try {
       const result=[];
       for(let i=0;i<stmts.length;i++){
         if(options.failAt===i)throw Error('synthetic database fault');
         result.push(await stmts[i].run());
       }
       db.exec('COMMIT');return result;
     }catch(e){db.exec('ROLLBACK');throw e;}
   }
 };
}
async function fixture(t,options={}){
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());db.exec(schema);
 const ids={storeA:randomUUID(),storeB:randomUUID(),owner:randomUUID(),
   manager:randomUUID(),staff:randomUUID(),other:randomUUID()};
 for(const [id,name] of [[ids.storeA,'虛構A'],[ids.storeB,'虛構B']])
   db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
 const ingredients=[randomUUID(),randomUUID(),randomUUID()];
 for(let i=0;i<ingredients.length;i++)
   db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
     .run(ingredients[i],'SYN-'+i,'測試食材'+i,'kg');
 const auth=await authPromise,cookies={},csrf={};
 for(const [username,role,id,locations] of [
   ['owner','owner',ids.owner,[ids.storeA]],
   ['manager','manager',ids.manager,[ids.storeA]],
   ['staff','staff',ids.staff,[ids.storeA]],
   ['other','manager',ids.other,[ids.storeB]]
 ]){
   db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
     .run(id,username,'虛構'+username,role,'salt','hash');
   for(const l of locations)db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,l);
   const token=auth.freshSessionToken();csrf[username]=auth.freshSessionToken();
   db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
     .run(await auth.tokenSha256(token),csrf[username],id,new Date(Date.now()+3600000).toISOString());
   cookies[username]=auth.SESSION_COOKIE+'='+token;
 }
 const groupItems=[];
 for(let i=1;i<=3;i++){
   const id=randomUUID();groupItems.push(id);
   db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)')
     .run(id,number(A,i),ids.storeA,ingredients[i-1],'供應商甲',i*2,ids.staff);
 }
 db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)')
   .run(randomUUID(),number(B,1),ids.storeB,ingredients[0],'供應商乙',9,ids.other);
 return {db,d1:d1(db,options),ids,ingredients,groupItems,cookies,csrf};
}
async function act(f,role,action='order.batch-approve',group=A,options={}){
 const run=(await groupedPromise).internalGroupedOrderMutation;
 const method=options.method||'POST';
 const req=new Request('https://private.example/api/command',{
  method,
  body:method==='GET'?undefined:(options.body??JSON.stringify({action,data:{number:group}})),
  headers:{cookie:f.cookies[role]||'','content-type':'application/json',
    origin:'https://private.example','x-csrf-token':f.csrf[role]||'',...options.headers}
 });
 return run(req,{DB:f.d1,CLOUD_AUTH_PHASE:options.phase||'preview-readonly',
   GROUP_ORDER_WRITE_STAGE:options.stage||'internal-test-only'});
}
const rows=(f,g=A)=>f.db.prepare('SELECT id,number,status,approved_by,received_at FROM purchase_orders WHERE number GLOB ? ORDER BY number')
 .all(g+'-[0-9][0-9][0-9]');
const audit=f=>f.db.prepare('SELECT action,entity_id,detail FROM audit_logs ORDER BY rowid').all();
const ledger=f=>f.db.prepare('SELECT id,ingredient_id,location_id,qty_delta,reference_id,move_type FROM stock_moves ORDER BY rowid').all();

test('whole grouped order: 3 approvals, then 3 receiving credits, exactly one audit each',async t=>{
 const f=await fixture(t);
 let response=await act(f,'manager');
 assert.equal(response.status,200);
 assert.equal((await response.json()).result.item_count,3);
 assert.deepEqual(rows(f).map(o=>o.status),['approved','approved','approved']);
 assert.equal(ledger(f).length,0);
 assert.equal(audit(f).length,1);
 response=await act(f,'manager','order.batch-receive');
 assert.equal(response.status,200);
 assert.deepEqual(rows(f).map(o=>o.status),['received','received','received']);
 assert.equal(ledger(f).length,3);
 assert.equal(audit(f).length,2);
 assert.deepEqual(ledger(f).map(m=>m.qty_delta),[2,4,6]);
 for(const move of ledger(f)){
   assert.match(move.id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
   assert.equal(move.location_id,f.ids.storeA);
   assert.equal(move.move_type,'purchase');
   assert.ok(f.groupItems.includes(move.reference_id));
 }
 assert.equal(f.db.prepare('SELECT SUM(qty_delta) AS balance FROM stock_moves WHERE location_id=?')
   .get(f.ids.storeA).balance,12);
 assert.equal((await act(f,'manager','order.batch-receive')).status,409);
 assert.equal((await act(f,'manager')).status,409);
 assert.equal(ledger(f).length,3);assert.equal(audit(f).length,2);
 assert.equal(rows(f,B)[0].status,'requested');
});

test('no receiving before approval; no staff authorizations or cross-store authorization',async t=>{
 const f=await fixture(t);
 assert.equal((await act(f,'manager','order.batch-receive')).status,409);
 assert.equal((await act(f,'staff')).status,403);
 assert.equal((await act(f,'manager','order.batch-approve',B)).status,404);
 assert.equal((await act(f,'other')).status,404);
 assert.equal((await act(f,'owner')).status,200);
 assert.equal(ledger(f).length,0);
});

test('group integrity: missing serial, supplier change, different store, inactive ingredient',async t=>{
 for(const kind of ['gap','supplier','store','ingredient']){
   const f=await fixture(t);
   if(kind==='gap')f.db.prepare('DELETE FROM purchase_orders WHERE number=?').run(number(A,2));
   if(kind==='supplier')f.db.prepare('UPDATE purchase_orders SET supplier=? WHERE number=?').run('another',number(A,2));
   if(kind==='store')f.db.prepare('UPDATE purchase_orders SET location_id=? WHERE number=?').run(f.ids.storeB,number(A,2));
   if(kind==='ingredient')f.db.prepare('UPDATE ingredients SET active=0 WHERE id=?').run(f.ingredients[0]);
   assert.equal((await act(f,'manager')).status,409,kind);
   assert.equal(audit(f).length,0);assert.equal(ledger(f).length,0);
 }
});

test('preexisting receipt ledger prevents duplicate credits even if group still approved',async t=>{
 const f=await fixture(t);
 f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE number GLOB ?").run(A+'-[0-9][0-9][0-9]');
 f.db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id) VALUES(?,?,?,?,?,?)")
  .run(randomUUID(),f.ingredients[0],f.ids.storeA,2,'purchase',f.groupItems[0]);
 assert.equal((await act(f,'manager','order.batch-receive')).status,503);
 assert.equal(ledger(f).length,1);
 assert.ok(rows(f).every(o=>o.status==='approved'));
 assert.equal(audit(f).length,0);
});

test('schema, method, input, CSRF, origin, revoked session and public route remain closed',async t=>{
 const f=await fixture(t);
 assert.equal((await act(f,'manager','order.batch-approve',A,{phase:'disabled'})).status,503);
 assert.equal((await act(f,'manager','order.batch-approve',A,{stage:'off'})).status,503);
 assert.equal((await act(f,'manager','order.batch-approve',A,{method:'GET'})).status,405);
 assert.equal((await act(f,'manager','order.batch-approve',A,{body:'no'})).status,400);
 assert.equal((await act(f,'manager','order.batch-create')).status,400);
 assert.equal((await act(f,'manager','order.batch-approve',A,{body:JSON.stringify({action:'order.batch-approve',data:{number:A,qty:100}})})).status,400);
 assert.equal((await act(f,'manager','order.batch-approve',A,{headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await act(f,'manager','order.batch-approve',A,{headers:{'x-csrf-token':'bad'}})).status,403);
 const worker=(await workerPromise).default;
 const request=new Request('https://private.example/api/command',{method:'POST',
  headers:{origin:'https://private.example','content-type':'application/json',
   cookie:f.cookies.manager,'x-csrf-token':f.csrf.manager},
  body:JSON.stringify({action:'order.batch-receive',data:{number:A}})});
 const raw=await worker.fetch(request,{DB:f.d1,CLOUD_AUTH_PHASE:'preview-readonly',GROUP_ORDER_WRITE_STAGE:'internal-test-only'});
 assert.equal(raw.status,503);
 f.db.prepare('DELETE FROM cloud_schema_contract').run();
 assert.equal((await act(f,'manager')).status,503);
 f.db.prepare('INSERT INTO cloud_schema_contract(id,contract_version) VALUES(1,3)').run();
 f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.manager);
 assert.equal((await act(f,'manager')).status,401);
 assert.equal(audit(f).length,0);assert.equal(ledger(f).length,0);
});

test('SQL failure at every batched statement rolls back every grouped line',async t=>{
 for(const receive of [false,true]){
  for(const failAt of receive?[0,1,2,3]:[0,1,2]){
   const f=await fixture(t,{failAt});
   if(receive) f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE number GLOB ?")
     .run(A+'-[0-9][0-9][0-9]');
   const original=rows(f).map(o=>o.status);
   assert.equal((await act(f,'manager',receive?'order.batch-receive':'order.batch-approve')).status,503);
   assert.deepEqual(rows(f).map(o=>o.status),original);
   assert.equal(audit(f).length,0);assert.equal(ledger(f).length,0);
  }
 }
});

test('interleaving role revocation, store disable, item status and group extension cause DB constraint rollback',async t=>{
 for(const kind of ['role','location','status','extra']){
   let f;
   f=await fixture(t,{beforeBatch(){
     if(kind==='role')f.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ids.manager);
     if(kind==='location')f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
     if(kind==='status')f.db.prepare("UPDATE purchase_orders SET status='cancelled' WHERE number=?").run(number(A,2));
     if(kind==='extra')f.db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)')
       .run(randomUUID(),number(A,4),f.ids.storeA,f.ingredients[0],'供應商甲',1,f.ids.staff);
   }});
   const res=await act(f,'manager');
   assert.equal(res.status,503,kind);
   assert.equal(audit(f).length,0);assert.equal(ledger(f).length,0);
   assert.equal(rows(f)[0].status,'requested');
 }
});

test('session expiry cutoff is captured once for the group transaction',async t=>{
 const f=await fixture(t);
 const NativeDate=global.Date,point=NativeDate.now();
 f.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?')
   .run(new NativeDate(point+1000).toISOString(),f.ids.manager);
 let reads=0;
 class Clock extends NativeDate{
  constructor(...args){if(args.length) super(...args);else super(++reads<=2?point:point+60000);}
  static now(){return point;}
 }
 let res;
 try{
  global.Date=Clock;
  res=await act(f,'manager');
 }finally{global.Date=NativeDate;}
 assert.equal(res.status,200);
 assert.equal(reads,2);
 assert.ok(rows(f).every(o=>o.status==='approved'));
 assert.equal(audit(f).length,1);
});
