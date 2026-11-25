'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const worker=import('../cloudflare/worker.mjs'),site='https://leave.example.workers.dev';
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
  CLOUD_NATIVE_LEAVE_WRITE_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:'synthetic-leave-test-pepper-long-enough',
  DB:{prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
   async batch(steps){opt.beforeBatch?.(db);db.exec('BEGIN IMMEDIATE');
    try{const out=[];for(let i=0;i<steps.length;i++){
     if(opt.failAt===i)throw Error('synthetic failure');out.push(await steps[i].run());
    }db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
   }}};
 const create=(over={})=>({action:'leave.create',data:{user_id:ids.staff,location_id:ids.store,start_date:'2026-12-01',end_date:'2026-12-02',reason:'private synthetic reason',...over}});
 const review=(id,status='approved')=>({action:'leave.review',data:{id,status}});
 const send=async(who,body=create(),opts={})=>{
  const s=sessions[who]??{};
  const req=new Request(site+'/api/leave',{method:'POST',headers:{origin:site,'sec-fetch-site':'same-origin',
   'content-type':'application/json','x-idempotency-key':opts.key??randomUUID(),
   ...(s.cookie?{cookie:s.cookie,'x-csrf-token':s.csrf}:{}),...opts.headers},body:JSON.stringify(body)});
  return (await worker).default.fetch(req,opts.env??env);
 };
 const snapshot=()=>({leaves:db.prepare('SELECT * FROM leave_requests ORDER BY id').all(),audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all()});
 return {db,ids,env,create,review,send,snapshot};
}
test('staff self application, manager review, no duplicate or private reason in audit',async t=>{
 const f=await fixture(t),key=randomUUID();
 assert.equal((await f.send('staff',f.create(),{key})).status,200);
 assert.equal((await f.send('staff',f.create(),{key:key.toUpperCase()})).status,409);
 assert.equal((await f.send('staff',f.review(key))).status,403);
 assert.equal((await f.send('manager',f.review(key))).status,200);
 assert.equal((await f.send('owner',f.review(key,'rejected'))).status,409);
 const s=f.snapshot();assert.equal(s.leaves.length,1);assert.equal(s.leaves[0].status,'approved');
 assert.equal(s.leaves[0].reviewer_id,f.ids.manager);assert.equal(s.audit.length,2);
 assert(!JSON.stringify(s.audit).includes('private synthetic reason'));
 assert.deepEqual(s.audit.map(a=>a.entity_id),[key,key]);
});
test('default off, session, scope, target, CSRF, dates and unknown fields fail closed',async t=>{
 const f=await fixture(t),before=f.snapshot();
 assert.equal((await f.send('staff',f.create(),{env:{...f.env,CLOUD_NATIVE_LEAVE_WRITE_GATE:undefined}})).status,503);
 assert.equal((await f.send('none')).status,401);
 assert.equal((await f.send('staff',f.create({user_id:f.ids.manager}))).status,403);
 assert.equal((await f.send('manager',f.create({location_id:f.ids.other,user_id:f.ids.otherStaff}))).status,403);
 assert.equal((await f.send('manager',f.create({user_id:f.ids.owner}))).status,404);
 assert.equal((await f.send('staff',f.create(),{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.send('staff',f.create(),{headers:{origin:'https://evil.invalid'}})).status,403);
 for(const over of [{start_date:'2026-02-30'},{end_date:'2026-11-01'},{reason:' '},{reason:'a'.repeat(401)},{unknown:1}])
  assert.equal((await f.send('staff',f.create(over))).status,400);
 assert.deepEqual(f.snapshot(),before);
});
test('manager cannot review own, other store, or Owner request',async t=>{
 const f=await fixture(t);
 for(const [who,over,expected] of [['manager',{user_id:f.ids.manager},403],
  ['otherStaff',{user_id:f.ids.otherStaff,location_id:f.ids.other},404],['owner',{user_id:f.ids.owner},403]]){
  const key=randomUUID();assert.equal((await f.send(who,f.create(over),{key})).status,200);
  const before=f.snapshot();assert.equal((await f.send('manager',f.review(key))).status,expected);
  assert.deepEqual(f.snapshot(),before);
 }
});
test('all three transaction fault positions preserve create and review rows/audit',async t=>{
 for(const action of ['create','review'])for(let failAt=0;failAt<3;failAt++)await t.test(action+' '+failAt,async sub=>{
  const opt={},f=await fixture(sub,opt),key=randomUUID();
  if(action==='review')assert.equal((await f.send('staff',f.create(),{key})).status,200);
  const before=f.snapshot();opt.failAt=failAt;
  assert.equal((await f.send(action==='create'?'staff':'manager',action==='create'?f.create():f.review(key),{key})).status,503);
  assert.deepEqual(f.snapshot(),before);
 });
});
test('transaction-time session and store grant revocation cannot leave audit or partial write',async t=>{
 for(const kind of ['session','grant','target'])await t.test(kind,async sub=>{
  let f;const opt={};f=await fixture(sub,opt);const before=f.snapshot();
  opt.beforeBatch=db=>{
   if(kind==='session')db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.manager);
   if(kind==='grant')db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.manager);
   if(kind==='target')db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
  };
  assert.equal((await f.send('manager',f.create())).status,503);
  assert.deepEqual(f.snapshot(),before);
 });
});
test('review race cannot overwrite concurrent decision or append false audit',async t=>{
 const opt={},f=await fixture(t,opt),key=randomUUID();
 assert.equal((await f.send('staff',f.create(),{key})).status,200);
 let raced;
 opt.beforeBatch=db=>{db.prepare("UPDATE leave_requests SET status='rejected',reviewer_id=? WHERE id=?").run(f.ids.owner,key);raced=f.snapshot();};
 assert.equal((await f.send('manager',f.review(key))).status,503);
 assert.deepEqual(f.snapshot(),raced);
});
