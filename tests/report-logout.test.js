'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function setup(dir){
 const handlers=new Map(),nodes=new Map(),bodyClasses=new Set();
 const body={classList:{toggle(key,on){if(on)bodyClasses.add(key);else bodyClasses.delete(key);},
  contains:key=>bodyClasses.has(key)}};
 function element(key){
  if(!nodes.has(key))nodes.set(key,{hidden:true,innerHTML:'',textContent:'',style:{},
   classList:{add(){},remove(){},toggle(){},contains(){return false}},
   addEventListener(type,fn){handlers.set(key+':'+type,fn);},
   appendChild(){},reset(){},remove(){},dataset:{},value:''});
  return nodes.get(key);
 }
 const document={querySelector:element,querySelectorAll:()=>[],body,createElement:()=>element('#created')};
 const state={loggedIn:true,printCount:0,dataResolve:null,logoutResolve:null,loginCalls:0};
 const respond=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
 const fetch=(url,options)=>{
  if(url==='/api/me')return Promise.resolve(state.loggedIn?respond(200,{user:{id:'owner1',role:'owner',display_name:'業主',locations:['l1']},csrf:'csrf'}):respond(401,{error:'請登入'}));
  if(url==='/api/overview')return Promise.resolve(respond(200,{overview:{todo:0,late:0,low:0,orders:0,repairs:0,trainingPending:0}}));
  if(url==='/api/data?entity=audit_logs')return new Promise(resolve=>{state.dataResolve=()=>resolve(respond(200,{rows:[{at:'2026-10-24',actor_name:'業主',action:'audit.secure'}]}));});
  if(url==='/api/logout'){state.loggedIn=false;return new Promise(resolve=>{state.logoutResolve=()=>resolve(respond(200,{ok:true}));});}
  if(url==='/api/login'){state.loginCalls++;state.loggedIn=true;return Promise.resolve(respond(200,{ok:true}));}
  throw Error('unexpected fetch '+url);
 };
 const ctx=vm.createContext({document,window:{confirm:()=>true,print(){state.printCount++;}},
  fetch,FormData:class{*[Symbol.iterator](){yield ['username','owner'];yield ['password','safe'];}},console,Date,URL,setTimeout:()=>0,clearTimeout:()=>{}});
 for(const file of ['app.js','report-ui.js'])
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',dir,file),'utf8'),ctx,{filename:dir+'/'+file});
 const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
 return {ctx,handlers,element,state,bodyClasses,settle};
}
for(const dir of ['public','vercel-demo']){
 test(dir+' immediate logout clears prior owner report, modal and cache before HTTP response',async()=>{
  const h=setup(dir);await h.settle();
  assert.equal(vm.runInContext('S.me.role',h.ctx),'owner');
  h.element('#main').innerHTML='PRIVATE_AUDIT_IP_192.0.2.3';
  const modal=h.element('#modal-root');modal.hidden=false;modal.innerHTML='PRIVATE_EMPLOYEE_PASSWORD';
  vm.runInContext("S.cache.audit_logs=[{detail:'private'}];S.filter='IP';S.page='reports'",h.ctx);
  const initialEpoch=vm.runInContext('S.authEpoch',h.ctx);
  const pending=h.handlers.get('#logout:click')();
  assert.equal(typeof h.state.logoutResolve,'function','logout request was initiated');
  assert.ok(h.bodyClasses.has('auth-locked'),'CSS must be locked before awaiting network');
  assert.equal(h.element('#auth-overlay').hidden,false);
  assert.equal(h.element('#main').innerHTML,'');
  assert.equal(modal.hidden,true);assert.equal(modal.innerHTML,'');
  assert.equal(vm.runInContext('Object.keys(S.cache).length',h.ctx),0);
  assert.equal(vm.runInContext('S.me',h.ctx),null);
  assert.equal(vm.runInContext('S.csrf',h.ctx),'');
  assert.equal(vm.runInContext('S.authEpoch',h.ctx),initialEpoch+1);
  h.state.logoutResolve();await pending;
  assert.ok(h.bodyClasses.has('auth-locked'));
  const css=fs.readFileSync(path.join(__dirname,'..',dir,'styles.css'),'utf8');
  assert.match(css,/@media print[\s\S]*body\.auth-locked main,body\.auth-locked #report-print-preview\{display:none!important\}/);
  assert.ok(css.includes('#auth-overlay'),'password overlay must not be misused as print protection');
 });
 test(dir+' a pending report response cannot recreate a printable document after logout',async()=>{
  const h=setup(dir);await h.settle();
  vm.runInContext("S.page='audit_logs';S.filter='';",h.ctx);
  const report=vm.runInContext("exportCurrentPage('print')",h.ctx);
  assert.equal(typeof h.state.dataResolve,'function','report fetch pending');
  const logout=h.handlers.get('#logout:click')();
  assert.ok(h.bodyClasses.has('auth-locked'));
  h.state.dataResolve();
  await report;
  assert.equal(h.state.printCount,0,'pending print must not open print dialog');
  assert.equal(h.element('#main').innerHTML,'','old sensitive content must remain erased');
  h.state.logoutResolve();await logout;
 });
 test(dir+' waits for old logout response before starting a new login',async()=>{
  const h=setup(dir);await h.settle();
  const signOut=h.handlers.get('#logout:click')();
  assert.ok(h.bodyClasses.has('auth-locked'));
  assert.equal(typeof h.state.logoutResolve,'function');
  // After logout is clicked, new credentials must not send /api/login
  // until the old Set-Cookie deletion response has settled.
  const loginForm=h.element('#login-form');
  const next=h.handlers.get('#login-form:submit')({
   currentTarget:loginForm,preventDefault(){}
  });
  for(let i=0;i<15;i++)await Promise.resolve();
  assert.equal(h.state.loginCalls,0,'new login must not race the old logout');
  h.state.logoutResolve();
  await signOut;await next;await h.settle();
  assert.equal(h.state.loginCalls,1);
  assert.equal(vm.runInContext('S.me.role',h.ctx),'owner');
  assert.equal(h.element('#auth-overlay').hidden,true);
  assert.ok(!h.bodyClasses.has('auth-locked'),'new login unlocks UI');
 });
}
