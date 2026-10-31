// Preview-only signed Access subject -> D1 staff identity endpoint.
// Enabling it requires trusted *server-side* Access issuer/audience and a
// separately reviewed, explicitly activated D1 identity link. No sessions,
// credential enrollment, cookies, mutations or Production route activation.
import {createBoundAccessPrincipal} from './access-principal-internal.mjs';

const HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff'
});
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const ISSUER=/^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.cloudflareaccess\.com$/;
const AUDIENCE=/^[0-9a-f]{64}$/i;

// Factory isolates cache and lets synthetic signed-JWT tests supply a fake JWKS
// fetch. Its one cached resolver belongs only to a trusted server config pair.
export function createPreviewAccessMeHandler({fetchImpl,nowMs}={}){
  let key=null, lookup=null;
  return Object.freeze({
    async handle(request,env){
      if(env?.CLOUD_AUTH_PHASE!=='preview-readonly')
        return reply(503,{code:'E_NOT_READY'});
      if(env?.CLOUD_ACCESS_IDENTITY_GATE!=='staging-get-only')
        return reply(503,{code:'E_ACCESS_NOT_ENABLED'});
      if(!env.DB?.prepare ||
          typeof env.CLOUD_ACCESS_ISSUER!=='string' ||
          !ISSUER.test(env.CLOUD_ACCESS_ISSUER) ||
          typeof env.CLOUD_ACCESS_AUDIENCE!=='string' ||
          !AUDIENCE.test(env.CLOUD_ACCESS_AUDIENCE))
        return reply(503,{code:'E_ACCESS_CONFIG_UNAVAILABLE'});
      if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
      try{
        const url=new URL(request.url);
        if(url.search || url.hash || url.pathname!=='/api/access/me')
          return reply(400,{code:'E_BAD_REQUEST'});
        const configKey=env.CLOUD_ACCESS_ISSUER+'|'+env.CLOUD_ACCESS_AUDIENCE;
        if(key!==configKey){
          lookup=createBoundAccessPrincipal({
            issuer:env.CLOUD_ACCESS_ISSUER,
            audience:env.CLOUD_ACCESS_AUDIENCE,
            ...(fetchImpl?{fetchImpl}:{}),
            ...(nowMs?{nowMs}:{})
          });
          key=configKey;
        }
        const user=await lookup.resolve(request,env);
        if(!user)return reply(401,{code:'E_UNAUTHENTICATED'});
        // Never include JWT, credential material, CSRF, session tokens or email.
        return reply(200,{
          status:'staging_access_readonly',
          user:{id:user.id,username:user.username,
            display_name:user.display_name,role:user.role,locations:user.locations},
          production_ready:false,
          session_created:false,
          mutations_enabled:false
        });
      }catch{
        return reply(503,{code:'E_ACCESS_UNAVAILABLE'});
      }
    }
  });
}
export const previewAccessMe=createPreviewAccessMeHandler().handle;
