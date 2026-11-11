'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const asset=name=>fs.readFileSync(path.join(root,'vercel-demo',name),'utf8');
const capability=import('../vercel-demo/native-owner-capability.mjs');

test('overview reports active system writes without presenting the dashboard as a write page',async()=>{
 const {nativeOwnerCapability}=await capability;
 const actual=nativeOwnerCapability({view:'overview',role:'owner',task:true,
  catalog:true,order:true,stocktake:true,repair:true});
 assert.equal(actual.systemLabel,'正式營運模式');
 assert.equal(actual.systemWritable,true);
 assert.equal(actual.pageLabel,'總覽看板・僅檢視');
 assert.equal(actual.pageWritable,false);
 assert.match(actual.description,/今日總覽只供檢視/);
 assert.match(actual.description,/左側對應功能/);
 assert(Object.isFrozen(actual));
});

test('login-only stays clearly different from writes enabled',async()=>{
 const {nativeOwnerCapability}=await capability;
 const actual=nativeOwnerCapability({view:'overview',role:'owner'});
 assert.equal(actual.systemLabel,'登入服務已啟用');
 assert.equal(actual.systemWritable,false);
 assert.equal(actual.pageLabel,'總覽看板・僅檢視');
 assert.equal(actual.pageWritable,false);
});

test('each authorized write page uses only its corresponding backend gate',async()=>{
 const {nativeOwnerCapability}=await capability;
 const cases=[
  {view:'tasks',key:'task'},
  {view:'locations',key:'catalog'},
  {view:'ingredients',key:'catalog'},
  {view:'purchase_orders',key:'order'},
  {view:'stocktakes',key:'stocktake'},
  {view:'repairs',key:'repair'}
 ];
 for(const {view,key} of cases){
  const active=nativeOwnerCapability({view,role:'owner',[key]:true});
  assert.equal(active.pageWritable,true,view+' should be writable');
  assert.equal(active.pageLabel,'本頁操作已啟用');
  assert.equal(active.systemWritable,true);
  const different=nativeOwnerCapability({view,role:'owner',
   [key==='task'?'catalog':'task']:true});
  if(view==='locations'||view==='ingredients'||view==='tasks'){
   assert.equal(different.pageWritable,false,'unrelated gate: '+view);
  }
 }
 for(const view of ['overview','stock','shifts','training_courses']){
  const data=nativeOwnerCapability({view,role:'owner',task:true,catalog:true,
   order:true,stocktake:true,repair:true});
  assert.equal(data.pageWritable,false,view+' must be read-only');
 }
});

test('catalog write label remains Owner-only and does not authorize actions',async()=>{
 const {nativeOwnerCapability}=await capability;
 for(const role of ['manager','staff',null]){
  const data=nativeOwnerCapability({view:'locations',role,catalog:true});
  assert.equal(data.systemWritable,true,'gate might be active for Owner');
  assert.equal(data.pageWritable,false,'non-Owner cannot edit catalog');
  assert.equal(data.pageLabel,'本頁僅檢視');
 }
});

test('visible badges are separate, driven by API flags, not persistent browser state',()=>{
 const js=asset('owner-app.js'),html=asset('owner-app.html'),
  css=asset('owner-app.css');
 for(const name of ['operation-mode','capability','capability-detail'])
  assert.match(html,new RegExp('id="'+name+'"'));
 assert.match(html,/總覽看板・僅檢視/);
 assert.doesNotMatch(html,/>唯讀<\/span>/);
 assert.match(js,/import \{nativeOwnerCapability\} from '\.\/native-owner-capability\.mjs'/);
 assert.match(js,/const capability=nativeOwnerCapability\(\{view,role,task:writeEnabled/);
 assert.match(js,/\$\('operation-mode'\)\.textContent=capability\.systemLabel/);
 assert.match(js,/\$\('capability'\)\.textContent=capability\.pageLabel/);
 assert.match(js,/\$\('capability-detail'\)\.textContent=capability\.description/);
 assert.match(js,/catalogWriteEnabled=status\.catalog_write_enabled===true/);
 assert.match(js,/repairWriteEnabled=status\.repair_write_enabled===true/);
 assert.match(css,/\.capability-strip #capability-detail/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|mock\.js/);
});
