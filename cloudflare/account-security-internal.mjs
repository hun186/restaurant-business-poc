// Dormant internal D1 account security prototype. NOT imported by public Worker.
// No HTTP route, operator endpoint, credentials, database migration or release flag.
// Cloudflare Zero Trust/Access is not a prerequisite for this synthetic test module.
import {loadPrincipal, authorizedMutation, hashWorkerPassword} from './auth-core.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDb=db=>!!db && typeof db.prepare==='function' && typeof db.batch==='function';
function count(result){
  const n=result?.meta?.changes ?? result?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_ACCOUNT_D1_RESULT');
  return n;
}

export async function internalRotateD1Password(request,env,{targetUserId,newPassword}={}){
  // Both gates are absent from production config. This function is deliberately
  // not imported or referenced from worker.mjs / native-login-http.mjs.
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly' ||
     env?.ACCOUNT_SECURITY_STAGE!=='internal-test-only' || !validDb(env?.DB))
    return {status:503,code:'E_NOT_READY'};
  if(request?.method!=='POST')return {status:405,code:'METHOD_NOT_ALLOWED'};
  if(!UUID.test(targetUserId||'') ||
     typeof newPassword!=='string'||newPassword.length<12||newPassword.length>256)
    return {status:400,code:'E_INVALID_INPUT'};
  try{
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return {status:401,code:'E_UNAUTHENTICATED'};
    if(principal.role!=='owner' || !authorizedMutation(request,principal,'owner'))
      return {status:403,code:'E_FORBIDDEN'};
    const schema=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(schema?.contract_version)!==3)
      return {status:503,code:'E_SCHEMA_NOT_READY'};
    const target=await env.DB.prepare(
      'SELECT id,password_salt,password_hash FROM users WHERE id=? AND active=1'
    ).bind(targetUserId).first();
    if(!target)return {status:404,code:'E_ACCOUNT_NOT_FOUND'};
    const fresh=await hashWorkerPassword(newPassword);
    const now=new Date().toISOString();
    const actorGate='a.id=? AND a.role=\'owner\' AND a.active=1 '+
      'AND s.token_hash=? AND s.expires_at>? AND s.csrf_token=?';
    // Same D1.batch transaction: the audit, password update, and revocation
    // recheck owner session/role and the target's observed credentials.
    // Audit comes first, so changing one's own password can revoke the actor.
    const audit=env.DB.prepare(
      'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,detail) '+
      'SELECT ?,a.id,a.username,\'user.password\',\'users\',t.id, '+
      'printf(\'{"password_changed":true,"revoked_sessions":%d}\', '+
      '(SELECT COUNT(*) FROM sessions WHERE user_id=t.id)) '+
      'FROM users a JOIN sessions s ON s.user_id=a.id JOIN users t ON t.id=? '+
      'WHERE '+actorGate+
      ' AND t.active=1 AND t.password_salt=? AND t.password_hash=?'
    ).bind(crypto.randomUUID(),targetUserId,principal.id,principal.token_hash,now,
      principal.csrf,target.password_salt,target.password_hash);
    const update=env.DB.prepare(
      'UPDATE users SET password_salt=?,password_hash=? WHERE id=? AND active=1 '+
      'AND password_salt=? AND password_hash=? AND EXISTS ('+
      'SELECT 1 FROM users a JOIN sessions s ON s.user_id=a.id WHERE '+actorGate+')'
    ).bind(fresh.password_salt,fresh.password_hash,targetUserId,
      target.password_salt,target.password_hash,principal.id,principal.token_hash,now,principal.csrf);
    const revoke=env.DB.prepare(
      'DELETE FROM sessions WHERE user_id=? AND EXISTS ('+
      'SELECT 1 FROM users t WHERE t.id=? AND t.active=1 '+
      'AND t.password_salt=? AND t.password_hash=?)'
    ).bind(targetUserId,targetUserId,fresh.password_salt,fresh.password_hash);
    const result=await env.DB.batch([audit,update,revoke]);
    if(!Array.isArray(result)||result.length!==3 ||
       count(result[0])!==1||count(result[1])!==1)
      return {status:409,code:'E_CONCURRENT_CHANGE'};
    return {status:200,code:'OK',revokedSessions:count(result[2])};
  }catch{
    // Never expose password, token hash, SQL or internal D1 details.
    return {status:503,code:'E_ACCOUNT_UNAVAILABLE'};
  }
}
