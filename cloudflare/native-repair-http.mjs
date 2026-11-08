// Native D1 repair tickets: staff reporting, manager assignment and closure.
// No public access and no mutations unless the operator independently releases this gate.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal,hasAccess,authorizedMutation} from './auth-core.mjs';
const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
const respond=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const nativeRepairWriteEnabled=env=>
  nativeLoginEnabled(env)&&env.CLOUD_NATIVE_REPAIR_WRITE_GATE==='operator-released';
const changes=r=>{
  const n=r?.meta?.changes??r?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_D1_RESULT');
  return n;
};
async function parse(request){
  const LIMIT=2048;
  if(request.headers.get('content-type')!=='application/json')return null;
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>LIMIT))
    return null;
  const reader=request.body?.getReader();if(!reader)return null;
  let timer,size=0;const chunks=[];
  try{
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('E_TIMEOUT')),2000);});
    for(;;){
      const chunk=await Promise.race([reader.read(),deadline]);if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array))return null;
      size+=chunk.value.byteLength;if(size>LIMIT)return null;chunks.push(chunk.value);
    }
    if(!size)return null;
    const buf=new Uint8Array(size);let offset=0;
    for(const chunk of chunks){buf.set(chunk,offset);offset+=chunk.byteLength;}
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buf));
    if(!data||typeof data!=='object'||Array.isArray(data)||
       Object.keys(data).sort().join(',')!=='action,data'||!data.data||
       typeof data.data!=='object'||Array.isArray(data.data))return null;
    const d=data.data,fields=Object.keys(d).sort().join(',');
    if(data.action==='repair.create'&&
       fields==='description,equipment,location_id'&&
       typeof d.location_id==='string'&&UUID.test(d.location_id)&&
       typeof d.equipment==='string'&&typeof d.description==='string'){
      const equipment=d.equipment.trim(),description=d.description.trim();
      if(equipment.length>=1&&equipment.length<=120&&
         description.length>=1&&description.length<=1000)
        return {action:data.action,location_id:d.location_id,equipment,description};
    }
    if(data.action==='repair.update'&&
       (fields==='expected_assigned_to,expected_status,id,status'||
        fields==='assigned_to,expected_assigned_to,expected_status,id,status')&&
       typeof d.id==='string'&&UUID.test(d.id)&&
       ['reported','assigned'].includes(d.expected_status)&&
       ['assigned','closed'].includes(d.status)&&
       (d.expected_assigned_to===null||
         typeof d.expected_assigned_to==='string'&&UUID.test(d.expected_assigned_to))&&
       (d.status==='assigned'?
          typeof d.assigned_to==='string'&&UUID.test(d.assigned_to):
          !Object.hasOwn(d,'assigned_to')))
      return {action:data.action,id:d.id,expected_status:d.expected_status,
        status:d.status,expected_assigned_to:d.expected_assigned_to,
        assigned_to:d.status==='assigned'?d.assigned_to:null};
    return null;
  }catch{return null;}finally{
    if(timer)clearTimeout(timer);
    try{const result=reader.cancel();result?.catch?.(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
}
const actorSQL=role=>
  'EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id '+
  'WHERE u.id=? AND u.role=? AND u.active=1 AND s.token_hash=? AND s.expires_at>?'+
  (role==='manager'?" AND u.role IN ('manager','owner')":'')+')';
const scopeSQL=alias=>
  "(?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
  'WHERE ul.user_id=? AND ul.location_id='+alias+'.location_id))';
const authArgs=(p,now)=>[p.id,p.role,p.token_hash,now,p.role,p.id];
async function createRepair(db,p,c){
  const id=crypto.randomUUID(),auditId=crypto.randomUUID(),now=new Date().toISOString();
  const insert=db.prepare(
    'INSERT INTO repairs(id,location_id,equipment,description,created_by) '+
    'SELECT ?,l.id,?,?,? FROM locations l WHERE l.id=? AND l.active=1 '+
    'AND '+actorSQL('staff')+" AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    'WHERE ul.user_id=? AND ul.location_id=l.id))'
  ).bind(id,c.equipment,c.description,p.id,c.location_id,...authArgs(p,now));
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    "SELECT ?,?,?,'repair.create','repairs',r.id,r.location_id,? "+
    'FROM repairs r WHERE r.id=? AND r.created_by=?'
  ).bind(auditId,p.id,p.username,JSON.stringify({equipment:c.equipment}),id,p.id);
  const guard=db.prepare(
    'UPDATE repairs SET equipment=CASE WHEN EXISTS('+
    "SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='repairs' "+
    'AND a.entity_id=repairs.id) THEN equipment ELSE NULL END WHERE id=?'
  ).bind(auditId,id);
  const rows=await db.batch([insert,audit,guard]);
  if(!Array.isArray(rows)||rows.length!==3||rows.some(x=>changes(x)!==1))
    return respond(409,{code:'E_REPAIR_CONFLICT'});
  return respond(200,{ok:true,result:{id,location_id:c.location_id,status:'reported'}});
}
async function updateRepair(db,p,c){
  if(!hasAccess(p,'manager'))return respond(403,{code:'E_FORBIDDEN'});
  const item=await db.prepare(
    'SELECT r.id,r.location_id,r.status,r.assigned_to,l.active FROM repairs r '+
    'JOIN locations l ON l.id=r.location_id WHERE r.id=? LIMIT 1'
  ).bind(c.id).first();
  if(!item||item.active!==1||!hasAccess(p,'manager',item.location_id))
    return respond(404,{code:'E_REPAIR_NOT_FOUND'});
  if(item.status!==c.expected_status||item.assigned_to!==c.expected_assigned_to||
     (c.status==='assigned'&&item.status==='assigned'&&item.assigned_to===c.assigned_to))
    return respond(409,{code:'E_REPAIR_CONFLICT'});
  const targetAssignee=c.status==='assigned'?c.assigned_to:item.assigned_to,
    now=new Date().toISOString(),auditId=crypto.randomUUID();
  const where=[
    'r.id=? AND r.status=? AND r.assigned_to IS ?',
    'AND EXISTS(SELECT 1 FROM locations l WHERE l.id=r.location_id AND l.active=1)',
    'AND '+actorSQL('manager'),'AND '+scopeSQL('r')
  ];
  if(c.status==='assigned')where.push(
    'AND EXISTS(SELECT 1 FROM users u JOIN user_locations ul ON ul.user_id=u.id '+
    "WHERE u.id=? AND u.active=1 AND u.role IN ('manager','staff') "+
    'AND ul.location_id=r.location_id)'
  );
  const predicate=where.join(' ');
  const baseArgs=[c.id,c.expected_status,c.expected_assigned_to,...authArgs(p,now),
    ...(c.status==='assigned'?[c.assigned_to]:[])];
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    "SELECT ?,?,?,'repair.update','repairs',r.id,r.location_id,? "+
    'FROM repairs r WHERE '+predicate
  ).bind(auditId,p.id,p.username,JSON.stringify({
    from:c.expected_status,to:c.status,assigned_to:targetAssignee}),...baseArgs);
  const update=db.prepare(
    'UPDATE repairs AS r SET status=?,assigned_to=? WHERE '+
    predicate+' AND EXISTS(SELECT 1 FROM audit_logs a '+
    "WHERE a.id=? AND a.entity='repairs' AND a.entity_id=r.id)"
  ).bind(c.status,targetAssignee,...baseArgs,auditId);
  const guard=db.prepare(
    'UPDATE audit_logs SET detail=CASE WHEN EXISTS('+
    'SELECT 1 FROM repairs r WHERE r.id=? AND r.status=? AND r.assigned_to IS ?'+
    ') THEN detail ELSE NULL END WHERE id=?'
  ).bind(c.id,c.status,targetAssignee,auditId);
  const rows=await db.batch([audit,update,guard]);
  if(!Array.isArray(rows)||rows.length!==3||rows.some(x=>changes(x)!==1))
    return respond(409,{code:'E_REPAIR_CONFLICT'});
  return respond(200,{ok:true,result:{id:c.id,status:c.status,assigned_to:targetAssignee}});
}
export async function nativeRepairHttp(request,env){
  if(!nativeRepairWriteEnabled(env))return respond(503,{code:'E_NOT_READY'});
  if(request?.method!=='POST')return respond(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/repair'||url.search||url.hash)
      return respond(400,{code:'E_BAD_REQUEST'});
    if(request.headers.get('sec-fetch-site')!=='same-origin'||
       request.headers.has('authorization'))return respond(403,{code:'E_ORIGIN_DENIED'});
    const p=await loadPrincipal(env.DB,request);
    if(!p)return respond(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,p,'staff'))return respond(403,{code:'E_FORBIDDEN'});
    const c=await parse(request);if(!c)return respond(400,{code:'E_INVALID_COMMAND'});
    const contract=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(contract?.contract_version)!==3)return respond(503,{code:'E_SCHEMA_NOT_READY'});
    return c.action==='repair.create'?await createRepair(env.DB,p,c):
      await updateRepair(env.DB,p,c);
  }catch{return respond(503,{code:'E_REPAIR_UNAVAILABLE'});}
}
