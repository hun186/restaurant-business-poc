'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const worker=import('../cloudflare/worker.mjs'),site='https://evaluation.example.workers.dev';
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
  CLOUD_NATIVE_EVALUATION_WRITE_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:'synthetic-leave-test-pepper-long-enough',
  DB:{prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
   async batch(steps){opt.beforeBatch?.(db);db.exec('BEGIN IMMEDIATE');
    try{const out=[];for(let i=0;i<steps.length;i++){
     if(opt.failAt===i)throw Error('synthetic failure');out.push(await steps[i].run());
    }db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
   }}};
 const create=(over={})=>({action:'evaluation.create',data:{user_id:ids.staff,location_id:ids.store,period:'2026-11',score:85,feedback:'private feedback',...over}});
 const send=async(who,body=create(),opts={})=>{
  const s=sessions[who]??{};
  const req=new Request(site+'/api/evaluation',{method:'POST',headers:{origin:site,'sec-fetch-site':'same-origin',
   'content-type':'application/json','x-idempotency-key':opts.key??randomUUID(),
   ...(s.cookie?{cookie:s.cookie,'x-csrf-token':s.csrf}:{}),...opts.headers},body:opts.raw??JSON.stringify(body)});
  return (await worker).default.fetch(req,opts.env??env);
 };
 const snapshot=()=>({evaluations:db.prepare('SELECT * FROM evaluations ORDER BY id').all(),audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all()});
 const capability=async(who,e=env,headers={})=>{
  const s=sessions[who]??{};
  return (await worker).default.fetch(new Request(site+'/api/evaluation/capability',
   {headers:{'sec-fetch-site':'same-origin',...(s.cookie?{cookie:s.cookie}:{}),...headers}}),e);
 };
 return {db,ids,env,create,send,snapshot,capability};
}


test('append-only evaluation, UUID replay denied, no private HR content in audit',async t=>{
 const f=await fixture(t),key=randomUUID();
 const r=await f.send('manager',f.create(),{key});assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{ok:true,result:{id:key}});
 assert.equal((await f.send('owner',f.create({score:95}),{key:key.toUpperCase()})).status,409);
 const s=f.snapshot();assert.equal(s.evaluations.length,1);assert.equal(s.evaluations[0].score,85);
 assert.equal(s.evaluations[0].reviewer_id,f.ids.manager);assert.equal(s.audit.length,1);
 assert.equal(s.audit[0].action,'evaluation.create');assert.equal(s.audit[0].entity_id,key);
 assert.equal(s.audit[0].detail,'{}');assert(!JSON.stringify(s.audit).includes('private feedback'));
 // Distinct assessment in the same period remains permitted by existing schema.
 assert.equal((await f.send('owner',f.create({score:95}))).status,200);
 assert.equal(f.snapshot().evaluations.length,2);
});
test('gate, scope, self evaluation, active target and strict input',async t=>{
 const f=await fixture(t),before=f.snapshot();
 assert.equal((await f.send('manager',f.create(),{env:{...f.env,CLOUD_NATIVE_EVALUATION_WRITE_GATE:undefined}})).status,503);
 assert.equal((await f.send('none')).status,401);assert.equal((await f.send('staff')).status,403);
 assert.equal((await f.send('manager',f.create({user_id:f.ids.manager}))).status,403);
 assert.equal((await f.send('manager',f.create({user_id:f.ids.otherStaff,location_id:f.ids.other}))).status,403);
 assert.equal((await f.send('owner',f.create({user_id:f.ids.otherStaff}))).status,404);
 assert.equal((await f.send('owner',f.create({user_id:f.ids.owner}))).status,403);
 assert.equal((await f.send('manager',f.create(),{headers:{'x-csrf-token':'bad'}})).status,403);
 for(const x of [{score:-1},{score:101},{score:80.5},{score:'80'},{period:' '},{period:'a'.repeat(31)},{period:'x\nz'},{feedback:'x'.repeat(1001)},{unexpected:true}])
  assert.equal((await f.send('manager',f.create(x))).status,400);
 assert.deepEqual(f.snapshot(),before);
});
test('each atomic failure position leaves no evaluation or audit',async t=>{
 for(let failAt=0;failAt<3;failAt++)await t.test(String(failAt),async sub=>{
  const f=await fixture(sub,{failAt}),before=f.snapshot();
  assert.equal((await f.send('manager')).status,503);assert.deepEqual(f.snapshot(),before);
 });
});
test('transaction-time actor, target, session, store, grant and replay races',async t=>{
 for(const kind of ['session','actor','grant','target','targetGrant','store','duplicate'])await t.test(kind,async sub=>{
  const opt={},f=await fixture(sub,opt),key=randomUUID();let raced;
  opt.beforeBatch=db=>{
   if(kind==='session')db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.manager);
   if(kind==='actor')db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ids.manager);
   if(kind==='grant')db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.manager);
   if(kind==='target')db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
   if(kind==='targetGrant')db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.staff);
   if(kind==='store')db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.store);
   if(kind==='duplicate')db.prepare('INSERT INTO evaluations(id,user_id,location_id,period,score,reviewer_id) VALUES(?,?,?,?,?,?)').run(key,f.ids.staff,f.ids.store,'2026-11',70,f.ids.owner);
   raced=f.snapshot();
  };
  assert.equal((await f.send('manager',f.create(),{key})).status,503);
  assert.deepEqual(f.snapshot(),raced);
 });
});

test('maximum valid Chinese feedback survives byte limit and oversized requests are rejected without mutation',async t=>{
 const f=await fixture(t),value='評'.repeat(1000);
 const body=f.create({period:'期'.repeat(30),feedback:value});
 const raw=JSON.stringify(body),size=Buffer.byteLength(raw,'utf8');assert(size>2048&&size<8192);
 const key=randomUUID();assert.equal((await f.send('manager',body,{key,headers:{'content-length':String(size)}})).status,200);
 const saved=f.snapshot();assert.equal(saved.evaluations[0].feedback,value);
 assert.equal((await f.send('manager',f.create({feedback:value+'字'}))).status,400);
 assert.equal((await f.send('manager',body,{raw:raw+' '.repeat(8193-size)})).status,400);
 assert.equal((await f.send('manager',body,{headers:{'content-length':'8193'}})).status,413);
 assert.deepEqual(f.snapshot(),saved);
});
