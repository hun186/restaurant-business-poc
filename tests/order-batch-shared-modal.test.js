'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
test('legacy single-item form invalidates pending batch preview (real and demo)',async()=>{
 for(const dir of ['public','vercel-demo']){
  const native=fs.readFileSync(path.join(__dirname,'..',dir,'app.js'),'utf8');
  const batch=fs.readFileSync(path.join(__dirname,'..',dir,'order-batch-ui.js'),'utf8');
  const beginning=native.indexOf('function invalidateModalOpens(root)');
  const ending=native.indexOf('\nasync function operation(',beginning);
  assert.ok(beginning!==-1&&ending>beginning);
  const root={hidden:true,innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
  const pending=[];
  const S={me:{id:'owner'},authEpoch:3};
  const elements={
   '#modal-root':root,
   '#cancel-modal':{addEventListener(){}},
   '#record-form':{addEventListener(){}}
  };
  const ctx=vm.createContext({
   S,window:{},document:{querySelector:()=>root,body:{classList:{contains:()=>false}}},
   $:k=>elements[k],
   api:url=>new Promise((resolve,reject)=>pending.push({url,resolve,reject})),
   getLists:async()=>{},def:{'order.create':{title:'建立叫貨申請',fields:[]}},
   E:s=>String(s),inputHtml:()=>'',toast:()=>{},console
  });
  vm.runInContext(batch+'\n'+native.slice(beginning,ending),ctx);
  const old=ctx.window.OrderBatchUI.preview('old-order');
  assert.equal(pending.length,1);
  await vm.runInContext("showForm('order.create')",ctx);
  assert.match(root.innerHTML,/record-form/);
  const draft=root.innerHTML;
  pending[0].resolve({number:'old-order',states:['requested'],rows:[],supplier:'S',location_name:'L'});
  await old;
  assert.equal(root.innerHTML,draft,dir+' must preserve new legacy order draft');
  assert.equal(root.hidden,false);
 }
});
