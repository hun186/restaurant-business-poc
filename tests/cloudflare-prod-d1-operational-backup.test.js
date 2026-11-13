'use strict';
// Offline-only operational backup contract. No Cloudflare credentials, deploy,
// Production D1 SQL writes or sensitive fixture data.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.join(__dirname,'..');
const mod=import('../tools/cloudflare-prod-d1-encrypted-backup.mjs');
const schema=fs.readFileSync(path.join(root,'cloudflare/migrations/0001_initial_v3.sql'),'utf8');
const indexes=fs.readFileSync(path.join(root,'cloudflare/migrations/0002_login_attempts_window_indexes.sql'),'utf8');
const baseline=schema+'\n'+indexes+'\n'+[
 'CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT NOT NULL);',
 "INSERT INTO d1_migrations(id,name) VALUES(1,'0001_initial_v3.sql');",
 "INSERT INTO d1_migrations(id,name) VALUES(2,'0002_login_attempts_window_indexes.sql');",
 "INSERT INTO users(id,username,display_name,role,password_salt,password_hash,active) VALUES('owner-id','owner','Synthetic Owner','owner','"+'b'.repeat(32)+"','pbkdf2-sha256$100000$"+'a'.repeat(64)+"',1);",
 "INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail) VALUES('bootstrap','production-bootstrap','auth.owner_bootstrap','users','owner-id','{\"hash_version\":\"pbkdf2-sha256$100000\"}');"
].join('\n');
const operating=baseline+'\n'+[
 "INSERT INTO locations(id,name,active) VALUES('shop1','Synthetic Shop',1);",
 "INSERT INTO ingredients(id,sku,name,unit,min_stock,active) VALUES('ingredient1','TEST-01','Synthetic Item','piece',0,1);",
 "INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,actor_id) VALUES('move1','ingredient1','shop1',5,'purchase','owner-id');",
 "INSERT INTO login_attempts(id,username,ip_hash,success) VALUES('attempt1','owner','"+'b'.repeat(64)+"',1);",
 "INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,detail) VALUES('login-audit','owner-id','owner','auth.login','sessions','{}');",
 "INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES('synthetic-token','synthetic-csrf','owner-id','2030-01-01');"
].join('\n');
const pass='synthetic-strong-backup-passphrase-123';
test('operational replay accepts real business/auth rows but legacy validator stays strict',async()=>{
 const m=await mod;
 assert.throws(()=>m.verifyLocalSql(operating),e=>e.message==='E_PRODUCTION_D1_BACKUP'&&e.reason==='SQL_OWNER_STATE');
 const v=m.verifyLocalSql(operating,{operational:true});
 assert.equal(v.schema_version,3);
 assert.equal(v.owner_count,1);
 assert.equal(v.owner_enrollment_audits,1);
 assert.equal(v.business_data_present,true);
 assert.equal(v.operational_backup,true);
 assert.equal(v.production_restore_performed,false);
 const initial=m.verifyLocalSql(baseline);
 assert.equal(initial.owner_count,1);
 assert.equal(initial.operational_backup,undefined);
});
test('operational encrypted format is GCM-bound, cannot be relabeled as initial backup',async()=>{
 const m=await mod;
 const blob=m.encryptSql(operating,pass,{operational:true});
 const outer=JSON.parse(blob.toString('utf8'));
 assert.equal(outer.format,'RBPOC_D1_AES256_GCM_OPERATIONAL_SQL_V1');
 assert.equal(m.decryptSql(blob,pass),operating);
 assert.ok(!blob.toString('utf8').includes('Synthetic Shop'));
 assert.throws(()=>m.decryptSql(blob,'wrong-synthetic-passphrase'),/E_PRODUCTION_D1_BACKUP/);
 for(const format of ['RBPOC_D1_AES256_GCM_SQL_V1','WRONG_FORMAT']){
  assert.throws(()=>m.decryptSql(Buffer.from(JSON.stringify({...outer,format})),pass),/E_PRODUCTION_D1_BACKUP/);
 }
 const legacy=m.encryptSql(baseline,pass);
 const old=JSON.parse(legacy.toString('utf8'));
 assert.equal(old.format,'RBPOC_D1_AES256_GCM_SQL_V1');
 assert.throws(()=>m.decryptSql(Buffer.from(JSON.stringify({...old,format:outer.format})),pass),/E_PRODUCTION_D1_BACKUP/);
});
test('operational backup verifies encrypted local source and offline duplicate without restore',async t=>{
 const m=await mod;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'operational-d1-archive-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const original=path.join(dir,'original.sql.aes'),copy=path.join(dir,'copy.sql.aes');
 const bytes=m.encryptSql(operating,pass,{operational:true});
 fs.writeFileSync(original,bytes,{flag:'wx',mode:0o600});
 fs.copyFileSync(original,copy);
 const verified=m.verifyArchive(original,pass);
 assert.equal(verified.status,'PROD_D1_ENCRYPTED_LOCAL_VERIFY_PASS');
 assert.equal(verified.operational_backup,true);
 assert.equal(verified.business_data_present,true);
 assert.equal(verified.production_write_performed,false);
 const copied=m.verifyIndependentCopy(original,copy,pass);
 assert.equal(copied.copy_matches_source,true);
 assert.equal(copied.both_archives_offline_sqlite_replay_verified,true);
 assert.equal(copied.remote_restore_rehearsal_verified,false);
});
test('operational replay rejects invalid bootstrap, credentials, corrupted schema or FK',async()=>{
 const m=await mod;
 const bad=[
  operating.replace("'auth.owner_bootstrap'","'auth.login'"),
  operating.replace("'production-bootstrap'","'fake-bootstrap'"),
  operating.replace("'owner','Synthetic Owner','owner'","'owner','Synthetic Owner','staff'"),
  operating.replace('pbkdf2-sha256$100000$'+'a'.repeat(64),'weak'),
  operating.replace("VALUES(1,'0001_initial_v3.sql')","VALUES(1,'other.sql')"),
  operating.replace("'ingredient1','shop1',5","'ingredient1','missing-shop',5")
 ];
 for(const sql of bad)assert.throws(()=>m.verifyLocalSql(sql,{operational:true}),/E_PRODUCTION_D1_BACKUP/);
});
test('operational export verifies production target, skips initial-only empty database probe',async()=>{
 const m=await mod;
 const target=(await import('../tools/cloudflare-prod-owner-operator.mjs')).localProductionTarget();
 const uri='https://api.cloudflare.com/client/v4/accounts/'+target.accountId+'/d1/database/'+target.databaseId;
 let meta=0,exportCalls=0,download=0,query=0;
 const transport=async(url,opts)=>{
  if(url===uri){
   assert.equal(opts.method,'GET');meta++;
   return {ok:true,status:200,text:async()=>JSON.stringify({success:true,result:{
    name:'restaurant-business-prod',uuid:target.databaseId,version:'production'
   }})};
  }
  if(url===uri+'/export'){
   assert.equal(opts.method,'POST');exportCalls++;
   const out=exportCalls===1?{type:'export',success:true,status:'running',at_bookmark:'bookmark1'}:
    {type:'export',success:true,status:'complete',result:{signed_url:'https://backup.example.r2.dev/one-time'}};
   return {ok:true,status:200,text:async()=>JSON.stringify({success:true,result:out})};
  }
  if(url.startsWith('https://backup.example.r2.dev/')){
   assert.equal(opts.method,'GET');assert.equal(opts.headers,undefined);download++;
   let sent=false;
   return {ok:true,status:200,headers:{get:()=>String(Buffer.byteLength(operating))},
    body:{getReader:()=>({read:async()=>sent?{done:true}:(sent=true,{done:false,value:Buffer.from(operating)}),
     releaseLock(){}})}};
  }
  if(url.endsWith('/query'))query++;
  throw Error('unexpected network call');
 };
 const out=await m.remoteExport({token:'a'.repeat(24),operational:true,transport,pause:async()=>{}});
 assert.equal(out,operating);
 assert.equal(meta,1);assert.equal(exportCalls,2);assert.equal(download,1);assert.equal(query,0);
 assert.equal(m.verifyLocalSql(out,{operational:true}).operational_backup,true);
});
test('Windows launcher requires exact 4 and does not confuse choice errors with export',()=>{
 const bat=fs.readFileSync(path.join(root,'run-production-d1-backup.bat'),'utf8').replace(/\r\n/g,'\n');
 assert.match(bat,/choice \/C 1234 \/N/);
 assert.match(bat,/if "%MENU_CHOICE%"=="4" goto export-operational/);
 assert.match(bat,/--export-operational/);
 assert.match(bat,/if "%MENU_CHOICE%"=="3" goto verify-copy/);
 assert.doesNotMatch(bat,/if errorlevel [34] goto/);
});
