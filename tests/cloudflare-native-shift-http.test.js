'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const worker=import('../cloudflare/worker.mjs'),site='https://shift.example.workers.dev';
async function fixture(t,opt={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
 db.exec(fs.readFileSync(path.join(__dirname,'../cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
 const ids=Object.fromEntries(['owner','manager','staff','otherStaff','store','other'].map(k=>[k,randomUUID()]));
 const sessions={};
 for(const l of ['store','other'])db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(ids[l],l);
 for(const [name,role,location] of [['owner','owner',null],['manager','manager','store'],['staff','staff','store'],['otherStaff','staff','other']]){
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(ids[name],name,name,role,'synthetic-salt','synthetic-hash');
  if(location)db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(ids[name],ids[location]);
  const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run(createHash('sha256').update(token).digest('hex'),csrf,ids[name],new Date(Date.now()+3600000).toISOString());
  sessions[name]={cookie:'__Host-restaurant_session='+token,csrf};
 }
 const stmt=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),all:async()=>({results:db.prepare(sql).all(...args)}),run:async()=>({meta:db.prepare(sql).run(...args)})});
 const env={CLOUD_AUTH_PHASE:'native-production',CLOUD_NATIVE_LOGIN_GATE:'operator-released',
  CLOUD_NATIVE_SHIFT_WRITE_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:'synthetic-leave-test-pepper-long-enough',
  DB:{prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
   async batch(steps){opt.beforeBatch?.(db);db.exec('BEGIN IMMEDIATE');
    try{const out=[];for(let i=0;i<steps.length;i++){
     if(opt.failAt===i)throw Error('synthetic failure');out.push(await steps[i].run());
    }db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
   }}};
 const create=(over={})=>({action:'shift.create',data:{user_id:ids.staff,location_id:ids.store,shift_date:'2026-12-31',start_time:'22:00',end_time:'06:00',note:'private shift note',...over}});
 const send=async(who,body=create(),opts={})=>{
  const s=sessions[who]??{};
  const req=new Request(site+'/api/shift',{method:'POST',headers:{origin:site,'sec-fetch-site':'same-origin',
   'content-type':'application/json','x-idempotency-key':opts.key??randomUUID(),
   ...(s.cookie?{cookie:s.cookie,'x-csrf-token':s.csrf}:{}),...opts.headers},body:JSON.stringify(body)});
  return (await worker).default.fetch(req,opts.env??env);
 };
 const snapshot=()=>({shifts:db.prepare('SELECT * FROM shifts ORDER BY id').all(),audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all()});
 return {db,ids,env,create,send,snapshot};
}

test('manager creates overnight shift; cross-store overlap denied without disclosing another store',async t=>{
 const f=await fixture(t),key=randomUUID();
 f.db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(f.ids.staff,f.ids.other);
 assert.equal((await f.send('owner',f.create({location_id:f.ids.other}),{key})).status,200);
 const before=f.snapshot();
 const conflict=await f.send('manager',f.create({shift_date:'2027-01-01',start_time:'04:00',end_time:'09:00'}));
 assert.equal(conflict.status,409);assert.deepEqual(await conflict.json(),{code:'E_SHIFT_OVERLAP'});
 assert.deepEqual(f.snapshot(),before);
 const next=randomUUID();
 assert.equal((await f.send('manager',f.create({shift_date:'2027-01-01',start_time:'06:00',end_time:'09:00'}),{key:next})).status,200);
 assert.equal((await f.send('manager',f.create({shift_date:'2027-01-01',start_time:'06:00',end_time:'09:00'}),{key:next.toUpperCase()})).status,409);
 const result=f.snapshot();assert.equal(result.shifts.length,2);assert.equal(result.audit.length,2);
 assert(!JSON.stringify(result.audit).includes('private shift note'));
});
test('gate, role, store, target, CSRF, date, time, note and exact input checks reject writes',async t=>{
 const f=await fixture(t),before=f.snapshot();
 assert.equal((await f.send('manager',f.create(),{env:{...f.env,CLOUD_NATIVE_SHIFT_WRITE_GATE:undefined}})).status,503);
 assert.equal((await f.send('none')).status,401);
 assert.equal((await f.send('staff')).status,403);
 assert.equal((await f.send('manager',f.create({location_id:f.ids.other,user_id:f.ids.otherStaff}))).status,403);
 assert.equal((await f.send('manager',f.create({user_id:f.ids.otherStaff}))).status,404);
 assert.equal((await f.send('owner',f.create({user_id:f.ids.owner}))).status,404);
 assert.equal((await f.send('manager',f.create(),{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.send('manager',f.create(),{headers:{origin:'https://evil.invalid'}})).status,403);
 for(const over of [{shift_date:'2026-02-30'},{start_time:'24:00'},{end_time:'22:00'},{note:'x'.repeat(201)},{unknown:1}])
  assert.equal((await f.send('manager',f.create(over))).status,400);
 assert.deepEqual(f.snapshot(),before);
});
test('transaction rejects all three injected failure positions without partial shifts or audits',async t=>{
 for(let failAt=0;failAt<3;failAt++)await t.test(String(failAt),async sub=>{
  const f=await fixture(sub,{failAt}),before=f.snapshot();
  assert.equal((await f.send('manager')).status,503);assert.deepEqual(f.snapshot(),before);
 });
});
test('transaction rechecks actor, target, active store, grants and session',async t=>{
 for(const kind of ['session','actor','grant','target','targetGrant','store'])await t.test(kind,async sub=>{
  let f;const opt={};f=await fixture(sub,opt);const before=f.snapshot();
  opt.beforeBatch=db=>{
   if(kind==='session')db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.manager);
   if(kind==='actor')db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ids.manager);
   if(kind==='grant')db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.manager);
   if(kind==='target')db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
   if(kind==='targetGrant')db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.staff);
   if(kind==='store')db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.store);
  };
  assert.equal((await f.send('manager')).status,503);assert.deepEqual(f.snapshot(),before);
 });
});
test('concurrent cross-store overnight shift inserted after precheck cannot create overlap or false audit',async t=>{
 const opt={},f=await fixture(t,opt),concurrent=randomUUID();let raced;
 f.db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(f.ids.staff,f.ids.other);
 opt.beforeBatch=db=>{
  db.prepare('INSERT INTO shifts(id,location_id,user_id,shift_date,start_time,end_time,created_by) VALUES(?,?,?,?,?,?,?)')
   .run(concurrent,f.ids.other,f.ids.staff,'2027-01-01','04:00','08:00',f.ids.owner);
  raced=f.snapshot();
 };
 assert.equal((await f.send('manager')).status,503);assert.deepEqual(f.snapshot(),raced);
 assert.equal(f.snapshot().shifts[0].id,concurrent);
});
