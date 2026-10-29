'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const modPromise=import('../tools/cloudflare-d1-recovery-readiness.mjs');
const idsPromise=import('../tools/check-cloudflare-staging.mjs');
const goodBookmark='00000001-00000002-00004e2f-0a83ea2fceebc654de0640c422be4653';
const tool=path.join(root,'tools/cloudflare-d1-recovery-readiness.mjs');
const workflow=path.join(root,'.github/workflows/d1-production-recovery-readonly-g5.yml');
async function valid(){
 const {PROD_ID}=await idsPromise;
 return [{success:true,result:{uuid:PROD_ID,name:'restaurant-business-prod',version:'production'}},
 {success:true,result:{bookmark:goodBookmark}}];
}
test('synthetic SQLite backup and restore is isolated and explicitly not a remote D1 drill',async()=>{
 const m=await modPromise;
 const r=m.isolatedSyntheticRestore();
 assert.equal(r.status,'G5_ISOLATED_SYNTHETIC_SQLITE_RESTORE_PASS');
 assert.equal(r.synthetic_rows_verified,2);
 assert.equal(r.snapshot_integrity_verified,true);
 assert.equal(r.source_database_preserved,true);
 assert.equal(r.production_restore_performed,false);
 assert.equal(r.remote_restore_rehearsal_verified,false);
 assert.equal(r.offsite_encrypted_backup_verified,false);
 assert.equal(r.recovery_signoff_granted,false);
});
test('real API metadata and current bookmark shape show ONLY read-only capability',async()=>{
 const m=await modPromise;
 const [info,bk]=await valid();
 const result=m.checkD1Metadata(info,bk);
 assert.equal(result.status,'G5_PROD_D1_TIME_TRAVEL_READONLY_CAPABILITY_PASS');
 assert.equal(result.backend,'production');
 assert.equal(result.current_bookmark_retrieved,true);
 assert.equal(result.recovery_signoff_granted,false);
 assert.equal(result.production_ready,false);
 assert.doesNotMatch(JSON.stringify(result),/00000001|bookmark"|restaurant-business-prod|b882a6e8/);
});
test('alpha backend, wrong DB, malformed bookmark or failing response refuse certification',async()=>{
 const m=await modPromise;
 const failure=[
  (i,b)=>i.result.version='alpha',
  (i,b)=>i.result.version=undefined,
  (i,b)=>i.result.uuid='2c355bed-d9c3-449c-aa9b-1018f3bc1177',
  (i,b)=>i.result.name='restaurant-business-staging',
  (i,b)=>i.success=false,
  (i,b)=>b.success=false,
  (i,b)=>b.result.bookmark='',
  (i,b)=>b.result.bookmark='not-a-bookmark',
  (i,b)=>b.result.bookmark=123,
  (i,b)=>b.result=null
 ];
 for(const mutate of failure){
   const [info,bk]=await valid();
   mutate(info,bk);
   assert.throws(()=>m.checkD1Metadata(info,bk),/E_G5_RECOVERY_READONLY/);
 }
});
test('remote inspection must request exact two read-only Cloudflare D1 paths',async()=>{
 const m=await modPromise,{ACCOUNT_ID,PROD_ID}=await idsPromise;
 const base='/accounts/'+ACCOUNT_ID+'/d1/database/'+PROD_ID;
 const calls=[],[meta,bookmark]=await valid();
 const result=await m.inspectRemote(async p=>{
   calls.push(p);
   if(p===base)return meta;
   if(p===base+'/time_travel/bookmark')return bookmark;
   throw Error('unexpected Cloudflare path');
 });
 assert.deepEqual(calls,[base,base+'/time_travel/bookmark']);
 assert.equal(result.production_migration_performed,false);
 assert.equal(result.production_restore_performed,false);
});
test('Cloudflare HTTP fetch uses GET and fixed origin; refuses redirection, invalid token and API failure',async()=>{
 const m=await modPromise,{ACCOUNT_ID,PROD_ID}=await idsPromise;
 const base='/accounts/'+ACCOUNT_ID+'/d1/database/'+PROD_ID;
 const validMeta=(await valid())[0];
 let requested;
 const fake=async(url,opts)=>{
   requested={url,opts};
   return {ok:true,text:async()=>JSON.stringify(validMeta)};
 };
 const data=await m.cloudflareReadOnly(base,'SYNTHETIC_READ_ONLY_TOKEN',fake);
 assert.deepEqual(data,validMeta);
 assert.equal(requested.url,'https://api.cloudflare.com/client/v4'+base);
 assert.equal(requested.opts.method,'GET');
 assert.equal(requested.opts.redirect,'error');
 assert.equal(requested.opts.headers.Accept,'application/json');
 await assert.rejects(()=>m.cloudflareReadOnly('/accounts/not-our-account/d1/database/x','SYNTHETIC_READ_ONLY_TOKEN',fake),/E_G5_RECOVERY_READONLY/);
 await assert.rejects(()=>m.cloudflareReadOnly(base,'bad',fake),/E_G5_RECOVERY_READONLY/);
 await assert.rejects(()=>m.cloudflareReadOnly(base,'SYNTHETIC_READ_ONLY_TOKEN',
   async()=>({ok:false,text:async()=>JSON.stringify(validMeta)})),/E_G5_RECOVERY_READONLY/);
 await assert.rejects(()=>m.cloudflareReadOnly(base,'SYNTHETIC_READ_ONLY_TOKEN',
   async()=>({ok:true,text:async()=>JSON.stringify({success:false,errors:['synthetic']})})),/E_G5_RECOVERY_READONLY/);
 await assert.rejects(()=>m.cloudflareReadOnly(base,'SYNTHETIC_READ_ONLY_TOKEN',
   async()=>({ok:true,text:async()=>'{broken'})),/E_G5_RECOVERY_READONLY/);
 await assert.rejects(()=>m.cloudflareReadOnly(base,'SYNTHETIC_READ_ONLY_TOKEN',
   async()=>({ok:true,text:async()=> 'x'.repeat(65537)})),/E_G5_RECOVERY_READONLY/);
});
test('CLI synthetic mode succeeds without credentials and remote mode fails closed outside protected Actions',()=>{
 const synthetic=spawnSync(process.execPath,[tool,'synthetic'],{
   cwd:root,encoding:'utf8',timeout:15000,
   env:{...process.env,GITHUB_ACTIONS:'false',CLOUDFLARE_API_TOKEN:''}
 });
 assert.equal(synthetic.status,0,synthetic.stderr);
 assert.equal(JSON.parse(synthetic.stdout).remote_restore_rehearsal_verified,false);
 const denied=spawnSync(process.execPath,[tool,'remote'],{
   cwd:root,encoding:'utf8',timeout:15000,
   env:{...process.env,GITHUB_ACTIONS:'false',GITHUB_REF:'refs/heads/main',
      G5_RECOVERY_READONLY_CONFIRM:'CHECK_PROD_D1_RECOVERY_READONLY',
      CLOUDFLARE_API_TOKEN:'SYNTHETIC_READ_ONLY_TOKEN'}
 });
 assert.equal(denied.status,1);
 assert.match(denied.stderr,/G5_RECOVERY_READONLY_CHECK_FAILED/);
 assert.doesNotMatch(denied.stderr,/SYNTHETIC_READ_ONLY_TOKEN|b882a6e8/);
});
test('workflow is main-only manual read-only, same prod concurrency, no restore/export/deploy commands',()=>{
 const wf=fs.readFileSync(workflow,'utf8');
 assert.match(wf,/^on:\s*$/m);
 assert.match(wf,/^  workflow_dispatch:/m);
 assert.doesNotMatch(wf,/^\s*(push|pull_request|schedule):/m);
 assert.match(wf,/github\.ref == 'refs\/heads\/main'/);
 assert.match(wf,/inputs\.confirm == 'CHECK_PROD_D1_RECOVERY_READONLY'/);
 assert.match(wf,/group: restaurant-business-production-d1-initialization/);
 assert.match(wf,/environment: d1-production-readonly/);
 assert.match(wf,/CLOUDFLARE_PROD_D1_READ_TOKEN/);
 assert.doesNotMatch(wf,/CLOUDFLARE_PROD_D1_WRITE_TOKEN|d1-production-migration|G5_RELEASE_GATE_CLOSED/);
 assert.match(wf,/node tools\/cloudflare-hosted-probe-preflight\.mjs/);
 assert.match(wf,/node tools\/cloudflare-d1-recovery-readiness\.mjs synthetic/);
 assert.match(wf,/node tools\/cloudflare-d1-recovery-readiness\.mjs remote/);
 assert.doesNotMatch(wf,/\bwrangler\b|d1 migrations apply|d1 time-travel restore|d1 export|d1 execute|upload-artifact|artifact:/i);
 const script=fs.readFileSync(tool,'utf8');
 assert.match(script,/method:'GET'/);
 assert.match(script,/redirect:'error'/);
 assert.doesNotMatch(script,/method:'POST'|method:'DELETE'|\/time_travel\/restore|cloudflare\.com\/client\/v4\/accounts\/.*\/query/);
});
