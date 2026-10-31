'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const imported=import('../vercel-demo/staging-access-client.js');
const UUID='11111111-2222-4333-8444-555555555555';
const success=(id=UUID,status='done')=>({
 ok:true,result:{id,status},environment:'staging_access',production_ready:false
});
const response=(obj,status=200,mime='application/json; charset=utf-8')=>
 new Response(JSON.stringify(obj),{status,headers:{'content-type':mime}});
test('only manually callable task.status POST uses same-origin cookies, intent header and exact approved schema',async()=>{
 const {createAccessPreviewClient}=await imported;
 const calls=[];
 const client=createAccessPreviewClient(async(url,opts)=>{
  calls.push([url,opts]);
  return response(success());
 });
 assert.deepEqual(await client.changeTaskStatus(UUID,'done'),{id:UUID,status:'done'});
 assert.equal(calls.length,1);
 const [url,options]=calls[0];
 assert.equal(url,'/api/access/task-status');
 assert.equal(options.method,'POST');
 assert.equal(options.mode,'same-origin');
 assert.equal(options.credentials,'same-origin');
 assert.equal(options.redirect,'manual');
 assert.equal(options.cache,'no-store');
 assert.equal(options.referrerPolicy,'no-referrer');
 assert.equal(options.headers.Accept,'application/json');
 assert.equal(options.headers['Content-Type'],'application/json');
 assert.equal(options.headers['X-Staging-Intent'],'task.status');
 assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Content-Type','X-Staging-Intent'].sort());
 assert.deepEqual(JSON.parse(options.body),{action:'task.status',data:{id:UUID,status:'done'}});
 assert.equal(options.signal,undefined);
});
test('invalid task ID or target status fails before any network request',async()=>{
 const {createAccessPreviewClient}=await imported;
 let calls=0;
 const client=createAccessPreviewClient(async()=>{calls++;return response(success())});
 for(const id of [undefined,null,123,'some-text','../../api/command','https://evil.invalid',
  UUID+'?role=owner',UUID.substring(0,35)]){
  await assert.rejects(client.changeTaskStatus(id,'done'));
 }
 for(const to of [null,undefined,'admin','cancelled','Done','received','delete']){
  await assert.rejects(client.changeTaskStatus(UUID,to));
 }
 assert.equal(calls,0);
});
test('disabled gate, unauthenticated, forbidden, stale, unknown, redirects and malformed responses all reject',async()=>{
 const {createAccessPreviewClient}=await imported;
 for(const [r,label] of [
  [response({code:'E_TASK_WRITE_NOT_ENABLED'},503),'disabled'],
  [response({code:'E_UNAUTHENTICATED'},401),'auth'],
  [response({code:'E_ORIGIN_DENIED'},403),'origin'],
  [response({code:'E_TASK_NOT_FOUND'},404),'scope'],
  [response({code:'E_CONCURRENT_CHANGE'},409),'stale'],
  [new Response('',{status:302,headers:{location:'https://outside.invalid'}}),'redirect'],
  [new Response('<html>login</html>',{status:200,headers:{'content-type':'text/html'}}),'html'],
  [new Response('invalid',{status:200,headers:{'content-type':'application/json'}}),'parse'],
  [response(success(UUID,'doing')),'wrong status'],
  [response(success('22222222-2222-4333-8444-555555555555')),'wrong id'],
  [response({...success(),production_ready:true}),'production'],
  [response({...success(),environment:'production'}),'environment'],
  [response({...success(),ok:false}),'ok flag'],
  [response({...success(),result:'not-object'}),'result']
 ]){
  const api=createAccessPreviewClient(async()=>r);
  await assert.rejects(api.changeTaskStatus(UUID,'done'),label);
 }
});
test('Staging UI requires explicit person confirmation and does not auto retry or persist secrets',()=>{
 const js=fs.readFileSync(path.join(root,'vercel-demo/staging-access-preview.js'),'utf8');
 const html=fs.readFileSync(path.join(root,'vercel-demo/staging-access-preview.html'),'utf8');
 const client=fs.readFileSync(path.join(root,'vercel-demo/staging-access-client.js'),'utf8');
 assert.match(js,/window\.confirm\(/);
 assert.match(js,/mutationInFlight/);
 assert.match(js,/client\.changeTaskStatus\(item\.id,desired\)/);
 assert.match(js,/view==='tasks'/);
 assert.match(js,/clear\(\);\s*status\(/);
 assert.match(js,/current!==seq/);
 assert.match(js,/textContent/);
 assert.match(html,/Staging.*?受控驗收/);
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/form-action 'none'/);
 assert.match(client,/\/api\/access\/task-status/);
 assert.doesNotMatch(html,/<form\b|<input\b|mock\.js|app\.js/);
 assert.doesNotMatch(js+' '+client,/localStorage|sessionStorage|\.innerHTML\s*=|document\.cookie|atob\s*\(|Authorization/);
 assert.doesNotMatch(client,/fetchImpl\(\s*[^'"/\s]/); // only fixed, literal server paths
});
