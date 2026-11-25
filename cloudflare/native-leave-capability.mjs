// Separate authenticated operation projection. Existing read-only list stays
// unchanged. Candidate rows are not authority to commit a future mutation.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {nativeLeaveWriteEnabled} from './native-leave-http.mjs';
import {loadPrincipal} from './auth-core.mjs';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const actor="a.id=? AND a.role=? AND a.active=1 AND EXISTS(SELECT 1 FROM sessions s "+
 "WHERE s.user_id=a.id AND s.token_hash=? AND s.csrf_token=? "+
 "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) "+
 "AND (a.role='owner' OR EXISTS(SELECT 1 FROM user_locations g WHERE g.user_id=a.id AND g.location_id=l.id))";
const target="t.active=1 AND (t.role='owner' OR EXISTS(SELECT 1 FROM user_locations g "+
 "WHERE g.user_id=t.id AND g.location_id=l.id))";
async function list(db,sql,args){
 const result=await db.prepare(sql).bind(...args).all();
 if(!Array.isArray(result?.results)||result.results.length>501)throw Error('E_LEAVE_LIST');
 return {rows:result.results.slice(0,500),truncated:result.results.length>500};
}
export async function nativeLeaveCapabilityHttp(request,env){
 if(!nativeLoginEnabled(env))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 try{
  const u=new URL(request.url);
  if(u.protocol!=='https:'||u.pathname!=='/api/leave/capability'||u.search||u.hash)return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.has('authorization')||
   request.headers.has('x-forwarded-user'))return reply(403,{code:'E_FORBIDDEN'});
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
  if(!nativeLeaveWriteEnabled(env))return reply(200,{enabled:false,candidates:[],pending:[],truncated:false});
  const args=[p.id,p.role,p.token_hash,p.csrf];
  const candidates=await list(db,
   "SELECT t.id AS user_id,t.display_name AS staff_name,l.id AS location_id,l.name AS location_name "+
   "FROM users a JOIN locations l ON l.active=1 JOIN users t ON "+target+
   " WHERE "+actor+" AND (t.id=a.id OR (a.role IN ('owner','manager') AND t.role IN ('manager','staff'))) "+
   "ORDER BY l.name,l.id,t.display_name,t.id LIMIT 501",args);
  const pending=p.role==='staff'?{rows:[],truncated:false}:await list(db,
   "SELECT r.id,r.start_date,r.end_date,r.reason,t.display_name AS staff_name,l.name AS location_name "+
   "FROM users a JOIN leave_requests r ON r.status='pending' AND r.reviewer_id IS NULL "+
   "JOIN locations l ON l.id=r.location_id AND l.active=1 JOIN users t ON t.id=r.user_id AND "+target+
   " WHERE "+actor+" AND a.role IN ('owner','manager') AND r.user_id<>a.id "+
   "AND (a.role='owner' OR t.role<>'owner') ORDER BY r.created_at DESC,r.id DESC LIMIT 501",args);
  return reply(200,{enabled:true,candidates:candidates.rows,pending:pending.rows,
   truncated:candidates.truncated||pending.truncated});
 }catch{return reply(503,{code:'E_LEAVE_CAPABILITY_UNAVAILABLE'});}
}
