// First browser-reachable but OFF-BY-DEFAULT Access-bound D1 business mutation.
// Only a separately operator-approved Staging write gate can activate it.
// No sessions, passwords, self-enrollment, Production or other actions.
import {createBoundAccessPrincipal} from './access-principal-internal.mjs';
import {createTrustedAccessIdentity} from './access-identity-internal.mjs';

const HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff'
});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const ISSUER=/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/;
const AUD=/^[a-f0-9]{64}$/i;
const TASK_ID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const STATES=new Set(['todo','doing','done']);
const LIMIT=4096;
async function parseCommand(request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return null;
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LIMIT))return null;
 const reader=request.body?.getReader();
 if(!reader)return null;
 let bytes=0;const chunks=[];
 try{
  for(;;){
   const part=await reader.read();
   if(part.done)break;
   if(!(part.value instanceof Uint8Array))return null;
   bytes+=part.value.byteLength;
   if(bytes>LIMIT)return null;
   chunks.push(part.value);
  }
 }finally{try{await reader.cancel();}catch{}}
 if(!bytes)return null;
 const raw=new Uint8Array(bytes);
 let offset=0;
 for(const c of chunks){raw.set(c,offset);offset+=c.byteLength;}
 try{
  const v=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==2||
     v.action!=='task.status'||!v.data||typeof v.data!=='object'||
     Array.isArray(v.data)||Object.keys(v.data).length!==2||
     !TASK_ID.test(v.data.id)||!STATES.has(v.data.status))return null;
  return Object.freeze({id:v.data.id,status:v.data.status});
 }catch{return null;}
}
function changed(value){
 const count=value?.meta?.changes??value?.changes;
 if(!Number.isSafeInteger(count)||count<0)throw Error('E_BATCH_RESULT');
 return count;
}
// Every D1.batch statement is server-authored, parameterized and references
// the live approved JWT subject link, role, user activation and store grants.
// Never authorize a write from the JWT role/email, stale snapshot or browser.
const PREDICATE=[
 't.id=? AND t.status=?',
 'AND EXISTS(SELECT 1 FROM locations loc WHERE loc.id=t.location_id AND loc.active=1)',
 'AND EXISTS(SELECT 1 FROM access_identity_links link',
 'JOIN users u ON u.id=link.user_id',
 'WHERE link.issuer=? AND link.audience=? AND link.subject=?',
 'AND link.user_id=? AND link.active=1 AND u.active=1 AND u.role=?)',
 "AND (?='owner' OR EXISTS(SELECT 1 FROM user_locations ul",
 'JOIN locations grant_l ON grant_l.id=ul.location_id',
 'WHERE ul.user_id=? AND ul.location_id=t.location_id AND grant_l.active=1))',
 "AND (?<>'staff' OR t.assigned_to=?)"
].join(' ');
export function createPreviewAccessTaskStatusHandler({fetchImpl,nowMs}={}){
 let configKey=null,principalLookup=null,identityLookup=null;
 return Object.freeze({
  async handle(request,env){
   if(env?.CLOUD_AUTH_PHASE!=='preview-readonly')return reply(503,{code:'E_NOT_READY'});
   if(env?.CLOUD_ACCESS_IDENTITY_GATE!=='staging-get-only'||
      env?.CLOUD_ACCESS_TASK_WRITE_GATE!=='staging-task-status-only')
    return reply(503,{code:'E_TASK_WRITE_NOT_ENABLED'});
   if(typeof env.DB?.prepare!=='function'||typeof env.DB?.batch!=='function'||
      typeof env.CLOUD_ACCESS_ISSUER!=='string'||!ISSUER.test(env.CLOUD_ACCESS_ISSUER)||
      typeof env.CLOUD_ACCESS_AUDIENCE!=='string'||!AUD.test(env.CLOUD_ACCESS_AUDIENCE))
    return reply(503,{code:'E_ACCESS_CONFIG_UNAVAILABLE'});
   if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
   try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/access/task-status'||url.search||url.hash)
     return reply(400,{code:'E_BAD_REQUEST'});
    // An Access cookie can be ambient browser authority. A custom intent
    // header plus HTTPS same-Origin and Fetch Metadata deny cross-site CSRF.
    if(request.headers.get('origin')!==url.origin||
       request.headers.get('sec-fetch-site')!=='same-origin'||
       request.headers.get('x-staging-intent')!=='task.status')
     return reply(403,{code:'E_ORIGIN_DENIED'});
    const cmd=await parseCommand(request);
    if(!cmd)return reply(400,{code:'E_INVALID_COMMAND'});
    const currentKey=env.CLOUD_ACCESS_ISSUER+'|'+env.CLOUD_ACCESS_AUDIENCE;
    if(currentKey!==configKey){
     const opts={issuer:env.CLOUD_ACCESS_ISSUER,audience:env.CLOUD_ACCESS_AUDIENCE,
      ...(fetchImpl?{fetchImpl}:{}),...(nowMs?{nowMs}:{})};
     principalLookup=createBoundAccessPrincipal(opts);
     identityLookup=createTrustedAccessIdentity(opts);
     configKey=currentKey;
    }
    const principal=await principalLookup.resolve(request,env);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    const identity=await identityLookup.verify(request);
    if(typeof identity?.subject!=='string'||!identity.subject||identity.subject.length>256)
     return reply(401,{code:'E_UNAUTHENTICATED'});
    const contract=await env.DB.prepare(
     'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(contract?.contract_version)!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
    const task=await env.DB.prepare(
     'SELECT t.id,t.status,t.location_id,t.assigned_to,l.active FROM tasks t '+
     'JOIN locations l ON l.id=t.location_id WHERE t.id=? LIMIT 1').bind(cmd.id).first();
    if(!task||task.active!==1||
       (principal.role!=='owner'&&!principal.locations.includes(task.location_id))||
       (principal.role==='staff'&&task.assigned_to!==principal.id))
     return reply(404,{code:'E_TASK_NOT_FOUND'});
    if(task.status===cmd.status)return reply(409,{code:'E_NO_STATE_CHANGE'});
    if(!STATES.has(task.status))return reply(409,{code:'E_TASK_STATE'});
    const args=[cmd.id,task.status,env.CLOUD_ACCESS_ISSUER,env.CLOUD_ACCESS_AUDIENCE,
     identity.subject,principal.id,principal.role,principal.role,principal.id,
     principal.role,principal.id];
    const auditId=crypto.randomUUID();
    const detail=JSON.stringify({from:task.status,to:cmd.status});
    const audit=env.DB.prepare(
     'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
     "SELECT ?,?,?,'task.status','tasks',t.id,t.location_id,? FROM tasks t WHERE "+PREDICATE
    ).bind(auditId,principal.id,principal.username,detail,...args);
    const update=env.DB.prepare(
     'UPDATE tasks AS t SET status=? WHERE '+PREDICATE+
     " AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='tasks' AND a.entity_id=t.id)"
    ).bind(cmd.status,...args,auditId);
    // If audit inserts but update cannot proceed, NOT NULL detail deliberately
    // aborts the ENTIRE transaction; 0-row outcomes never count as success.
    const validate=env.DB.prepare(
     'UPDATE audit_logs SET detail=CASE WHEN EXISTS('+
     'SELECT 1 FROM tasks t WHERE t.id=? AND t.status=? AND t.location_id=?'+
     ') THEN detail ELSE NULL END WHERE id=?'
    ).bind(cmd.id,cmd.status,task.location_id,auditId);
    const results=await env.DB.batch([audit,update,validate]);
    if(!Array.isArray(results)||results.length!==3||
       results.some(result=>changed(result)!==1))
     return reply(409,{code:'E_CONCURRENT_CHANGE'});
    return reply(200,{ok:true,result:{id:cmd.id,status:cmd.status},
     environment:'staging_access',production_ready:false});
   }catch{
    // Any SQL/remote/transaction error is deliberately opaque. No partial
    // successful response, JWT, SQL, principal or row details are disclosed.
    return reply(503,{code:'E_TASK_WRITE_UNAVAILABLE'});
   }
  }
 });
}
export const previewAccessTaskStatus=createPreviewAccessTaskStatusHandler().handle;
