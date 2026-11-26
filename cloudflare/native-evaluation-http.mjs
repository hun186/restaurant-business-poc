// Existing v3 employee evaluations, append-only, independently gated.
// No self evaluation, Owner target, editing, deletion, or raw HR audit detail.
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const uuid=x=>typeof x==='string'&&UUID.test(x)?x.toLowerCase():null;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const nativeEvaluationWriteEnabled=env=>nativeLoginEnabled(env)&&
 env?.CLOUD_NATIVE_EVALUATION_WRITE_GATE==='operator-released';
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys;
const first=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
const auditExists="EXISTS(SELECT 1 FROM audit_logs x WHERE x.id=? AND x.actor_id=? "+
 "AND x.action='evaluation.create' AND x.entity='evaluations' AND x.entity_id=? AND x.location_id=?)";
export async function nativeEvaluationHttp(request,env){
 if(!nativeEvaluationWriteEnabled(env))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const u=new URL(request.url);
  if(u.protocol!=='https:'||u.pathname!=='/api/evaluation'||u.search||u.hash)return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.has('authorization')||
   request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
  if(request.headers.get('content-type')!=='application/json'||request.headers.has('content-encoding'))
   return reply(415,{code:'E_INVALID_REQUEST'});
  const len=request.headers.get('content-length');
  if(len!==null&&(!/^(0|[1-9][0-9]*)$/.test(len)||Number(len)>8192))return reply(413,{code:'E_INVALID_REQUEST'});
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(!authorizedMutation(request,p,'manager'))return reply(403,{code:'E_FORBIDDEN'});
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  let raw;try{raw=JSON.parse(await bodyWithinLimit(request,{maxBytes:8192}));}catch{return reply(400,{code:'E_INVALID_COMMAND'});}
  if(!exact(raw,'action,data')||raw.action!=='evaluation.create')return reply(400,{code:'E_INVALID_COMMAND'});
  const x=raw.data;
  if(!exact(x,'feedback,location_id,period,score,user_id')||!uuid(x.user_id)||!uuid(x.location_id)||
   !Number.isInteger(x.score)||x.score<0||x.score>100||
   typeof x.period!=='string'||!x.period.trim()||x.period.length>30||/[\x00-\x1f\x7f]/.test(x.period)||
   typeof x.feedback!=='string'||x.feedback.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x.feedback))
   return reply(400,{code:'E_INVALID_COMMAND'});
  const key=uuid(request.headers.get('x-idempotency-key'));
  if(!key)return reply(400,{code:'E_IDEMPOTENCY_KEY'});
  const user=uuid(x.user_id),loc=uuid(x.location_id),period=x.period.trim(),feedback=x.feedback.trim();
  if(!hasAccess(p,'manager',loc)||user===p.id)return reply(403,{code:'E_FORBIDDEN'});
  const target=await first(db,"SELECT t.id FROM users t JOIN user_locations g ON g.user_id=t.id "+
   "JOIN locations l ON l.id=g.location_id AND l.active=1 WHERE t.id=? AND l.id=? "+
   "AND t.active=1 AND t.role IN ('staff','manager')",user,loc);
  if(!target)return reply(404,{code:'E_NOT_FOUND'});
  // Existing schema permits multiple assessments in the same period. Only
  // a replay of the same UUID is rejected, not a new assessment of that period.
  if(await first(db,'SELECT id FROM evaluations WHERE lower(id)=?',key))return reply(409,{code:'E_DUPLICATE_EVALUATION'});
  const aid=crypto.randomUUID(),a=[aid,p.id,key,loc];
  const audit=db.prepare("INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) "+
   "SELECT ?,a.id,a.username,'evaluation.create','evaluations',?,l.id,'{}' "+
   "FROM users a JOIN locations l ON l.id=? AND l.active=1 "+
   "JOIN users t ON t.id=? AND t.active=1 AND t.role IN ('staff','manager') "+
   "WHERE a.id=? AND a.role=? AND a.active=1 AND a.role IN ('owner','manager') AND t.id<>a.id "+
   "AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=a.id AND s.token_hash=? AND s.csrf_token=? "+
   "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) "+
   "AND (a.role='owner' OR EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=a.id AND g.location_id=l.id)) "+
   "AND EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=t.id AND g.location_id=l.id) "+
   "AND EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3) "+
   "AND NOT EXISTS(SELECT 1 FROM evaluations WHERE lower(id)=?)")
   .bind(aid,key,loc,user,p.id,p.role,p.token_hash,p.csrf,key);
  const mutation=db.prepare("INSERT INTO evaluations(id,user_id,location_id,period,score,feedback,reviewer_id) "+
   "SELECT ?,?,?,?,?,?,? WHERE "+auditExists).bind(key,user,loc,period,x.score,feedback,p.id,...a);
  const guard=db.prepare("UPDATE users SET display_name=CASE WHEN "+auditExists+
   " AND EXISTS(SELECT 1 FROM evaluations WHERE id=? AND user_id=? AND location_id=? "+
   "AND period=? AND score=? AND feedback=? AND reviewer_id=?) "+
   "THEN display_name ELSE NULL END WHERE id=?")
   .bind(...a,key,user,loc,period,x.score,feedback,p.id,p.id);
  const out=await db.batch([audit,mutation,guard]);
  if(!Array.isArray(out)||out.length!==3||out.some(v=>v?.success===false||(v?.meta?.changes??v?.changes)!==1))
   return reply(503,{code:'E_EVALUATION_UNCERTAIN_NO_RETRY'});
  return reply(200,{ok:true,result:{id:key}});
 }catch{return reply(503,{code:'E_EVALUATION_UNCERTAIN_NO_RETRY'});}
}
