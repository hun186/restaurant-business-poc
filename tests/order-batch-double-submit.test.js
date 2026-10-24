'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

test('batch create stays single-flight under rapid repeat submissions; failed requests may retry (real + demo)',async()=>{
 for(const dir of ['public','vercel-demo']){
  const source=fs.readFileSync(path.join(__dirname,'..',dir,'order-batch-ui.js'),'utf8');
  const requests=[],notices=[];
  let refreshCount=0;
  const loc={value:'l1',onchange:null},form={onsubmit:null};
  const submit={disabled:false,textContent:'依供應商產生叫貨單'};
  const lines=[];
  function row(){
   const ingredient={value:''},quantity={value:''},supplier={value:'',title:'',addEventListener(){}};
   const remove={onclick:null};
   return {
    className:'',innerHTML:'',remove(){},
    querySelector:key=>({
     '.batch-ingredient':ingredient,'.batch-qty':quantity,
     '.batch-supplier':supplier,'.batch-remove':remove
    })[key],
    ingredient,quantity,supplier
   };
  }
  const elements={
   '#batch-location':loc,
   '#batch-lines':{appendChild:r=>lines.push(r),addEventListener(){}},
   '#batch-add':{onclick:null},
   '#batch-suggest':{onclick:null},
   '#batch-form':form,
   '#batch-submit':submit
  };
  const modal={
   hidden:true,innerHTML:'',
   querySelector:key=>key==='[data-close-batch]'?{addEventListener(){}}:(elements[key]||null),
   querySelectorAll:key=>key==='.batch-line'?lines:[]
  };
  const document={
   body:{classList:{contains:()=>false}},
   querySelector:()=>modal,createElement:()=>row()
  };
  const S={me:{id:'staff-1',role:'staff'},authEpoch:3};
  const api=(url,method,payload)=>{
   if(url==='/api/command'){
    return new Promise((resolve,reject)=>requests.push({method,payload,resolve,reject}));
   }
   return Promise.resolve({rows:
    url.includes('entity=locations')?[{id:'l1',name:'甲店',active:1}]:
    url.includes('entity=ingredients')?[{id:'i1',name:'蘿蔔',unit:'公斤',active:1}]:[]});
  };
  const context=vm.createContext({
   S,api,document,window:{},toast:x=>notices.push(x),
   refresh:async()=>{refreshCount++;throw Error('temporary list refresh failure');},
   console
  });
  vm.runInContext(source,context,{filename:dir+'/order-batch-ui.js'});
  await context.window.OrderBatchUI.start();
  assert.equal(lines.length,1);
  lines[0].ingredient.value='i1';
  lines[0].quantity.value='12';
  lines[0].supplier.value='蔬菜商';
  const event={preventDefault(){}};
  const first=form.onsubmit(event);
  const doubleClick=form.onsubmit(event);
  await doubleClick;
  assert.equal(requests.length,1,dir+' must create just one API request before resolution');
  assert.equal(requests[0].payload.action,'order.batch-create');
  assert.equal(requests[0].payload.data.location_id,'l1');
  assert.equal(requests[0].payload.data.items.length,1);
  assert.equal(submit.disabled,true,dir+' submit button must be disabled while awaiting API');
  requests[0].reject(Error('temporary service failure'));
  await first;
  assert.equal(submit.disabled,false,dir+' submit button should allow retry after failed request');
  assert.ok(notices.some(x=>x.includes('temporary service failure')));

  const retry=form.onsubmit(event);
  const triplicate=form.onsubmit(event);
  await triplicate;
  assert.equal(requests.length,2,dir+' must only retry once');
  assert.equal(submit.disabled,true);
  requests[1].resolve({result:{groups:[{number:'POB-ABC'}]}});
  await retry;
  assert.equal(refreshCount,1);
  assert.equal(modal.hidden,true,dir+' accepted order closes the form');
  assert.equal(submit.disabled,true,dir+' must never re-enable after successful creation');
  await form.onsubmit(event);
  assert.equal(requests.length,2,dir+' refresh failure cannot cause another accepted order');
  assert.ok(notices.some(x=>x.includes('叫貨單已建立，但列表更新失敗')));
 }
});


test('older batch create cannot erase or alter a newer modal after cancel/reopen (real + demo)',async()=>{
 for(const dir of ['public','vercel-demo']){
  const source=fs.readFileSync(path.join(__dirname,'..',dir,'order-batch-ui.js'),'utf8');
  const requests=[],notices=[];
  let current=null,close;
  const modal={
   hidden:true,_html:'',
   set innerHTML(value){
    this._html=value;
    current=value?newForm():null;
   },
   get innerHTML(){return this._html;},
   querySelector(key){
    if(key==='[data-close-batch]')return {addEventListener(_type,cb){close=cb;}};
    return current?.elements[key]||null;
   },
   querySelectorAll(key){return key==='.batch-line'?(current?.lines||[]):[];}
  };
  function newForm(){
   const lines=[],submit={disabled:false,textContent:'依供應商產生叫貨單'};
   const form={onsubmit:null};
   const elements={
    '#batch-form':form,
    '#batch-submit':submit,
    '#batch-location':{value:'l1',onchange:null},
    '#batch-lines':{appendChild:r=>lines.push(r),addEventListener(){}},
    '#batch-add':{onclick:null},
    '#batch-suggest':{onclick:null}
   };
   return {lines,form,submit,elements};
  }
  function row(){
   const ingredient={value:''},quantity={value:''};
   const supplier={value:'',title:'',addEventListener(){}};
   return {
    innerHTML:'',className:'',remove(){},
    querySelector:key=>({
     '.batch-ingredient':ingredient,'.batch-qty':quantity,
     '.batch-supplier':supplier,'.batch-remove':{onclick:null}
    })[key],
    ingredient,quantity,supplier
   };
  }
  const S={me:{id:'employee-1'},authEpoch:9};
  const api=(url,method,payload)=>{
   if(url==='/api/command')return new Promise((resolve,reject)=>requests.push({payload,resolve,reject}));
   return Promise.resolve({rows:
    url.includes('entity=locations')?[{id:'l1',name:'A',active:1}]:
    url.includes('entity=ingredients')?[{id:'i1',name:'菜',unit:'公斤',active:1}]:[]});
  };
  const document={
   body:{classList:{contains:()=>false}},
   querySelector:()=>modal,
   createElement:row
  };
  const ctx=vm.createContext({window:{},document,S,api,console,
   toast:v=>notices.push(v),refresh:async()=>{}});
  vm.runInContext(source,ctx,{filename:dir+'/order-batch-ui.js'});
  const open=async(qty,supplier)=>{
   await ctx.window.OrderBatchUI.start();
   const active=current;
   assert.equal(active.lines.length,1);
   active.lines[0].ingredient.value='i1';
   active.lines[0].quantity.value=String(qty);
   active.lines[0].supplier.value=supplier;
   return active;
  };
  const event={preventDefault(){}};
  const firstForm=await open(1,'原本供應商');
  const oldRequest=firstForm.form.onsubmit(event);
  assert.equal(requests.length,1);
  close();
  assert.equal(modal.hidden,true);
  const nextForm=await open(9,'新供應商');
  assert.notEqual(nextForm.form,firstForm.form);
  assert.equal(modal.hidden,false);
  // An obsolete success must not clear the new draft or make its button usable.
  requests[0].resolve({result:{groups:[{number:'POB-old'}]}});
  await oldRequest;
  assert.equal(modal.hidden,false,dir+': stale success closed the next modal');
  assert.equal(modal.querySelector('#batch-form'),nextForm.form);
  assert.equal(current.lines[0].quantity.value,'9');
  assert.equal(current.lines[0].supplier.value,'新供應商');
  assert.equal(nextForm.submit.disabled,false);

  // A stale rejection must likewise leave the next form's pending state untouched.
  const nextRequest=nextForm.form.onsubmit(event);
  assert.equal(requests.length,2);
  assert.equal(nextForm.submit.disabled,true);
  close();
  const thirdForm=await open(11,'第三供應商');
  requests[1].reject(Error('old request failed'));
  await nextRequest;
  assert.equal(modal.hidden,false);
  assert.equal(modal.querySelector('#batch-form'),thirdForm.form);
  assert.equal(current.lines[0].quantity.value,'11');
  assert.equal(thirdForm.submit.disabled,false);
  assert.ok(!notices.some(x=>x.includes('old request failed')),
    dir+': obsolete errors must not intrude into the new draft');
  const newestRequest=thirdForm.form.onsubmit(event);
  assert.equal(requests.length,3);
  requests[2].resolve({result:{groups:[{number:'POB-new'}]}});
  await newestRequest;
  assert.equal(modal.hidden,true,dir+': current request should still close its own modal');
 }
});
