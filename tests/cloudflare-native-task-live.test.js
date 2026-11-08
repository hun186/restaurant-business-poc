'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const root=path.join(__dirname,'..'),site='https://restaurant.example.workers.dev';
const workerPromise=import('../cloudflare/worker.mjs'),authPromise=import('../cloudflare/auth-core.mjs');
const pepper='synthetic-IP-source-pepper-32-characters-only';
function d1(db,opt={}){
  const make=(sql,args=[])=>({first:async()=>db.prepare(sql).get(...args),
    all:async()=>({results:db.prepare(sql).all(...args)}),
    run:async()=>({meta:db.prepare(sql).run(...args)})});
  return {prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(statements){
      if(opt.beforeBatch)opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');try{
        const out=[];
        for(let i=0;i<statements.length;i++){
          if(opt.failNow&&opt.failAt===i)throw Error('SYNTHETIC_ATOMIC_ROLLBACK');
          out.push(await statements[i].run());
        }
        db.exec('COMMIT');return out;
      }catch(e){db.exec('ROLLBACK');throw e;}
    }};
}
async function fixture(t,opt={}){
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8'));
  const auth=await authPromise,password='synthetic-owner-pass-123',
    hash=await auth.hashWorkerPassword(password);
  const ids={owner:randomUUID(),manager:randomUUID(),staff:randomUUID(),
    a:randomUUID(),b:randomUUID(),task:randomUUID()};
  for(const [id,name] of [[ids.a,'虛構甲店'],[ids.b,'虛構乙店']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  for(const [name,role,id] of [['owner','owner',ids.owner],
      ['manager','manager',ids.manager],['staff','staff',ids.staff]]){
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
      .run(id,name,'測試'+name,role,hash.password_salt,hash.password_hash);
    if(role!=='owner')
      db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,ids.a);
  }
  db.prepare('INSERT INTO tasks(id,location_id,title,status,assigned_to,created_by) VALUES(?,?,?, ?,?,?)')
    .run(ids.task,ids.a,'測試既存工作','todo',ids.staff,ids.owner);
  const env={DB:d1(db,opt),CLOUD_AUTH_PHASE:'native-production',
    CLOUD_NATIVE_LOGIN_GATE:'operator-released',
    CLOUD_NATIVE_TASK_WRITE_GATE:'operator-released',
    NATIVE_AUTH_SOURCE_PEPPER:pepper};
  const worker=(await workerPromise).default;
  const send=(route,init={},override=env)=>{
    const req=new Request(site+route,init);
    Object.defineProperty(req,'cf',{value:{colo:'TPE'}});
    return worker.fetch(req,override);
  };
  async function login(username){
    const res=await send('/api/login',{method:'POST',headers:{
      origin:site,'content-type':'application/json',
      'sec-fetch-site':'same-origin','CF-Connecting-IP':'198.51.100.18'
    },body:JSON.stringify({username,password})});
    assert.equal(res.status,200,'synthetic login '+username);
    const info=await res.json();
    return {cookie:res.headers.get('set-cookie').split(';')[0],csrf:info.csrf};
  }
  const write=(auth,action,data,opts={})=>{
    const req=new Request(site+'/api/task',{method:'POST',headers:{
      'content-type':'application/json','origin':site,
      'sec-fetch-site':'same-origin','cookie':auth.cookie,
      'x-csrf-token':auth.csrf,...opts.headers
    },body:opts.body??JSON.stringify({action,data})});
    return worker.fetch(req,opts.env||env);
  };
  return {db,ids,env,send,login,write};
}
const taskCount=db=>db.prepare('SELECT COUNT(*) AS n FROM tasks').get().n;
const taskAudit=db=>db.prepare("SELECT action,entity_id,detail FROM audit_logs WHERE action LIKE 'task.%' ORDER BY rowid").all();
test('default and partial gates do not consume task body or write D1',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const env of [{...f.env,CLOUD_AUTH_PHASE:'disabled'},
    {...f.env,CLOUD_NATIVE_TASK_WRITE_GATE:undefined},
    {...f.env,CLOUD_NATIVE_LOGIN_GATE:undefined}]){
    const res=await f.write(owner,'task.create',{location_id:f.ids.a,title:'Nope'},{env});
    assert.equal(res.status,503);
    assert.equal((await res.json()).code,'E_NOT_READY');
  }
  const off=await f.send('/api/native/status',{},{
    ...f.env,CLOUD_NATIVE_TASK_WRITE_GATE:undefined});
  assert.deepEqual(await off.json(),{
    mode:'native',login_enabled:true,task_write_enabled:false,
    catalog_write_enabled:false,order_write_enabled:false,stocktake_write_enabled:false,repair_write_enabled:false});
  assert.equal(taskCount(f.db),1);
  assert.equal(taskAudit(f.db).length,0);
  const config=JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  assert.equal(config.vars.CLOUD_AUTH_PHASE,'disabled');
  assert.equal(Object.hasOwn(config.vars,'CLOUD_NATIVE_TASK_WRITE_GATE'),false);
});
test('owner creates an actual D1 task, changes status, sees persisted rows and audit',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  const create=await f.write(owner,'task.create',{location_id:f.ids.b,title:' 開店盤點 '});
  assert.equal(create.status,200);
  const created=(await create.json()).result;
  assert.equal(created.title,'開店盤點');
  assert.equal(taskCount(f.db),2);
  let row=f.db.prepare('SELECT title,status,location_id FROM tasks WHERE id=?').get(created.id);
  assert.equal(row.title,'開店盤點');assert.equal(row.status,'todo');
  assert.equal(row.location_id,f.ids.b);
  const change=await f.write(owner,'task.status',{id:created.id,status:'done'});
  assert.equal(change.status,200);assert.equal((await change.json()).result.status,'done');
  row=f.db.prepare('SELECT status FROM tasks WHERE id=?').get(created.id);
  assert.equal(row.status,'done');
  assert.deepEqual(taskAudit(f.db).map(x=>x.action),['task.create','task.status']);
  const after=await f.send('/api/data?entity=tasks',{headers:{cookie:owner.cookie}});
  assert.equal(after.status,200);
  assert((await after.json()).rows.some(x=>x.id===created.id&&x.status==='done'));
  const duplicate=await f.write(owner,'task.status',{id:created.id,status:'done'});
  assert.equal(duplicate.status,409);
  assert.equal(taskAudit(f.db).length,2);
});
test('manager cannot create cross-store, staff cannot create or change colleague task',async t=>{
  const f=await fixture(t),manager=await f.login('manager'),staff=await f.login('staff');
  assert.equal((await f.write(manager,'task.create',{location_id:f.ids.b,title:'Forbidden'})).status,409);
  assert.equal((await f.write(staff,'task.create',{location_id:f.ids.a,title:'No create'})).status,403);
  const allowed=await f.write(manager,'task.create',{location_id:f.ids.a,title:'Manager task'});
  assert.equal(allowed.status,200);const created=(await allowed.json()).result;
  assert.equal((await f.write(staff,'task.status',{id:created.id,status:'done'})).status,404);
  assert.equal((await f.write(staff,'task.status',{id:f.ids.task,status:'doing'})).status,200);
  assert.equal(taskCount(f.db),2);
  assert.deepEqual(taskAudit(f.db).map(x=>x.action),['task.create','task.status']);
});
test('cross-site origin, forged CSRF and malformed JSON reject with zero writes',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  for(const opts of [
    {headers:{origin:'https://evil.example'}},
    {headers:{'x-csrf-token':'invalid'}},
    {headers:{'sec-fetch-site':'cross-site'}},
    {body:'not json'},
    {body:JSON.stringify({action:'task.create',data:{title:'forged',location_id:f.ids.a,role:'owner'}})}
  ]){
    const response=await f.write(owner,'task.create',{location_id:f.ids.a,title:'Nope'},opts);
    assert.notEqual(response.status,200);
  }
  assert.equal(taskCount(f.db),1);
  assert.equal(taskAudit(f.db).length,0);
});
test('D1 batch exception rolls back both business and audit statements',async t=>{
  const options={failAt:1};
  const f=await fixture(t,options),owner=await f.login('owner');
  options.failNow=true;
  const res=await f.write(owner,'task.create',{location_id:f.ids.a,title:'Rollback'});
  assert.equal(res.status,503);
  assert.equal(taskCount(f.db),1);
  assert.equal(taskAudit(f.db).length,0);
});
test('role revoked immediately before transaction prevents task insertion',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ids.manager);
  }});
  const manager=await f.login('manager');
  revoke=true;
  const r=await f.write(manager,'task.create',{location_id:f.ids.a,title:'Stale role'});
  assert.equal(r.status,409);
  assert.equal(taskCount(f.db),1);assert.equal(taskAudit(f.db).length,0);
});
test('native Owner browser never loads mock and has real task command wiring',()=>{
  const js=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
  assert.match(js,/\/api\/task/);
  assert.match(js,/task\.create/);
  assert.match(js,/task\.status/);
  assert.doesNotMatch(js,/localStorage|sessionStorage|mock\.js/);
});
test('owner assigns work to active staff in same store; assignee can complete it',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),staff=await f.login('staff');
  const response=await f.write(owner,'task.create',{
    location_id:f.ids.a,title:'門市打烊清點',assigned_to:f.ids.staff});
  assert.equal(response.status,200);
  const created=(await response.json()).result;
  assert.equal(created.assigned_to,f.ids.staff);
  const saved=f.db.prepare('SELECT assigned_to,location_id,status FROM tasks WHERE id=?').get(created.id);
  assert.equal(saved.assigned_to,f.ids.staff);assert.equal(saved.location_id,f.ids.a);
  assert.equal((await f.write(staff,'task.status',{id:created.id,status:'doing'})).status,200);
  assert.deepEqual(taskAudit(f.db).map(x=>x.action),['task.create','task.status']);
});

test('invalid, inactive, unbound and owner assignees cannot create work',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager');
  for(const [user,location] of [
    [f.ids.staff,f.ids.b],       // active staff, but not a member of store b
    [f.ids.owner,f.ids.a]        // owner cannot be selected as assigned staff
  ]){
    const result=await f.write(owner,'task.create',{
      location_id:location,title:'Not assigned',assigned_to:user});
    assert.equal(result.status,409);
  }
  assert.equal((await f.write(manager,'task.create',{
    location_id:f.ids.b,title:'Cross-store manager',assigned_to:f.ids.staff})).status,409);
  f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
  assert.equal((await f.write(owner,'task.create',{
    location_id:f.ids.a,title:'Inactive user',assigned_to:f.ids.staff})).status,409);
  assert.equal((await f.write(owner,'task.create',{
    location_id:f.ids.a,title:'Malformed',assigned_to:'NOT-A-UUID'})).status,400);
  assert.equal(taskCount(f.db),1);
  assert.equal(taskAudit(f.db).length,0);
});

test('assignable staff read API is role-gated, active-only and location-scoped',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager'),
    staff=await f.login('staff');
  const read=login=>f.send('/api/data?entity=assignable_staff',{
    headers:{cookie:login.cookie}});
  assert.equal((await read(staff)).status,403);
  const managerRows=await read(manager);
  assert.equal(managerRows.status,200);
  const people=(await managerRows.json()).rows;
  assert(people.some(x=>x.id===f.ids.staff&&x.location_id===f.ids.a));
  assert(people.every(x=>x.location_id===f.ids.a&&x.role!=='owner'));
  const ownerRows=await read(owner);
  assert.equal(ownerRows.status,200);
  assert((await ownerRows.json()).rows.some(x=>x.id===f.ids.manager));
  f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
  assert(!(await (await read(owner)).json()).rows.some(x=>x.id===f.ids.staff));
});

test('assignment is reauthorized inside transaction after staff location revocation',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare('DELETE FROM user_locations WHERE user_id=? AND location_id=?')
      .run(f.ids.staff,f.ids.a);
  }});
  const owner=await f.login('owner');
  revoke=true;
  const result=await f.write(owner,'task.create',{
    location_id:f.ids.a,title:'Stale staff grant',assigned_to:f.ids.staff});
  assert.equal(result.status,409);
  assert.equal(taskCount(f.db),1);
  assert.equal(taskAudit(f.db).length,0);
});

test('Owner reassigns a pending task with persisted audit and staff takes over',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager'),
    staff=await f.login('staff');
  const first=await f.write(owner,'task.assign',{
    id:f.ids.task,assigned_to:f.ids.manager,expected_assigned_to:f.ids.staff});
  assert.equal(first.status,200);
  assert.equal(f.db.prepare('SELECT assigned_to FROM tasks WHERE id=?')
    .get(f.ids.task).assigned_to,f.ids.manager);
  assert.equal((await f.write(staff,'task.status',{id:f.ids.task,status:'doing'})).status,404);
  const second=await f.write(manager,'task.assign',{
    id:f.ids.task,assigned_to:f.ids.staff,expected_assigned_to:f.ids.manager});
  assert.equal(second.status,200);
  assert.equal((await f.write(staff,'task.status',{id:f.ids.task,status:'doing'})).status,200);
  assert.deepEqual(taskAudit(f.db).map(x=>x.action),['task.assign','task.assign','task.status']);
});

test('task assignment refuses staff, stale expected ID, and malformed commands',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),staff=await f.login('staff');
  const cmd={id:f.ids.task,assigned_to:null,expected_assigned_to:f.ids.staff};
  assert.equal((await f.write(staff,'task.assign',cmd)).status,403);
  assert.equal((await f.write(owner,'task.assign',{...cmd,expected_assigned_to:null})).status,409);
  assert.equal((await f.write(owner,'task.assign',{...cmd,assigned_to:'not-uuid'})).status,400);
  assert.equal((await f.write(owner,'task.assign',{...cmd,extra:'forged'})).status,400);
  assert.equal((await f.write(owner,'task.assign',{...cmd,assigned_to:f.ids.staff})).status,409);
  assert.equal(taskAudit(f.db).length,0);
  assert.equal(f.db.prepare('SELECT assigned_to FROM tasks WHERE id=?')
    .get(f.ids.task).assigned_to,f.ids.staff);
});

test('assignment refuses cross-store or disabled staff, and done task changes',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),manager=await f.login('manager');
  const create=await f.write(owner,'task.create',{location_id:f.ids.b,title:'Store B'});
  assert.equal(create.status,200);
  const id=(await create.json()).result.id;
  const result=await f.write(owner,'task.assign',{id,assigned_to:f.ids.staff,
    expected_assigned_to:null});
  assert.equal(result.status,409);
  assert.equal((await f.write(manager,'task.assign',{
    id,assigned_to:null,expected_assigned_to:null})).status,404);
  f.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.ids.staff);
  assert.equal((await f.write(owner,'task.assign',{
    id:f.ids.task,assigned_to:f.ids.staff,expected_assigned_to:null})).status,409);
  f.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(f.ids.task);
  assert.equal((await f.write(owner,'task.assign',{
    id:f.ids.task,assigned_to:null,expected_assigned_to:f.ids.staff})).status,409);
  assert.deepEqual(taskAudit(f.db).map(x=>x.action),['task.create']);
});

test('reassignment preflight revocation and D1 rollback leave no false audit',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare('DELETE FROM user_locations WHERE user_id=? AND location_id=?')
      .run(f.ids.manager,f.ids.a);
  }});
  const manager=await f.login('manager');
  revoke=true;
  assert.equal((await f.write(manager,'task.assign',{id:f.ids.task,assigned_to:null,
    expected_assigned_to:f.ids.staff})).status,409);
  assert.equal(taskAudit(f.db).length,0);
  assert.equal(f.db.prepare('SELECT assigned_to FROM tasks WHERE id=?')
    .get(f.ids.task).assigned_to,f.ids.staff);
});

test('D1 assignment audit failure rolls back assignment atomically',async t=>{
  const options={failAt:1};
  const f=await fixture(t,options),owner=await f.login('owner');
  options.failNow=true;
  assert.equal((await f.write(owner,'task.assign',{id:f.ids.task,assigned_to:null,
    expected_assigned_to:f.ids.staff})).status,503);
  assert.equal(taskAudit(f.db).length,0);
  assert.equal(f.db.prepare('SELECT assigned_to FROM tasks WHERE id=?')
    .get(f.ids.task).assigned_to,f.ids.staff);
});

test('Owner creates dated tasks, reschedules pending work and records D1 audit',async t=>{
  const f=await fixture(t),owner=await f.login('owner');
  const created=await f.write(owner,'task.create',{
    location_id:f.ids.a,title:'月底盤點',due_date:'2028-02-29'});
  assert.equal(created.status,200);
  const task=(await created.json()).result;
  assert.equal(task.due_date,'2028-02-29');
  assert.equal(f.db.prepare('SELECT due_date FROM tasks WHERE id=?')
    .get(task.id).due_date,'2028-02-29');
  const updated=await f.write(owner,'task.due',{id:task.id,
    due_date:'2028-03-01',expected_due_date:'2028-02-29'});
  assert.equal(updated.status,200);
  assert.equal(f.db.prepare('SELECT due_date FROM tasks WHERE id=?')
    .get(task.id).due_date,'2028-03-01');
  const cleared=await f.write(owner,'task.due',{id:task.id,
    due_date:null,expected_due_date:'2028-03-01'});
  assert.equal(cleared.status,200);
  assert.equal(f.db.prepare('SELECT due_date FROM tasks WHERE id=?')
    .get(task.id).due_date,null);
  assert.deepEqual(taskAudit(f.db).map(x=>x.action),['task.create','task.due','task.due']);
});

test('invalid calendar dates, stale updates and staff due edits reject without audit',async t=>{
  const f=await fixture(t),owner=await f.login('owner'),staff=await f.login('staff');
  for(const due_date of ['2026-02-29','0000-01-01','2026-13-01','2026-11-31','2026-1-02']){
    assert.equal((await f.write(owner,'task.create',{location_id:f.ids.a,
      title:'Invalid date',due_date})).status,400);
  }
  const cmd={id:f.ids.task,due_date:'2026-12-25',expected_due_date:null};
  assert.equal((await f.write(staff,'task.due',cmd)).status,403);
  assert.equal((await f.write(owner,'task.due',{...cmd,expected_due_date:'2026-12-20'})).status,409);
  assert.equal((await f.write(owner,'task.due',{...cmd,forged:true})).status,400);
  assert.equal(taskAudit(f.db).length,0);
  assert.equal(f.db.prepare('SELECT due_date FROM tasks WHERE id=?')
    .get(f.ids.task).due_date,null);
});

test('due date cannot be changed for completed work or unauthorized store',async t=>{
  const f=await fixture(t),manager=await f.login('manager'),owner=await f.login('owner');
  const created=await f.write(owner,'task.create',{location_id:f.ids.b,title:'B'});
  assert.equal(created.status,200);
  const id=(await created.json()).result.id;
  assert.equal((await f.write(manager,'task.due',{id,due_date:'2026-12-31',
    expected_due_date:null})).status,404);
  f.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(f.ids.task);
  assert.equal((await f.write(owner,'task.due',{id:f.ids.task,
    due_date:'2026-12-31',expected_due_date:null})).status,409);
  assert.deepEqual(taskAudit(f.db).map(x=>x.action),['task.create']);
});

test('transaction-time manager grant revocation prevents due date change',async t=>{
  let f,revoke=false;
  f=await fixture(t,{beforeBatch(){
    if(revoke)f.db.prepare('DELETE FROM user_locations WHERE user_id=? AND location_id=?')
      .run(f.ids.manager,f.ids.a);
  }});
  const manager=await f.login('manager');
  revoke=true;
  assert.equal((await f.write(manager,'task.due',{id:f.ids.task,
    due_date:'2026-12-31',expected_due_date:null})).status,409);
  assert.equal(taskAudit(f.db).length,0);
  assert.equal(f.db.prepare('SELECT due_date FROM tasks WHERE id=?')
    .get(f.ids.task).due_date,null);
});

test('due date D1 batch failure rolls back task and audit',async t=>{
  const options={failAt:1},f=await fixture(t,options),owner=await f.login('owner');
  options.failNow=true;
  assert.equal((await f.write(owner,'task.due',{id:f.ids.task,
    due_date:'2026-12-31',expected_due_date:null})).status,503);
  assert.equal(taskAudit(f.db).length,0);
  assert.equal(f.db.prepare('SELECT due_date FROM tasks WHERE id=?')
    .get(f.ids.task).due_date,null);
});
