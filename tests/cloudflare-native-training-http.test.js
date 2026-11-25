'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID,randomBytes,createHash}=require('node:crypto');
const worker=import('../cloudflare/worker.mjs'),site='https://training.example.workers.dev';
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
  CLOUD_NATIVE_TRAINING_WRITE_GATE:'operator-released',NATIVE_AUTH_SOURCE_PEPPER:'synthetic-leave-test-pepper-long-enough',
  DB:{prepare(sql){return {...stmt(sql),bind:(...args)=>stmt(sql,args)};},
   async batch(steps){opt.beforeBatch?.(db);db.exec('BEGIN IMMEDIATE');
    try{const out=[];for(let i=0;i<steps.length;i++){
     if(opt.failAt===i)throw Error('synthetic failure');out.push(await steps[i].run());
    }db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}
   }}};
 const create=(over={})=>({action:'course.create',data:{title:'Synthetic course',description:'private training description',required_score:80,...over}});
 const assign=(course,over={})=>({action:'training.assign',data:{course_id:course,user_id:ids.staff,location_id:ids.store,...over}});
 const score=(id,over={})=>({action:'training.score',data:{id,score:85,completed_on:'2026-12-01',...over}});
 const send=async(who,body=create(),opts={})=>{
  const s=sessions[who]??{};
  const req=new Request(site+'/api/training',{method:'POST',headers:{origin:site,'sec-fetch-site':'same-origin',
   'content-type':'application/json','x-idempotency-key':opts.key??randomUUID(),
   ...(s.cookie?{cookie:s.cookie,'x-csrf-token':s.csrf}:{}),...opts.headers},body:opts.raw??JSON.stringify(body)});
  return (await worker).default.fetch(req,opts.env??env);
 };
 const snapshot=()=>({courses:db.prepare('SELECT * FROM training_courses ORDER BY id').all(),
  records:db.prepare('SELECT * FROM training_records ORDER BY id').all(),audit:db.prepare('SELECT * FROM audit_logs ORDER BY id').all()});
 return {db,ids,env,create,assign,score,send,snapshot};
}


async function setup(f,assign=true){
 const course=randomUUID(),record=randomUUID();
 assert.equal((await f.send('manager',f.create(),{key:course})).status,200);
 if(assign)assert.equal((await f.send('manager',f.assign(course),{key:record})).status,200);
 return {course,record};
}
test('course, assignment, score and audit; duplicate and overwrite rejected',async t=>{
 const f=await fixture(t),{course,record}=await setup(f);
 assert.equal((await f.send('owner',f.assign(course))).status,409);
 assert.equal((await f.send('owner',f.create(),{key:course.toUpperCase()})).status,409);
 assert.equal((await f.send('manager',f.score(record))).status,200);
 const before=f.snapshot();assert.equal(before.records[0].score,85);
 assert.equal(before.records[0].assessor_id,f.ids.manager);assert.equal(before.audit.length,3);
 assert(!JSON.stringify(before.audit).includes('private training description'));
 assert.equal((await f.send('owner',f.score(record,{score:99}))).status,409);
 assert.deepEqual(f.snapshot(),before);
});
test('gate, authentication, roles, exact input, active scope and self score fail closed',async t=>{
 const f=await fixture(t),{course,record}=await setup(f);
 const before=f.snapshot();
 assert.equal((await f.send('staff',f.create())).status,403);
 assert.equal((await f.send('none',f.create())).status,401);
 assert.equal((await f.send('owner',f.create(),{env:{...f.env,CLOUD_NATIVE_TRAINING_WRITE_GATE:undefined}})).status,503);
 assert.equal((await f.send('owner',f.create({required_score:80.5}))).status,400);
 assert.equal((await f.send('owner',f.create({title:' '}))).status,400);
 assert.equal((await f.send('manager',f.create(),{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await f.send('manager',f.assign(course,{location_id:f.ids.other,user_id:f.ids.otherStaff}))).status,403);
 assert.equal((await f.send('owner',f.assign(course,{user_id:f.ids.otherStaff}))).status,404);
 assert.equal((await f.send('owner',f.score(record,{completed_on:'2026-02-30'}))).status,400);
 assert.equal((await f.send('owner',f.score(record,{score:101}))).status,400);
 assert.deepEqual(f.snapshot(),before);
 const own=randomUUID();assert.equal((await f.send('manager',f.assign(course,{user_id:f.ids.manager}),{key:own})).status,200);
 assert.equal((await f.send('manager',f.score(own))).status,403);
});
test('each operation rolls back all three injected batch failure positions',async t=>{
 for(const action of ['course','assign','score'])for(let failAt=0;failAt<3;failAt++)await t.test(action+' '+failAt,async sub=>{
  const opt={},f=await fixture(sub,opt);
  const {course,record}=action==='course'?{}:await setup(f,action==='score');
  const before=f.snapshot();opt.failAt=failAt;
  const body=action==='course'?f.create():action==='assign'?f.assign(course):f.score(record);
  assert.equal((await f.send('manager',body)).status,503);assert.deepEqual(f.snapshot(),before);
 });
});
test('transaction-time score and assignment authorization races cannot append false audit or overwrite',async t=>{
 for(const action of ['assign','score'])for(const kind of ['session','actorGrant','targetGrant','inactiveTarget','inactiveCourse','inactiveStore','duplicate'])await t.test(action+' '+kind,async sub=>{
  const opt={},f=await fixture(sub,opt),{course,record}=await setup(f,action==='score');let raced;
  opt.beforeBatch=db=>{
   if(kind==='session')db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ids.manager);
   if(kind==='actorGrant')db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.manager);
   if(kind==='targetGrant')db.prepare('DELETE FROM user_locations WHERE user_id=?').run(f.ids.staff);
   if(kind==='inactiveTarget')db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
   if(kind==='inactiveCourse')db.prepare('UPDATE training_courses SET active=0 WHERE id=?').run(course);
   if(kind==='inactiveStore')db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.store);
   if(kind==='duplicate'&&action==='assign')db.prepare('INSERT INTO training_records(id,course_id,user_id,location_id) VALUES(?,?,?,?)').run(randomUUID(),course,f.ids.staff,f.ids.store);
   if(kind==='duplicate'&&action==='score')db.prepare("UPDATE training_records SET score=70,completed_on='2026-11-25',assessor_id=? WHERE id=?").run(f.ids.owner,record);
   raced=f.snapshot();
  };
  assert.equal((await f.send('manager',action==='assign'?f.assign(course):f.score(record))).status,503);
  assert.deepEqual(f.snapshot(),raced);
 });
});

test('maximum valid Chinese description survives byte limit and oversized requests are rejected without mutation',async t=>{
 const f=await fixture(t),value='課'.repeat(1200);
 const body=f.create({title:'課'.repeat(150),description:value});
 const raw=JSON.stringify(body),size=Buffer.byteLength(raw,'utf8');assert(size>2048&&size<8192);
 const key=randomUUID();assert.equal((await f.send('manager',body,{key,headers:{'content-length':String(size)}})).status,200);
 const saved=f.snapshot();assert.equal(saved.courses[0].description,value);
 assert.equal((await f.send('manager',f.create({description:value+'字'}))).status,400);
 assert.equal((await f.send('manager',body,{raw:raw+' '.repeat(8193-size)})).status,400);
 assert.equal((await f.send('manager',body,{headers:{'content-length':'8193'}})).status,413);
 assert.deepEqual(f.snapshot(),saved);
});
