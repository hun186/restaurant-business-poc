// Owner-only Native D1 account creation/read HTTP. No public registration.
// A separately operator-released account gate protects all new account writes.
import {loadPrincipal,authorizedMutation,hashWorkerPassword} from './auth-core.mjs';
import {nativeLoginEnabled,bodyWithinLimit} from './native-login-http.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validDb=db=>!!db&&typeof db.prepare==='function'&&typeof db.batch==='function';
function changed(res){
  const n=res?.meta?.changes??res?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_ACCOUNT_D1_RESULT');
  return n;
}
const HEADERS={'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
export const nativeAccountsWriteEnabled=env=>
  nativeLoginEnabled(env)&&env?.CLOUD_NATIVE_ACCOUNT_WRITE_GATE==='operator-released';

// Production account creation transaction, guarded independently of business writes.
async function createProductionD1Account(request,env,input={}){
  if(!nativeAccountsWriteEnabled(env)||!validDb(env?.DB))
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
      "AND s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND s.csrf_token=?" +
      " AND (SELECT COUNT(*) FROM audit_logs WHERE actor_id=a.id AND action='user.create' AND at>=datetime('now','-1 hour'))<10";
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


export async function nativeAccountsHttp(request,env){
  if(!nativeLoginEnabled(env))return reply(503,{code:'E_NOT_READY'});
  const method=request?.method;
  if(method!=='GET'&&method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  let url;try{url=new URL(request.url);}catch{return reply(400,{code:'E_INVALID_REQUEST'});}
  if(url.protocol!=='https:'||url.pathname!=='/api/accounts'||url.search||url.hash)
    return reply(400,{code:'E_INVALID_REQUEST'});
  if(request.headers.get('sec-fetch-site')&&
     request.headers.get('sec-fetch-site')!=='same-origin')
    return reply(403,{code:'E_FORBIDDEN'});
  if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
    return reply(400,{code:'E_INVALID_REQUEST'});
  if(method==='POST'&&!nativeAccountsWriteEnabled(env))
    return reply(503,{code:'E_NOT_READY'});
  try{
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    if(principal.role!=='owner')return reply(403,{code:'E_FORBIDDEN'});
    const marker=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(marker?.contract_version)!==3)
      return reply(503,{code:'E_SCHEMA_NOT_READY'});
    if(method==='GET'){
      const users=await env.DB.prepare(
        'SELECT id,username,display_name,role,active,created_at FROM users '+
        'ORDER BY created_at,id LIMIT 101'
      ).all();
      if(!Array.isArray(users?.results)||users.results.length>100)
        return reply(503,{code:'E_ACCOUNT_LIST_UNAVAILABLE'});
      const locations=await env.DB.prepare(
        'SELECT user_id,location_id FROM user_locations WHERE user_id IN ('+
        'SELECT id FROM users ORDER BY created_at,id LIMIT 100) '+
        'ORDER BY user_id,location_id LIMIT 1601'
      ).all();
      if(!Array.isArray(locations?.results)||locations.results.length>1600)
        return reply(503,{code:'E_ACCOUNT_LIST_UNAVAILABLE'});
      const grants=new Map(users.results.map(u=>[u.id,[]]));
      for(const row of locations.results){
        if(!grants.has(row.user_id)||typeof row.location_id!=='string')
          return reply(503,{code:'E_ACCOUNT_LIST_UNAVAILABLE'});
        grants.get(row.user_id).push(row.location_id);
      }
      return reply(200,{users:users.results.map(u=>({
        id:u.id,username:u.username,display_name:u.display_name,
        role:u.role,active:u.active===1,created_at:u.created_at,
        location_ids:grants.get(u.id)
      })),can_create:nativeAccountsWriteEnabled(env)});
    }
    if(!authorizedMutation(request,principal,'owner'))
      return reply(403,{code:'E_FORBIDDEN'});
    if(request.headers.get('content-type')!=='application/json'||
       request.headers.has('content-encoding'))
      return reply(415,{code:'E_INVALID_REQUEST'});
    const length=request.headers.get('content-length');
    if(length!==null&&(!/^(0|[1-9][0-9]*)$/.test(length)||Number(length)>2048))
      return reply(413,{code:'E_INVALID_REQUEST'});
    const quota=await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM audit_logs WHERE action='user.create' "+
      "AND actor_id=? AND at>=datetime('now','-1 hour')"
    ).bind(principal.id).first();
    if(!Number.isSafeInteger(quota?.n)||quota.n<0)
      return reply(503,{code:'E_ACCOUNT_UNAVAILABLE'});
    if(quota.n>=10)return reply(429,{code:'E_RATE_LIMITED'});
    let payload;try{payload=JSON.parse(await bodyWithinLimit(request));}
    catch{return reply(400,{code:'E_INVALID_JSON'});}
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||
       Object.keys(payload).sort().join(',')!==
       'action,displayName,initialPassword,locationIds,role,username'||
       payload.action!=='user.create')
      return reply(400,{code:'E_INVALID_SHAPE'});
    const {action,...input}=payload;
    const result=await createProductionD1Account(request,env,input);
    return reply(result.status,{code:result.code,...(result.user?{user:result.user}:{})});
  }catch{return reply(503,{code:'E_ACCOUNT_UNAVAILABLE'});}
}
