// Owner-only Native D1 store-grant changes. Default-denied by an independent
// operator gate; no direct role elevation, Owner target, or deletion of users.
import {loadPrincipal,authorizedMutation} from './auth-core.mjs';
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
import {nativeAccountGrantWriteEnabled} from './native-account-management-http.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
function changed(res){
 const n=res?.meta?.changes??res?.changes;
 if(!Number.isSafeInteger(n)||n<0)throw Error('E_GRANT_D1_RESULT');
 return n;
}
const validDb=db=>!!db&&typeof db.prepare==='function'&&typeof db.batch==='function';

export async function nativeAccountGrantHttp(request,env){
 if(!nativeLoginEnabled(env)||!nativeAccountGrantWriteEnabled(env)||
    !validDb(env?.DB))return reply(503,{code:'E_NOT_READY'});
 if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
 let url;try{url=new URL(request.url);}catch{return reply(400,{code:'E_INVALID_REQUEST'});}
 if(url.protocol!=='https:'||url.pathname!=='/api/accounts/grant'||
    url.search||url.hash)return reply(400,{code:'E_INVALID_REQUEST'});
 if(request.headers.get('sec-fetch-site')&&
    request.headers.get('sec-fetch-site')!=='same-origin')
   return reply(403,{code:'E_FORBIDDEN'});
 if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
   return reply(400,{code:'E_INVALID_REQUEST'});
 if(request.headers.get('content-type')!=='application/json'||
    request.headers.has('content-encoding'))
   return reply(415,{code:'E_INVALID_REQUEST'});
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>2048))
   return reply(413,{code:'E_INVALID_REQUEST'});
 try{
  const p=await loadPrincipal(env.DB,request);
  if(!p)return reply(401,{code:'E_UNAUTHENTICATED'});
  if(p.role!=='owner'||!authorizedMutation(request,p,'owner'))
    return reply(403,{code:'E_FORBIDDEN'});
  const schema=await env.DB.prepare(
    'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
  if(Number(schema?.contract_version)!==3)
    return reply(503,{code:'E_SCHEMA_NOT_READY'});
  let input;try{input=JSON.parse(await bodyWithinLimit(request));}
  catch{return reply(400,{code:'E_INVALID_JSON'});}
  if(!input||typeof input!=='object'||Array.isArray(input)||
     Object.keys(input).sort().join(',')!==
       'action,expectedAssigned,expectedRole,locationId,targetUserId'||
     !['assign','unassign'].includes(input.action)||
     !['staff','manager'].includes(input.expectedRole)||
     typeof input.expectedAssigned!=='boolean'||
     input.expectedAssigned!==(input.action==='unassign')||
     typeof input.targetUserId!=='string'||!UUID.test(input.targetUserId)||
     typeof input.locationId!=='string'||!UUID.test(input.locationId))
    return reply(400,{code:'E_INVALID_INPUT'});
  if(p.id===input.targetUserId)return reply(403,{code:'E_FORBIDDEN'});
  const id=input.targetUserId,loc=input.locationId,assign=input.action==='assign';
  const target=await env.DB.prepare('SELECT id,role,active FROM users WHERE id=?')
    .bind(id).first();
  if(!target)return reply(404,{code:'E_ACCOUNT_NOT_FOUND'});
  if(target.role==='owner')return reply(403,{code:'E_FORBIDDEN'});
  if(target.active!==1||target.role!==input.expectedRole)
    return reply(409,{code:'E_CONCURRENT_CHANGE'});
  const store=await env.DB.prepare('SELECT id,active FROM locations WHERE id=?')
    .bind(loc).first();
  if(!store)return reply(404,{code:'E_LOCATION_NOT_FOUND'});
  if(assign&&store.active!==1)return reply(409,{code:'E_LOCATION_INACTIVE'});
  const current=await env.DB.prepare(
    'SELECT 1 AS present FROM user_locations WHERE user_id=? AND location_id=?'
  ).bind(id,loc).first();
  if(Boolean(current)===assign)return reply(409,{code:'E_NO_CHANGE'});
  const count=await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM user_locations WHERE user_id=?'
  ).bind(id).first();
  const active=await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM user_locations ul JOIN locations l '+
    'ON l.id=ul.location_id AND l.active=1 WHERE ul.user_id=?'
  ).bind(id).first();
  if(!Number.isSafeInteger(count?.n)||!Number.isSafeInteger(active?.n)||
     count.n<0||active.n<0)return reply(503,{code:'E_ACCOUNT_UNAVAILABLE'});
  if(assign&&count.n>=16)return reply(409,{code:'E_GRANT_LIMIT'});
  if(!assign&&store.active===1&&active.n<=1)
    return reply(409,{code:'E_LAST_ACTIVE_GRANT'});
  const action=assign?'user.assign-location':'user.unassign-location';
  const quota=await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM audit_logs WHERE actor_id=? AND "+
    "action IN ('user.assign-location','user.unassign-location') "+
    "AND at>=datetime('now','-1 hour')"
  ).bind(p.id).first();
  if(!Number.isSafeInteger(quota?.n)||quota.n<0)
    return reply(503,{code:'E_ACCOUNT_UNAVAILABLE'});
  if(quota.n>=20)return reply(429,{code:'E_RATE_LIMITED'});
  const auditId=crypto.randomUUID();
  const actorGate="a.id=? AND a.role='owner' AND a.active=1 "+
    "AND s.token_hash=? AND s.csrf_token=? "+
    "AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') "+
    "AND (SELECT COUNT(*) FROM audit_logs WHERE actor_id=a.id "+
    "AND action IN ('user.assign-location','user.unassign-location') "+
    "AND at>=datetime('now','-1 hour'))<20";
  const beforeState=assign?'NOT EXISTS':'EXISTS';
  const membershipGate=beforeState+
    ' (SELECT 1 FROM user_locations ul WHERE ul.user_id=t.id AND ul.location_id=?)';
  const capacityGate=assign?
    ' AND l.active=1 AND (SELECT COUNT(*) FROM user_locations ul WHERE ul.user_id=t.id)<16':
    ' AND (l.active=0 OR (SELECT COUNT(*) FROM user_locations ul '+
    'JOIN locations ll ON ll.id=ul.location_id AND ll.active=1 WHERE ul.user_id=t.id)>1)';
  const audit=env.DB.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    "SELECT ?,a.id,a.username,?,'user_locations',t.id,?,? FROM users a "+
    'JOIN sessions s ON s.user_id=a.id JOIN users t ON t.id=? '+
    'JOIN locations l ON l.id=? WHERE '+actorGate+
    " AND t.id<>a.id AND t.role=? AND t.active=1 AND "+membershipGate+capacityGate
  ).bind(auditId,action,loc,JSON.stringify({assigned:assign}),id,loc,
    p.id,p.token_hash,p.csrf,input.expectedRole,loc);
  const mutate=assign?env.DB.prepare(
    'INSERT INTO user_locations(user_id,location_id) SELECT t.id,l.id FROM users t '+
    'JOIN locations l ON l.id=? WHERE t.id=? AND t.role=? AND t.active=1 AND l.active=1 '+
    'AND EXISTS(SELECT 1 FROM audit_logs WHERE id=? AND action=?) '+
    'AND NOT EXISTS(SELECT 1 FROM user_locations WHERE user_id=t.id AND location_id=l.id) '+
    'AND (SELECT COUNT(*) FROM user_locations WHERE user_id=t.id)<16'
  ).bind(loc,id,input.expectedRole,auditId,action):
    env.DB.prepare(
      'DELETE FROM user_locations WHERE user_id=? AND location_id=? '+
      'AND EXISTS(SELECT 1 FROM audit_logs WHERE id=? AND action=?) '+
      'AND EXISTS(SELECT 1 FROM users WHERE id=? AND role=? AND active=1)'
    ).bind(id,loc,auditId,action,id,input.expectedRole);
  const resulting=assign?'EXISTS':'NOT EXISTS';
  const membershipResult=resulting+
    ' (SELECT 1 FROM user_locations WHERE user_id=? AND location_id=?)';
  const revoke=env.DB.prepare(
    'DELETE FROM sessions WHERE user_id=? AND '+
    'EXISTS (SELECT 1 FROM audit_logs WHERE id=? AND action=?) AND '+
    membershipResult
  ).bind(id,auditId,action,id,loc);
  // A failed audit/CAS, race removing the last active store, or incomplete
  // target Session revocation must throw inside the SAME D1.batch transaction.
  // users.display_name is NOT NULL; NULL is an intentional rollback sentinel.
  const guard=env.DB.prepare(
    'UPDATE users SET display_name=CASE WHEN '+
    'EXISTS(SELECT 1 FROM audit_logs WHERE id=? AND action=? AND entity_id=?) '+
    'AND EXISTS(SELECT 1 FROM users WHERE id=? AND role=? AND active=1) AND '+
    membershipResult+' AND '+
    '(SELECT COUNT(*) FROM user_locations ul JOIN locations l '+
    'ON l.id=ul.location_id AND l.active=1 WHERE ul.user_id=?)>=1 AND '+
    '(SELECT COUNT(*) FROM user_locations WHERE user_id=?)<=16 AND '+
    'NOT EXISTS(SELECT 1 FROM sessions WHERE user_id=?) '+
    'THEN display_name ELSE NULL END WHERE id=?'
  ).bind(auditId,action,id,id,input.expectedRole,id,loc,id,id,id,p.id);
  const out=await env.DB.batch([audit,mutate,revoke,guard]);
  if(!Array.isArray(out)||out.length!==4||changed(out[0])!==1||
     changed(out[1])!==1||changed(out[3])!==1)
    return reply(503,{code:'E_ACCOUNT_UNAVAILABLE'});
  return reply(200,{code:'OK',user:{id,role:input.expectedRole,
    locationId:loc,assigned:assign}});
 }catch{return reply(503,{code:'E_ACCOUNT_UNAVAILABLE'});}
}
