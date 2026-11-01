'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const mod=import('../tools/cloudflare-prod-d1-encrypted-backup.mjs');
const SQL=[
 'CREATE TABLE cloud_schema_contract(contract_version INTEGER NOT NULL);',
 'INSERT INTO cloud_schema_contract VALUES(3);',
 'CREATE TABLE d1_migrations(id INTEGER NOT NULL);',
 'INSERT INTO d1_migrations VALUES(1);INSERT INTO d1_migrations VALUES(2);',
 'CREATE TABLE users(id TEXT,role TEXT,active INTEGER);',
 'CREATE TABLE locations(id TEXT);',
 'CREATE TABLE audit_logs(id TEXT);',
 'CREATE TABLE sessions(id TEXT);',
 'CREATE TABLE stock_moves(id TEXT);',
 'CREATE TABLE purchase_orders(id TEXT);'
].join('\n');
const TOKEN='a'.repeat(24);
const before={
 contract_version:3,migration_total:2,migration_1:1,migration_2:1,
 locations:0,users:0,user_locations:0,sessions:0,login_attempts:0,audit_logs:0,
 tasks:0,ingredients:0,stock_moves:0,purchase_orders:0,stocktakes:0,repairs:0,
 shifts:0,leave_requests:0,training_courses:0,training_records:0,evaluations:0,
 ingredient_prices:0,menu_dishes:0,dish_ingredients:0
};
const after={contract_version:3,migration_total:2,users:0,owners:0,
 sessions:0,login_attempts:0,audit_logs:0,owner_enrollment_audits:0};
const envelope=x=>({ok:true,status:200,text:async()=>JSON.stringify(x),json:async()=>x});
function mockTransport({tamper=false,badUrl=false}={}){
 let queries=0,posts=0,gets=0,downloads=0;const calls=[];
 const transport=async(url,opts)=>{
  calls.push({url:url.split('?')[0],method:opts.method,auth:!!opts.headers?.Authorization});
  if(url.endsWith('/export')){
   posts++;assert.equal(opts.method,'POST');
   assert.equal(opts.redirect,'error');
   const body=JSON.parse(opts.body);
   assert.equal(body.output_format,'polling');
   if(posts===1){
    assert.equal(body.current_bookmark,undefined);
    return envelope({success:true,result:{type:'export',success:true,
     at_bookmark:'aaaaaaaa-bbbbbbbb-cccccccc-'+'d'.repeat(32)}});
   }
   assert.equal(body.current_bookmark,'aaaaaaaa-bbbbbbbb-cccccccc-'+'d'.repeat(32));
   return envelope({success:true,result:{type:'export',success:true,status:'complete',
    result:{signed_url:badUrl?'http://127.0.0.1/file':
     'https://private.example.r2.dev/signed?SECRET_SIGNED_QUERY'}}});
  }
  if(url.includes('/signed?')){
   downloads++;assert.equal(opts.method,'GET');assert.equal(opts.headers,undefined);
   let first=true;
   return {ok:true,status:200,headers:{get:()=>String(Buffer.byteLength(SQL))},
    body:{getReader:()=>({read:async()=>first?(first=false,{done:false,value:Buffer.from(SQL)}):
      {done:true},releaseLock(){}})}};
  }
  assert.ok(url.startsWith('https://api.cloudflare.com/client/v4/accounts/'));
  assert.equal(opts.headers.Authorization,'Bearer '+TOKEN);
  if(url.endsWith('/query')){
   queries++;assert.equal(opts.method,'POST');
   const data=JSON.parse(opts.body),sql=data.sql;
   let results;
   if(sql.includes('FROM cloud_schema_contract')&&sql.includes('migration_1'))results=[tamper?{...before,users:1}:before];
   else if(sql.includes('owner_enrollment_audits'))results=[after];
   else if(sql==='PRAGMA quick_check;')results=[{quick_check:'ok'}];
   else if(sql==='PRAGMA foreign_key_check;')results=[];
   else throw Error('unexpected reviewed query');
   return envelope({success:true,result:[{success:true,results}]});
  }
  gets++;assert.equal(opts.method,'GET');
  const target=(await import('../tools/cloudflare-prod-owner-operator.mjs')).localProductionTarget();
  return envelope({success:true,result:{uuid:target.databaseId,
   name:'restaurant-business-prod',version:'production'}});
 };
 return {transport,calls,get queries(){return queries},get posts(){return posts},
  get gets(){return gets},get downloads(){return downloads}};
}
test('AES-GCM archive roundtrip and offline SQL replay validates v3 and migrations',async()=>{
 const m=await mod;
 const replay=m.verifyLocalSql(SQL);
 assert.equal(replay.schema_version,3);
 assert.equal(replay.applied_migrations,2);
 assert.equal(replay.owner_count,0);
 assert.equal(replay.remote_restore_rehearsal_verified,false);
 const sealed=m.encryptSql(SQL,'synthetic-lab-password-123456');
 assert.ok(!sealed.toString().includes('INSERT INTO')&&!sealed.toString().includes('cloud_schema_contract'));
 const plain=m.decryptSql(sealed,'synthetic-lab-password-123456');
 assert.equal(plain,SQL);
 assert.throws(()=>m.decryptSql(sealed,'wrong-encryption-passphrase-123'),/E_PRODUCTION_D1_BACKUP/);
 const corrupt=JSON.parse(sealed.toString());
 corrupt.ciphertext=(corrupt.ciphertext[0]==='a'?'b':'a')+corrupt.ciphertext.slice(1);
 assert.throws(()=>m.decryptSql(Buffer.from(JSON.stringify(corrupt)),'synthetic-lab-password-123456'),/E_PRODUCTION_D1_BACKUP/);
});
test('invalid or incomplete dump fails closed without writing remote D1',async()=>{
 const m=await mod;
 for(const s of [
  'DROP TABLE foo;',SQL.replace('VALUES(3)','VALUES(4)'),
  SQL.replace('INSERT INTO d1_migrations VALUES(2);',''),
  SQL.replace('CREATE TABLE audit_logs(id TEXT);','')
 ])assert.throws(()=>m.verifyLocalSql(s),/E_PRODUCTION_D1_BACKUP/);
 assert.throws(()=>m.encryptSql(SQL,'short'),/E_PRODUCTION_D1_BACKUP/);
});
test('remote exporter sends four reviewed Owner SELECT/PRAGMAs and bounded export polling',async()=>{
 const m=await mod,mock=mockTransport();
 let pauses=0;
 const out=await m.remoteExport({token:TOKEN,transport:mock.transport,pause:async()=>{pauses++;}});
 assert.equal(out,SQL);
 assert.equal(mock.queries,4);assert.equal(mock.gets,1);
 assert.equal(mock.posts,2);assert.equal(mock.downloads,1);
 assert.equal(pauses,1);
 assert.equal(mock.calls.filter(x=>x.url.includes('/query')).every(x=>x.method==='POST'),true);
 assert.equal(mock.calls.filter(x=>x.url.endsWith('/export')).length,2);
 assert.equal(mock.calls.filter(x=>x.url.includes('.r2.dev')).every(x=>x.auth===false),true);
 assert.equal(mock.calls.some(x=>/\/(import|restore|delete|migrations)/.test(x.url)),false);
});
test('changed Owner count or untrusted signed URL cannot download data',async()=>{
 const m=await mod;
 const changed=mockTransport({tamper:true});
 await assert.rejects(()=>m.remoteExport({token:TOKEN,transport:changed.transport,pause:async()=>{}}),
  /E_PRODUCTION_D1_BACKUP/);
 assert.equal(changed.posts,0);assert.equal(changed.downloads,0);
 const bad=mockTransport({badUrl:true});
 await assert.rejects(()=>m.remoteExport({token:TOKEN,transport:bad.transport,pause:async()=>{}}),
  /E_PRODUCTION_D1_BACKUP/);
 assert.equal(bad.downloads,0);
});
test('CLI refuses redirected stdin and never runs export from CI',async()=>{
 const p=spawnSync(process.execPath,['tools/cloudflare-prod-d1-encrypted-backup.mjs','--export'],{
  cwd:root,encoding:'utf8',input:'EXPORT_PRODUCTION_D1_TO_ENCRYPTED_LOCAL_BACKUP',
  env:{...process.env,GITHUB_ACTIONS:'true',CLOUDFLARE_API_TOKEN:'SENTINEL_PRIVATE_TOKEN'},
  timeout:15000
 });
 assert.notEqual(p.status,0);
 assert.match(p.stderr,/E_PRODUCTION_D1_BACKUP/);
 assert.doesNotMatch(p.stdout+p.stderr,/SENTINEL_PRIVATE_TOKEN|cloudflare\.com\/client/);
});
test('Windows launcher offers explicit export and offline verify, never import/restore',()=>{
 const fs=require('node:fs');
 const txt=fs.readFileSync(path.join(root,'run-production-d1-backup.bat'),'utf8');
 assert.match(txt,/--export/);assert.match(txt,/--verify/);
 assert.doesNotMatch(txt,/d1 migrations apply|time_travel.restore|\/import|--enroll/);
});
