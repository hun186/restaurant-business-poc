// Standalone Cloudflare Access-protected synthetic probe. NEVER import from worker.mjs.
// Disabled by config; dedicated Worker-level Access MUST protect all hostnames
// before routing is separately activated. No D1, Owner, cookies or user input.
import { runHostedSyntheticOperation, HOSTED_OPERATIONS } from './pbkdf2-hosted-synthetic.mjs';

const HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
  'X-Robots-Tag':'noindex, nofollow',
  'Referrer-Policy':'no-referrer'
});
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:HEADERS});
let busy=false;
const accessAudienceIsValid = value => typeof value==='string' && /^[a-f0-9]{32,64}$/i.test(value);
async function emptyRequest(request){
  const len=request.headers.get('content-length');
  if(request.headers.has('authorization') ||
     request.headers.has('transfer-encoding') ||
     (len!==null && len!=='0') || (request.body && len!=='0'))return false;
  if(!request.body)return true;
  const reader=request.body.getReader();
  try {return (await reader.read()).done===true;}
  catch{return false;}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
export default {
  async fetch(request,env,ctx){
    // Fail closed on both deployment configuration and authenticated,
    // platform-supplied Access context. Header spoofing never grants access.
    if(env?.PROBE_ENABLED!=='access-only')return respond({code:'E_DISABLED'},404);
    if(!accessAudienceIsValid(env.PROBE_ACCESS_AUD) ||
       !ctx?.access || typeof ctx.access.getIdentity!=='function' ||
       ctx.access.aud!==env.PROBE_ACCESS_AUD)
      return respond({code:'E_ACCESS_REQUIRED'},403);

    const url=new URL(request.url);
    if(url.protocol!=='https:' || url.search || url.hash ||
       !HOSTED_OPERATIONS.some(op=>url.pathname==='/synthetic/'+op))
      return respond({code:'E_NOT_FOUND'},404);
    if(request.method!=='POST')return respond({code:'E_METHOD'},405);
    const origin=request.headers.get('origin');
    if((origin && origin!==url.origin) ||
       !['none','same-origin',null].includes(request.headers.get('sec-fetch-site')))
      return respond({code:'E_ORIGIN'},403);
    if(request.headers.get('x-synthetic-probe-intent')!=='pbkdf2-only' ||
       !(await emptyRequest(request)))return respond({code:'E_NO_INPUT'},400);
    if(busy)return respond({code:'E_BUSY'},429);
    busy=true;
    const operation=url.pathname.slice('/synthetic/'.length);
    const probe_id=crypto.randomUUID();
    try{
      const result=await runHostedSyntheticOperation(operation);
      // Correlate probe_id and operation with platform invocation logs;
      // only Cloudflare's $workers.wallTimeMs / $workers.cpuTimeMs and
      // $workers.outcome are authoritative timings/status.
      // Never log fabricated JavaScript elapsed time, identity or secrets.
      console.info(JSON.stringify({
        event:'pbkdf2_synthetic_only',probe_id,operation,
        iterations:result.iterations
      }));
      return respond({
        kind:'hosted_synthetic_result_no_inline_timings',
        probe_id,operation,iterations:result.iterations,
        valid:result.valid,cpu_verified:false
      });
    }catch{
      console.error(JSON.stringify({event:'pbkdf2_synthetic_failed',probe_id,operation}));
      return respond({code:'E_SYNTHETIC_FAILURE',probe_id},500);
    }finally{busy=false;}
  }
};
