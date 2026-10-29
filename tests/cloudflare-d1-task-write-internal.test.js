'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {randomUUID}=require('node:crypto');
const authPromise=import('../cloudflare/auth-core.mjs');
const taskPromise=import('../cloudflare/task-write-internal.mjs');
const workerPromise=import('../cloudflare/worker.mjs');
const migration=fs.readFileSync(path.join(__dirname,'..','cloudflare','migrations','0001_initial_v3.sql'),'utf8');
function adapt(db,opt={}){
  const make=(sql,params=[])=>({
    first:async()=>db.prepare(sql).get(...params),
    all:async()=>({results:db.prepare(sql).all(...params)}),
    run:async()=>({meta:db.prepare(sql).run(...params)})
  });
  return {
    prepare(sql){return {...make(sql),bind:(...args)=>make(sql,args)};},
    async batch(statements) {
      if(opt.beforeBatch) opt.beforeBatch();
      db.exec('BEGIN IMMEDIATE');
      try {
        const out=[];
        for(let i=0;i<statements.length;i++){
          if(opt.failAt===i) throw Error('E_TEST_ATOMIC_FAIL');
          out.push(await statements[i].run());
        }
        db.exec('COMMIT');return out;
      } catch(e){db.exec('ROLLBACK');throw e;}
    }
  };
}
async function fixture(t,opt={}){
  const db=new DatabaseSync(':memory:');
  t.after(()=>db.close());db.exec(migration);
  const ids={own:randomUUID(),staff:randomUUID(),other:randomUUID(),storeA:randomUUID(),storeB:randomUUID(),taskA:randomUUID(),taskB:randomUUID(),taskOther:randomUUID()};
  for(const [id,name] of [[ids.storeA,'虛構A'],[ids.storeB,'虛構B']])
    db.prepare('INSERT INTO locations(id,name) VALUES(?,?)').run(id,name);
  const auth=await authPromise;
  const people=[
    ['owner','owner',ids.own,[ids.storeA]],
    ['manager','manager',randomUUID(),[ids.storeA]],
    ['staff','staff',ids.staff,[ids.storeA]],
    ['other','staff',ids.other,[ids.storeB]]
  ];
  const cookies={},csrf={},ident={};
  for(const [label,role,id,stores] of people){
    db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)').run(id,label,'虛構'+label,role,'dummy','dummy');
    for(const s of stores) db.prepare('INSERT INTO user_locations(user_id,location_id) VALUES(?,?)').run(id,s);
    const token=auth.freshSessionToken();csrf[label]=auth.freshSessionToken();
    db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run(await auth.tokenSha256(token),csrf[label],id,new Date(Date.now()+3600000).toISOString());
    cookies[label]=auth.SESSION_COOKIE+'='+token;ident[label]=id;
  }
  for(const [id,loc,assigned] of [[ids.taskA,ids.storeA,ids.staff],[ids.taskB,ids.storeB,ids.other],[ids.taskOther,ids.storeA,ident.manager]])
    db.prepare('INSERT INTO tasks(id,location_id,title,assigned_to) VALUES(?,?,?,?)').run(id,loc,'虛構工作',assigned);
  return {db,d1:adapt(db,opt),ids,cookies,csrf,ident};
}
async function command(f,role,id,status='doing',settings={}){
  const handler=(await taskPromise).internalTaskStatusMutation;
  const body=settings.body??JSON.stringify({action:'task.status',data:{id,status}});
  const headers={cookie:f.cookies[role]||'','content-type':'application/json',
    'origin':'https://private.example','x-csrf-token':f.csrf[role]||'',...settings.headers};
  const request=new Request('https://private.example/api/command',{
    method:settings.method||'POST',headers,body:settings.method==='GET'?undefined:body});
  return handler(request,{DB:f.d1,CLOUD_AUTH_PHASE:settings.phase||'preview-readonly',
    TASK_WRITE_STAGE:settings.stage||'internal-test-only'});
}
const row=(db,id)=>db.prepare('SELECT status FROM tasks WHERE id=?').get(id).status;
const log=(db)=>db.prepare("SELECT action,actor_name,entity_id,detail FROM audit_logs ORDER BY rowid").all();
test('scoped manager and own staff status writes update task and audit atomically',async t=>{
 const f=await fixture(t);
 let r=await command(f,'manager',f.ids.taskA);
 assert.equal(r.status,200);
 assert.equal(row(f.db,f.ids.taskA),'doing');
 assert.deepEqual(log(f.db).map(x=>[x.action,x.actor_name,x.entity_id]),[['task.status','manager',f.ids.taskA]]);
 r=await command(f,'staff',f.ids.taskA,'done');
 assert.equal(r.status,200);assert.equal(row(f.db,f.ids.taskA),'done');
 assert.equal(log(f.db).length,2);
 assert.deepEqual(JSON.parse(log(f.db)[1].detail),{from:'doing',to:'done'});
 r=await command(f,'staff',f.ids.taskA,'done');
 assert.equal(r.status,409);assert.equal(log(f.db).length,2);
});
test('inactive store, stale grant, cross store, and unassigned staff deny without audit',async t=>{
 const f=await fixture(t);
 for(const [role,id] of [['manager',f.ids.taskB],['staff',f.ids.taskB],['staff',f.ids.taskOther]]){
   const r=await command(f,role,id);assert.equal(r.status,404,role);
 }
 f.db.prepare('UPDATE locations SET active=0 WHERE id=?').run(f.ids.storeA);
 const r=await command(f,'manager',f.ids.taskA);assert.equal(r.status,404);
 assert.equal(row(f.db,f.ids.taskA),'todo');assert.equal(log(f.db).length,0);
 // Owner is also forbidden from operating a deactivated location.
 assert.equal((await command(f,'owner',f.ids.taskA)).status,404);
});
test('production flag, missing explicit internal guard and public Worker route fail closed',async t=>{
 const f=await fixture(t);
 assert.equal((await command(f,'manager',f.ids.taskA,'doing',{phase:'disabled'})).status,503);
 assert.equal((await command(f,'manager',f.ids.taskA,'doing',{stage:'not-enabled'})).status,503);
 const worker=(await workerPromise).default;
 const req=new Request('https://private.example/api/command',{method:'POST',
   headers:{cookie:f.cookies.manager,'origin':'https://private.example','x-csrf-token':f.csrf.manager,'content-type':'application/json'},
   body:JSON.stringify({action:'task.status',data:{id:f.ids.taskA,status:'doing'}})});
 const result=await worker.fetch(req,{DB:f.d1,CLOUD_AUTH_PHASE:'preview-readonly',
   TASK_WRITE_STAGE:'internal-test-only'});
 assert.equal(result.status,503);assert.equal(row(f.db,f.ids.taskA),'todo');
 assert.equal(log(f.db).length,0);
});
test('CSRF, Origin, stale session, malformed payload and verb are rejected',async t=>{
 const f=await fixture(t);
 assert.equal((await command(f,'manager',f.ids.taskA,'doing',{headers:{origin:'https://bad.example'}})).status,403);
 assert.equal((await command(f,'manager',f.ids.taskA,'doing',{headers:{'x-csrf-token':'bad'}})).status,403);
 assert.equal((await command(f,'manager',f.ids.taskA,'doing',{method:'GET'})).status,405);
 assert.equal((await command(f,'manager',f.ids.taskA,'doing',{body:'not-json'})).status,400);
 assert.equal((await command(f,'manager',f.ids.taskA,'invalid')).status,400);
 assert.equal((await command(f,'manager',f.ids.taskA,'doing',{body:JSON.stringify({action:'task.status',data:{id:f.ids.taskA,status:'doing',location_id:f.ids.storeB}})})).status,400);
 f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.ident.manager);
 assert.equal((await command(f,'manager',f.ids.taskA)).status,401);
 assert.equal(log(f.db).length,0);assert.equal(row(f.db,f.ids.taskA),'todo');
});
test('failed audit or update rolls back both statements',async t=>{
 for(const failAt of [0,1]){
   const f=await fixture(t,{failAt});
   const r=await command(f,'manager',f.ids.taskA);
   assert.equal(r.status,503,'failure at statement '+failAt);
   assert.equal(row(f.db,f.ids.taskA),'todo');
   assert.equal(log(f.db).length,0);
 }
});
test('revoked role between read and transaction blocks both audit and update',async t=>{
 let f;
 f=await fixture(t,{beforeBatch(){
   f.db.prepare("UPDATE users SET role='staff' WHERE id=?").run(f.ident.manager);
 }});
 const r=await command(f,'manager',f.ids.taskA);
 assert.equal(r.status,409);
 assert.equal(row(f.db,f.ids.taskA),'todo');
 assert.equal(log(f.db).length,0);
});
test('D1 contract mismatch is rejected before any change',async t=>{
 const f=await fixture(t);
 f.db.prepare('DELETE FROM cloud_schema_contract').run();
 assert.equal((await command(f,'manager',f.ids.taskA)).status,503);
 assert.equal(row(f.db,f.ids.taskA),'todo');assert.equal(log(f.db).length,0);
});
