// Scoped training operations; catalogue is global, person and record
// candidates are store-scoped. Existing read-only history remains unchanged.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {nativeTrainingWriteEnabled} from './native-training-http.mjs';
import {loadPrincipal} from './auth-core.mjs';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const actor="a.id=? AND a.role=? AND a.active=1 AND a.role IN ('owner','manager') "+
 "AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=a.id AND s.token_hash=? AND s.csrf_token=? "+
 "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) "+
 "AND EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3)";
const scope=" AND (a.role='owner' OR EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=a.id AND g.location_id=l.id))";
const target="t.active=1 AND t.role IN ('staff','manager') AND EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=t.id AND g.location_id=l.id)";
async function list(db,sql,args){
 const out=await db.prepare(sql).bind(...args).all();
 if(!Array.isArray(out?.results)||out.results.length>501)throw Error('E_TRAINING_LIST');
 return {rows:out.results.slice(0,500),truncated:out.results.length>500};
}
export async function nativeTrainingCapabilityHttp(request,env){
 if(!nativeLoginEnabled(env))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const u=new URL(request.url);
  if(u.protocol!=='https:'||u.pathname!=='/api/training/capability'||u.hash||u.search)
   return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.has('authorization')||
   request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  const empty={enabled:false,courses:[],candidates:[],pending:[],truncated:false};
  if(!nativeTrainingWriteEnabled(env)||!['owner','manager'].includes(p.role))return reply(200,empty);
  const args=[p.id,p.role,p.token_hash,p.csrf];
  // Each projection rechecks actor identity/session and schema. The writer
  // independently rechecks all permissions before and within its D1 batch.
  const courses=await list(db,"SELECT c.id,c.title,c.required_score FROM users a "+
   "JOIN training_courses c ON c.active=1 WHERE "+actor+" ORDER BY c.title,c.id LIMIT 501",args);
  const candidates=await list(db,"SELECT t.id AS user_id,t.display_name AS staff_name,l.id AS location_id,l.name AS location_name "+
   "FROM users a JOIN locations l ON l.active=1 JOIN user_locations g ON g.location_id=l.id "+
   "JOIN users t ON t.id=g.user_id AND "+target+" WHERE "+actor+scope+
   " ORDER BY l.name,l.id,t.display_name,t.id LIMIT 501",args);
  const pending=await list(db,"SELECT r.id,c.title AS course_title,c.required_score,t.display_name AS staff_name,l.name AS location_name "+
   "FROM users a JOIN training_records r ON r.score IS NULL AND r.completed_on IS NULL AND r.assessor_id IS NULL "+
   "JOIN locations l ON l.id=r.location_id AND l.active=1 JOIN users t ON t.id=r.user_id AND "+target+
   " JOIN training_courses c ON c.id=r.course_id AND c.active=1 WHERE "+actor+scope+
   " AND r.user_id<>a.id ORDER BY l.name,l.id,t.display_name,c.title,r.id LIMIT 501",args);
  if(!await db.prepare("SELECT a.id FROM users a WHERE "+actor).bind(...args).first())return reply(401,{code:'E_UNAUTHENTICATED'});
  return reply(200,{enabled:true,courses:courses.rows,candidates:candidates.rows,pending:pending.rows,
   truncated:courses.truncated||candidates.truncated||pending.truncated});
 }catch{return reply(503,{code:'E_TRAINING_CAPABILITY_UNAVAILABLE'});}
}
