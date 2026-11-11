// Standalone maintenance Worker, run ONLY by local Wrangler dev with remote D1 binding.
// This module is never imported by the production Cloudflare Worker and has no public route.
import {atomicOwnerRecovery} from './owner-recovery-atomic-internal.mjs';

const APPROVAL='RESET_EXISTING_OWNER_PASSWORD_ONCE';
const FAIL='E_OWNER_RECOVERY_LOCAL';
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SQL=`SELECT u.id AS owner_id,u.password_salt,u.password_hash,
 (SELECT contract_version FROM cloud_schema_contract WHERE id=1) AS contract_version,
 (SELECT COUNT(*) FROM d1_migrations) AS migrations,
 (SELECT COUNT(*) FROM d1_migrations WHERE name='0001_initial_v3.sql') AS migration_1,
 (SELECT COUNT(*) FROM d1_migrations WHERE name='0002_login_attempts_window_indexes.sql') AS migration_2,
 (SELECT COUNT(*) FROM users WHERE role='owner') AS total_owners,
 (SELECT COUNT(*) FROM users WHERE role='owner' AND active=1) AS active_owners,
 (SELECT COUNT(*) FROM users WHERE username='owner' COLLATE NOCASE) AS username_owners,
 (SELECT COUNT(*) FROM audit_logs WHERE actor_name='production-bootstrap'
  AND action='auth.owner_bootstrap' AND entity_id=u.id) AS bootstrap_audits,
 (SELECT COUNT(*) FROM audit_logs WHERE actor_name='production-password-recovery'
  AND action='auth.password_reset' AND entity_id=u.id) AS reset_audits,
 (SELECT COUNT(*) FROM sessions WHERE user_id=u.id) AS sessions,
 (SELECT COUNT(*) FROM locations)+(SELECT COUNT(*) FROM ingredients)+
 (SELECT COUNT(*) FROM tasks)+(SELECT COUNT(*) FROM purchase_orders)+
 (SELECT COUNT(*) FROM stock_moves)+(SELECT COUNT(*) FROM stocktakes)+
 (SELECT COUNT(*) FROM repairs)+(SELECT COUNT(*) FROM shifts) AS business_rows
 FROM users u WHERE u.username='owner' COLLATE NOCASE AND u.role='owner' AND u.active=1`;
const reply=(code,status=400)=>new Response(JSON.stringify({code}),{status,headers:{
 'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, private',
 'X-Content-Type-Options':'nosniff'
}});
async function inspect(db){
 if(typeof db?.prepare!=='function'||typeof db?.batch!=='function')throw Error(FAIL);
 const r=await db.prepare(SQL).all(),row=r?.results?.[0];
 if(r?.results?.length!==1||!row||!UUID.test(row.owner_id)||row.contract_version!==3||
    row.migrations!==2||row.migration_1!==1||row.migration_2!==1||
    row.total_owners!==1||row.active_owners!==1||row.username_owners!==1||
    row.bootstrap_audits!==1||
    !/^[0-9a-f]{32}$/.test(row.password_salt||'')||
    !/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/.test(row.password_hash||''))throw Error(FAIL);
 const q=await db.prepare('PRAGMA quick_check;').all();
 const f=await db.prepare('PRAGMA foreign_key_check;').all();
 if(q?.results?.length!==1||q.results[0]?.quick_check!=='ok'||
    !Array.isArray(f?.results)||f.results.length!==0)throw Error(FAIL);
 return row;
}
export async function handleLocalRecovery(req,env){
 try{
  const url=new URL(req.url);
  if(url.hostname!=='127.0.0.1'||req.headers.get('host')?.split(':')[0]!=='127.0.0.1'||
     req.headers.has('origin')||req.headers.has('cookie')||
     req.headers.has('authorization')||req.headers.has('x-forwarded-for')||
     env?.RECOVERY_LOCAL_MODE!=='operator-loopback-only'||!env.DB?.batch)
   return reply('E_LOCAL_ONLY',403);
  if(url.search||url.hash)return reply('E_NOT_FOUND',404);
  if(req.method==='GET'&&url.pathname==='/__recovery/ready')
   return reply('LOCAL_WORKER_READY',200);
  if(req.method==='POST'&&url.pathname==='/__recovery/inspect'){
   await inspect(env.DB);
   return reply('OWNER_RECOVERY_PRECHECK_PASS',200);
  }
  if(req.method!=='POST'||url.pathname!=='/__recovery/reset')
   return reply('E_NOT_FOUND',404);
  if(req.headers.get('content-type')!=='application/json')return reply('E_INPUT',415);
  const length=req.headers.get('content-length');
  if(!length||!/^[1-9][0-9]*$/.test(length)||Number(length)>1500)
   return reply('E_INPUT',413);
  const raw=await req.text();
  if(new TextEncoder().encode(raw).length>1500)return reply('E_INPUT',413);
  let data;try{data=JSON.parse(raw);}catch{return reply('E_INPUT',400);}
  if(!data||typeof data!=='object'||Array.isArray(data)||
     JSON.stringify(Object.keys(data).sort())!==
     JSON.stringify(['approval','audit_id','password_hash','password_salt'].sort())||
     data.approval!==APPROVAL)return reply('E_INPUT',400);
  const before=await inspect(env.DB);
  const replacement={password_salt:data.password_salt,password_hash:data.password_hash};
  const result=await atomicOwnerRecovery(env.DB,before,replacement,data.audit_id);
  if(result.atomic_binding_batch!==true)throw Error(FAIL);
  const after=await inspect(env.DB);
  if(after.owner_id!==before.owner_id||
     after.password_hash!==replacement.password_hash||
     after.password_salt!==replacement.password_salt||
     after.sessions!==0||after.reset_audits!==before.reset_audits+1||
     after.business_rows!==before.business_rows)throw Error(FAIL);
  return reply('OWNER_RECOVERY_ATOMIC_VERIFIED',200);
 }catch{return reply('E_OWNER_RECOVERY_UNCERTAIN',503);}
}
export default {fetch:handleLocalRecovery};
