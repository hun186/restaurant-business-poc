'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const ui=import('../vercel-demo/native-account-management-ui.mjs');
const cap=import('../vercel-demo/native-owner-capability.mjs');
const ids={owner:'owner-1',staff:'staff-1',manager:'manager-1',disabled:'disabled-1'};
function node(tag){
 const n={tag,children:[],handlers:{},value:'',textContent:'',disabled:false,hidden:false};
 n.append=(...children)=>n.children.push(...children);
 n.replaceChildren=(...children)=>{n.children=[...children];};
 n.setAttribute=(k,v)=>{n[k]=v;};
 n.addEventListener=(k,v)=>{n.handlers[k]=v;};
 return n;
}
const walk=n=>[n,...n.children.flatMap(walk)];
async function fixture(t,{enabled=true,role='owner',confirm=true}={}){
 const oldDoc=global.document,oldConfirm=global.confirm;
 global.document={createElement:node};global.confirm=()=>confirm;
 t.after(()=>{global.document=oldDoc;global.confirm=oldConfirm;});
 const pane=node('main'),notices=[],requests=[],pending=[],authExpired=[],controller=new AbortController();
 let alive=true;
 const users=Object.entries(ids).map(([name,id])=>({id,username:name,display_name:name,
  role:name==='owner'?'owner':name==='manager'?'manager':'staff',active:name!=='disabled',location_ids:[]}));
 const api=async(url,opts)=>{
  if(url==='/api/accounts')return {users,offset:0,has_more:true,next_offset:50,
   can_create:false,can_manage_status:true,can_reset_password:enabled};
  if(url==='/api/data?entity=locations')return {rows:[]};
  requests.push({url,opts});return new Promise((resolve,reject)=>pending.push({resolve,reject}));
 };
 await (await ui).renderOwnerAccounts({pane,api,role,signal:controller.signal,
  notice:(message,error)=>notices.push({message,error}),refresh:async()=>{},live:()=>alive,
  token:'synthetic-csrf',onAuthExpired:m=>authExpired.push(m)});
 const buttons=()=>walk(pane).filter(n=>n.tag==='button'&&n.textContent==='重設密碼');
 function open(which='staff'){
  const b=buttons().find(n=>n['aria-label']==='重設帳號 '+which+' 的密碼');
  assert(b);b.handlers.click();
  const form=walk(pane).find(n=>n.tag==='form'&&walk(n).some(c=>c.name==='currentOwnerPassword'));
  assert(form);
  const fields=Object.fromEntries(walk(form).filter(n=>n.tag==='input').map(n=>[n.name,n]));
  fields.currentOwnerPassword.value='synthetic-owner-current-123';
  fields.newPassword.value=fields.confirmNewPassword.value='synthetic-staff-new-123';
  return {form,fields,submit:()=>form.handlers.submit({preventDefault(){}})};
 }
 return {pane,notices,requests,pending,authExpired,buttons,open,controller,stale:()=>{alive=false;}};
}
const cleared=fields=>Object.values(fields).forEach(n=>assert.equal(n.value,''));
test('reset controls only for active staff/manager and explicit authenticated capability',async t=>{
 const f=await fixture(t);assert.deepEqual(f.buttons().map(n=>n['aria-label']),
 ['重設帳號 staff 的密碼','重設帳號 manager 的密碼']);
 const c=(await cap).nativeOwnerCapability;
 assert.equal(c({view:'accounts',role:'owner',accountPasswordReset:true}).pageWritable,true);
 assert.equal(c({view:'accounts',role:'staff',accountPasswordReset:true}).pageWritable,false);
});
test('missing permission hides all reset controls',async t=>{
 const f=await fixture(t,{enabled:false});assert.equal(f.buttons().length,0);
});
test('clears fields before POST, locks other account actions, rejects duplicate submit and confirms only OK',async t=>{
 const f=await fixture(t),form=f.open(),p=form.submit();
 cleared(form.fields);assert.equal(f.requests.length,1);
 assert.equal(f.requests[0].url,'/api/accounts/password-reset');
 assert.deepEqual(JSON.parse(f.requests[0].opts.body),{targetUserId:ids.staff,
  currentOwnerPassword:'synthetic-owner-current-123',newPassword:'synthetic-staff-new-123'});
 assert.equal(f.requests[0].opts.headers['X-CSRF-Token'],'synthetic-csrf');
 assert(walk(f.pane).filter(n=>n.tag==='button'&&['重設密碼','停用','下一頁'].includes(n.textContent)).every(n=>n.disabled));
 await form.submit();assert.equal(f.requests.length,1);
 f.pending[0].resolve({code:'OK'});await p;
 assert(f.notices.some(n=>n.message.includes('員工密碼已重設')));
 assert(f.buttons().every(n=>!n.disabled));
});
test('unconfirmed response latches reset actions; no raw backend error displayed or resend',async t=>{
 const f=await fixture(t),form=f.open(),p=form.submit();
 f.pending[0].reject(Object.assign(Error('synthetic-secret-server-text'),{status:503}));
 await p;cleared(form.fields);
 assert(f.buttons().every(n=>n.disabled));
 assert(f.notices.some(n=>n.error&&n.message.includes('不要直接重送')));
 assert(!JSON.stringify(f.notices).includes('synthetic-secret-server-text'));
 f.buttons()[0].handlers.click();assert.equal(f.requests.length,1);
 assert(!walk(f.pane).some(n=>n.name==='currentOwnerPassword'));
});
test('cancel, switched editor and abort clear all detached password fields',async t=>{
 const f=await fixture(t),a=f.open(),b=f.open('manager');cleared(a.fields);
 walk(b.form).find(n=>n.textContent==='取消').handlers.click();cleared(b.fields);
 const c=f.open();f.controller.abort();cleared(c.fields);
 await c.submit();assert.equal(f.requests.length,0);
});
test('stale response cannot announce success to another page',async t=>{
 const f=await fixture(t),form=f.open(),p=form.submit();f.stale();f.controller.abort();
 f.pending[0].resolve({code:'OK'});await p;cleared(form.fields);
 assert(!f.notices.some(n=>n.message.includes('員工密碼已重設')));
});
test('mismatched password cannot send; explicit wrong Owner password clears without success',async t=>{
 const f=await fixture(t),a=f.open();a.fields.confirmNewPassword.value='not-same';
 await a.submit();cleared(a.fields);assert.equal(f.requests.length,0);
 const b=f.open(),p=b.submit();f.pending[0].reject(Object.assign(Error('private'),{status:403,code:'E_INVALID_CURRENT_PASSWORD'}));await p;
 cleared(b.fields);assert(f.buttons().every(n=>!n.disabled));
 assert(f.notices.some(n=>n.message.includes('業主目前密碼不正確')));
});
