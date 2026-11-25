// Native training commands, existing v3 schema. No score overwrite or self
// assessment, course editing/deletion, or remote activation.
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const uuid=x=>typeof x==='string'&&UUID.test(x)?x.toLowerCase():null;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const nativeTrainingWriteEnabled=env=>nativeLoginEnabled(env)&&
 env?.CLOUD_NATIVE_TRAINING_WRITE_GATE==='operator-released';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys;
const text=(x,max,required=false)=>typeof x==='string'&&x.length<=max&&(!required||!!x.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x);
const score=x=>Number.isInteger(x)&&x>=0&&x<=100;
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const actor="a.id=? AND a.role=? AND a.active=1 AND a.role IN ('owner','manager') "+
 "AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=a.id AND s.token_hash=? AND s.csrf_token=? "+
 "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) "+
 "AND EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3)";
const scope=" AND (a.role='owner' OR EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=a.id AND g.location_id=l.id))";
const target="t.active=1 AND t.role IN ('staff','manager') AND EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=t.id AND g.location_id=l.id)";
const auditExists="EXISTS(SELECT 1 FROM audit_logs x WHERE x.id=? AND x.actor_id=? AND x.action=? AND x.entity=? AND x.entity_id=? AND x.location_id IS ?)";
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
async function finish(db,p,audit,mutation,proof,proofArgs,auditArgs,id){
 const guard=db.prepare("UPDATE users SET display_name=CASE WHEN "+auditExists+" AND EXISTS("+proof+
  ") THEN display_name ELSE NULL END WHERE id=?").bind(...auditArgs,...proofArgs,p.id);
 const out=await db.batch([audit,mutation,guard]);
 if(!Array.isArray(out)||out.length!==3||out.some(v=>v?.success===false||(v?.meta?.changes??v?.changes)!==1))
  return reply(503,{code:'E_TRAINING_UNCERTAIN_NO_RETRY'});
 return reply(200,{ok:true,result:{id}});
}
export async function nativeTrainingHttp(request,env){
 if(!nativeTrainingWriteEnabled(env))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const u=new URL(request.url);
  if(u.protocol!=='https:'||u.pathname!=='/api/training'||u.search||u.hash)return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.has('authorization')||request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
  if(request.headers.get('content-type')!=='application/json'||request.headers.has('content-encoding'))return reply(415,{code:'E_INVALID_REQUEST'});
  const len=request.headers.get('content-length');
  if(len!==null&&(!/^(0|[1-9][0-9]*)$/.test(len)||Number(len)>8192))return reply(413,{code:'E_INVALID_REQUEST'});
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(!authorizedMutation(request,p,'manager'))return reply(403,{code:'E_FORBIDDEN'});
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  let raw;try{raw=JSON.parse(await bodyWithinLimit(request,{maxBytes:8192}));}catch{return reply(400,{code:'E_INVALID_COMMAND'});}
  if(!exact(raw,'action,data')||!['course.create','training.assign','training.score'].includes(raw.action))return reply(400,{code:'E_INVALID_COMMAND'});
  const x=raw.data,key=uuid(request.headers.get('x-idempotency-key')),auditId=crypto.randomUUID();
  if(!key)return reply(400,{code:'E_IDEMPOTENCY_KEY'});
  const aa=[p.id,p.role,p.token_hash,p.csrf],bad=()=>reply(400,{code:'E_INVALID_COMMAND'}),duplicate=()=>reply(409,{code:'E_TRAINING_DUPLICATE'});
  if(raw.action==='course.create'){
   // Like the local service, course catalogue is shared across stores.
   // Manager may create a course; no existing catalogue row is modified.
   if(!exact(x,'description,required_score,title')||!text(x.title,150,true)||!text(x.description,1200)||!score(x.required_score))return bad();
   if(await first(db,'SELECT id FROM training_courses WHERE lower(id)=?',key))return duplicate();
   const title=x.title.trim(),description=x.description.trim(),a=[auditId,p.id,raw.action,'training_courses',key,null];
   const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
    "SELECT ?,a.id,a.username,'course.create','training_courses',?,NULL,'{}' FROM users a WHERE "+actor+
    " AND NOT EXISTS(SELECT 1 FROM training_courses WHERE lower(id)=?)").bind(auditId,key,...aa,key);
   const mutation=db.prepare("INSERT INTO training_courses(id,title,description,required_score) SELECT ?,?,?,? WHERE "+auditExists)
    .bind(key,title,description,x.required_score,...a);
   return await finish(db,p,audit,mutation,"SELECT 1 FROM training_courses WHERE id=? AND title=? AND description=? AND required_score=? AND active=1",
    [key,title,description,x.required_score],a,key);
  }
  if(raw.action==='training.assign'){
   if(!exact(x,'course_id,location_id,user_id')||!uuid(x.course_id)||!uuid(x.location_id)||!uuid(x.user_id))return bad();
   const course=uuid(x.course_id),loc=uuid(x.location_id),user=uuid(x.user_id);
   if(!hasAccess(p,'manager',loc))return reply(403,{code:'E_FORBIDDEN'});
   const eligible=await first(db,"SELECT t.id FROM users t JOIN locations l ON l.id=? AND l.active=1 "+
    "JOIN training_courses c ON c.id=? AND c.active=1 WHERE t.id=? AND "+target,loc,course,user);
   if(!eligible)return reply(404,{code:'E_NOT_FOUND'});
   if(await first(db,'SELECT id FROM training_records WHERE lower(id)=? OR (course_id=? AND user_id=? AND location_id=?)',key,course,user,loc))return duplicate();
   const a=[auditId,p.id,raw.action,'training_records',key,loc];
   const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
    "SELECT ?,a.id,a.username,'training.assign','training_records',?,l.id,'{}' "+
    "FROM users a JOIN locations l ON l.id=? AND l.active=1 JOIN users t ON t.id=? "+
    "JOIN training_courses c ON c.id=? AND c.active=1 WHERE "+actor+scope+" AND "+target+
    " AND NOT EXISTS(SELECT 1 FROM training_records WHERE lower(id)=? OR (course_id=c.id AND user_id=t.id AND location_id=l.id))")
    .bind(auditId,key,loc,user,course,...aa,key);
   const mutation=db.prepare("INSERT INTO training_records(id,course_id,user_id,location_id) SELECT ?,?,?,? WHERE "+auditExists)
    .bind(key,course,user,loc,...a);
   return await finish(db,p,audit,mutation,"SELECT 1 FROM training_records WHERE id=? AND course_id=? AND user_id=? AND location_id=? AND score IS NULL AND completed_on IS NULL AND assessor_id IS NULL",
    [key,course,user,loc],a,key);
  }
  if(!exact(x,'completed_on,id,score')||!uuid(x.id)||!score(x.score)||!day(x.completed_on))return bad();
  const id=uuid(x.id);
  const row=await first(db,"SELECT r.id,r.user_id,r.location_id,r.course_id,r.score,r.completed_on,r.assessor_id FROM training_records r "+
   "JOIN locations l ON l.id=r.location_id AND l.active=1 JOIN users t ON t.id=r.user_id "+
   "JOIN training_courses c ON c.id=r.course_id AND c.active=1 WHERE r.id=? AND "+target,id);
  if(!row||!hasAccess(p,'manager',row.location_id))return reply(404,{code:'E_NOT_FOUND'});
  if(row.user_id===p.id)return reply(403,{code:'E_FORBIDDEN'});
  if(row.score!==null||row.completed_on!==null||row.assessor_id!==null)return reply(409,{code:'E_TRAINING_ALREADY_SCORED'});
  const a=[auditId,p.id,raw.action,'training_records',id,row.location_id];
  const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
   "SELECT ?,a.id,a.username,'training.score','training_records',r.id,l.id,'{}' "+
   "FROM users a JOIN training_records r ON r.id=? JOIN locations l ON l.id=r.location_id AND l.active=1 "+
   "JOIN users t ON t.id=r.user_id JOIN training_courses c ON c.id=r.course_id AND c.active=1 WHERE "+
   actor+scope+" AND "+target+" AND r.user_id<>a.id AND r.user_id=? AND r.location_id=? AND r.course_id=? "+
   "AND r.score IS NULL AND r.completed_on IS NULL AND r.assessor_id IS NULL")
   .bind(auditId,id,...aa,row.user_id,row.location_id,row.course_id);
  const mutation=db.prepare("UPDATE training_records SET score=?,completed_on=?,assessor_id=? WHERE id=? "+
   "AND user_id=? AND location_id=? AND course_id=? AND score IS NULL AND completed_on IS NULL AND assessor_id IS NULL AND "+auditExists)
   .bind(x.score,x.completed_on,p.id,id,row.user_id,row.location_id,row.course_id,...a);
  return await finish(db,p,audit,mutation,"SELECT 1 FROM training_records WHERE id=? AND user_id=? AND location_id=? AND course_id=? AND score=? AND completed_on=? AND assessor_id=?",
   [id,row.user_id,row.location_id,row.course_id,x.score,x.completed_on,p.id],a,id);
 }catch{return reply(503,{code:'E_TRAINING_UNCERTAIN_NO_RETRY'});}
}
