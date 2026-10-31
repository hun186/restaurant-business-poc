// Native Worker/D1 password login HTTP boundary. Entirely dormant by default.
// Release requires separate production D1 schema/Owner provisioning and gates.
// No Cloudflare Access, public registration, account creation or business writes.
import {sameOrigin} from './auth-core.mjs';
import {authenticateD1,revokeD1Session,sourceIpDigest} from './login-service.mjs';

const HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store, private',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
});
const MAX_BODY_BYTES=2048;
const reply=(status,obj,cookie)=>new Response(JSON.stringify(obj),{
  status,headers:cookie?{...HEADERS,'Set-Cookie':cookie}:HEADERS
});

export function nativeLoginEnabled(env){
  return env?.CLOUD_AUTH_PHASE==='native-production' &&
    env?.CLOUD_NATIVE_LOGIN_GATE==='operator-released' &&
    typeof env?.NATIVE_AUTH_SOURCE_PEPPER==='string' &&
    env.NATIVE_AUTH_SOURCE_PEPPER.length>=32 &&
    typeof env?.DB?.prepare==='function' &&
    typeof env?.DB?.batch==='function';
}
async function bodyWithinLimit(request) {
  const reader=request.body?.getReader();
  if(!reader)return '';
  const chunks=[];let size=0;
  try{
    for(;;){
      const next=await reader.read();
      if(next.done)break;
      size+=next.value?.byteLength ?? MAX_BODY_BYTES+1;
      if(size>MAX_BODY_BYTES)throw Error('E_BODY_TOO_LARGE');
      chunks.push(next.value);
    }
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const b=new Uint8Array(size);let at=0;
  for(const chunk of chunks){b.set(chunk,at);at+=chunk.byteLength;}
  return new TextDecoder('utf-8',{fatal:true}).decode(b);
}
function requestSafe(request,route){
  if(request.method!=='POST')return 405;
  const u=new URL(request.url);
  if(u.protocol!=='https:' || u.pathname!==route || u.search || u.hash)return 400;
  if(!sameOrigin(request))return 403;
  const site=request.headers.get('sec-fetch-site');
  if(site && site!=='same-origin')return 403;
  if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))return 400;
  const length=request.headers.get('content-length');
  if(length!==null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length)>MAX_BODY_BYTES))return 413;
  return 200;
}
function payload(raw){
  let item;
  try{item=JSON.parse(raw);}catch{return null;}
  if(!item || typeof item!=='object'||Array.isArray(item) ||
     Object.keys(item).sort().join(',')!=='password,username')return null;
  if(typeof item.username!=='string'||!/^[A-Za-z0-9_.-]{1,40}$/.test(item.username)||
     typeof item.password!=='string'||item.password.length<12||item.password.length>256)return null;
  return item;
}
export async function nativeLoginHttp(request,env){
  // Gate before reading caller data, processing any credential, or writing D1.
  if(!nativeLoginEnabled(env))return reply(503,{code:'E_NOT_READY'});
  const route=new URL(request.url).pathname;
  if(route!=='/api/login' && route!=='/api/logout')return reply(404,{code:'E_NOT_FOUND'});
  const valid=requestSafe(request,route);
  if(valid!==200)return reply(valid,{code:valid===405?'METHOD_NOT_ALLOWED':'E_AUTH_REQUEST'});
  try{
    // No use of caller-provided X-Forwarded-For / X-Real-IP. This is an additional
    // source provenance check; credentials never work in Node / unknown proxies.
    if(route==='/api/login'){
      if(!request.cf || typeof request.cf.colo!=='string')return reply(503,{code:'E_AUTH_SOURCE_UNAVAILABLE'});
      if(request.headers.get('content-type')!=='application/json')
        return reply(415,{code:'E_AUTH_REQUEST'});
      const creds=payload(await bodyWithinLimit(request));
      if(!creds)return reply(400,{code:'E_AUTH_REQUEST'});
      const schema=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
      if(Number(schema?.contract_version)!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
      let ipHash;
      try{ipHash=await sourceIpDigest(request,env.NATIVE_AUTH_SOURCE_PEPPER);}
      catch{return reply(503,{code:'E_AUTH_SOURCE_UNAVAILABLE'});}
      const r=await authenticateD1(env.DB,{...creds,ipHash});
      if(r.status!==200)return reply(r.status,{code:r.code});
      return reply(200,{code:'OK',user:r.user,csrf:r.csrf},r.cookie);
    }
    if(request.headers.get('content-type')!==null)return reply(400,{code:'E_AUTH_REQUEST'});
    if((await bodyWithinLimit(request)).length!==0)return reply(400,{code:'E_AUTH_REQUEST'});
    const r=await revokeD1Session(env.DB,request);
    return reply(r.status,{code:r.code},r.cookie);
  }catch(e){
    if(e?.message==='E_BODY_TOO_LARGE')return reply(413,{code:'E_AUTH_REQUEST'});
    return reply(503,{code:'E_AUTH_UNAVAILABLE'});
  }
}
