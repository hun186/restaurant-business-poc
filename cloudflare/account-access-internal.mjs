// Dormant internal D1 account-access transaction. No public Worker import/route.
// Synthetic-only dual gate, no deployment variable, migrations or live D1 writes.
import {loadPrincipal, authorizedMutation, hashWorkerPassword} from './auth-core.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES=new Set(['owner','manager','staff']);
const ACTIONS=new Set(['user.role','user.active','user.assign-location','user.unassign-location']);
function changed(result){
  const n=result?.meta?.changes ?? result?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_ACCOUNT_D1_RESULT');
  return n;
}
const validDb=db=>!!db && typeof db.prepare==='function' && typeof db.batch==='function';

// This function is not an HTTP handler. It is never referenced by the deployed
// Worker. Future public integration requires separate security/release review.
export async function internalChangeD1AccountAccess(request,env,input={}){
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly' ||
     env?.ACCOUNT_SECURITY_STAGE!=='internal-test-only' || !validDb(env?.DB))
    return {status:503,code:'E_NOT_READY'};
  if(request?.method!=='POST')return {status:405,code:'METHOD_NOT_ALLOWED'};
  if(!input || typeof input!=='object'||Array.isArray(input) ||
     !ACTIONS.has(input.action) || typeof input.targetUserId!=='string' ||
     !UUID.test(input.targetUserId))
    return {status:400,code:'E_INVALID_INPUT'};
  const {action,targetUserId}=input;
  const isRole=action==='user.role',isActive=action==='user.active';
  const isAssign=action==='user.assign-location',isStore=isAssign||action==='user.unassign-location';
  const keys=Object.keys(input).sort().join(',');
  const expected=(isRole?'action,role,targetUserId':isActive?'action,active,targetUserId':'action,locationId,targetUserId');
  if(keys!==expected ||
     (isRole&&!ROLES.has(input.role)) ||
     (isActive&&typeof input.active!=='boolean') ||
     (isStore&&(typeof input.locationId!=='string'||!UUID.test(input.locationId))))
    return {status:400,code:'E_INVALID_INPUT'};
  try{
    const p=await loadPrincipal(env.DB,request);
    if(!p)return {status:401,code:'E_UNAUTHENTICATED'};
    if(p.role!=='owner'||!authorizedMutation(request,p,'owner'))
      return {status:403,code:'E_FORBIDDEN'};
    const schema=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(schema?.contract_version)!==3)return {status:503,code:'E_SCHEMA_NOT_READY'};
    const target=await env.DB.prepare(
      'SELECT id,role,active FROM users WHERE id=?'
    ).bind(targetUserId).first();
    if(!target)return {status:404,code:'E_ACCOUNT_NOT_FOUND'};
    if((isRole||isActive)&&target.id===p.id)return {status:403,code:'E_FORBIDDEN'};
    if((isRole||isStore)&&target.active!==1)return {status:409,code:'E_ACCOUNT_INACTIVE'};
    if((isRole&&target.role===input.role)||
       (isActive&&target.active===Number(input.active)))
      return {status:409,code:'E_NO_CHANGE'};
    if(isStore){
      const location=await env.DB.prepare(
        'SELECT id FROM locations WHERE id=? AND active=1'
      ).bind(input.locationId).first();
      if(!location)return {status:404,code:'E_LOCATION_NOT_FOUND'};
      const existing=await env.DB.prepare(
        'SELECT 1 AS present FROM user_locations WHERE user_id=? AND location_id=?'
      ).bind(targetUserId,input.locationId).first();
      if(Boolean(existing)===isAssign)return {status:409,code:'E_NO_CHANGE'};
    }
    // Every write is inside ONE transactional D1.batch. The audit statement
    // repeats the actor/session/target predicates, guarding lookup-to-write races.
    const now=new Date().toISOString(), auditId=crypto.randomUUID();
    const actorGate="a.id=? AND a.role='owner' AND a.active=1 "+
      'AND s.token_hash=? AND s.expires_at>? AND s.csrf_token=?';
    const detailSuffix='(SELECT COUNT(*) FROM sessions rev WHERE rev.user_id=t.id)';
    const details=isRole?
      "json_object('from',t.role,'to',?,'revoked_sessions',"+detailSuffix+')':
      isActive?
      "json_object('active',?,'revoked_sessions',"+detailSuffix+')':
      isAssign?
      "json_object('new_assignment',1,'revoked_sessions',"+detailSuffix+')':
      "json_object('removed_assignment',1,'revoked_sessions',"+detailSuffix+')';
    const detailsArgs=isRole?[input.role]:isActive?[Number(input.active)]:[];
    const bindingState=isStore?
      (isAssign?'NOT EXISTS':'EXISTS')+
      ' (SELECT 1 FROM user_locations ul WHERE ul.user_id=t.id AND ul.location_id=?)':'1=1';
    const bindingArgs=isStore?[input.locationId]:[];
    const storeGate=isStore?' AND EXISTS (SELECT 1 FROM locations l WHERE l.id=? AND l.active=1)':'';
    const storeArgs=isStore?[input.locationId]:[];
    const lastOwnerGuard=(
      (isRole&&target.role==='owner'&&input.role!=='owner'&&target.active===1)||
      (isActive&&target.role==='owner'&&input.active===false&&target.active===1)
    )?" AND (SELECT COUNT(*) FROM users WHERE role='owner' AND active=1)>1":'';
    const audit=env.DB.prepare(
      'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
      'SELECT ?,a.id,a.username,?,?,t.id,?,'+details+' FROM users a '+
      'JOIN sessions s ON s.user_id=a.id JOIN users t ON t.id=? '+
      'WHERE '+actorGate+' AND t.role=? AND t.active=? '+
      'AND '+bindingState+storeGate+lastOwnerGuard
    ).bind(auditId,action,isStore?'user_locations':'users',
      isStore?input.locationId:null,...detailsArgs,targetUserId,
      p.id,p.token_hash,now,p.csrf,target.role,target.active,...bindingArgs,...storeArgs);
    let mutate,afterGuard;
    if(isRole){
      mutate=env.DB.prepare(
        'UPDATE users SET role=? WHERE id=? AND role=? AND active=? '+
        'AND EXISTS (SELECT 1 FROM audit_logs WHERE id=?)'
      ).bind(input.role,targetUserId,target.role,target.active,auditId);
      afterGuard='EXISTS (SELECT 1 FROM users WHERE id=? AND role=? AND active=?)';
    }else if(isActive){
      mutate=env.DB.prepare(
        'UPDATE users SET active=? WHERE id=? AND role=? AND active=? '+
        'AND EXISTS (SELECT 1 FROM audit_logs WHERE id=?)'
      ).bind(Number(input.active),targetUserId,target.role,target.active,auditId);
      afterGuard='EXISTS (SELECT 1 FROM users WHERE id=? AND role=? AND active=?)';
    }else if(isAssign){
      mutate=env.DB.prepare(
        'INSERT INTO user_locations(user_id,location_id) SELECT ?,? '+
        'WHERE EXISTS (SELECT 1 FROM audit_logs WHERE id=?) '+
        'AND NOT EXISTS (SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?)'
      ).bind(targetUserId,input.locationId,auditId,targetUserId,input.locationId);
      afterGuard='EXISTS (SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?)';
    }else{
      mutate=env.DB.prepare(
        'DELETE FROM user_locations WHERE user_id=? AND location_id=? '+
        'AND EXISTS (SELECT 1 FROM audit_logs WHERE id=?)'
      ).bind(targetUserId,input.locationId,auditId);
      afterGuard='NOT EXISTS (SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?)';
    }
    const afterArgs=isRole?[targetUserId,input.role,target.active]:
      isActive?[targetUserId,target.role,Number(input.active)]:
      [targetUserId,input.locationId];
    const revoke=env.DB.prepare(
      'DELETE FROM sessions WHERE user_id=? '+
      'AND EXISTS (SELECT 1 FROM audit_logs WHERE id=?) AND '+afterGuard
    ).bind(targetUserId,auditId,...afterArgs);
    const out=await env.DB.batch([audit,mutate,revoke]);
    if(!Array.isArray(out)||out.length!==3||
       changed(out[0])!==1||changed(out[1])!==1)
      return {status:409,code:'E_CONCURRENT_CHANGE'};
    return {status:200,code:'OK',revokedSessions:changed(out[2])};
  }catch{
    // No SQL fragments, tokens, IDs or credentials in caller-visible errors.
    return {status:503,code:'E_ACCOUNT_UNAVAILABLE'};
  }
}


// Synthetic-only Owner account provisioning, deliberately NOT an HTTP handler.
// The public Worker must not import this dormant module or expose user.create.
export async function internalCreateD1Account(request,env,input={}){
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly'||
     env?.ACCOUNT_SECURITY_STAGE!=='internal-test-only'||!validDb(env?.DB))
    return {status:503,code:'E_NOT_READY'};
  if(request?.method!=='POST')return {status:405,code:'METHOD_NOT_ALLOWED'};
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).sort().join(',')!=='displayName,initialPassword,locationIds,role,username'||
     typeof input.username!=='string'||!/^[A-Za-z0-9_.-]{1,40}$/.test(input.username)||
     typeof input.displayName!=='string'||input.displayName.trim()!==input.displayName||
     input.displayName.length<1||input.displayName.length>80||
     /[\u0000-\u001f\u007f]/.test(input.displayName)||
     !['manager','staff'].includes(input.role)||
     typeof input.initialPassword!=='string'||input.initialPassword.length<12||
     input.initialPassword.length>256||/[\r\n\0]/.test(input.initialPassword)||
     !Array.isArray(input.locationIds)||input.locationIds.length<1||
     input.locationIds.length>16||
     input.locationIds.some(id=>typeof id!=='string'||!UUID.test(id))||
     new Set(input.locationIds.map(id=>id.toLowerCase())).size!==input.locationIds.length)
    return {status:400,code:'E_INVALID_INPUT'};
  try{
    const p=await loadPrincipal(env.DB,request);
    if(!p)return {status:401,code:'E_UNAUTHENTICATED'};
    if(p.role!=='owner'||!authorizedMutation(request,p,'owner'))
      return {status:403,code:'E_FORBIDDEN'};
    const marker=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(marker?.contract_version)!==3)
      return {status:503,code:'E_SCHEMA_NOT_READY'};
    if(await env.DB.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE LIMIT 1')
      .bind(input.username).first())return {status:409,code:'E_ACCOUNT_EXISTS'};
    const ids=input.locationIds,placeholders=ids.map(()=>'?').join(',');
    const locationCount=await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM locations WHERE active=1 AND id IN ('+placeholders+')'
    ).bind(...ids).first();
    if(Number(locationCount?.n)!==ids.length)
      return {status:400,code:'E_LOCATION_NOT_FOUND'};
    const hash=await hashWorkerPassword(input.initialPassword);
    const id=crypto.randomUUID(),auditId=crypto.randomUUID();
    const ownerGate="a.id=? AND a.role='owner' AND a.active=1 "+
      "AND s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND s.csrf_token=?";
    const inserted=env.DB.prepare(
      'INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) '+
      'SELECT ?,?,?,?,?,?,1 FROM users a JOIN sessions s ON s.user_id=a.id WHERE '+
      ownerGate+' AND (SELECT COUNT(*) FROM locations WHERE active=1 AND id IN ('+
      placeholders+'))=? AND NOT EXISTS ('+
      'SELECT 1 FROM users WHERE username=? COLLATE NOCASE)'
    ).bind(id,input.username,input.displayName,input.role,hash.password_salt,
      hash.password_hash,p.id,p.token_hash,p.csrf,...ids,ids.length,input.username);
    const grants=ids.map(loc=>env.DB.prepare(
      'INSERT INTO user_locations(user_id,location_id) SELECT ?,l.id FROM locations l '+
      'JOIN users u ON u.id=? WHERE l.id=? AND l.active=1'
    ).bind(id,id,loc));
    const audit=env.DB.prepare(
      'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,detail) '+
      "SELECT ?,a.id,a.username,'user.create','users',u.id,? FROM users a "+
      'JOIN sessions s ON s.user_id=a.id JOIN users u ON u.id=? WHERE '+
      ownerGate+' AND u.username=? COLLATE NOCASE AND u.role=? AND u.active=1 '+
      'AND (SELECT COUNT(*) FROM user_locations WHERE user_id=u.id)=?'
    ).bind(auditId,JSON.stringify({role:input.role,assigned_locations:ids.length}),id,
      p.id,p.token_hash,p.csrf,input.username,input.role,ids.length);
    // A failed CAS must abort the transaction, not just return a late 409
    // after another statement committed. Owner.display_name is NOT NULL.
    const atomicGuard=env.DB.prepare(
      'UPDATE users SET display_name=CASE WHEN EXISTS ('+
      "SELECT 1 FROM audit_logs WHERE id=? AND action='user.create' AND entity_id=?) "+
      'AND EXISTS (SELECT 1 FROM users WHERE id=? AND active=1) '+
      'THEN display_name ELSE NULL END WHERE id=?'
    ).bind(auditId,id,id,p.id);
    const operations=[inserted,...grants,audit,atomicGuard];
    const out=await env.DB.batch(operations);
    if(!Array.isArray(out)||out.length!==operations.length||
       out.some(result=>changed(result)!==1))
      return {status:503,code:'E_ACCOUNT_UNAVAILABLE'};
    return {status:201,code:'OK',user:{id,username:input.username,
      display_name:input.displayName,role:input.role,active:true,location_ids:[...ids]}};
  }catch{
    // D1 errors, salt, hash, passwords and session material must remain private.
    return {status:503,code:'E_ACCOUNT_UNAVAILABLE'};
  }
}
