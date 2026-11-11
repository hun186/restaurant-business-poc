// Authenticated native D1 password change; independent of business write gates.
// Never logs or returns credentials. A successful change revokes all sessions.
import {loadPrincipal,authorizedMutation,verifyWorkerPassword,hashWorkerPassword,
 expiredSessionCookie} from './auth-core.mjs';
import {reserveLoginAttempt,sourceIpDigest} from './login-service.mjs';
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';

const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(code,status=400,cookie)=>new Response(JSON.stringify({code}),{
 status,headers:cookie?{...headers,'Set-Cookie':cookie}:headers
});
const count=res=>{
 const n=res?.meta?.changes??res?.changes;
 if(!Number.isSafeInteger(n)||n<0)throw Error('E_PASSWORD_D1_RESULT');
 return n;
};
function input(raw){
 let obj;
 try{obj=JSON.parse(raw);}catch{return null;}
 if(!obj||typeof obj!=='object'||Array.isArray(obj)||
    Object.keys(obj).sort().join(',')!=='current_password,new_password')return null;
 for(const k of ['current_password','new_password']){
  if(typeof obj[k]!=='string'||obj[k].length<12||obj[k].length>256||
     /[\r\n\0]/.test(obj[k]))return null;
 }
 if(obj.current_password===obj.new_password)return null;
 return obj;
}
export async function changePasswordD1(db,request,principal,values,ipHash){
 if(!db||typeof db.prepare!=='function'||typeof db.batch!=='function')
   throw Error('E_PASSWORD_CONFIG');
 if(!principal?.id||!principal.token_hash||!authorizedMutation(request,principal,'staff'))
   return {status:403,code:'E_CSRF_ORIGIN'};
 // Limit attempts to check the old password even for authenticated sessions.
 const attempt=await reserveLoginAttempt(db,principal.username,ipHash);
 if(!attempt)return {status:429,code:'E_RATE_LIMITED'};
 const user=await db.prepare(
  'SELECT password_salt,password_hash FROM users WHERE id=? AND username=? COLLATE NOCASE AND active=1'
 ).bind(principal.id,principal.username).first();
 if(!user||!(await verifyWorkerPassword(values.current_password,
   user.password_salt,user.password_hash)))return {status:403,code:'E_INVALID_CURRENT_PASSWORD'};
 const replacement=await hashWorkerPassword(values.new_password);
 const at=new Date().toISOString();
 const done=await db.batch([
  db.prepare(
   'UPDATE users SET password_salt=?, password_hash=? WHERE id=? AND active=1 '+
   'AND password_salt=? AND password_hash=? AND EXISTS ('+
   'SELECT 1 FROM sessions WHERE user_id=? AND token_hash=? AND expires_at>?)'
  ).bind(replacement.password_salt,replacement.password_hash,principal.id,
   user.password_salt,user.password_hash,principal.id,principal.token_hash,at),
  db.prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS ('+
    'SELECT 1 FROM users WHERE id=? AND password_salt=? AND password_hash=?)'
  ).bind(principal.id,principal.id,replacement.password_salt,replacement.password_hash),
  db.prepare('INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,detail) '+
   "SELECT ?,id,username,'auth.password_change','users','{}' FROM users "+
   'WHERE id=? AND password_salt=? AND password_hash=?'
  ).bind(crypto.randomUUID(),principal.id,replacement.password_salt,replacement.password_hash),
  db.prepare('UPDATE login_attempts SET success=1 WHERE id=? AND success=0 AND EXISTS ('+
   'SELECT 1 FROM users WHERE id=? AND password_salt=? AND password_hash=?)'
  ).bind(attempt,principal.id,replacement.password_salt,replacement.password_hash)
 ]);
 if(!Array.isArray(done)||done.length!==4||count(done[0])!==1||
    count(done[1])<1||count(done[2])!==1||count(done[3])!==1)
    throw Error('E_PASSWORD_ATOMIC');
 return {status:200,code:'OK'};
}
export async function nativePasswordChangeHttp(request,env){
 // Gate checked before reading the supplied password body.
 if(!nativeLoginEnabled(env))return reply('E_NOT_READY',503);
 const url=new URL(request.url);
 if(url.protocol!=='https:'||url.pathname!=='/api/password/change'||url.search||url.hash)
   return reply('E_AUTH_REQUEST',400);
 if(request.method!=='POST')return reply('METHOD_NOT_ALLOWED',405);
 if(request.headers.get('origin')!==url.origin||
   (request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'))
   return reply('E_CSRF_ORIGIN',403);
 if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
   return reply('E_AUTH_REQUEST',400);
 if(request.headers.get('content-type')!=='application/json')
   return reply('E_AUTH_REQUEST',415);
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>2048))
   return reply('E_AUTH_REQUEST',413);
 try{
  const principal=await loadPrincipal(env.DB,request);
  if(!principal)return reply('E_UNAUTHENTICATED',401);
  if(!authorizedMutation(request,principal,'staff'))return reply('E_CSRF_ORIGIN',403);
  if(!request.cf||typeof request.cf.colo!=='string')
   return reply('E_AUTH_SOURCE_UNAVAILABLE',503);
  const values=input(await bodyWithinLimit(request));
  if(!values)return reply('E_PASSWORD_FORMAT',400);
  const schema=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(Number(schema?.contract_version)!==3)return reply('E_SCHEMA_NOT_READY',503);
  let ipHash;
  try{ipHash=await sourceIpDigest(request,env.NATIVE_AUTH_SOURCE_PEPPER);}
  catch{return reply('E_AUTH_SOURCE_UNAVAILABLE',503);}
  const result=await changePasswordD1(env.DB,request,principal,values,ipHash);
  return reply(result.code,result.status,result.status===200?expiredSessionCookie():undefined);
 }catch(e){
  if(e?.message==='E_BODY_TOO_LARGE')return reply('E_AUTH_REQUEST',413);
  if(e?.message==='E_BODY_DEADLINE')return reply('E_AUTH_REQUEST',408);
  if(e?.message==='E_BODY_INVALID'||e?.message==='E_BODY_CHUNKS')
   return reply('E_AUTH_REQUEST',400);
  return reply('E_PASSWORD_UNAVAILABLE',503);
 }
}
