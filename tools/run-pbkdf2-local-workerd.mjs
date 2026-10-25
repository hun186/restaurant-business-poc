// Manually invoked only: run synthetic PBKDF2 on localhost workerd, not hosted Cloudflare.
// No network endpoint beyond 127.0.0.1; no secrets or D1 access are passed to the child.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT=18786;
const url='http://127.0.0.1:'+PORT;
const entry=path.resolve('node_modules/wrangler/bin/wrangler.js');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const guard=()=>{
  const cfg=JSON.parse(fs.readFileSync('wrangler.pbkdf2-local.jsonc','utf8'));
  if(cfg.main!=='./cloudflare/pbkdf2-local-probe-worker.mjs' || cfg.workers_dev!==false ||
     cfg.preview_urls!==false || cfg.d1_databases || cfg.routes || cfg.route ||
     cfg.assets || cfg.vars || cfg.services || cfg.triggers)
    throw new Error('E_UNSAFE_BENCH_CONFIG');
  if(!fs.existsSync(entry)) throw new Error('E_WRANGLER_NOT_INSTALLED');
};
async function run(){
  guard();
  const args=[entry,'dev','--local','--ip','127.0.0.1','--port',String(PORT),
    '--config','wrangler.pbkdf2-local.jsonc'];
  const env={
    PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR || '/tmp',
    CI:'true',TZ:'UTC',NO_COLOR:'1',WRANGLER_SEND_METRICS:'false',
  };
  let stderr='';
  const child=spawn(process.execPath,args,{env,stdio:['ignore','ignore','pipe']});
  child.stderr.setEncoding('utf8');
  child.stderr.on('data',v=>{stderr=(stderr+v).slice(-1200);});
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
    const samples=[];
    for(let i=0;i<3;i++){
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
    const med = key=>[...samples].map(x=>x[key]).sort((a,b)=>a-b)[1];
    // Only synthetic wall-clock measurements, not a hosted Workers CPU claim.
    console.log(JSON.stringify({
      result:'LOCAL_WORKERD_SYNTHETIC_PASS',
      cpu_limit_verified:false,
      environment:'local_workerd',
      iterations:600000,
      samples:3,
      median_wall_ms:{
        hash:med('hash_ms'),verify_correct:med('verify_correct_ms'),
        verify_wrong:med('verify_wrong_ms')
      }
    }));
  }finally{
    close();
    process.off('SIGINT',stop);process.off('SIGTERM',stop);
  }
}
run().catch(e=>{
  console.error('LOCAL_WORKERD_SYNTHETIC_FAILED: '+(e?.message||'unknown'));
  process.exitCode=1;
});
