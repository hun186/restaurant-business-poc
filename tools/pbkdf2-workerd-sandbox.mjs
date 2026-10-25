// Create a private, disposable workerd project containing only the reviewed
// synthetic probe modules. Neither Wrangler nor workerd see repository .env,
// .dev.vars, or any project-level Cloudflare/Owner credential bindings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG='wrangler.pbkdf2-local.jsonc';
const MODULES=Object.freeze([
  'cloudflare/auth-core.mjs',
  'cloudflare/pbkdf2-local-probe.mjs',
  'cloudflare/pbkdf2-local-probe-worker.mjs'
]);
const KEYS=Object.freeze(['compatibility_date','main','name','preview_urls','send_metrics','workers_dev']);
function validate(cfg) {
  if(!cfg || Array.isArray(cfg) || typeof cfg!=='object' ||
    JSON.stringify(Object.keys(cfg).sort())!==JSON.stringify([...KEYS].sort()) ||
    cfg.name!=='restaurant-pbkdf2-local-synthetic-probe' ||
    cfg.main!=='./cloudflare/pbkdf2-local-probe-worker.mjs' ||
    cfg.workers_dev!==false || cfg.preview_urls!==false ||
    cfg.send_metrics!==false || cfg.compatibility_date!=='2026-10-25')
    throw new Error('E_UNSAFE_BENCH_CONFIG');
}
export function createIsolatedProbeWorkspace(sourceRoot) {
  const cfg=JSON.parse(fs.readFileSync(path.join(sourceRoot,CONFIG),'utf8'));
  validate(cfg);
  // Only exact whitelisted files are copied. Hidden dot-env files are NEVER
  // read, enumerated, copied, imported or handed to Wrangler in its cwd.
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-pbkdf2-'));
  try {
    fs.mkdirSync(path.join(folder,'cloudflare'),{mode:0o700});
    fs.writeFileSync(path.join(folder,CONFIG),JSON.stringify(cfg),{flag:'wx',mode:0o600});
    for(const file of MODULES) fs.copyFileSync(path.join(sourceRoot,file),path.join(folder,file));
    return folder;
  }catch(error){
    fs.rmSync(folder,{recursive:true,force:true});
    throw error;
  }
}
export function isolatedProbeEnvironment(folder) {
  // Env allowlist is positive, not inherited; HOME/config/cache and TMPDIR are
  // inside the disposable directory. Dotenv loading is also explicitly disabled.
  return {
    PATH:process.env.PATH || '',
    HOME:folder,
    TMPDIR:folder,
    XDG_CONFIG_HOME:folder,
    CI:'true',
    TZ:'UTC',
    NO_COLOR:'1',
    WRANGLER_SEND_METRICS:'false',
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV:'false'
  };
}
