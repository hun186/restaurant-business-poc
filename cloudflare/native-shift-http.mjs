// Independently gated Native shift creation. Existing v3 schema.
// No edit/delete, cross-store conflict details or automatic leave changes.
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
import {SHIFT_CONFLICT_SQL,shiftConflictBindings} from './shift-time-contract.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const uuid=x=>typeof x==='string'&&UUID.test(x)?x.toLowerCase():null;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const nativeShiftWriteEnabled=env=>nativeLoginEnabled(env)&&
 env?.CLOUD_NATIVE_SHIFT_WRITE_GATE==='operator-released';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys;
const auditExists="EXISTS(SELECT 1 FROM audit_logs x WHERE x.id=? AND x.actor_id=? "+
 "AND x.action='shift.create' AND x.entity='shifts' AND x.entity_id=? AND x.location_id=?)";
export async function nativeShiftHttp(request,env){
 if(!nativeShiftWriteEnabled(env))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const url=new URL(request.url);
  if(url.protocol!=='https:'||url.pathname!=='/api/shift'||url.search||url.hash)return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.has('authorization')||
    request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
  if(request.headers.get('content-type')!=='application/json'||request.headers.has('content-encoding'))
   return reply(415,{code:'E_INVALID_REQUEST'});
  const len=request.headers.get('content-length');
  if(len!==null&&(!/^(0|[1-9][0-9]*)$/.test(len)||Number(len)>2048))return reply(413,{code:'E_INVALID_REQUEST'});
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(!authorizedMutation(request,p,'manager'))return reply(403,{code:'E_FORBIDDEN'});
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  let raw;try{raw=JSON.parse(await bodyWithinLimit(request));}catch{return reply(400,{code:'E_INVALID_COMMAND'});}
  if(!exact(raw,'action,data')||raw.action!=='shift.create')return reply(400,{code:'E_INVALID_COMMAND'});
  const x=raw.data;
  if(!exact(x,'end_time,location_id,note,shift_date,start_time,user_id')||!uuid(x.location_id)||
   !uuid(x.user_id)||typeof x.note!=='string'||x.note.length>200||/[\x00-\x1f\x7f]/.test(x.note))
   return reply(400,{code:'E_INVALID_COMMAND'});
  const key=uuid(request.headers.get('x-idempotency-key'));
  if(!key)return reply(400,{code:'E_IDEMPOTENCY_KEY'});
  const userId=uuid(x.user_id),locationId=uuid(x.location_id);
  let conflictArgs;
  try{conflictArgs=shiftConflictBindings(userId,x.shift_date,x.start_time,x.end_time);}
  catch{return reply(400,{code:'E_INVALID_COMMAND'});}
  if(!hasAccess(p,'manager',locationId))return reply(403,{code:'E_FORBIDDEN'});
  // Match existing local shift semantics: target must have explicit active
  // store membership. Native exposes only active staff/manager candidates.
  const target=await db.prepare("SELECT t.id FROM users t JOIN user_locations g ON g.user_id=t.id "+
   "JOIN locations l ON l.id=g.location_id AND l.active=1 WHERE t.id=? AND l.id=? "+
   "AND t.active=1 AND t.role IN ('staff','manager')").bind(userId,locationId).first();
  if(!target)return reply(404,{code:'E_NOT_FOUND'});
  if(await db.prepare('SELECT id FROM shifts WHERE lower(id)=?').bind(key).first())
   return reply(409,{code:'E_DUPLICATE_SHIFT'});
  if(await db.prepare(SHIFT_CONFLICT_SQL).bind(...conflictArgs).first())
   return reply(409,{code:'E_SHIFT_OVERLAP'});
  const auditId=crypto.randomUUID();
  // The exact same shared conflict predicate is checked inside the atomic
  // transaction across ALL stores, not just the actor's authorized stores.
  const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
   "SELECT ?,a.id,a.username,'shift.create','shifts',?,l.id,'{}' "+
   "FROM users a JOIN locations l ON l.id=? AND l.active=1 "+
   "JOIN users t ON t.id=? AND t.active=1 AND t.role IN ('staff','manager') "+
   "WHERE a.id=? AND a.role=? AND a.active=1 AND a.role IN ('owner','manager') "+
   "AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=a.id AND s.token_hash=? AND s.csrf_token=? "+
   "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) "+
   "AND (a.role='owner' OR EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=a.id AND g.location_id=l.id)) "+
   "AND EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=t.id AND g.location_id=l.id) "+
   "AND EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3) "+
   "AND NOT EXISTS(SELECT 1 FROM shifts WHERE lower(id)=?) AND NOT EXISTS("+SHIFT_CONFLICT_SQL+")")
   .bind(auditId,key,locationId,userId,p.id,p.role,p.token_hash,p.csrf,key,...conflictArgs);
  const note=x.note.trim(),auditArgs=[auditId,p.id,key,locationId];
  const mutation=db.prepare("INSERT INTO shifts(id,location_id,user_id,shift_date,start_time,end_time,note,created_by) "+
   "SELECT ?,?,?,?,?,?,?,? WHERE "+auditExists)
   .bind(key,locationId,userId,x.shift_date,x.start_time,x.end_time,note,p.id,...auditArgs);
  const guard=db.prepare("UPDATE users SET display_name=CASE WHEN "+auditExists+
   " AND EXISTS(SELECT 1 FROM shifts WHERE id=? AND location_id=? AND user_id=? "+
   "AND shift_date=? AND start_time=? AND end_time=? AND note=? AND created_by=?) "+
   "THEN display_name ELSE NULL END WHERE id=?")
   .bind(...auditArgs,key,locationId,userId,x.shift_date,x.start_time,x.end_time,note,p.id,p.id);
  const result=await db.batch([audit,mutation,guard]);
  if(!Array.isArray(result)||result.length!==3||result.some(v=>v?.success===false||(v?.meta?.changes??v?.changes)!==1))
   return reply(503,{code:'E_SHIFT_UNCERTAIN_NO_RETRY'});
  return reply(200,{ok:true,result:{id:key}});
 }catch{return reply(503,{code:'E_SHIFT_UNCERTAIN_NO_RETRY'});}
}
