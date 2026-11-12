// Operator-only isolated launcher. Do not import this module into a public Worker.
// Wrangler CLI always exposes an unauthenticated DevTools Inspector, so use its
// programmatic API with inspect:false instead of "wrangler dev".
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const EXPECTED_WRANGLER='4.160.0';
const FAIL='E_OWNER_RECOVERY_INSPECTOR_DISABLED';
const dir=path.dirname(fileURLToPath(import.meta.url));
const cloudflare=path.resolve(dir,'../cloudflare');
const CONFIG='wrangler.owner-recovery.local.jsonc';
const WORKER='./owner-recovery-local-worker.mjs';

export function inspectorDisabledOptions(port){
 if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error(FAIL);
 return Object.freeze({
  config:CONFIG,
  ip:'127.0.0.1',
  port,
  local:true,
  inspect:false,
  experimental:{disableExperimentalWarning:true,disableDevRegistry:true}
 });
}

// npm exec --package=wrangler@4.160.0 prepends its cache's node_modules/.bin
// to PATH. Resolve the exact package from there without unsafe module fallbacks.
export function resolvePinnedWrangler(packagePath=process.env.PATH||''){
 for(const item of packagePath.split(path.delimiter)){
  if(!item||path.basename(item)!=='.bin')continue;
  const base=path.resolve(item,'..','wrangler');
  try{
   const manifest=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));
   if(manifest.name!=='wrangler'||manifest.version!==EXPECTED_WRANGLER)continue;
   const real=fs.realpathSync(base);
   const entry=path.join(real,'wrangler-dist','cli.js');
   if(fs.statSync(entry).isFile())return pathToFileURL(entry).href;
  }catch{}
 }
 throw Error(FAIL);
}

export async function serveRecoveryWorker(port,{load=href=>import(href)}={}){
 const options=inspectorDisabledOptions(port);
 const api=await load(resolvePinnedWrangler());
 if(typeof api?.unstable_dev!=='function')throw Error(FAIL);
 // This programmatic API passes inspect:false to Wrangler startDev;
 // unlike --inspector-port 0 it does not create an inspector listener.
 const instance=await api.unstable_dev(WORKER,options);
 if(!instance||typeof instance.stop!=='function')throw Error(FAIL);
 return instance;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.argv[2]);
 process.chdir(cloudflare);
 serveRecoveryWorker(port).then(instance=>{
  // Parent controls the entire process tree; this is best-effort graceful
  // shutdown only, and the parent's SIGKILL/taskkill remains authoritative.
  const stop=()=>{void instance.stop().finally(()=>process.exit(0));};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }).catch(()=>{
  process.stderr.write(FAIL+'; no recovery Worker listening.\n');
  process.exitCode=1;
 });
}
