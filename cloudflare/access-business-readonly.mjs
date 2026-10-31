// Preview-only authenticated Access subject -> scoped D1 business SELECTs.
// No password authentication, sessions, cookies, mutations, or Production use.
import {createBoundAccessPrincipal} from './access-principal-internal.mjs';
import {queryFor} from './operations-readonly.mjs';
import {metricQueries} from './overview-readonly.mjs';

const HEADERS=Object.freeze({
 'Content-Type':'application/json; charset=utf-8',
 'Cache-Control':'private, no-store, max-age=0',
 'X-Content-Type-Options':'nosniff'
});
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
const ISSUER=/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/;
const AUDIENCE=/^[0-9a-f]{64}$/i;
// Unlike legacy session data, this first Access API explicitly does not grant
// audit logs, users, staff directories, or internal/private HR tables.
const ENTITIES=new Set(['locations','ingredients','training_courses',
  'tasks','purchase_orders','repairs','shifts','stock']);
const MAX_QUERY=100;
export function createPreviewAccessBusinessHandler({fetchImpl,nowMs}={}){
 let key=null,lookup=null;
 return Object.freeze({
  async handle(request,env){
   if(env?.CLOUD_AUTH_PHASE!=='preview-readonly')return reply(503,{code:'E_NOT_READY'});
   if(env?.CLOUD_ACCESS_IDENTITY_GATE!=='staging-get-only')
    return reply(503,{code:'E_ACCESS_NOT_ENABLED'});
   if(!env.DB?.prepare || !ISSUER.test(env.CLOUD_ACCESS_ISSUER??'') ||
       !AUDIENCE.test(env.CLOUD_ACCESS_AUDIENCE??''))
    return reply(503,{code:'E_ACCESS_CONFIG_UNAVAILABLE'});
   if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
   try{
    const url=new URL(request.url);
    const dataPath=url.pathname==='/api/access/data';
    const overviewPath=url.pathname==='/api/access/overview';
    if(!dataPath&&!overviewPath)return reply(404,{code:'E_UNKNOWN_ENDPOINT'});
    if(url.hash || url.search.length>MAX_QUERY)return reply(400,{code:'E_BAD_QUERY'});
    let entity=null;
    if(dataPath){
     const keys=[...url.searchParams.keys()];
     if(keys.length!==1||keys[0]!=='entity')
      return reply(400,{code:'E_BAD_QUERY'});
     entity=url.searchParams.get('entity');
     if(!ENTITIES.has(entity))return reply(404,{code:'E_UNKNOWN_ENTITY'});
    }else if(url.search)return reply(400,{code:'E_BAD_QUERY'});
    // Trust only deployment-supplied issuer/audience. Never use JWT claims or
    // request host/header to select a Cloudflare key origin.
    const configKey=env.CLOUD_ACCESS_ISSUER+'|'+env.CLOUD_ACCESS_AUDIENCE;
    if(key!==configKey){
     lookup=createBoundAccessPrincipal({issuer:env.CLOUD_ACCESS_ISSUER,
      audience:env.CLOUD_ACCESS_AUDIENCE,
      ...(fetchImpl?{fetchImpl}:{}),...(nowMs?{nowMs}:{})});
     key=configKey;
    }
    const principal=await lookup.resolve(request,env);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    const marker=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(marker?.contract_version)!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
    if(dataPath){
     const plan=queryFor(entity,principal);
     if(!plan)return reply(404,{code:'E_UNKNOWN_ENTITY'});
     const result=await env.DB.prepare(plan.sql).bind(...plan.params).all();
     if(!Array.isArray(result?.results)||result.results.length>500)
      throw Error('E_INVALID_DATA');
     return reply(200,{status:'staging_access_readonly',entity,rows:result.results,
      session_created:false,production_ready:false,mutations_enabled:false});
    }
    const metrics={};
    for(const [name,sql,args] of metricQueries(principal)){
     const stmt=env.DB.prepare(sql);
     const result=await (args.length?stmt.bind(...args):stmt).first();
     if(!Number.isSafeInteger(result?.n)||result.n<0)throw Error('E_BAD_METRIC');
     metrics[name]=result.n;
    }
    return reply(200,{status:'staging_access_readonly',metrics,
     session_created:false,production_ready:false,mutations_enabled:false});
   }catch{return reply(503,{code:'E_ACCESS_BUSINESS_UNAVAILABLE'});}
  }
 });
}
export const previewAccessBusiness=createPreviewAccessBusinessHandler().handle;
