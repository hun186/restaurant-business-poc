// Native leave create/review. Existing v3 schema, default denied.
// Staff can apply only for self. Managers are scoped to active granted stores.
// No self review, deletion, implicit shift change, or sensitive reason in audit.
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const nativeLeaveWriteEnabled=env=>nativeLoginEnabled(env)&&
 env?.CLOUD_NATIVE_LEAVE_WRITE_GATE==='operator-released';
const uuid=x=>typeof x==='string'&&UUID.test(x)?x.toLowerCase():null;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&
 Object.keys(x).sort().join(',')===keys;
const changed=x=>x?.meta?.changes??x?.changes;
// Every business mutation is conditioned on an audit inserted in this very
// batch. Its random ID cannot be provided by a caller. The final NOT NULL
// guard rolls back any partially successful audit or business statement.
const actorScope="a.id=? AND a.role=? AND a.active=1 AND "+
 "EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=a.id AND s.token_hash=? AND s.csrf_token=? "+
 "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) "+
 "AND (a.role='owner' OR EXISTS(SELECT 1 FROM user_locations ul WHERE ul.user_id=a.id AND ul.location_id=l.id)) "+
 "AND EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3)";
const actorArgs=p=>[p.id,p.role,p.token_hash,p.csrf];
const auditExists="EXISTS(SELECT 1 FROM audit_logs x WHERE x.id=? AND x.actor_id=? AND x.action=? AND x.entity='leave_requests' AND x.entity_id=? AND x.location_id=?)";
const guardSql="UPDATE users SET display_name=CASE WHEN "+auditExists+
 " AND EXISTS(SELECT 1 FROM leave_requests r WHERE r.id=? AND r.location_id=? AND r.user_id=? AND r.status=? "+
 "AND ((?='pending' AND r.reviewer_id IS NULL) OR (?<>'pending' AND r.reviewer_id=?))) "+
 "THEN display_name ELSE NULL END WHERE id=?";
async function finish(db,p,audit,mutation,auditId,action,row,status){
 const guard=db.prepare(guardSql).bind(auditId,p.id,action,row.id,row.location_id,
  row.id,row.location_id,row.user_id,status,status,status,p.id,p.id);
 const result=await db.batch([audit,mutation,guard]);
 if(!Array.isArray(result)||result.length!==3||result.some(x=>x?.success===false||changed(x)!==1))
  return reply(503,{code:'E_LEAVE_UNCERTAIN_NO_RETRY'});
 return reply(200,{ok:true,result:{id:row.id,status}});
}
export async function nativeLeaveHttp(request,env){
 if(!nativeLeaveWriteEnabled(env))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.pathname!=='/api/leave'||url.search||url.hash)return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.has('authorization')||
   request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
  if(request.headers.get('content-type')!=='application/json'||request.headers.has('content-encoding'))
   return reply(415,{code:'E_INVALID_REQUEST'});
  const len=request.headers.get('content-length');
  if(len!==null&&(!/^(0|[1-9][0-9]*)$/.test(len)||Number(len)>2048))return reply(413,{code:'E_INVALID_REQUEST'});
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(!authorizedMutation(request,p,'staff'))return reply(403,{code:'E_FORBIDDEN'});
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  let raw;try{raw=JSON.parse(await bodyWithinLimit(request));}catch{return reply(400,{code:'E_INVALID_COMMAND'});}
  if(!exact(raw,'action,data')||!['leave.create','leave.review'].includes(raw.action))
   return reply(400,{code:'E_INVALID_COMMAND'});
  const x=raw.data,auditId=crypto.randomUUID();
  if(raw.action==='leave.create'){
   if(!exact(x,'end_date,location_id,reason,start_date,user_id')||
     !uuid(x.location_id)||!uuid(x.user_id)||!day(x.start_date)||!day(x.end_date)||
     x.start_date>x.end_date||typeof x.reason!=='string'||!x.reason.trim()||
     x.reason.length>400||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x.reason))
    return reply(400,{code:'E_INVALID_COMMAND'});
   const key=uuid(request.headers.get('x-idempotency-key'));
   if(!key)return reply(400,{code:'E_IDEMPOTENCY_KEY'});
   const row={id:key,location_id:uuid(x.location_id),user_id:uuid(x.user_id)};
   if(!hasAccess(p,'staff',row.location_id)||(p.role==='staff'&&row.user_id!==p.id))
    return reply(403,{code:'E_FORBIDDEN'});
   // Target must be active and currently assigned to the selected active store.
   // Owner self-application is allowed in an active store, as Owner has global scope.
   const target=await db.prepare("SELECT t.id FROM users t JOIN locations l ON l.id=? AND l.active=1 "+
    "WHERE t.id=? AND t.active=1 AND (t.role='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    "WHERE ul.user_id=t.id AND ul.location_id=l.id))").bind(row.location_id,row.user_id).first();
   if(!target||(row.user_id!==p.id&&p.role!=='owner'&&
    !(await db.prepare("SELECT id FROM users WHERE id=? AND role IN ('staff','manager')").bind(row.user_id).first())))
    return reply(404,{code:'E_NOT_FOUND'});
   if(await db.prepare('SELECT id FROM leave_requests WHERE lower(id)=?').bind(key).first())
    return reply(409,{code:'E_DUPLICATE_LEAVE'});
   const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
    "SELECT ?,a.id,a.username,'leave.create','leave_requests',?,l.id,'{}' "+
    "FROM users a JOIN locations l ON l.id=? AND l.active=1 JOIN users t ON t.id=? AND t.active=1 "+
    "WHERE "+actorScope+" AND (a.role<>'staff' OR t.id=a.id) "+
    "AND (a.role='owner' OR t.role IN ('staff','manager')) "+
    "AND (t.role='owner' OR EXISTS(SELECT 1 FROM user_locations ul WHERE ul.user_id=t.id AND ul.location_id=l.id)) "+
    "AND NOT EXISTS(SELECT 1 FROM leave_requests WHERE lower(id)=?)")
    .bind(auditId,key,row.location_id,row.user_id,...actorArgs(p),key);
   const mutation=db.prepare("INSERT INTO leave_requests(id,user_id,location_id,start_date,end_date,reason) "+
    "SELECT ?,?,?,?,?,? WHERE "+auditExists).bind(key,row.user_id,row.location_id,x.start_date,x.end_date,x.reason.trim(),
     auditId,p.id,'leave.create',key,row.location_id);
   return await finish(db,p,audit,mutation,auditId,'leave.create',row,'pending');
  }
  if(!exact(x,'id,status')||!uuid(x.id)||!['approved','rejected'].includes(x.status))
   return reply(400,{code:'E_INVALID_COMMAND'});
  if(!hasAccess(p,'manager'))return reply(403,{code:'E_FORBIDDEN'});
  const row=await db.prepare('SELECT r.id,r.user_id,r.location_id,r.status FROM leave_requests r JOIN locations l ON l.id=r.location_id AND l.active=1 WHERE r.id=?')
   .bind(uuid(x.id)).first();
  if(!row||!hasAccess(p,'manager',row.location_id))return reply(404,{code:'E_NOT_FOUND'});
  if(row.user_id===p.id)return reply(403,{code:'E_FORBIDDEN'});
  if(row.status!=='pending')return reply(409,{code:'E_LEAVE_ALREADY_REVIEWED'});
  // Match the pending record, actor and active location again in the transaction.
  // A manager cannot review a global Owner's request (only another Owner can).
  const target=await db.prepare('SELECT role FROM users WHERE id=?').bind(row.user_id).first();
  if(!target||(target.role==='owner'&&p.role!=='owner'))return reply(403,{code:'E_FORBIDDEN'});
  const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
   "SELECT ?,a.id,a.username,'leave.review','leave_requests',r.id,l.id,? "+
   "FROM users a JOIN leave_requests r ON r.id=? JOIN locations l ON l.id=r.location_id AND l.active=1 "+
   "JOIN users t ON t.id=r.user_id WHERE "+actorScope+
   " AND a.role IN ('owner','manager') AND r.status='pending' AND r.reviewer_id IS NULL "+
   "AND r.user_id<>a.id AND r.user_id=? AND r.location_id=? AND (a.role='owner' OR t.role<>'owner')")
   .bind(auditId,JSON.stringify({status:x.status}),row.id,...actorArgs(p),row.user_id,row.location_id);
  const mutation=db.prepare("UPDATE leave_requests SET status=?,reviewer_id=? WHERE id=? AND status='pending' AND reviewer_id IS NULL "+
   "AND user_id=? AND location_id=? AND "+auditExists)
   .bind(x.status,p.id,row.id,row.user_id,row.location_id,auditId,p.id,'leave.review',row.id,row.location_id);
  return await finish(db,p,audit,mutation,auditId,'leave.review',row,x.status);
 }catch{return reply(503,{code:'E_LEAVE_UNCERTAIN_NO_RETRY'});}
}
