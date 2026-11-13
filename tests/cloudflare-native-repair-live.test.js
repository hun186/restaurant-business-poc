'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const workerPromise=import('../cloudflare/worker.mjs'),authPromise=import('../cloudflare/auth-core.mjs');
function d1(db,opt={}){
  const make=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})});
  return {prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(steps){
      if(opt.beforeBatch)opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');try{
        const out=[];
        for(let i=0;i<steps.length;i++){
          if(opt.failNow&&opt.failAt===i)throw Error('SYNTHETIC_ROLLBACK');
          out.push(await steps[i].run());
        }
        db.exec('COMMIT');return out;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }};
}
async function fixture(t,opt={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
  const hash=await (await authPromise).hashWorkerPassword('synthetic-password-12345');
  const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
    otherStaff:randomUUID(),a:randomUUID(),b:randomUUID()};
  for(const [id,name] of [[ids.a,'虛構甲店'],[ids.b,'虛構乙店']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  for(const role of ['owner','manager','staff','otherStaff']){
    const dbRole=role==='otherStaff'?'staff':role;
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(ids[role],role,'合成'+role,dbRole,hash.password_salt,hash.password_hash);
    if(role!=='owner')db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)')
      .run(ids[role],role==='otherStaff'?ids.b:ids.a);
  }
  const env={DB:d1(db,opt),CLOUD_AUTH_PHASE:'native-production',
    CLOUD_NATIVE_LOGIN_GATE:'operator-released',
    CLOUD_NATIVE_REPAIR_WRITE_GATE:'operator-released',
    NATIVE_AUTH_SOURCE_PEPPER:'synthetic-source-pepper-32-characters-only'};
  const worker=(await workerPromise).default;
  const send=(route,init={},e=env)=>{
    const request=new Request(site+route,init);
    Object.defineProperty(request,'cf',{value:{colo:'TPE'}});
    return worker.fetch(request,e);
  };
  async function login(username){
    const response=await send('/api/login',{method:'POST',headers:{
      origin:site,'content-type':'application/json','sec-fetch-site':'same-origin',
      'CF-Connecting-IP':'198.51.100.29'
    },body:JSON.stringify({username,password:'synthetic-password-12345'})});
    assert.equal(response.status,200);
    const json=await response.json();
    return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:json.csrf};
  }
  const write=(who,action,data,options={})=>send('/api/repair',{method:'POST',headers:{
    'content-type':'application/json',origin:site,'sec-fetch-site':'same-origin',
    cookie:who.cookie,'x-csrf-token':who.csrf,...options.headers
  },body:options.body??JSON.stringify({action,data})},options.env||env);
  return {db,ids,env,send,login,write};
}
const repair=db=>db.prepare('SELECT * FROM repairs ORDER BY rowid LIMIT 1').get();
const audits=db=>db.prepare("SELECT action FROM audit_logs WHERE action LIKE 'repair.%' ORDER BY rowid").all();
const createData=f=>({location_id:f.ids.a,equipment:'製冰機',description:'虛構故障需檢修'});
const update=(id,from,to,oldAssignee,newAssignee)=>
  ({id,status:to,expected_status:from,expected_assigned_to:oldAssignee,
    ...(to==='assigned'?{assigned_to:newAssignee}:{})});
test('staff reports real D1 repair, manager assigns then closes with audit',async t=>{
  const f=await fixture(t),staff=await f.login('staff'),manager=await f.login('manager');
  const result=await f.write(staff,'repair.create',createData(f));
  assert.equal(result.status,200);
  const id=(await result.json()).result.id;
  assert.equal(repair(f.db).status,'reported');
  const list=await f.send('/api/data?entity=repairs',{headers:{cookie:staff.cookie}});
  assert.equal(list.status,200);
  assert((await list.json()).rows.some(x=>x.id===id));
  const assigned=await f.write(manager,'repair.update',
    update(id,'reported','assigned',null,f.ids.staff));
  assert.equal(assigned.status,200);
  assert.equal(repair(f.db).assigned_to,f.ids.staff);
  assert.equal(repair(f.db).status,'assigned');
  const closed=await f.write(manager,'repair.update',
    update(id,'assigned','closed',f.ids.staff));
  assert.equal(closed.status,200);
  assert.equal(repair(f.db).status,'closed');
  assert.deepEqual(audits(f.db).map(x=>x.action),[
    'repair.create','repair.update','repair.update']);
  assert.equal((await f.write(manager,'repair.update',
    update(id,'assigned','closed',f.ids.staff))).status,409);
});
test('staff can report but cannot self-assign or close repairs',async t=>{
  const f=await fixture(t),staff=await f.login('staff');
  const newRepair=await f.write(staff,'repair.create',createData(f));
  assert.equal(newRepair.status,200);
  const id=(await newRepair.json()).result.id;
  assert.equal((await f.write(staff,'repair.update',
    update(id,'reported','assigned',null,f.ids.staff))).status,403);
  assert.equal(repair(f.db).status,'reported');
  assert.deepEqual(audits(f.db).map(x=>x.action),['repair.create']);
});
test('manager cannot act outside active grant and cannot assign outside same store',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager');
  const other=await f.write(owner,'repair.create',{...createData(f),location_id:f.ids.b});
  assert.equal(other.status,200);
  const id=(await other.json()).result.id;
  assert.equal((await f.write(manager,'repair.update',
    update(id,'reported','assigned',null,f.ids.otherStaff))).status,404);
  const local=await f.write(owner,'repair.create',createData(f));
  assert.equal(local.status,200);
  const localId=(await local.json()).result.id;
  assert.equal((await f.write(manager,'repair.update',
    update(localId,'reported','assigned',null,f.ids.otherStaff))).status,409);
  assert.equal(audits(f.db).length,2);
});
test('reject malformed descriptions, stale expected assignee and forged CSRF',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const data of [{...createData(f),description:''},
    {...createData(f),equipment:' '},{...createData(f),extra:1},
    {...createData(f),description:'x'.repeat(1001)}]){
    assert.equal((await f.write(owner,'repair.create',data)).status,400);
  }
  const created=await f.write(owner,'repair.create',createData(f));
  const id=(await created.json()).result.id;
  assert.equal((await f.write(owner,'repair.update',
    update(id,'assigned','closed',null))).status,409);
  assert.equal((await f.write(owner,'repair.update',{
    ...update(id,'reported','assigned',null,f.ids.staff),forged:true})).status,400);
  assert.equal((await f.write(owner,'repair.update',
    update(id,'reported','assigned',null,f.ids.staff),{
      headers:{'x-csrf-token':'fake'}})).status,403);
  assert.equal(repair(f.db).status,'reported');
  assert.equal(audits(f.db).length,1);
});
test('assignment revocation before batch prevents update and audit',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare(
      'DELETE FROM user_locations WHERE user_id=? AND location_id=?'
    ).run(f.ids.staff,f.ids.a);
  }});
  const owner=await f.login('owner');
  const created=await f.write(owner,'repair.create',createData(f));
  const id=(await created.json()).result.id;
  revoke=true;
  assert.equal((await f.write(owner,'repair.update',
    update(id,'reported','assigned',null,f.ids.staff))).status,409);
  assert.equal(repair(f.db).status,'reported');
  assert.equal(audits(f.db).length,1);
});
test('D1 batch audit failure rolls back a new repair completely',async t=>{
  const options={failAt:1},f=await fixture(t,options),owner=await f.login('owner');
  options.failNow=true;
  assert.equal((await f.write(owner,'repair.create',createData(f))).status,503);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM repairs').get().n,0);
  assert.equal(audits(f.db).length,0);
});
test('D1 batch status update failure does not leave an audit or changed repair',async t=>{
  const options={failAt:1},f=await fixture(t,options),owner=await f.login('owner');
  const created=await f.write(owner,'repair.create',createData(f));
  const id=(await created.json()).result.id;
  options.failNow=true;
  assert.equal((await f.write(owner,'repair.update',
    update(id,'reported','assigned',null,f.ids.staff))).status,503);
  assert.equal(repair(f.db).status,'reported');
  assert.deepEqual(audits(f.db).map(x=>x.action),['repair.create']);
});
test('default production gate stays disabled and avoids data writes',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const env of [{...f.env,CLOUD_AUTH_PHASE:'disabled'},
    {...f.env,CLOUD_NATIVE_REPAIR_WRITE_GATE:undefined},
    {...f.env,CLOUD_NATIVE_LOGIN_GATE:undefined}]){
    const outcome=await f.write(owner,'repair.create',createData(f),{env});
    assert.equal(outcome.status,503);
    assert.equal((await outcome.json()).code,'E_NOT_READY');
  }
  const status=await f.send('/api/native/status',{},{
    ...f.env,CLOUD_NATIVE_REPAIR_WRITE_GATE:undefined});
  assert.equal((await status.json()).repair_write_enabled,false);
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(cfg.keep_vars,true);
  assert.equal(Object.hasOwn(cfg,'vars'),false);
  assert.equal(Object.hasOwn(cfg.vars??{},'CLOUD_NATIVE_REPAIR_WRITE_GATE'),false);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM repairs').get().n,0);
});

test('max-length Chinese equipment and description fit strict UTF-8 byte envelope',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  const result=await f.write(owner,'repair.create',{
    location_id:f.ids.a,equipment:'設'.repeat(120),description:'測'.repeat(1000)});
  assert.equal(result.status,200);
  assert.equal(repair(f.db).equipment.length,120);
  assert.equal(repair(f.db).description.length,1000);
  const reject=await f.write(owner,'repair.create',{
    location_id:f.ids.a,equipment:'設備',description:'甲'.repeat(1500)});
  assert.equal(reject.status,400);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM repairs').get().n,1);
  assert.equal(audits(f.db).length,1);
});
