'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const authPromise=import('../cloudflare/auth-core.mjs');
const handlerPromise=import('../cloudflare/stocktake-write-internal.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const schema=fs.readFileSync(path.join(__dirname,'..','cloudflare/migrations/0001_initial_v3.sql'),'utf8');
function d1(db,opts={}){
 const prepared=(sql,args=[])=>({
   first:async()=>db.prepare(sql).get(...args),
   all:async()=>({results:db.prepare(sql).all(...args)}),
   run:async()=>({meta:db.prepare(sql).run(...args)})
 });
 return {prepare(sql){return {...prepared(sql),bind:(...args)=>prepared(sql,args)};},
   async batch(queries) {
     opts.beforeBatch?.();
     db.exec('BEGIN IMMEDIATE');
     try {
       const results=[];
       for(let i=0;i<queries.length;i++){
         if(opts.failAt===i) throw Error('synthetic D1 SQL failure');
         results.push(await queries[i].run());
       }
       db.exec('COMMIT');return results;
     }catch(err){db.exec('ROLLBACK');throw err;}
   }
 };
}
async function fixture(t,opts={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(schema);
 const ids={storeA:randomUUID(),storeB:randomUUID(),ing:randomUUID(),
   owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),other:randomUUID(),
   stocktake:randomUUID(),zero:randomUUID(),foreign:randomUUID()};
 for(const [id,label] of [[ids.storeA,'A'],[ids.storeB,'B']])
   db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,'測試門市'+label);
 db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)')
   .run(ids.ing,'STOCKTAKE-SYN','合成食材','kg');
 const cookies={},csrf={},auth=await authPromise;
 for(const [name,role,id,locations] of [
   ['owner','owner',ids.owner,[ids.storeA]],
   ['manager','manager',ids.manager,[ids.storeA]],
   ['staff','staff',ids.staff,[ids.storeA]],
   ['other','manager',ids.other,[ids.storeB]]
 ]){
   db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
     .run(id,name,'虛構'+name,role,'salt','hash');
   for(const loc of locations)db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,loc);
   const token=auth.freshSessionToken();csrf[name]=auth.freshSessionToken();
   db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
     .run(await auth.tokenSha256(token),csrf[name],id,new Date(Date.now()+3600000).toISOString());
   cookies[name]=auth.SESSION_COOKIE+'='+token;
 }
 db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES(?,?,?,?,?,?)")
   .run(randomUUID(),ids.ing,ids.storeA,8,'purchase',ids.manager);
 for(const [id,location,expected,counted] of [
   [ids.stocktake,ids.storeA,8,5],[ids.zero,ids.storeA,8,8],[ids.foreign,ids.storeB,0,2]
 ]){
   db.prepare('INSERT INTO stocktakes(id,location_id,ingredient_id,expected_qty,counted_qty,created_by) VALUES(?,?,?,?,?,?)')
     .run(id,location,ids.ing,expected,counted,ids.staff);
 }
 return {db,DB:d1(db,opts),ids,cookies,csrf};
}
async function command(f,role,id,opts={}){
 const fn=(await handlerPromise).internalStocktakeConfirm;
 const method=opts.method||'POST';
 const req=new Request('https://private.example/api/command',{
   method,body:method==='GET'?undefined:(opts.body??JSON.stringify({action:'stocktake.confirm',data:{id}})),
   headers:{'content-type':'application/json',cookie:f.cookies[role]||'',
     origin:'https://private.example','x-csrf-token':f.csrf[role]||'',...opts.headers}
 });
 return fn(req,{DB:f.DB,CLOUD_AUTH_PHASE:opts.phase??'preview-readonly',
   STOCKTAKE_WRITE_STAGE:opts.stage??'internal-test-only'});
}
const status=(f,id)=>f.db.prepare('SELECT status,confirmed_by FROM stocktakes WHERE id=?').get(id);
const balance=(f,l)=>f.db.prepare('SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?').get(f.ids.ing,l).n;
const adjustments=f=>f.db.prepare("SELECT reference_id,qty_delta,location_id,move_type FROM stock_moves WHERE move_type='adjustment'").all();
const audit=f=>f.db.prepare('SELECT action,entity_id,detail FROM audit_logs').all();

test('manager confirms count 5 against ledger 8 with one -3 adjustment and audit',async t=>{
 const f=await fixture(t);
 const res=await command(f,'manager',f.ids.stocktake);
 assert.equal(res.status,200);
 assert.deepEqual((await res.json()).result,{id:f.ids.stocktake,status:'confirmed',delta:-3});
 assert.equal(status(f,f.ids.stocktake).status,'confirmed');
 assert.equal(status(f,f.ids.stocktake).confirmed_by,f.ids.manager);
 assert.equal(balance(f,f.ids.storeA),5);
 assert.equal(adjustments(f).length,1);
 assert.equal(adjustments(f)[0].reference_id,f.ids.stocktake);
 assert.equal(adjustments(f)[0].qty_delta,-3);
 assert.equal(adjustments(f)[0].location_id,f.ids.storeA);
 assert.equal(audit(f).length,1);
 assert.equal(audit(f)[0].action,'stocktake.confirm');
 assert.deepEqual(JSON.parse(audit(f)[0].detail),{expected:8,counted:5,delta:-3});
 assert.equal((await command(f,'manager',f.ids.stocktake)).status,409);
 assert.equal(adjustments(f).length,1);
 assert.equal(audit(f).length,1);
});

test('equal count confirms once, adds audit but never writes zero-delta move',async t=>{
 const f=await fixture(t);
 let res=await command(f,'manager',f.ids.zero);
 assert.equal(res.status,200);
 assert.equal((await res.json()).result.delta,0);
 assert.equal(status(f,f.ids.zero).status,'confirmed');
 assert.equal(balance(f,f.ids.storeA),8);
 assert.equal(adjustments(f).length,0);
 assert.equal(audit(f).length,1);
 assert.equal((await command(f,'manager',f.ids.zero)).status,409);
 assert.equal(audit(f).length,1);
});

test('staff, cross-store manager, inactive store and inactive ingredient denied',async t=>{
 const f=await fixture(t);
 assert.equal((await command(f,'staff',f.ids.stocktake)).status,403);
 assert.equal((await command(f,'other',f.ids.stocktake)).status,404);
 assert.equal((await command(f,'manager',f.ids.foreign)).status,404);
 assert.equal((await command(f,'owner',f.ids.foreign)).status,200);
 f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
 assert.equal((await command(f,'manager',f.ids.stocktake)).status,404);
 assert.equal((await command(f,'owner',f.ids.stocktake)).status,404);
 f.db.prepare('UPDATE locations SET active=1 WHERE id=?').run(f.ids.storeA);
 f.db.prepare('UPDATE ingredients SET active=0 WHERE id=?').run(f.ids.ing);
 assert.equal((await command(f,'manager',f.ids.stocktake)).status,404);
 assert.equal(audit(f).length,1);
});

test('stock changed after count creation: reject stale expected balance without writing',async t=>{
 const f=await fixture(t);
 f.db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)")
   .run(randomUUID(),f.ids.ing,f.ids.storeA,-1,'usage');
 const res=await command(f,'manager',f.ids.stocktake);
 assert.equal(res.status,409);
 assert.equal((await res.json()).code,'E_STALE_STOCKTAKE');
 assert.equal(status(f,f.ids.stocktake).status,'pending');
 assert.equal(balance(f,f.ids.storeA),7);
 assert.equal(adjustments(f).length,0);
 assert.equal(audit(f).length,0);
});

test('prior adjustment referencing stocktake rejects replay even when state pending',async t=>{
 const f=await fixture(t);
 f.db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id) VALUES(?,?,?,?,?,?)")
   .run(randomUUID(),f.ids.ing,f.ids.storeA,-3,'adjustment',f.ids.stocktake);
 f.db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)")
   .run(randomUUID(),f.ids.ing,f.ids.storeA,3,'purchase');
 const res=await command(f,'manager',f.ids.stocktake);
 assert.equal(res.status,503);
 assert.equal(status(f,f.ids.stocktake).status,'pending');
 assert.equal(adjustments(f).length,1);
 assert.equal(audit(f).length,0);
});

test('invalid command, CSRF, Origin, revoked session and schema mismatch are blocked',async t=>{
 const f=await fixture(t),id=f.ids.stocktake;
 assert.equal((await command(f,'manager',id,{method:'GET'})).status,405);
 assert.equal((await command(f,'manager',id,{headers:{origin:'https://evil.example'}})).status,403);
 assert.equal((await command(f,'manager',id,{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await command(f,'manager',id,{body:'not-json'})).status,400);
 assert.equal((await command(f,'manager',id,{body:JSON.stringify({action:'stocktake.confirm',data:{id,location_id:f.ids.storeB}})})).status,400);
 assert.equal((await command(f,'manager',id,{body:JSON.stringify({action:'stocktake.create',data:{id}})})).status,400);
 assert.equal((await command(f,'manager',randomUUID())).status,404);
 f.db.prepare('DELETE FROM cloud_schema_contract').run();
 assert.equal((await command(f,'manager',id)).status,503);
 f.db.prepare('INSERT INTO cloud_schema_contract(id,contract_version) VALUES(1,3)').run();
 f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.manager);
 assert.equal((await command(f,'manager',id)).status,401);
 assert.equal(audit(f).length,0);
 assert.equal(adjustments(f).length,0);
});

test('production, missing internal flag and public Worker write route all remain 503',async t=>{
 const f=await fixture(t);
 assert.equal((await command(f,'manager',f.ids.stocktake,{phase:'disabled'})).status,503);
 assert.equal((await command(f,'manager',f.ids.stocktake,{stage:'off'})).status,503);
 const worker=(await workerPromise).default;
 const req=new Request('https://private.example/api/command',{method:'POST',
   headers:{origin:'https://private.example','content-type':'application/json',
     cookie:f.cookies.manager,'x-csrf-token':f.csrf.manager},
   body:JSON.stringify({action:'stocktake.confirm',data:{id:f.ids.stocktake}})});
 const res=await worker.fetch(req,{DB:f.DB,CLOUD_AUTH_PHASE:'preview-readonly',
   STOCKTAKE_WRITE_STAGE:'internal-test-only'});
 assert.equal(res.status,503);
 assert.equal(status(f,f.ids.stocktake).status,'pending');
 assert.equal(audit(f).length,0);
});

test('every synthetic D1 batch SQL error rolls back audit, adjustment and confirmation',async t=>{
 for(const [idKey,steps] of [['stocktake',4],['zero',3]]){
   for(let i=0;i<steps;i++){
     const f=await fixture(t,{failAt:i}),id=f.ids[idKey];
     assert.equal((await command(f,'manager',id)).status,503,idKey+' failure '+i);
     assert.equal(status(f,id).status,'pending');
     assert.equal(balance(f,f.ids.storeA),8);
     assert.equal(audit(f).length,0);
     assert.equal(adjustments(f).length,0);
   }
 }
});

test('stale ledger, role, store or count changed before batch forces rollback',async t=>{
 for(const kind of ['ledger','role','store','count','status']){
   let f;
   f=await fixture(t,{beforeBatch(){
     if(kind==='ledger')f.db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)")
       .run(randomUUID(),f.ids.ing,f.ids.storeA,2,'purchase');
     if(kind==='role')f.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ids.manager);
     if(kind==='store')f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
     if(kind==='count')f.db.prepare('UPDATE stocktakes SET counted_qty=4 WHERE id=?').run(f.ids.stocktake);
     if(kind==='status')f.db.prepare("UPDATE stocktakes SET status='confirmed' WHERE id=?").run(f.ids.stocktake);
   }});
   const res=await command(f,'manager',f.ids.stocktake);
   assert.equal(res.status,503,kind);
   assert.equal(status(f,f.ids.stocktake).status,kind==='status'?'confirmed':'pending');
   assert.equal(adjustments(f).length,0);
   assert.equal(audit(f).length,0);
   assert.equal(balance(f,f.ids.storeA),kind==='ledger'?10:8);
 }
});

test('zero-delta path rechecks stale stock and rolls back without an audit',async t=>{
 let f;f=await fixture(t,{beforeBatch(){
   f.db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type) VALUES(?,?,?,?,?)")
     .run(randomUUID(),f.ids.ing,f.ids.storeA,1,'purchase');
 }});
 assert.equal((await command(f,'manager',f.ids.zero)).status,503);
 assert.equal(status(f,f.ids.zero).status,'pending');
 assert.equal(audit(f).length,0);
 assert.equal(adjustments(f).length,0);
 assert.equal(balance(f,f.ids.storeA),9);
});

test('shared session-expiry cutoff is evaluated once per confirmation batch',async t=>{
 const f=await fixture(t);
 const OriginalDate=global.Date,point=OriginalDate.now();
 f.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?')
   .run(new OriginalDate(point+1000).toISOString(),f.ids.manager);
 let reads=0;
 class Clock extends OriginalDate{
   constructor(...args){if(args.length)super(...args);else super(++reads<=2?point:point+60000);}
   static now(){return point;}
 }
 let res;
 try{global.Date=Clock;res=await command(f,'manager',f.ids.stocktake);}
 finally{global.Date=OriginalDate;}
 assert.equal(res.status,200);
 assert.equal(reads,2);
 assert.equal(status(f,f.ids.stocktake).status,'confirmed');
 assert.equal(adjustments(f).length,1);
 assert.equal(audit(f).length,1);
});
