'use strict';
// Exercise the production Owner password-change form with a synthetic DOM.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../vercel-demo/owner-app.js'),'utf8');
const begin=source.indexOf('function renderPasswordChange(marker){');
const end=source.indexOf('async function refresh(){',begin);
assert(begin>=0&&end>begin,'real Owner password-change handler must exist');
const production=source.slice(begin,end);
function fixture(){
 const pending=[],notices=[],logins=[],requests=[];
 function node(kind,text=''){
  const n={kind,textContent:String(text),children:[],handlers:{},value:'',disabled:false,resetCount:0};
  n.append=(...children)=>{n.children.push(...children);};
  n.addEventListener=(type,listener)=>{n.handlers[type]=listener;};
  n.reset=()=>{
   n.resetCount++;
   for(const child of n.children)
    for(const control of child.children||[])
     if(control.kind==='input')control.value='';
  };
  return n;
 }
 const panel=node('section');
 const ctx=vm.createContext({
  authEpoch:2,csrf:'session-one-csrf',revision:5,
  $:id=>{assert.equal(id,'content');return panel;},
  el:node,
  labeledField:(caption,control)=>{const label=node('label',caption);label.append(control);return label;},
  say:(message,error)=>notices.push({message,error}),
  showLogin:message=>logins.push(message),
  api:(url,opts)=>{
   requests.push({url,opts});
   return new Promise((resolve,reject)=>pending.push({resolve,reject}));
  }
 });
 ctx.liveAuth=(epoch,token)=>epoch===ctx.authEpoch&&token===ctx.csrf;
 vm.runInContext(production+'\nthis.renderPasswordChange=renderPasswordChange;',ctx);
 ctx.renderPasswordChange(5);
 const form=panel.children.find(n=>n.kind==='form');
 assert(form,'password-change form missing');
 const inputs=Object.fromEntries(form.children.flatMap(n=>n.children||[])
  .filter(n=>n.kind==='input').map(n=>[n.name,n]));
 assert.deepEqual(Object.keys(inputs).sort(),
  ['confirm_password','current_password','new_password']);
 function submit(){
  inputs.current_password.value='old-synthetic-password-123';
  inputs.new_password.value='new-synthetic-password-123';
  inputs.confirm_password.value='new-synthetic-password-123';
  return form.handlers.submit({preventDefault(){}});
 }
 return {ctx,panel,form,inputs,pending,requests,notices,logins,submit};
}
test('HTTP 200 without code OK must NOT announce successful Owner password change',async()=>{
 const f=fixture(),action=f.submit();
 assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].url,'/api/password/change');
 f.pending.shift().resolve({code:'E_NOT_UPDATED'});
 await action;
 assert.equal(f.logins.length,0);
 assert.equal(f.form.resetCount,0);
 assert(f.notices.some(x=>x.error===true&&/未確認密碼已更新/.test(x.message)));
 for(const key of ['current_password','new_password','confirm_password'])
  assert.equal(f.inputs[key].value,'');
});
test('code OK alone in active session confirms password update and clears form',async()=>{
 const f=fixture(),action=f.submit();
 f.pending.shift().resolve({code:'OK'});
 await action;
 assert.equal(f.logins.length,1);
 assert.equal(f.form.resetCount,1);
 assert(f.notices.some(x=>/密碼已更新/.test(x.message)));
});
test('a stale password-change success cannot reset a newer session or announce success',async()=>{
 const f=fixture(),action=f.submit();
 f.ctx.authEpoch=3;f.ctx.csrf='another-session-csrf';f.ctx.revision=6;
 f.pending.shift().resolve({code:'OK'});
 await action;
 assert.equal(f.logins.length,0);
 assert.equal(f.form.resetCount,0);
 assert.equal(f.notices.some(x=>/密碼已更新/.test(x.message)),false);
});
test('password-change response assertion keeps Demo and storage APIs excluded',()=>{
 assert.match(production,/if\(result\?\.code!=='OK'\)/);
 assert.match(production,/if\(!liveAuth\(epoch,token\)\)return/);
 assert.doesNotMatch(production,/mock\.js|localStorage|sessionStorage/);
});
