// Native Cloudflare D1 task creation/status, off unless BOTH production gates
// are set by an operator. Server checks sessions, roles, stores and CSRF.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal,hasAccess,authorizedMutation} from './auth-core.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const STATES=new Set(['todo','doing','done']);
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
       Object.keys(data.data).sort().join(',')==='location_id,title'&&
       typeof data.data.location_id==='string'&&UUID.test(data.data.location_id)&&
       typeof data.data.title==='string'){
      const title=data.data.title.trim();
      if(title&&title.length<=120)return {action:'task.create',
        location_id:data.data.location_id,title};
    }
    if(data.action==='task.status'&&
       Object.keys(data.data).sort().join(',')==='id,status'&&
       typeof data.data.id==='string'&&UUID.test(data.data.id)&&
       STATES.has(data.data.status))return {action:'task.status',
         id:data.data.id,status:data.data.status};
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
async function createTask(db,principal,cmd){
  if(!hasAccess(principal,'manager'))return respond(403,{code:'E_FORBIDDEN'});
  const now=new Date().toISOString(),id=crypto.randomUUID(),auditId=crypto.randomUUID();
  // The authorization check is repeated INSIDE the transactional INSERT,
  // not based only on a previously loaded Session.
  const insert=db.prepare(
    'INSERT INTO tasks(id,location_id,title,description,created_by) '+
    'SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users u '+
    'JOIN sessions s ON s.user_id=u.id WHERE u.id=? AND u.active=1 '+
    "AND u.role=? AND u.role IN ('owner','manager') "+
    'AND s.token_hash=? AND s.expires_at>?) '+
    'AND EXISTS(SELECT 1 FROM locations l WHERE l.id=? AND l.active=1 '+
    "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    'WHERE ul.location_id=l.id AND ul.user_id=?)))'
  ).bind(id,cmd.location_id,cmd.title,'',principal.id,
    principal.id,principal.role,principal.token_hash,now,
    cmd.location_id,principal.role,principal.id);
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
  return respond(200,{ok:true,result:{id,location_id:cmd.location_id,title:cmd.title}});
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
    return cmd.action==='task.create'
      ? await createTask(env.DB,principal,cmd)
      : await changeStatus(env.DB,principal,cmd);
  }catch{return respond(503,{code:'E_TASK_UNAVAILABLE'});}
}