// Manually invoked only: run synthetic PBKDF2 on localhost workerd, not hosted Cloudflare.
// No network endpoint beyond 127.0.0.1; no secrets or D1 access are passed to the child.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIsolatedProbeWorkspace, isolatedProbeEnvironment } from './pbkdf2-workerd-sandbox.mjs';

const PROJECT_ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const PORT=18786;
const url='http://127.0.0.1:'+PORT;
const entry=path.join(PROJECT_ROOT,'node_modules/wrangler/bin/wrangler.js');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function run(){
  const smoke=process.argv.length===3 && process.argv[2]==='--smoke';
  if(process.argv.length>2 && !smoke) throw new Error('E_UNKNOWN_PROBE_MODE');
  if(!fs.existsSync(entry)) throw new Error('E_WRANGLER_NOT_INSTALLED');
  // The spawned Wrangler process receives only an isolated project; its cwd,
  // config, HOME and TMPDIR contain no project .dev.vars / .env secrets.
  const sandbox=createIsolatedProbeWorkspace(PROJECT_ROOT);
  const args=[entry,'dev','--local','--ip','127.0.0.1','--port',String(PORT),
    '--config',path.join(sandbox,'wrangler.pbkdf2-local.jsonc')];
  const child=spawn(process.execPath,args,{
    cwd:sandbox,env:isolatedProbeEnvironment(sandbox),
    stdio:['ignore','ignore','pipe']
  });
  child.on('error',()=>{}); // Startup failures are reported by readiness check.
  child.stderr.resume(); // Discard diagnostics: never forward arbitrary env data.
  const close=()=>{if(child.exitCode===null && !child.killed) child.kill('SIGTERM');};
  const stop=()=>close();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    let ready=false;
    for(let i=0;i<100 && child.exitCode===null;i++){
      try{
        const res=await fetch(url+'/health',{signal:AbortSignal.timeout(1000)});
        const body=await res.json();
        if(res.ok && body.status==='local_synthetic_only' && body.cpu_verified===false){
          ready=true;break;
        }
      }catch{}
      await pause(300);
    }
    if(!ready)throw new Error('E_WORKERD_STARTUP');
    // Real localhost HTTP transport regression: requests with payloads must
    // be rejected, while a Node fetch() POST with zero payload must succeed.
    const badPayload=await fetch(url+'/run',{
      method:'POST',body:'{"password":"forbidden"}',
      headers:{'content-type':'application/json'},
      signal:AbortSignal.timeout(2500)
    });
    if(badPayload.status!==400) throw new Error('E_PROBE_PAYLOAD_WAS_ACCEPTED');
    const badAuth=await fetch(url+'/run',{
      method:'POST',headers:{authorization:'Bearer forbidden'},
      signal:AbortSignal.timeout(2500)
    });
    if(badAuth.status!==400) throw new Error('E_PROBE_AUTH_WAS_ACCEPTED');
    const samples=[];
    const count=smoke ? 1 : 3;
    for(let i=0;i<count;i++){
      const res=await fetch(url+'/run',{method:'POST',signal:AbortSignal.timeout(25000)});
      if(!res.ok)throw new Error('E_SYNTHETIC_PROBE_STATUS_'+res.status);
      const body=await res.json();
      if(body.kind!=='synthetic_local_workerd_wall_ms_not_cpu' || body.iterations!==600000 ||
         body.correct_match!==true || body.wrong_match!==false ||
         !['hash_ms','verify_correct_ms','verify_wrong_ms'].every(k=>Number.isFinite(body[k]) && body[k]>=0))
        throw new Error('E_SYNTHETIC_PROBE_RESULT');
      samples.push({
        hash_ms:body.hash_ms,verify_correct_ms:body.verify_correct_ms,
        verify_wrong_ms:body.verify_wrong_ms,
      });
    }
    const med = key=>[...samples].map(x=>x[key]).sort((a,b)=>a-b)[Math.floor(samples.length/2)];
    // Only synthetic wall-clock measurements, not a hosted Workers CPU claim.
    console.log(JSON.stringify({
      result:'LOCAL_WORKERD_SYNTHETIC_PASS',
      cpu_limit_verified:false,
      environment:'local_workerd',
      iterations:600000,
      samples:count,
      median_wall_ms:{
        hash:med('hash_ms'),verify_correct:med('verify_correct_ms'),
        verify_wrong:med('verify_wrong_ms')
      }
    }));
  }finally{
    close();
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
    if(child.exitCode===null){
      await Promise.race([
        new Promise(resolve=>child.once('close',resolve)),
        pause(2000)
      ]);
    }
    fs.rmSync(sandbox,{recursive:true,force:true});
  }
}
run().catch(e=>{
  console.error('LOCAL_WORKERD_SYNTHETIC_FAILED: '+(e?.message||'unknown'));
  process.exitCode=1;
});
