'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const authPromise=import('../cloudflare/auth-core.mjs');
const handlerPromise=import('../cloudflare/order-write-internal.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const schema=fs.readFileSync(path.join(__dirname,'..','cloudflare','migrations','0001_initial_v3.sql'),'utf8');

function d1(db,options={}){
  const prepared=(sql,args=[])=>({
    first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})
  });
  return {
    prepare(sql){return {...prepared(sql),bind:(...args)=>prepared(sql,args)};},
    async batch(statements){
      if(options.beforeBatch) options.beforeBatch();
      db.exec('BEGIN IMMEDIATE');
      try{
        const out=[];
        for(let i=0;i<statements.length;i++){
          if(options.failAt===i) throw Error('E_TEST_SQL_ERROR');
          out.push(await statements[i].run());
        }
        db.exec('COMMIT');return out;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }
  };
}
async function fixture(t,options={}){
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());
  db.exec(schema);
  const ids={
    storeA:randomUUID(),storeB:randomUUID(),
    owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),other:randomUUID(),
    orderA:randomUUID(),orderB:randomUUID(),grouped:randomUUID()
  };
  for(const [id,name] of [[ids.storeA,'虛構中和'],[ids.storeB,'虛構板橋']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  const ing=randomUUID();
  db.prepare('INSERT INTO ingredients(id,sku,name,unit) VALUES(?,?,?,?)').run(ing,'SYN-ING','合成測試食材','kg');
  const auth=await authPromise, cookies={},csrf={};
  for(const [name,role,uid,stores] of [
    ['owner','owner',ids.owner,[ids.storeA]],
    ['manager','manager',ids.manager,[ids.storeA]],
    ['staff','staff',ids.staff,[ids.storeA]],
    ['other','manager',ids.other,[ids.storeB]]
  ]){
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(uid,name,'虛構'+name,role,'x','x');
    for(const loc of stores)
      db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(uid,loc);
    const token=auth.freshSessionToken();csrf[name]=auth.freshSessionToken();
    db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
      .run(await auth.tokenSha256(token),csrf[name],uid,new Date(Date.now()+3600000).toISOString());
    cookies[name]=auth.SESSION_COOKIE+'='+token;
  }
  for(const [id,number,loc,creator] of [
    [ids.orderA,'PO-SYN-A',ids.storeA,ids.staff],
    [ids.orderB,'PO-SYN-B',ids.storeB,ids.other],
    [ids.grouped,'POB-'+'A'.repeat(32)+'-001',ids.storeA,ids.staff]
  ])
    db.prepare('INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) VALUES(?,?,?,?,?,?,?)')
      .run(id,number,loc,ing,'虛構供應商',7,creator);
  return {db,d1:d1(db,options),ids,ing,cookies,csrf};
}
async function request(f,role,action,id,overrides={}){
  const fn=(await handlerPromise).internalOrderMutation;
  const body=overrides.body??JSON.stringify({action,data:{id}});
  const method=overrides.method||'POST';
  const req=new Request('https://protected.example/api/command',{
    method,body:method==='GET'?undefined:body,
    headers:{cookie:f.cookies[role]||'','content-type':'application/json',
      origin:'https://protected.example','x-csrf-token':f.csrf[role]||'',...overrides.headers}
  });
  return fn(req,{DB:f.d1,CLOUD_AUTH_PHASE:overrides.phase||'preview-readonly',
    ORDER_WRITE_STAGE:overrides.stage||'internal-test-only'});
}
const state=(f,id)=>f.db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(id).status;
const audit=f=>f.db.prepare('SELECT action,actor_name,entity_id,detail FROM audit_logs ORDER BY rowid').all();
const moves=f=>f.db.prepare("SELECT id,location_id,ingredient_id,qty_delta,move_type,reference_id FROM stock_moves ORDER BY rowid").all();

test('manager approval, then receiving posts exactly one D1 ledger credit and both audits',async t=>{
  const f=await fixture(t);
  let res=await request(f,'manager','order.approve',f.ids.orderA);
  assert.equal(res.status,200);assert.equal(state(f,f.ids.orderA),'approved');
  assert.equal(moves(f).length,0);
  assert.equal(audit(f).length,1);
  assert.deepEqual(JSON.parse(audit(f)[0].detail),{from:'requested',to:'approved'});
  res=await request(f,'manager','order.receive',f.ids.orderA);
  assert.equal(res.status,200);assert.equal(state(f,f.ids.orderA),'received');
  assert.equal(moves(f).length,1);assert.equal(audit(f).length,2);
  assert.equal(moves(f)[0].reference_id,f.ids.orderA);
  assert.equal(moves(f)[0].location_id,f.ids.storeA);
  assert.equal(moves(f)[0].qty_delta,7);
  assert.equal(moves(f)[0].move_type,'purchase');
  assert.deepEqual(audit(f).map(a=>a.action),['order.approve','order.receive']);
  assert.equal(f.db.prepare('SELECT SUM(qty_delta) AS n FROM stock_moves WHERE ingredient_id=? AND location_id=?').get(f.ing,f.ids.storeA).n,7);
  for(const a of ['order.approve','order.receive'])
    assert.equal((await request(f,'manager',a,f.ids.orderA)).status,409);
  assert.equal(moves(f).length,1);assert.equal(audit(f).length,2);
});

test('receiving without approval, after cancel or after prior receive does not stock credit',async t=>{
  const f=await fixture(t);
  assert.equal((await request(f,'manager','order.receive',f.ids.orderA)).status,409);
  f.db.prepare("UPDATE purchase_orders SET status='cancelled' WHERE id=?").run(f.ids.orderA);
  assert.equal((await request(f,'manager','order.receive',f.ids.orderA)).status,409);
  assert.equal((await request(f,'manager','order.approve',f.ids.orderA)).status,409);
  assert.equal(moves(f).length,0);assert.equal(audit(f).length,0);
});

test('manager cross-store, staff approval, inactive store/ingredient and grouped order denied',async t=>{
  const f=await fixture(t);
  assert.equal((await request(f,'staff','order.approve',f.ids.orderA)).status,403);
  assert.equal((await request(f,'manager','order.approve',f.ids.orderB)).status,404);
  assert.equal((await request(f,'manager','order.approve',f.ids.grouped)).status,409);
  assert.equal((await request(f,'manager','order.approve',randomUUID())).status,404);
  f.db.prepare('UPDATE ingredients SET active=0 WHERE id=?').run(f.ing);
  assert.equal((await request(f,'manager','order.approve',f.ids.orderA)).status,404);
  f.db.prepare('UPDATE ingredients SET active=1 WHERE id=?').run(f.ing);
  f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
  assert.equal((await request(f,'manager','order.approve',f.ids.orderA)).status,404);
  assert.equal((await request(f,'owner','order.approve',f.ids.orderA)).status,404);
  assert.equal(audit(f).length,0);assert.equal(moves(f).length,0);
});

test('pre-existing purchase ledger reference prevents duplicate receive and leaves state untouched',async t=>{
  const f=await fixture(t);
  f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(f.ids.orderA);
  f.db.prepare("INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(),f.ing,f.ids.storeA,7,'purchase',f.ids.orderA);
  assert.equal((await request(f,'manager','order.receive',f.ids.orderA)).status,409);
  assert.equal(state(f,f.ids.orderA),'approved');
  assert.equal(moves(f).length,1);assert.equal(audit(f).length,0);
});

test('reject malformed input, CSRF/origin mismatch, non-POST and revoked session without changes',async t=>{
  const f=await fixture(t);
  const id=f.ids.orderA;
  assert.equal((await request(f,'manager','order.approve',id,{headers:{origin:'https://evil.example'}})).status,403);
  assert.equal((await request(f,'manager','order.approve',id,{headers:{'x-csrf-token':'invalid'}})).status,403);
  assert.equal((await request(f,'manager','order.approve',id,{method:'GET'})).status,405);
  assert.equal((await request(f,'manager','order.approve',id,{body:'not-json'})).status,400);
  assert.equal((await request(f,'manager','order.unknown',id)).status,400);
  assert.equal((await request(f,'manager','order.receive',id,{body:JSON.stringify({action:'order.receive',data:{id,qty:50000}})})).status,400);
  f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.manager);
  assert.equal((await request(f,'manager','order.approve',id)).status,401);
  assert.equal(state(f,id),'requested');
  assert.equal(audit(f).length,0);assert.equal(moves(f).length,0);
});

test('production/missing internal-only config and public Worker routing always block write',async t=>{
  const f=await fixture(t);
  assert.equal((await request(f,'manager','order.approve',f.ids.orderA,{phase:'disabled'})).status,503);
  assert.equal((await request(f,'manager','order.approve',f.ids.orderA,{stage:'disabled'})).status,503);
  const worker=(await workerPromise).default;
  const req=new Request('https://protected.example/api/command',{method:'POST',
    headers:{origin:'https://protected.example',cookie:f.cookies.manager,
      'content-type':'application/json','x-csrf-token':f.csrf.manager},
    body:JSON.stringify({action:'order.approve',data:{id:f.ids.orderA}})});
  const res=await worker.fetch(req,{DB:f.d1,CLOUD_AUTH_PHASE:'preview-readonly',
    ORDER_WRITE_STAGE:'internal-test-only'});
  assert.equal(res.status,503);
  assert.equal(state(f,f.ids.orderA),'requested');
  assert.equal(audit(f).length,0);
});

test('database errors at each D1 statement abort approval and receipt transaction',async t=>{
  for(const action of ['order.approve','order.receive']){
    for(const failAt of action==='order.approve'?[0,1]:[0,1,2]){
      const f=await fixture(t,{failAt});
      if(action==='order.receive')
        f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(f.ids.orderA);
      const before=state(f,f.ids.orderA);
      assert.equal((await request(f,'manager',action,f.ids.orderA)).status,503);
      assert.equal(state(f,f.ids.orderA),before);
      assert.equal(audit(f).length,0);assert.equal(moves(f).length,0);
    }
  }
});

test('role revocation or store shutdown between preliminary read and D1 batch fails closed',async t=>{
  for(const action of ['order.approve','order.receive']){
    for(const change of ['role','store']){
      let f;
      f=await fixture(t,{beforeBatch(){
        if(change==='role')f.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ids.manager);
        else f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
      }});
      if(action==='order.receive')
        f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(f.ids.orderA);
      const before=state(f,f.ids.orderA);
      const res=await request(f,'manager',action,f.ids.orderA);
      assert.equal(res.status,409,action+' / '+change);
      assert.equal(state(f,f.ids.orderA),before);
      assert.equal(audit(f).length,0);assert.equal(moves(f).length,0);
    }
  }
});

test('one session-expiry cutoff across audit, stock movement and received status predicates',async t=>{
  const f=await fixture(t);
  f.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(f.ids.orderA);
  const RealDate=global.Date;
  const point=RealDate.now();
  // Session starts valid but expires between two Date() reads. Prior code
  // sampled Date separately in each condition() and committed a partial
  // audit + stock credit while leaving the order approved.
  f.db.prepare('UPDATE sessions SET expires_at=? WHERE user_id=?')
    .run(new RealDate(point+1000).toISOString(),f.ids.manager);
  let calls=0;
  class AdvancingClock extends RealDate{
    constructor(...args){
      if(args.length) super(...args);
      else super(++calls<=2 ? point : point+60000);
    }
    static now(){return point;}
  }
  let result;
  try {
    global.Date=AdvancingClock;
    result=await request(f,'manager','order.receive',f.ids.orderA);
  } finally {
    global.Date=RealDate;
  }
  assert.equal(result.status,200,'receipt must not commit ledger without changing order state');
  assert.equal(state(f,f.ids.orderA),'received');
  assert.equal(moves(f).length,1);
  assert.equal(audit(f).length,1);
  assert.deepEqual(audit(f).map(a=>a.action),['order.receive']);
  assert.equal(calls,2,'one principal validation and one shared transaction cutoff');
});

test('schema incompatible and changed order number before batch cannot cause partial receive',async t=>{
  const f=await fixture(t);
  f.db.prepare('DELETE FROM cloud_schema_contract').run();
  assert.equal((await request(f,'manager','order.approve',f.ids.orderA)).status,503);
  assert.equal(audit(f).length,0);
  let g;g=await fixture(t,{beforeBatch(){
    g.db.prepare("UPDATE purchase_orders SET number=? WHERE id=?").run('POB-'+'B'.repeat(32)+'-001',g.ids.orderA);
  }});
  g.db.prepare("UPDATE purchase_orders SET status='approved' WHERE id=?").run(g.ids.orderA);
  assert.equal((await request(g,'manager','order.receive',g.ids.orderA)).status,409);
  assert.equal(state(g,g.ids.orderA),'approved');
  assert.equal(audit(g).length,0);assert.equal(moves(g).length,0);
});
