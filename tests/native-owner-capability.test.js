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


test('Owner account capability uses account-specific backend authorization, not business gates',async()=>{
 const {nativeOwnerCapability}=await capability;
 const ready=nativeOwnerCapability({view:'accounts',role:'owner',account:true});
 assert.equal(ready.pageLabel,'帳號管理・可新增');
 assert.equal(ready.pageWritable,true);
 assert.equal(ready.systemLabel,'帳號新增已啟用');
 const closed=nativeOwnerCapability({view:'accounts',role:'owner',account:false,
  task:true,order:true});
 assert.equal(closed.pageLabel,'帳號管理・僅檢視');
 assert.equal(closed.pageWritable,false);
 for(const role of ['staff','manager',null]){
  assert.equal(nativeOwnerCapability({view:'accounts',role,account:true}).pageWritable,false);
 }
 for(const page of ['overview','shifts','training_courses']){
  assert.equal(nativeOwnerCapability({view:page,role:'owner',account:true}).pageWritable,false);
 }
});
test('Account capability only updates from authenticated independent D1 grants',()=>{
 const js=asset('owner-app.js'),ui=asset('native-account-management-ui.mjs');
 assert.match(js,/accountWriteEnabled=false;accountStatusWriteEnabled=false;accountRoleWriteEnabled=false;syncView\(\)/);
 assert.match(js,/onCapabilityChange:flags=>\{/);
 assert.match(js,/accountWriteEnabled=flags\?\.create===true/);
 assert.match(js,/accountStatusWriteEnabled=flags\?\.status===true/);
 assert.match(js,/accountRoleWriteEnabled=flags\?\.role===true/);
 assert.match(js,/account:accountWriteEnabled,accountStatus:accountStatusWriteEnabled/);
 assert.match(js,/accountRole:accountRoleWriteEnabled/);
 assert.match(ui,/create:data.can_create===true/);
 assert.match(ui,/status:data.can_manage_status===true/);
 assert.match(ui,/role:data.can_manage_role===true/);
 assert.match(ui,/onCapabilityChange,offset:newOffset/);
 for(const expr of ['role=null;accountWriteEnabled=false;accountStatusWriteEnabled=false',
   'role=me.user.role;accountWriteEnabled=false;accountStatusWriteEnabled=false',
   'authEpoch++;csrf=null;accountWriteEnabled=false;accountStatusWriteEnabled=false'])
  assert(js.includes(expr),'Account capabilities must clear with auth: '+expr);
});

test('account pagination fails closed for all three grants before next page',()=>{
 const s=asset('native-account-management-ui.mjs'),i=s.indexOf('const navigate=async newOffset=>{'),
  j=s.indexOf("previous.addEventListener('click'",i);
 assert(i>=0&&j>i);
 const block=s.slice(i,j);
 assert.match(block,/onCapabilityChange\(null\)/);
 assert(block.indexOf('onCapabilityChange(null)')<block.indexOf('await renderOwnerAccounts'));
});

test('independent Owner account grants never leave an authorized account page falsely read-only',async()=>{
 const {nativeOwnerCapability}=await capability;
 for(let mask=0;mask<8;mask++){
  const input={view:'accounts',role:'owner',account:Boolean(mask&1),
   accountStatus:Boolean(mask&2),accountRole:Boolean(mask&4)};
  const a=nativeOwnerCapability(input);
  assert.equal(a.pageWritable,mask!==0,'mask '+mask);
  assert.equal(a.systemWritable,mask!==0,'mask '+mask);
  assert.equal(a.pageLabel,mask===0?'帳號管理・僅檢視':
    mask===1?'帳號管理・可新增':
    (mask&1)?'帳號管理・可新增及管理':'帳號管理・可管理','mask '+mask);
  assert.equal(a.description.includes('可建立員工與主管帳號。'),Boolean(mask&1));
  assert.equal(a.description.includes('可停用／啟用'),Boolean(mask&2));
  assert.equal(a.description.includes('可調整員工與主管角色'),Boolean(mask&4));
  assert(Object.isFrozen(a));
  for(const role of ['manager','staff',null]){
   const unauthorized=nativeOwnerCapability({...input,role});
   assert.equal(unauthorized.pageWritable,false,'non-Owner '+mask);
   assert.equal(unauthorized.pageLabel,'帳號管理・僅檢視');
  }
 }
 for(const v of ['overview','shifts','stock','training_courses']){
  const a=nativeOwnerCapability({view:v,role:'owner',account:true,
   accountStatus:true,accountRole:true});
  assert.equal(a.pageWritable,false,'account grants are not business writes');
 }
});

test('Native Owner audit is a distinct read-only page even when all write gates are active',async()=>{
 const {nativeOwnerCapability}=await capability;
 for(const role of ['owner','manager','staff',null]){
  const x=nativeOwnerCapability({view:'audit_logs',role,task:true,
   catalog:true,order:true,stocktake:true,repair:true,
   account:true,accountStatus:true,accountRole:true});
  assert.equal(x.pageWritable,false);
  assert.equal(x.pageLabel,'安全稽核・僅檢視');
  assert.match(x.description,/只有業主可檢視/);
  assert(Object.isFrozen(x));
 }
 const html=asset('owner-app.html'),js=asset('owner-app.js');
 assert.match(html,/data-view="audit_logs" hidden/);
 assert.match(js,/if\(view==='audit_logs'\)/);
 assert.match(js,/renderOwnerAudit\(\{pane:\$\('content'\),api,role/);
 assert.match(js,/onlyOwner of \['accounts','audit_logs'\]/);
});

test('Grant editor capability only enables from the authenticated backend Owner flag',async()=>{
 const {nativeOwnerCapability}=await capability;
 const active=nativeOwnerCapability({view:'accounts',role:'owner',accountGrants:true});
 assert.equal(active.pageWritable,true);
 assert.equal(active.systemWritable,true);
 assert.equal(active.pageLabel,'帳號管理・可管理');
 assert.match(active.description,/可逐一調整員工門市授權/);
 for(const role of ['staff','manager',null]){
  const denied=nativeOwnerCapability({view:'accounts',role,accountGrants:true});
  assert.equal(denied.pageWritable,false);
  assert.equal(denied.pageLabel,'帳號管理・僅檢視');
 }
 const create=nativeOwnerCapability({view:'accounts',role:'owner',account:true,accountGrants:true});
 assert.equal(create.pageLabel,'帳號管理・可新增及管理');
 const other=nativeOwnerCapability({view:'overview',role:'owner',accountGrants:true});
 assert.equal(other.pageWritable,false,'account grant is not business write access');
 const js=asset('owner-app.js'),ui=asset('native-account-management-ui.mjs');
 assert(js.includes('accountGrantWriteEnabled=flags?.grants===true'));
 assert(js.includes('accountGrants:accountGrantWriteEnabled'));
 assert(js.includes('accountRoleWriteEnabled=false;accountGrantWriteEnabled=false'));
 assert(ui.includes('grants:data.can_manage_grants===true'));
 assert(ui.includes('data.can_manage_grants===true&&user.active===true'));
 assert(ui.includes("api('/api/accounts/grant'"));
 assert(!ui.includes('innerHTML'));
});
