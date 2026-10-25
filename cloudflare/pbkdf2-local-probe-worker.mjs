// This Worker must NEVER be imported by cloudflare/worker.mjs or deployed.
// wrangler.pbkdf2-local.jsonc disables workers.dev and preview URLs.
// Localhost-only HTTP transport exists solely for manually initiated local workerd tests.
import { runSyntheticPbkdf2Probe } from './pbkdf2-local-probe.mjs';

const headers = {
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'X-Content-Type-Options':'nosniff',
};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
let running=false;
export default {
  async fetch(request){
    const url=new URL(request.url);
    // Abort before doing expensive KDF work in any non-loopback context.
    // Cloudflare edge requests carry CF-Connecting-IP: refuse even if host is spoofed.
    if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' ||
       request.headers.has('cf-connecting-ip') || request.headers.has('x-forwarded-for'))
      return json({code:'E_NOT_AVAILABLE'},404);
    if(url.pathname==='/health' && request.method==='GET' && !url.search)
      return json({status:'local_synthetic_only',cpu_verified:false});
    if(url.pathname!=='/run' || request.method!=='POST' || url.search)
      return json({code:'E_NOT_AVAILABLE'},404);
    // Do not accept any request payload, including possible credentials.
    if(request.body || request.headers.has('content-length') || request.headers.has('authorization'))
      return json({code:'E_NO_INPUT_ALLOWED'},400);
    if(running) return json({code:'E_PROBE_BUSY'},429);
    running=true;
    try{
      return json(await runSyntheticPbkdf2Probe());
    }catch{
      return json({code:'E_SYNTHETIC_PROBE_FAILURE'},500);
    }finally{
      running=false;
    }
  },
};
