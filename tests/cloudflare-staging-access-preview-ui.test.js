'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const clientPromise=import('../vercel-demo/staging-access-client.js');
const response=(body,status=200,mime='application/json; charset=utf-8')=>
 new Response(JSON.stringify(body),{status,headers:{'Content-Type':mime}});
const base={status:'staging_access_readonly',session_created:false,
 production_ready:false,mutations_enabled:false};
const identity={...base,user:{id:'staff-01',username:'synthetic-staff',
 display_name:'Synthetic Staff',role:'staff',locations:['store-a']}};
const overview={...base,metrics:{open_tasks:1,pending_orders:2,open_repairs:0,low_stock:3}};
const tasks={...base,entity:'tasks',rows:[{id:'task-a',title:'<svg/onload=alert(1)>',location_id:'store-a'}]};
test('Access client uses ONLY same-origin GET and browser-managed cookies, with no Access tokens or request body',async()=>{
 const {createAccessPreviewClient}=await clientPromise;
 const calls=[],fetchImpl=async(url,opts)=>{
  calls.push({url,opts});
  const v=url==='/api/access/me'?identity:url==='/api/access/overview'?overview:tasks;
  return response(v);
 };
 const client=createAccessPreviewClient(fetchImpl);
 assert.deepEqual((await client.me()).user,identity.user);
 assert.deepEqual((await client.overview()).metrics,overview.metrics);
 assert.deepEqual((await client.data('tasks')).rows,tasks.rows);
 assert.deepEqual(calls.map(x=>x.url),
  ['/api/access/me','/api/access/overview','/api/access/data?entity=tasks']);
 for(const {opts} of calls){
  assert.equal(opts.method,'GET');
  assert.equal(opts.mode,'same-origin');
  assert.equal(opts.credentials,'same-origin');
  assert.equal(opts.cache,'no-store');
  assert.equal(opts.redirect,'manual');
  assert.deepEqual(Object.keys(opts.headers),['Accept']);
  assert.equal(opts.body,undefined);
 }
});
test('Allowlist disallows unknown entity, absolute URLs and administrator/private data before fetch',async()=>{
 const {createAccessPreviewClient,ENTITY_LABELS}=await clientPromise;
 let count=0;const client=createAccessPreviewClient(async()=>{count++;return response(tasks)});
 for(const entity of ['users','audit_logs','staff_directory','../../api/me',
  'https://evil.invalid','tasks?entity=users','leave_requests','evaluations']){
  await assert.rejects(client.data(entity));
 }
 assert.equal(count,0);
 assert.deepEqual(Object.keys(ENTITY_LABELS).sort(),
  ['tasks','purchase_orders','stock','repairs','shifts','ingredients','locations','training_courses'].sort());
});
test('401/503/HTML redirect, malformed JSON, metadata mismatch or unsafe response shape all reject',async()=>{
 const {createAccessPreviewClient}=await clientPromise;
 const scenarios=[
  [response({code:'E_UNAUTHENTICATED'},401),'me'],
  [response({code:'E_ACCESS_NOT_ENABLED'},503),'me'],
  [new Response('',{status:302,headers:{Location:'https://evil.invalid'}}),'me'],
  [new Response('<!doctype html>',{status:200,headers:{'Content-Type':'text/html'}}),'me'],
  [new Response('{broken',{status:200,headers:{'Content-Type':'application/json'}}),'me'],
  [response({...identity,production_ready:true}),'me'],
  [response({...identity,user:{...identity.user,role:'admin'}}),'me'],
  [response({...overview,metrics:{open_tasks:-1,pending_orders:0,open_repairs:0,low_stock:0}}),'overview'],
  [response({...tasks,entity:'users'}),'data'],
  [response({...tasks,rows:['untrusted']}),'data'],
  [response({...tasks,rows:Array(501).fill({id:'x'})}),'data']
 ];
 for(const [r,type] of scenarios){
  const api=createAccessPreviewClient(async()=>r);
  await assert.rejects(type==='me'?api.me():type==='overview'?api.overview():api.data('tasks'));
 }
});
test('no public Demo mocks, credential forms, token storage, unescaped row HTML or cross-origin calls in Staging UI',()=>{
 const html=fs.readFileSync(path.join(root,'vercel-demo/staging-access-preview.html'),'utf8');
 const ui=fs.readFileSync(path.join(root,'vercel-demo/staging-access-preview.js'),'utf8');
 const client=fs.readFileSync(path.join(root,'vercel-demo/staging-access-client.js'),'utf8');
 assert.match(html,/Content-Security-Policy/);
 assert.match(html,/form-action 'none'/);
 assert.match(html,/staging-access-preview\.js/);
 assert.match(html,/staging-access-preview\.css/);
 assert.doesNotMatch(html,/<input\b|<form\b|mock\.js|app\.js|password/i);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|\.innerHTML\s*=|Authorization|document\.cookie|atob\s*\(/);
 assert.doesNotMatch(client,/localStorage|sessionStorage|Authorization|document\.cookie|atob\s*\(/);
 assert.match(ui,/textContent/);
 assert.match(ui,/controller\.abort\(\)/);
 assert.match(ui,/current!==seq/);
 assert.match(ui,/clear\(\);\s*status\(error/);
 assert.match(client,/credentials:'same-origin'/);
 assert.match(client,/redirect:'manual'/);
});
