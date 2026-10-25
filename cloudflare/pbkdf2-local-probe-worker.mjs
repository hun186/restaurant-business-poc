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
    const ip=request.headers.get('cf-connecting-ip');
    const forwarded=request.headers.get('x-forwarded-for');
    if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' ||
       (ip && ip!=='127.0.0.1') || (forwarded && forwarded!=='127.0.0.1'))
      return json({code:'E_NOT_AVAILABLE'},404);
    if(url.pathname==='/health' && request.method==='GET' && !url.search)
      return json({status:'local_synthetic_only',cpu_verified:false});
    if(url.pathname!=='/run' || request.method!=='POST' || url.search)
      return json({code:'E_NOT_AVAILABLE'},404);
    // The workerd HTTP transport creates a non-null body stream even for
    // Content-Length: 0. Inspect at most the *first* chunk: the only accepted
    // stream is one that ends immediately with exactly zero bytes.
    // Refuse streamed/unknown lengths rather than buffering caller data.
    const length=request.headers.get('content-length');
    if(request.headers.has('authorization') || request.headers.has('transfer-encoding') ||
       (length!==null && length!=='0') || (request.body && length!=='0'))
      return json({code:'E_NO_INPUT_ALLOWED'},400);
    if(request.body) {
      const reader=request.body.getReader();
      try {
        const first=await reader.read();
        if(!first.done) return json({code:'E_NO_INPUT_ALLOWED'},400);
      }catch{
        return json({code:'E_NO_INPUT_ALLOWED'},400);
      }finally{
        await reader.cancel().catch(()=>{});
        reader.releaseLock();
      }
    }
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
