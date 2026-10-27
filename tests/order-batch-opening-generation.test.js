'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('latest create/preview opening wins over older pending GET (real + demo)',async()=>{
 for(const dir of ['public','vercel-demo']){
  const source=fs.readFileSync(path.join(__dirname,'..',dir,'order-batch-ui.js'),'utf8');
  const suppliers=[],previews=[];
  let current;
  const modal={
   hidden:true,_html:'',
   set innerHTML(html){
    this._html=html;
    if(html.includes('id="batch-form"')){
     const lines=[],form={onsubmit:null};
     current={kind:'create',form,lines,elements:{
      '#batch-form':form,
      '#batch-location':{value:'store-1',onchange:null},
      '#batch-add':{onclick:null},
      '#batch-suggest':{onclick:null},
      '#batch-submit':{disabled:false},
      '#batch-lines':{appendChild:r=>lines.push(r),addEventListener(){}}
     }};
    }else if(html.includes('order-batch-modal')){
     current={kind:'preview',root:{},elements:{}};
    }else current=null;
   },
   get innerHTML(){return this._html;},
   querySelector(selector){
    if(selector==='[data-close-batch]')return {addEventListener(){}};
    if(selector==='.order-batch-modal')return current?.kind==='preview'?current.root:null;
    return current?.elements?.[selector]||null;
   },
   querySelectorAll(selector){
    if(selector==='.batch-line')return current?.lines||[];
    if(selector==='[data-batch-action]')return [];
    return [];
   }
  };
  const makeRow=()=>{
   const ingredient={value:''},qty={value:''},supplier={value:'',title:'',addEventListener(){}};
   return {className:'',innerHTML:'',
    querySelector:selector=>({
     '.batch-ingredient':ingredient,
     '.batch-qty':qty,
     '.batch-supplier':supplier,
     '.batch-remove':{onclick:null}
    })[selector],
    ingredient,qty,supplier,remove(){}
   };
  };
  const active={me:{id:'user-1',role:'owner'},authEpoch:5};
  const detail=number=>({
   number,supplier:'原先廠商',location_name:'原先門市',
   states:['requested'],rows:[],line_manual_confirmation:null
  });
  const api=url=>{
   if(url.includes('entity=purchase_supplier_suggestions'))
    return new Promise((resolve,reject)=>suppliers.push({resolve,reject}));
   if(url.startsWith('/api/order-batch?'))
    return new Promise((resolve,reject)=>previews.push({resolve,reject}));
   return Promise.resolve({rows:
    url.includes('entity=locations')?[{id:'store-1',name:'測試店',active:1}]:
    url.includes('entity=ingredients')?[{id:'i1',name:'蔬菜',unit:'公斤',active:1}]:[]});
  };
  const ctx=vm.createContext({
   window:{confirm:()=>true},document:{body:{classList:{contains:()=>false}},
    querySelector:()=>modal,createElement:makeRow},
   S:active,api,can:()=>true,toast:()=>{},console
  });
  vm.runInContext(source,ctx,{filename:dir+'/order-batch-ui.js'});
  const oldPreview=ctx.window.OrderBatchUI.preview('POB-old');
  assert.equal(previews.length,1);
  const newCreate=ctx.window.OrderBatchUI.start();
  await Promise.resolve();
  assert.equal(suppliers.length,1);
  suppliers[0].resolve({rows:[]});
  await newCreate;
  assert.equal(current.kind,'create');
  current.lines[0].ingredient.value='i1';
  current.lines[0].qty.value='23';
  current.lines[0].supplier.value='新草稿廠商';
  const newerForm=current.form;
  previews[0].resolve(detail('POB-old'));
  await oldPreview;
  assert.equal(current.kind,'create',dir+' old preview must not replace new draft');
  assert.equal(current.form,newerForm);
  assert.equal(current.lines[0].qty.value,'23');
  assert.equal(current.lines[0].supplier.value,'新草稿廠商');

  const oldCreate=ctx.window.OrderBatchUI.start();
  await Promise.resolve();
  assert.equal(suppliers.length,2);
  const newPreview=ctx.window.OrderBatchUI.preview('POB-new');
  assert.equal(previews.length,2);
  previews[1].resolve(detail('POB-new'));
  await newPreview;
  assert.equal(current.kind,'preview');
  const newerPanel=current.root;
  const shownHTML=modal.innerHTML;
  suppliers[1].resolve({rows:[]});
  await oldCreate;
  assert.equal(current.kind,'preview',dir+' old create must not replace new preview');
  assert.equal(current.root,newerPanel);
  assert.equal(modal.innerHTML,shownHTML);

  const before=ctx.window.OrderBatchUI.preview('POB-before');
  const after=ctx.window.OrderBatchUI.preview('POB-after');
  assert.equal(previews.length,4);
  previews[3].resolve(detail('POB-after'));
  await after;
  previews[2].resolve(detail('POB-before'));
  await before;
  assert.match(modal.innerHTML,/POB-after/);
  assert.doesNotMatch(modal.innerHTML,/POB-before/);
 }
});
