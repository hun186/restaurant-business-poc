// Authenticated, bounded evaluation candidate projection. No scores, feedback or
// credentials. Candidate visibility never authorizes the subsequent write.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {nativeEvaluationWriteEnabled} from './native-evaluation-http.mjs';
import {loadPrincipal} from './auth-core.mjs';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export async function nativeEvaluationCapabilityHttp(request,env){
 if(!nativeLoginEnabled(env))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const u=new URL(request.url);
  if(u.protocol!=='https:'||u.pathname!=='/api/evaluation/capability'||u.search||u.hash)return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.has('authorization')||
   request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  if(!nativeEvaluationWriteEnabled(env)||!['owner','manager'].includes(p.role))
   return reply(200,{enabled:false,candidates:[],truncated:false});
  const result=await db.prepare(
   "SELECT t.id AS user_id,t.display_name AS staff_name,l.id AS location_id,l.name AS location_name "+
   "FROM users a JOIN locations l ON l.active=1 "+
   "JOIN user_locations tg ON tg.location_id=l.id JOIN users t ON t.id=tg.user_id "+
   "AND t.active=1 AND t.role IN ('staff','manager') AND t.id<>a.id "+
   "WHERE a.id=? AND a.role=? AND a.active=1 AND a.role IN ('owner','manager') "+
   "AND EXISTS(SELECT 1 FROM sessions s WHERE s.user_id=a.id AND s.token_hash=? AND s.csrf_token=? "+
   "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) "+
   "AND (a.role='owner' OR EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=a.id AND g.location_id=l.id)) "+
   "AND EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3) "+
   "ORDER BY l.name,l.id,t.display_name,t.id LIMIT 501")
   .bind(p.id,p.role,p.token_hash,p.csrf).all();
  if(!Array.isArray(result?.results)||result.results.length>501)throw Error('E_EVALUATION_LIST');
  return reply(200,{enabled:true,candidates:result.results.slice(0,500),truncated:result.results.length>500});
 }catch{return reply(503,{code:'E_EVALUATION_CAPABILITY_UNAVAILABLE'});}
}
