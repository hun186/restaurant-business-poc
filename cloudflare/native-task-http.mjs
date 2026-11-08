// Native Cloudflare D1 task creation/status, off unless BOTH production gates
// are set by an operator. Server checks sessions, roles, stores and CSRF.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal,hasAccess,authorizedMutation} from './auth-core.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const STATES=new Set(['todo','doing','done']);
function validDay(value){
  if(typeof value!=='string'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  if(year<1||month<1||month>12||day<1)return false;
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return day<=days[month-1];
}
const BODY_LIMIT=4096;
const changes=result=>{
  const n=result?.meta?.changes??result?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_TRANSACTION_RESULT');
  return n;
};
export function nativeTaskWriteEnabled(env){
  return nativeLoginEnabled(env)&&env.CLOUD_NATIVE_TASK_WRITE_GATE==='operator-released';
}
async function boundedJson(request){
  if(request.headers.get('content-type')!=='application/json')return null;
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>BODY_LIMIT))
    return null;
  const reader=request.body?.getReader();
  if(!reader)return null;
  const parts=[];let size=0,timer;
  try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('E_BODY_TIMEOUT')),2000);});
    for(;;){
      const chunk=await Promise.race([reader.read(),timeout]);
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array))return null;
      size+=chunk.value.byteLength;
      if(size>BODY_LIMIT)return null;
      parts.push(chunk.value);
    }
    if(size===0)return null;
    const bytes=new Uint8Array(size);let offset=0;
    for(const chunk of parts){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!data||typeof data!=='object'||Array.isArray(data)||
       Object.keys(data).sort().join(',')!=='action,data'||!data.data||
       typeof data.data!=='object'||Array.isArray(data.data))return null;
    if(data.action==='task.create'&&
       ['location_id,title','assigned_to,location_id,title',
         'due_date,location_id,title','assigned_to,due_date,location_id,title']
         .includes(Object.keys(data.data).sort().join(','))&&
       typeof data.data.location_id==='string'&&UUID.test(data.data.location_id)&&
       typeof data.data.title==='string'&&
       (!Object.hasOwn(data.data,'due_date')||validDay(data.data.due_date))&&
       (!Object.hasOwn(data.data,'assigned_to')||
         (typeof data.data.assigned_to==='string'&&UUID.test(data.data.assigned_to)))){
      const title=data.data.title.trim();
      if(title&&title.length<=120)return {action:'task.create',
        location_id:data.data.location_id,title,
        assigned_to:data.data.assigned_to??null,
        due_date:data.data.due_date??null};
    }
    if(data.action==='task.status'&&
       Object.keys(data.data).sort().join(',')==='id,status'&&
       typeof data.data.id==='string'&&UUID.test(data.data.id)&&
       STATES.has(data.data.status))return {action:'task.status',
         id:data.data.id,status:data.data.status};
    if(data.action==='task.due'&&
       Object.keys(data.data).sort().join(',')==='due_date,expected_due_date,id'&&
       typeof data.data.id==='string'&&UUID.test(data.data.id)&&
       (data.data.due_date===null||validDay(data.data.due_date))&&
       (data.data.expected_due_date===null||validDay(data.data.expected_due_date)))
      return {action:'task.due',id:data.data.id,due_date:data.data.due_date,
        expected_due_date:data.data.expected_due_date};
    if(data.action==='task.assign'&&
       Object.keys(data.data).sort().join(',')==='assigned_to,expected_assigned_to,id'&&
       typeof data.data.id==='string'&&UUID.test(data.data.id)&&
       (data.data.assigned_to===null||
         (typeof data.data.assigned_to==='string'&&UUID.test(data.data.assigned_to)))&&
       (data.data.expected_assigned_to===null||
         (typeof data.data.expected_assigned_to==='string'&&UUID.test(data.data.expected_assigned_to))))
      return {action:'task.assign',id:data.data.id,
        assigned_to:data.data.assigned_to,
        expected_assigned_to:data.data.expected_assigned_to};
    return null;
  }catch{return null;}
  finally{
    if(timer)clearTimeout(timer);
    try{const p=reader.cancel();if(p&&typeof p.catch==='function')p.catch(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
}
function statusWhere(){
  return [
    't.id=? AND t.status=?',
    'AND EXISTS(SELECT 1 FROM locations l WHERE l.id=t.location_id AND l.active=1)',
    'AND EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id',
    'WHERE u.id=? AND u.active=1 AND u.role=? AND s.token_hash=? AND s.expires_at>?)',
    "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul JOIN locations g",
    'ON g.id=ul.location_id AND g.active=1 WHERE ul.user_id=?',
    'AND ul.location_id=t.location_id))',
    "AND (?<>'staff' OR t.assigned_to=?)"
  ].join(' ');
}
async function changeStatus(db,principal,cmd){
  const item=await db.prepare('SELECT t.id,t.location_id,t.assigned_to,t.status,l.active '+
    'FROM tasks t JOIN locations l ON l.id=t.location_id WHERE t.id=? LIMIT 1')
    .bind(cmd.id).first();
  if(!item||item.active!==1||
     !hasAccess(principal,'staff',item.location_id)||
     (principal.role==='staff'&&item.assigned_to!==principal.id))
    return respond(404,{code:'E_TASK_NOT_FOUND'});
  if(!STATES.has(item.status)||item.status===cmd.status)
    return respond(409,{code:'E_TASK_STATE'});
  const now=new Date().toISOString(),auditId=crypto.randomUUID(),where=statusWhere();
  const args=[cmd.id,item.status,principal.id,principal.role,principal.token_hash,now,
    principal.role,principal.id,principal.role,principal.id];
  const audit=db.prepare(
    "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
    "SELECT ?,?,?,'task.status','tasks',t.id,t.location_id,? FROM tasks t WHERE "+where
  ).bind(auditId,principal.id,principal.username,
    JSON.stringify({from:item.status,to:cmd.status}),...args);
  const update=db.prepare('UPDATE tasks AS t SET status=? WHERE '+where+
    " AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='tasks' AND a.entity_id=t.id)"
  ).bind(cmd.status,...args,auditId);
  // NOT NULL detail forces rollback if audit was created but update failed.
  const validate=db.prepare('UPDATE audit_logs SET detail=CASE WHEN EXISTS('+
    'SELECT 1 FROM tasks t WHERE t.id=? AND t.status=? AND t.location_id=?'+
    ') THEN detail ELSE NULL END WHERE id=?'
  ).bind(cmd.id,cmd.status,item.location_id,auditId);
  const results=await db.batch([audit,update,validate]);
  if(!Array.isArray(results)||results.length!==3||
     results.some(x=>changes(x)!==1))return respond(409,{code:'E_CONCURRENT_CHANGE'});
  return respond(200,{ok:true,result:{id:cmd.id,status:cmd.status}});
}
// Reassignment uses an exact old-value comparison to reject stale browser tabs.
// Audit + business mutation are atomic and recheck actor and assignee in D1.
async function assignTask(db,principal,cmd){
  if(!hasAccess(principal,'manager'))return respond(403,{code:'E_FORBIDDEN'});
  const item=await db.prepare(
    'SELECT t.id,t.location_id,t.assigned_to,t.status,l.active FROM tasks t '+
    'JOIN locations l ON l.id=t.location_id WHERE t.id=? LIMIT 1'
  ).bind(cmd.id).first();
  if(!item||item.active!==1||!hasAccess(principal,'manager',item.location_id))
    return respond(404,{code:'E_TASK_NOT_FOUND'});
  if(item.status==='done'||item.assigned_to!==cmd.expected_assigned_to||
     item.assigned_to===cmd.assigned_to)
    return respond(409,{code:'E_TASK_ASSIGNMENT_CONFLICT'});
  const now=new Date().toISOString(),auditId=crypto.randomUUID();
  const where=[
    "t.id=? AND t.assigned_to IS ? AND t.status<>'done'",
    'AND EXISTS(SELECT 1 FROM locations l WHERE l.id=t.location_id AND l.active=1)',
    'AND EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id',
    "WHERE u.id=? AND u.active=1 AND u.role=? AND u.role IN ('owner','manager')",
    'AND s.token_hash=? AND s.expires_at>?)',
    "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul",
    'WHERE ul.user_id=? AND ul.location_id=t.location_id))',
    'AND (? IS NULL OR EXISTS(SELECT 1 FROM users assignee',
    'JOIN user_locations granted ON granted.user_id=assignee.id',
    'WHERE assignee.id=? AND assignee.active=1',
    "AND assignee.role IN ('staff','manager')",
    'AND granted.location_id=t.location_id))'
  ].join(' ');
  const args=[cmd.id,cmd.expected_assigned_to,principal.id,principal.role,
    principal.token_hash,now,principal.role,principal.id,
    cmd.assigned_to,cmd.assigned_to];
  const audit=db.prepare(
    "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
    "SELECT ?,?,?,'task.assign','tasks',t.id,t.location_id,? FROM tasks t WHERE "+where
  ).bind(auditId,principal.id,principal.username,JSON.stringify({
    from:cmd.expected_assigned_to,to:cmd.assigned_to}),...args);
  const update=db.prepare('UPDATE tasks AS t SET assigned_to=? WHERE '+where+
    " AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='tasks' AND a.entity_id=t.id)"
  ).bind(cmd.assigned_to,...args,auditId);
  // Failing an assertion must roll back both audit and assignment.
  const validate=db.prepare('UPDATE audit_logs SET detail=CASE WHEN EXISTS('+
    'SELECT 1 FROM tasks t WHERE t.id=? AND t.location_id=? AND t.assigned_to IS ?'+
    ') THEN detail ELSE NULL END WHERE id=?'
  ).bind(cmd.id,item.location_id,cmd.assigned_to,auditId);
  const results=await db.batch([audit,update,validate]);
  if(!Array.isArray(results)||results.length!==3||
     results.some(x=>changes(x)!==1))return respond(409,{code:'E_CONCURRENT_CHANGE'});
  return respond(200,{ok:true,result:{id:cmd.id,assigned_to:cmd.assigned_to}});
}
// Due date is a date-only business property, not an inferred time zone.
// Update is compare-and-set and cannot change a completed task.
async function changeDueDate(db,principal,cmd){
  if(!hasAccess(principal,'manager'))return respond(403,{code:'E_FORBIDDEN'});
  const item=await db.prepare(
    'SELECT t.id,t.location_id,t.due_date,t.status,l.active FROM tasks t '+
    'JOIN locations l ON l.id=t.location_id WHERE t.id=? LIMIT 1'
  ).bind(cmd.id).first();
  if(!item||item.active!==1||!hasAccess(principal,'manager',item.location_id))
    return respond(404,{code:'E_TASK_NOT_FOUND'});
  if(item.status==='done'||item.due_date!==cmd.expected_due_date||
     item.due_date===cmd.due_date)
    return respond(409,{code:'E_TASK_DUE_CONFLICT'});
  const now=new Date().toISOString(),auditId=crypto.randomUUID();
  const where=[
    "t.id=? AND t.due_date IS ? AND t.status<>'done'",
    'AND EXISTS(SELECT 1 FROM locations l WHERE l.id=t.location_id AND l.active=1)',
    'AND EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id',
    "WHERE u.id=? AND u.active=1 AND u.role=? AND u.role IN ('owner','manager')",
    'AND s.token_hash=? AND s.expires_at>?)',
    "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul",
    'WHERE ul.user_id=? AND ul.location_id=t.location_id))'
  ].join(' ');
  const args=[cmd.id,cmd.expected_due_date,principal.id,principal.role,
    principal.token_hash,now,principal.role,principal.id];
  const audit=db.prepare(
    "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
    "SELECT ?,?,?,'task.due','tasks',t.id,t.location_id,? FROM tasks t WHERE "+where
  ).bind(auditId,principal.id,principal.username,
    JSON.stringify({from:cmd.expected_due_date,to:cmd.due_date}),...args);
  const update=db.prepare('UPDATE tasks AS t SET due_date=? WHERE '+where+
    " AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='tasks' AND a.entity_id=t.id)"
  ).bind(cmd.due_date,...args,auditId);
  const validate=db.prepare('UPDATE audit_logs SET detail=CASE WHEN EXISTS('+
    'SELECT 1 FROM tasks t WHERE t.id=? AND t.location_id=? AND t.due_date IS ?'+
    ') THEN detail ELSE NULL END WHERE id=?'
  ).bind(cmd.id,item.location_id,cmd.due_date,auditId);
  const results=await db.batch([audit,update,validate]);
  if(!Array.isArray(results)||results.length!==3||
     results.some(x=>changes(x)!==1))return respond(409,{code:'E_CONCURRENT_CHANGE'});
  return respond(200,{ok:true,result:{id:cmd.id,due_date:cmd.due_date}});
}
async function createTask(db,principal,cmd){
  if(!hasAccess(principal,'manager'))return respond(403,{code:'E_FORBIDDEN'});
  const now=new Date().toISOString(),id=crypto.randomUUID(),auditId=crypto.randomUUID();
  // The authorization check is repeated INSIDE the transactional INSERT,
  // not based only on a previously loaded Session.
  const insert=db.prepare(
    'INSERT INTO tasks(id,location_id,title,description,created_by,assigned_to,due_date) '+
    'SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users u '+
    'JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.active=1 '+
    "AND u.role=? AND u.role IN ('owner','manager') "+
    'AND s.token_hash=? AND s.expires_at>?) '+
    'AND EXISTS(SELECT 1 FROM locations l WHERE l.id=? AND l.active=1 '+
    "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    'WHERE ul.location_id=l.id AND ul.user_id=?))) '+
    'AND (? IS NULL OR EXISTS(SELECT 1 FROM users assignee '+
    'JOIN user_locations assigned_store ON assigned_store.user_id=assignee.id '+
    'WHERE assignee.id=? AND assignee.active=1 '+
    "AND assignee.role IN ('manager','staff') "+
    'AND assigned_store.location_id=?))'
  ).bind(id,cmd.location_id,cmd.title,'',principal.id,cmd.assigned_to,cmd.due_date,
    principal.id,principal.role,principal.token_hash,now,
    cmd.location_id,principal.role,principal.id,
    cmd.assigned_to,cmd.assigned_to,cmd.location_id);
  const audit=db.prepare(
    "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
    "SELECT ?,?,?,'task.create','tasks',t.id,t.location_id,? FROM tasks t "+
    'WHERE t.id=? AND t.created_by=?'
  ).bind(auditId,principal.id,principal.username,JSON.stringify({title:cmd.title}),
    id,principal.id);
  // If audit cannot be created, make title=NULL to abort/rollback whole D1.batch.
  const check=db.prepare(
    "UPDATE tasks SET title=CASE WHEN EXISTS(SELECT 1 FROM audit_logs "+
    "WHERE id=? AND entity='tasks' AND entity_id=tasks.id) THEN title ELSE NULL END "+
    'WHERE id=?'
  ).bind(auditId,id);
  const results=await db.batch([insert,audit,check]);
  if(!Array.isArray(results)||results.length!==3||
     results.some(x=>changes(x)!==1))return respond(409,{code:'E_CONCURRENT_CHANGE'});
  return respond(200,{ok:true,result:{id,location_id:cmd.location_id,title:cmd.title,
    assigned_to:cmd.assigned_to,due_date:cmd.due_date}});
}
export async function nativeTaskHttp(request,env){
  if(!nativeTaskWriteEnabled(env))return respond(503,{code:'E_NOT_READY'});
  if(request?.method!=='POST')return respond(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/task'||url.search||url.hash)
      return respond(400,{code:'E_BAD_REQUEST'});
    if(request.headers.get('sec-fetch-site')!=='same-origin'||
       request.headers.has('authorization'))return respond(403,{code:'E_ORIGIN_DENIED'});
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return respond(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,principal,'staff'))
      return respond(403,{code:'E_FORBIDDEN'});
    const cmd=await boundedJson(request);
    if(!cmd)return respond(400,{code:'E_INVALID_COMMAND'});
    const version=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(version?.contract_version)!==3)
      return respond(503,{code:'E_SCHEMA_NOT_READY'});
    if(cmd.action==='task.create')return await createTask(env.DB,principal,cmd);
    if(cmd.action==='task.assign')return await assignTask(env.DB,principal,cmd);
    if(cmd.action==='task.due')return await changeDueDate(env.DB,principal,cmd);
    return await changeStatus(env.DB,principal,cmd);
  }catch{return respond(503,{code:'E_TASK_UNAVAILABLE'});}
}