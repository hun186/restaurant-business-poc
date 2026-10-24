'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

function loginHarness(source,loginOk=true){
 const handlers=new Map(),elements=new Map();
 function element(selector){
  if(!elements.has(selector)){
   const obj={hidden:true,textContent:'',innerHTML:'',style:{},resetCount:0,
    classList:{add(){},remove(){},toggle(){}},
    addEventListener(event,fn){handlers.set(selector+':'+event,fn);},
    reset(){this.resetCount++;}};
   elements.set(selector,obj);
  }
  return elements.get(selector);
 }
 const form=element('#login-form');
 const document={querySelector:element,querySelectorAll:()=>[]};
 let authenticated=false,loginCalls=0;
 const reply=(status,json)=>({ok:status>=200&&status<300,status,json:async()=>json});
 const fetch=async (url)=>{
  if(url==='/api/login'){
   loginCalls++;
   if(!loginOk)return reply(401,{error:'帳號或密碼錯誤'});
   authenticated=true;return reply(200,{ok:true});
  }
  if(url==='/api/me')
   return authenticated?reply(200,{user:{id:'owner1',role:'owner',display_name:'示範業主',locations:[]},csrf:'csrf'}):
    reply(401,{error:'請先登入'});
  if(url==='/api/overview')return reply(200,{overview:{todo:0,late:0,low:0,orders:0,repairs:0,trainingPending:0}});
  throw Error('Unexpected request: '+url);
 };
 class FakeFormData{
  constructor(target){assert.equal(target,form,'capture the live form before await');}
  *[Symbol.iterator](){yield ['username','owner'];yield ['password','example-valid-password'];}
 }
 const ctx=vm.createContext({document,window:{confirm:()=>true},fetch,FormData:FakeFormData,
  Date,URL,console,setTimeout,clearTimeout});
 vm.runInContext(source,ctx,{filename:'app.js'});
 const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 return {handlers,form,element,settle,get loginCalls(){return loginCalls}};
}
for(const filename of ['public/app.js','vercel-demo/app.js']){
 test(filename+' successful login does not access event.currentTarget after await',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
  const h=loginHarness(source);
  await h.settle();
  assert.equal(h.element('#auth-overlay').hidden,false,'unauthenticated page shows login');
  const submit=h.handlers.get('#login-form:submit');
  assert.equal(typeof submit,'function');
  const event={currentTarget:h.form,preventDefault(){}};
  const promise=submit(event);
  // Native Event.currentTarget is reset after synchronous dispatch.
  event.currentTarget=null;
  await promise;await h.settle();
  assert.equal(h.loginCalls,1);
  assert.equal(h.form.resetCount,1,'clear the captured form only after success');
  assert.equal(h.element('#login-error').textContent,'','no erroneous login error');
  assert.equal(h.element('#auth-overlay').hidden,true,'signed-in UI becomes visible');
 });
 test(filename+' unsuccessful login leaves form values and reports authentication failure',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'..',filename),'utf8');
  const h=loginHarness(source,false);
  await h.settle();
  const event={currentTarget:h.form,preventDefault(){}};
  const p=h.handlers.get('#login-form:submit')(event);event.currentTarget=null;
  await p;await h.settle();
  assert.equal(h.loginCalls,1);
  assert.equal(h.form.resetCount,0);
  assert.equal(h.element('#login-error').textContent,'帳號或密碼錯誤');
  assert.equal(h.element('#auth-overlay').hidden,false);
 });
}
