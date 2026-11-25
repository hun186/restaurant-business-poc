// Owner-assisted reset of active staff/manager accounts only. Never Owner
// recovery, public reset, hard delete or implicit activation. Default denied.
import {loadPrincipal,authorizedMutation,verifyWorkerPassword,hashWorkerPassword} from './auth-core.mjs';
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {reserveLoginAttempt,sourceIpDigest} from './login-service.mjs';
import {canOwnerManageAccountStatus} from './account-status-contract.mjs';

const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const reply=(status,code)=>new Response(JSON.stringify({code}),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
export const nativeAccountPasswordResetEnabled=env=>nativeLoginEnabled(env)&&
 env?.CLOUD_NATIVE_ACCOUNT_ADMIN_WRITE_GATE==='operator-released'&&
 env?.CLOUD_NATIVE_ACCOUNT_PASSWORD_RESET_WRITE_GATE==='operator-released';
const validPassword=x=>typeof x==='string'&&x.length>=12&&x.length<=256&&!/[\r\n\0]/.test(x);
const count=x=>{
 const n=x?.meta?.changes??x?.changes;
 if(!Number.isSafeInteger(n)||n<0)throw Error('E_ACCOUNT_RESET_RESULT');
 return n;
};
const quotaPredicate="(SELECT COUNT(*) FROM audit_logs WHERE actor_id=a.id AND action='user.password_reset' AND at>=datetime('now','-1 hour'))<5";
export async function nativeAccountPasswordResetHttp(request,env){
 if(!nativeAccountPasswordResetEnabled(env))return reply(503,'E_NOT_READY');
 if(request?.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED');
 try{
  const u=new URL(request.url);
  if(u.protocol!=='https:'||u.pathname!=='/api/accounts/password-reset'||u.search||u.hash||
     request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
   return reply(400,'E_INVALID_REQUEST');
  if(request.headers.get('sec-fetch-site')!=='same-origin'||request.headers.get('origin')!==u.origin)
   return reply(403,'E_FORBIDDEN');
  if(request.headers.get('content-type')!=='application/json'||request.headers.has('content-encoding'))
   return reply(415,'E_INVALID_REQUEST');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>2048))
   return reply(413,'E_INVALID_REQUEST');
  const db=env.DB,p=await loadPrincipal(db,request);
  if(!p)return reply(401,'E_UNAUTHENTICATED');
  if(!authorizedMutation(request,p,'owner')||p.role!=='owner')return reply(403,'E_FORBIDDEN');
  if(!request.cf||typeof request.cf.colo!=='string')return reply(503,'E_AUTH_SOURCE_UNAVAILABLE');
  const schema=await db.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(schema?.contract_version!==3)return reply(503,'E_SCHEMA_NOT_READY');
  let input;try{input=JSON.parse(await bodyWithinLimit(request));}
  catch{return reply(400,'E_INVALID_INPUT');}
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).sort().join(',')!=='currentOwnerPassword,newPassword,targetUserId'||
     typeof input.targetUserId!=='string'||!UUID.test(input.targetUserId)||
     !validPassword(input.currentOwnerPassword)||!validPassword(input.newPassword)||
     input.currentOwnerPassword===input.newPassword)return reply(400,'E_INVALID_INPUT');
  const targetId=input.targetUserId.toLowerCase();
  if(p.id.toLowerCase()===targetId)return reply(403,'E_FORBIDDEN');
  const quota=await db.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id=? AND action='user.password_reset' AND at>=datetime('now','-1 hour')").bind(p.id).first();
  if(!Number.isSafeInteger(quota?.n)||quota.n<0)return reply(503,'E_ACCOUNT_RESET_UNAVAILABLE');
  if(quota.n>=5)return reply(429,'E_RATE_LIMITED');
  // Reauthentication attempts share the existing durable login-attempt
  // limiter; a failed password check may consume an attempt but never
  // changes the target or revokes any session.
  let ipHash;try{ipHash=await sourceIpDigest(request,env.NATIVE_AUTH_SOURCE_PEPPER);}
  catch{return reply(503,'E_AUTH_SOURCE_UNAVAILABLE');}
  const attempt=await reserveLoginAttempt(db,p.username,ipHash);
  if(!attempt)return reply(429,'E_RATE_LIMITED');
  const actor=await db.prepare("SELECT password_salt,password_hash FROM users WHERE id=? AND username=? COLLATE NOCASE AND role='owner' AND active=1").bind(p.id,p.username).first();
  if(!actor||!await verifyWorkerPassword(input.currentOwnerPassword,actor.password_salt,actor.password_hash))
   return reply(403,'E_INVALID_CURRENT_PASSWORD');
  const target=await db.prepare('SELECT id,role,active,password_salt,password_hash FROM users WHERE id=?').bind(targetId).first();
  if(!target)return reply(404,'E_ACCOUNT_NOT_FOUND');
  if(!canOwnerManageAccountStatus(p.role,p.id,target.role,target.id)||target.active!==1)
   return reply(403,'E_FORBIDDEN');
  const replacement=await hashWorkerPassword(input.newPassword),auditId=crypto.randomUUID();
  // All authorization, both credential snapshots, DB-time expiry, target
  // role/state, schema and successful-reset quota are checked atomically.
  const audit=db.prepare(
   'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,detail) '+
   "SELECT ?,a.id,a.username,'user.password_reset','users',t.id,'{}' FROM users a "+
   'JOIN sessions s ON s.user_id=a.id JOIN users t ON t.id=? '+
   "WHERE a.id=? AND a.role='owner' AND a.active=1 AND a.password_salt=? AND a.password_hash=? "+
   "AND s.token_hash=? AND s.csrf_token=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
   "AND t.id<>a.id AND t.active=1 AND t.role=? AND t.role IN ('staff','manager') "+
   'AND t.password_salt=? AND t.password_hash=? AND '+quotaPredicate+
   ' AND EXISTS(SELECT 1 FROM cloud_schema_contract WHERE id=1 AND contract_version=3) '+
   'AND EXISTS(SELECT 1 FROM login_attempts WHERE id=? AND success=0)'
  ).bind(auditId,targetId,p.id,actor.password_salt,actor.password_hash,p.token_hash,p.csrf,
   target.role,target.password_salt,target.password_hash,attempt);
  const update=db.prepare(
   'UPDATE users SET password_salt=?,password_hash=? WHERE id=? AND active=1 AND role=? '+
   'AND password_salt=? AND password_hash=? AND EXISTS('+
   "SELECT 1 FROM audit_logs WHERE id=? AND actor_id=? AND action='user.password_reset' AND entity_id=?)"
  ).bind(replacement.password_salt,replacement.password_hash,targetId,target.role,target.password_salt,target.password_hash,auditId,p.id,targetId);
  const revoke=db.prepare(
   'DELETE FROM sessions WHERE user_id=? AND EXISTS('+
   "SELECT 1 FROM audit_logs WHERE id=? AND actor_id=? AND action='user.password_reset' AND entity_id=?) "+
   'AND EXISTS(SELECT 1 FROM users WHERE id=? AND password_salt=? AND password_hash=?)'
  ).bind(targetId,auditId,p.id,targetId,targetId,replacement.password_salt,replacement.password_hash);
  const mark=db.prepare(
   "UPDATE login_attempts SET success=1 WHERE id=? AND success=0 AND EXISTS(SELECT 1 FROM audit_logs WHERE id=? AND action='user.password_reset' AND entity_id=?)"
  ).bind(attempt,auditId,targetId);
  // A missing audit, CAS failure or surviving target session must abort
  // inside the transaction, not merely generate a late HTTP error.
  const guard=db.prepare(
   'UPDATE users SET display_name=CASE WHEN '+
   "EXISTS(SELECT 1 FROM audit_logs WHERE id=? AND actor_id=? AND action='user.password_reset' AND entity_id=?) "+
   'AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND role=? AND password_salt=? AND password_hash=?) '+
   'AND NOT EXISTS(SELECT 1 FROM sessions WHERE user_id=?) '+
   'AND EXISTS(SELECT 1 FROM login_attempts WHERE id=? AND success=1) '+
   'THEN display_name ELSE NULL END WHERE id=?'
  ).bind(auditId,p.id,targetId,targetId,target.role,replacement.password_salt,replacement.password_hash,targetId,attempt,p.id);
  const out=await db.batch([audit,update,revoke,mark,guard]);
  if(!Array.isArray(out)||out.length!==5||out.some(x=>x?.success===false)||
     [0,1,3,4].some(i=>count(out[i])!==1)||count(out[2])<0)
   return reply(503,'E_ACCOUNT_RESET_UNCERTAIN_NO_RETRY');
  return reply(200,'OK');
 }catch{return reply(503,'E_ACCOUNT_RESET_UNCERTAIN_NO_RETRY');}
}
