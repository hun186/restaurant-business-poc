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
