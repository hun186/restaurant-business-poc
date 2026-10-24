'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

test('stale approval and replenishment replies cannot modify a later modal (real + demo)',async()=>{
 for(const dir of ['public','vercel-demo']){
  const source=fs.readFileSync(path.join(__dirname,'..',dir,'order-batch-ui.js'),'utf8');
  const approvals=[],stocks=[],notices=[];
  let current=null;
  const modal={
   hidden:true,_html:'',
   get innerHTML(){return this._html;},
   set innerHTML(html){
    this._html=html;
    current=html.includes('id="batch-form"')?makeForm():
      html.includes('order-batch-modal')?makePreview():null;
   },
   get firstElementChild(){return current?.root||null;},
   querySelector(key){
    if(key==='[data-close-batch]')return current?.close||null;
    if(key==='.order-batch-modal')return current?.kind==='preview'?current.root:null;
    return current?.elements?.[key]||null;
   },
   querySelectorAll(key){
    if(key==='.batch-line')return current?.kind==='form'?current.lines:[];
    if(key==='.batch-ingredient')return current?.kind==='form'?
       current.lines.map(line=>line.ingredient):[];
    if(key==='[data-batch-action]')return current?.kind==='preview'?[current.approve]:[];
    return [];
   }
  };
  function makeClose(){
   const el={};
   el.addEventListener=(_event,fn)=>{el.click=fn;};
   return el;
  }
  function makeForm(){
   const lines=[],form={onsubmit:null},close=makeClose();
   return {kind:'form',root:{},lines,form,close,elements:{
    '#batch-form':form,
    '#batch-location':{value:'l1',onchange:null},
    '#batch-add':{onclick:null},
    '#batch-suggest':{onclick:null},
    '#batch-submit':{disabled:false,textContent:'依供應商產生叫貨單'},
    '#batch-lines':{appendChild:r=>lines.push(r),addEventListener(){}}
   }};
  }
  function makePreview(){
   const close=makeClose(),approve={dataset:{batchAction:'order.batch-approve'}};
   approve.addEventListener=(_event,fn)=>{approve.click=fn;};
   return {kind:'preview',root:{},close,approve,elements:{}};
  }
  function makeRow(){
   const ingredient={value:''},qty={value:''};
   const supplier={value:'',title:'',addEventListener(){}};
   return {
    className:'',innerHTML:'',remove(){},
    ingredient,qty,supplier,
    querySelector:key=>({
     '.batch-ingredient':ingredient,
     '.batch-qty':qty,
     '.batch-supplier':supplier,
     '.batch-remove':{onclick:null}
    })[key]
   };
  }
  const S={me:{id:'manager-1',role:'manager'},authEpoch:2};
  const data={number:'POB-'+'A'.repeat(32),location_name:'同一家門市',supplier:'蔬果商',
   rows:[{id:'line-1',ingredient_name:'蔬菜',qty:3,unit:'公斤',status:'requested'}],
   states:['requested'],line_manual_confirmation:null};
  const api=url=>{
   if(url.startsWith('/api/order-batch?'))return Promise.resolve(data);
   if(url==='/api/command')return new Promise((resolve,reject)=>approvals.push({resolve,reject}));
   if(url.includes('entity=stock'))return new Promise((resolve,reject)=>stocks.push({resolve,reject}));
   return Promise.resolve({rows:
    url.includes('entity=locations')?[{id:'l1',name:'同一家門市',active:1}]:
    url.includes('entity=ingredients')?[{id:'i1',name:'蔬菜',unit:'公斤',active:1}]:[]});
  };
  const ctx=vm.createContext({window:{confirm:()=>true},document:{
   querySelector:()=>modal,createElement:makeRow,body:{classList:{contains:()=>false}}
  },S,api,can:()=>true,refresh:async()=>{},toast:s=>notices.push(s),console});
  vm.runInContext(source,ctx,{filename:dir+'/order-batch-ui.js'});
  const open=()=>ctx.window.OrderBatchUI.start();
  const fillDraft=(quantity,supplier)=>{
   assert.equal(current.kind,'form');
   const row=current.lines[0];row.ingredient.value='i1';
   row.qty.value=String(quantity);row.supplier.value=supplier;
  };
  await ctx.window.OrderBatchUI.preview(data.number);
  assert.equal(current.kind,'preview');
  const previous=current;
  const approving=previous.approve.click();
  assert.equal(approvals.length,1);
  previous.close.click();
  await open();fillDraft(19,'NEW-DRAFT');
  const replacement=current;
  approvals[0].resolve({ok:true});
  await approving;
  assert.equal(modal.hidden,false,dir+': stale approval closed the new form');
  assert.equal(current,replacement,dir+': stale approval replaced the new form');
  assert.equal(current.lines[0].qty.value,'19');
  assert.equal(current.lines[0].supplier.value,'NEW-DRAFT');

  // Another stale action rejects after a later form replaces its preview.
  await ctx.window.OrderBatchUI.preview(data.number);
  const oldPreview=current;
  const rejectAction=oldPreview.approve.click();
  oldPreview.close.click();
  await open();fillDraft(24,'NEWER-DRAFT');
  const newest=current;
  approvals[1].reject(Error('old approval rejected'));
  await rejectAction;
  assert.equal(modal.hidden,false);
  assert.equal(current,newest);
  assert.equal(current.lines[0].qty.value,'24');
  assert.ok(!notices.some(msg=>msg.includes('old approval rejected')));

  const previousForm=current;
  const suggestion=previousForm.elements['#batch-suggest'].onclick();
  assert.equal(stocks.length,1);
  previousForm.close.click();
  await open();fillDraft(31,'USER-SELECTED');
  const fresh=current;
  stocks[0].resolve({rows:[{location_id:'l1',ingredient_id:'i1',on_hand:0,min_stock:7}]});
  await suggestion;
  assert.equal(current,fresh);
  assert.equal(current.lines[0].ingredient.value,'i1');
  assert.equal(current.lines[0].qty.value,'31',dir+': previous suggestion rewrote new quantity');
  assert.equal(current.lines[0].supplier.value,'USER-SELECTED');
  const liveSuggestion=fresh.elements['#batch-suggest'].onclick();
  assert.equal(stocks.length,2);
  stocks[1].resolve({rows:[{location_id:'l1',ingredient_id:'i1',on_hand:0,min_stock:7}]});
  await liveSuggestion;
  assert.equal(current.lines[0].qty.value,'31',dir+': own replenishment must respect manual selection');
 }
});
