'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const project=path.join(__dirname,'..');
const grants=import('../vercel-demo/native-account-grant-display.mjs');

test('Owner effective store grants distinguish usable, disabled and unlisted assignments',async()=>{
 const {effectiveStoreGrantLabel:project}=await grants;
 const shops=[
  {id:'A',name:'臺北店',active:1},
  {id:'B',name:'舊店',active:0},
  {id:'C',name:'板橋店',active:1}
 ];
 assert.deepEqual(project({role:'owner',location_ids:[]},shops),
  {text:'全部啟用門市（業主權限）',warning:false,active_count:null});
 assert.deepEqual(project({role:'staff',location_ids:['A','A']},shops),
  {text:'可用：臺北店',warning:false,active_count:1});
 assert.deepEqual(project({role:'manager',location_ids:['A','B','missing']},shops),
  {text:'可用：臺北店；已停用：舊店；未在本次門市清單：1 筆',
   warning:true,active_count:1});
 assert.deepEqual(project({role:'staff',location_ids:['B']},shops),
  {text:'已停用：舊店',warning:true,active_count:0});
 assert.deepEqual(project({role:'staff',location_ids:[]},shops),
  {text:'未設定門市授權',warning:true,active_count:0});
 assert.deepEqual(project({role:'staff',location_ids:['not-in-page']},shops),
  {text:'未在本次門市清單：1 筆',warning:true,active_count:0});
 assert.throws(()=>project({role:'staff',location_ids:null},shops));
 assert.throws(()=>project({role:'staff',location_ids:['x']},[{id:'x',name:'X',active:'unknown'}]));
 assert.throws(()=>project({role:'guest',location_ids:[]},shops));
 assert.throws(()=>project({role:'staff',location_ids:Array(1601).fill('A')},shops));
});
test('Real Owner account list renders safe grant warnings, without granting mutation rights',async t=>{
 class Node{
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.events={};
   this.value='';this.disabled=false;this.hidden=false;this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(e,cb){this.events[e]=cb;}
 }
 const before=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag)};
 t.after(()=>{if(before===undefined)delete globalThis.document;else globalThis.document=before;});
 const {renderOwnerAccounts}=await import('../vercel-demo/native-account-management-ui.mjs');
 const pane=new Node('main'),requests=[],messages=[],caps=[];
 let isLive=true;
 const api=async(url,opts)=>{
  requests.push({url,method:opts?.method||'GET'});
  if(url.startsWith('/api/accounts'))return {
   offset:0,has_more:false,next_offset:null,can_create:false,
   can_manage_status:false,can_manage_role:false,
   users:[
    {id:'owner-1',username:'owner',display_name:'業主',role:'owner',
      active:true,location_ids:[]},
    {id:'staff-1',username:'staff1',display_name:'員工一',role:'staff',
      active:true,location_ids:['A']},
    {id:'staff-2',username:'staff2',display_name:'員工二',role:'staff',
      active:true,location_ids:['B']},
    {id:'mgr-1',username:'manager1',display_name:'主管',role:'manager',
      active:true,location_ids:['A','absent']},
    {id:'inactive-1',username:'former',display_name:'已離職',role:'staff',
      active:false,location_ids:[]}
   ]
  };
  if(url==='/api/data?entity=locations')
   return {rows:[{id:'A',name:'臺北店',active:1},{id:'B',name:'停用店',active:0}]};
  throw Error('unexpected API '+url);
 };
 await renderOwnerAccounts({pane,api,role:'owner',live:()=>isLive,token:'synthetic-token',
  notice:(message)=>messages.push(message),onAuthExpired:()=>{},
  onCapabilityChange:x=>caps.push(x),refresh:async()=>{}});
 const all=[];const visit=node=>{
  all.push(node.textContent);
  for(const child of node.children)visit(child);
 };
 visit(pane);
 const content=all.join(' | ');
 for(const phrase of ['全部啟用門市（業主權限）','可用：臺北店',
  '⚠ 已停用：停用店','⚠ 可用：臺北店；未在本次門市清單：1 筆',
  '本頁有 2 個啟用帳號'])assert(content.includes(phrase),phrase);
 assert.deepEqual(requests.map(x=>x.method),['GET','GET']);
 assert(!content.includes('synthetic-token'),'csrf must never enter UI');
 assert.equal(caps.at(-1).create,false);
 assert.equal(caps.at(-1).status,false);
 assert.equal(caps.at(-1).role,false);
 // Filter is strictly a view of the authenticated current 50-row page:
 // no extra D1 request, no new account permission, no cross-page total.
 const find=(node,predicate)=>{
  if(predicate(node))return node;
  for(const child of node.children){const found=find(child,predicate);if(found)return found;}
  return null;
 };
 const select=find(pane,node=>node.tag==='select'&&
  node.attributes['aria-label']==='篩選本頁帳號');
 const search=find(pane,node=>node.tag==='input'&&
  node.attributes['aria-label']==='搜尋本頁帳號');
 const table=find(pane,node=>node.tag==='table');
 const tbody=find(table,node=>node.tag==='tbody');
 assert(select&&search&&tbody);
 assert.equal(tbody.children.length,5);
 assert.deepEqual(tbody.children.map(row=>row.hidden),[false,false,false,false,false]);
 select.value='grant';select.events.change();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[true,true,false,false,true],
  'only active accounts with questionable store grants');
 select.value='inactive';select.events.change();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[true,true,true,true,false],
  'inactive account remains visible separately, not as an active grant warning');
 select.value='all';select.events.change();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[false,false,false,false,false]);
 search.value='員工二';search.events.input();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[true,true,false,true,true],
  'search is limited to this page and visible name');
 search.value='停用店';search.events.input();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[true,true,false,true,true],
  'already rendered store name can be searched locally');
 select.value='grant';select.events.change();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[true,true,false,true,true],
  'status filter and search term are conjunctive');
 search.value='主管';search.events.input();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[true,true,true,false,true],
  'manager row can be found within the grant-warning subset');
 search.value='';search.events.input();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[true,true,false,false,true]);
 select.value='all';select.events.change();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[false,false,false,false,false]);
 assert.deepEqual(requests.map(x=>x.method),['GET','GET'],
  'filtering cannot issue new network requests or writes');
 const status=find(pane,node=>node.tag==='span'&&
  node.attributes['aria-live']==='polite');
 assert(status.textContent.includes('僅篩選目前分頁'));
 isLive=false;select.value='grant';select.events.change();
 search.value='former';search.events.input();
 assert.deepEqual(tbody.children.map(row=>row.hidden),[false,false,false,false,false],
  'detached or signed-out Owner page controls cannot mutate the displayed table');
 const src=fs.readFileSync(path.join(project,'vercel-demo/native-account-management-ui.mjs'),'utf8');
 assert(!src.includes('innerHTML'));
 assert(src.includes("effectiveStoreGrantLabel(user,stores.rows)"));
});

test('Owner account filter resets on the next server page and never expands scope',async t=>{
 class Node{
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.events={};
   this.attributes={};this.hidden=false;this.disabled=false;this.value='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  addEventListener(name,cb){this.events[name]=cb;}
  setAttribute(name,value){this.attributes[name]=value;}
 }
 const previous=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag)};
 t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 const {renderOwnerAccounts}=await import('../vercel-demo/native-account-management-ui.mjs');
 const pane=new Node('main'),requests=[];
 const api=async url=>{
  requests.push(url);
  if(url==='/api/data?entity=locations')return {rows:[
   {id:'A',name:'正常店',active:1},{id:'B',name:'舊店',active:0}]};
  if(url==='/api/accounts')return {
   offset:0,has_more:true,next_offset:50,can_create:false,
   can_manage_status:false,can_manage_role:false,
   users:Array.from({length:50},(_,i)=>({
    id:'staff-'+i,username:'staff'+i,display_name:'員工'+i,
    role:'staff',active:true,location_ids:[i===5?'B':'A']
   }))
  };
  if(url==='/api/accounts?offset=50')return {
   offset:50,has_more:false,next_offset:null,can_create:false,
   can_manage_status:false,can_manage_role:false,
   users:[{id:'staff-50',username:'staff50',display_name:'員工50',
    role:'staff',active:true,location_ids:['A']}]
  };
  throw Error('Unexpected GET '+url);
 };
 await renderOwnerAccounts({pane,api,role:'owner',live:()=>true,token:'test',
  notice:()=>{},refresh:async()=>{},onAuthExpired:()=>{}});
 const find=(node,tester)=>{
  if(tester(node))return node;
  for(const child of node.children){const found=find(child,tester);if(found)return found;}
  return null;
 };
 const select=find(pane,n=>n.tag==='select');
 let table=find(pane,n=>n.tag==='tbody');
 assert.equal(table.children.length,50);
 select.value='grant';select.events.change();
 assert.equal(table.children.filter(n=>!n.hidden).length,1,'first page only warning');
 const originalSearch=find(pane,n=>n.tag==='input'&&
  n.attributes['aria-label']==='搜尋本頁帳號');
 originalSearch.value='staff5';originalSearch.events.input();
 assert.equal(table.children.filter(n=>!n.hidden).length,1);
 const next=find(pane,n=>n.tag==='button'&&n.textContent==='下一頁');
 assert(next&&!next.disabled);
 await next.events.click();
 const newSelect=find(pane,n=>n.tag==='select'),newTable=find(pane,n=>n.tag==='tbody');
 const newSearch=find(pane,n=>n.tag==='input'&&
  n.attributes['aria-label']==='搜尋本頁帳號');
 assert.notEqual(newSelect,select,'new page is a fresh authenticated projection');
 assert.equal(newSelect.value,'all','filters reset instead of leaking across server pages');
 assert(newSearch&&newSearch!==originalSearch);
 assert.equal(newSearch.value,'','search must not silently carry over to next server page');
 assert.equal(newTable.children.length,1);
 assert.equal(newTable.children[0].hidden,false);
 assert.deepEqual(requests,[
  '/api/accounts','/api/data?entity=locations',
  '/api/accounts?offset=50','/api/data?entity=locations'
 ]);
});

test('Native Owner store-grant editor is hidden until the independent D1 capability',async t=>{
 class Node{
  constructor(tag){this.tag=tag;this.textContent='';this.children=[];this.events={};
   this.attributes={};this.disabled=false;this.hidden=false;this.value='';}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(k,v){this.attributes[k]=v;}
  addEventListener(e,cb){this.events[e]=cb;}
 }
 const saved=globalThis.document,savedConfirm=globalThis.confirm;
 globalThis.document={createElement:tag=>new Node(tag)};
 globalThis.confirm=()=>true;
 t.after(()=>{
  if(saved===undefined)delete globalThis.document;else globalThis.document=saved;
  if(savedConfirm===undefined)delete globalThis.confirm;else globalThis.confirm=savedConfirm;
 });
 const {renderOwnerAccounts}=await import('../vercel-demo/native-account-management-ui.mjs');
 const find=(n,p)=>{
  if(p(n))return n;
  for(const child of n.children){const z=find(child,p);if(z)return z;}
  return null;
 };
 const stores=[{id:'A',name:'總店',active:1},
  {id:'B',name:'第二門市',active:1},{id:'C',name:'停用店',active:0}];
 const original={id:'staff-id',username:'employee1',display_name:'員工',
  role:'staff',active:true,location_ids:['A','C']};
 const owner={id:'owner-id',username:'owner',display_name:'業主',
  role:'owner',active:true,location_ids:[]};
 const manager={id:'manager-id',username:'manager1',display_name:'主管',
  role:'manager',active:true,location_ids:['A']};
 const calls=[],caps=[],messages=[];
 let allowed=false,live=true,refreshes=0,holdGrant=false,resolveGrant,grantResponse={
  code:'OK',user:{id:'staff-id',locationId:'B',assigned:true}};
 const api=async(url,options)=>{
  calls.push({url,options});
  if(url.startsWith('/api/accounts')&&options?.method!=='POST')return {
   users:[owner,original,manager],offset:0,has_more:false,next_offset:null,
   can_create:false,can_manage_status:false,can_manage_role:false,
   can_manage_grants:allowed
  };
  if(url==='/api/data?entity=locations')return {rows:stores};
  if(url==='/api/accounts/grant'){
   if(holdGrant)return new Promise(resolve=>{resolveGrant=resolve;});
   return grantResponse;
  }
  throw Error('unexpected API '+url);
 };
 const launch=async()=>{
  const pane=new Node('main');
  await renderOwnerAccounts({pane,api,role:'owner',live:()=>live,
   token:'synthetic-csrf',notice:x=>messages.push(x),
   onAuthExpired:()=>{throw Error('unexpected auth invalidation');},
   onCapabilityChange:flags=>caps.push(flags),
   refresh:async()=>{refreshes++;}});
  return pane;
 };
 let pane=await launch();
 assert.equal(caps.at(-1).grants,false);
 assert.equal(find(pane,n=>n.tag==='button'&&n.textContent==='調整門市'),null);
 assert.equal(calls.filter(x=>x.options?.method==='POST').length,0);
 allowed=true;pane=await launch();
 assert.equal(caps.at(-1).grants,true);
 const button=find(pane,n=>n.tag==='button'&&n.textContent==='調整門市');
 const managerButton=find(pane,n=>n.tag==='button'&&
  n.attributes['aria-label']==='調整帳號 manager1 的門市授權');
 assert(button&&managerButton,'active staff and manager get per-store actions');
 button.events.click();
 const form=find(pane,n=>n.tag==='form');
 const edit=find(pane,n=>n.tag==='section'&&n.hidden===false);
 assert(form&&edit);
 const select=find(form,n=>n.tag==='select');
 const submit=find(form,n=>n.tag==='button'&&n.type==='submit');
 assert(select&&submit);
 select.value='B';select.events.change();
 assert.equal(submit.textContent,'新增授權');
 await form.events.submit({preventDefault(){}});
 assert.equal(refreshes,1);
 const req=calls.filter(x=>x.url==='/api/accounts/grant');
 assert.equal(req.length,1);
 assert.equal(req[0].options.method,'POST');
 assert.equal(req[0].options.headers['X-CSRF-Token'],'synthetic-csrf');
 assert.deepEqual(JSON.parse(req[0].options.body),{
  action:'assign',expectedAssigned:false,expectedRole:'staff',
  locationId:'B',targetUserId:'staff-id'
 });
 assert(!JSON.stringify(req).includes('password_hash'));
 // Unassigning an obsolete, disabled store is allowed to reach the backend,
 // where independent RBAC + last-active-location guarantees remain final.
 button.events.click();
 const nextForm=find(edit,n=>n.tag==='form'),nextSelect=find(nextForm,n=>n.tag==='select');
 nextSelect.value='C';nextSelect.events.change();
 const nextSubmit=find(nextForm,n=>n.tag==='button'&&n.type==='submit');
 assert.equal(nextSubmit.textContent,'移除授權');
 grantResponse={code:'OK',user:{id:'staff-id',locationId:'C',assigned:false}};
 await nextForm.events.submit({preventDefault(){}});
 assert.equal(refreshes,2);
 assert.equal(JSON.parse(calls.at(-1).options.body).action,'unassign');
 // Code review P2 regression: selector change must never release the
 // submit/cancel lock while the previous grant POST has not settled.
 button.events.click();
 const busyForm=find(edit,n=>n.tag==='form');
 const busySelect=find(busyForm,n=>n.tag==='select');
 const busySubmit=find(busyForm,n=>n.tag==='button'&&n.type==='submit');
 const busyCancel=find(busyForm,n=>n.tag==='button'&&n.textContent==='取消');
 holdGrant=true;busySelect.value='B';busySelect.events.change();
 const pending=busyForm.events.submit({preventDefault(){}});
 assert.equal(busySubmit.disabled,true);
 assert.equal(busySelect.disabled,true);
 assert.equal(busyCancel.disabled,true);
 const posted=calls.filter(x=>x.url==='/api/accounts/grant').length;
 assert.equal(button.disabled,true,'all grant edit entry points lock during POST');
 assert.equal(managerButton.disabled,true,'another staff member cannot bypass the lock');
 // DOM handlers can still be invoked synthetically: the shared lock must
 // reject reopening both the same employee and another employee's editor.
 button.events.click();
 managerButton.events.click();
 assert.equal(find(edit,n=>n.tag==='form'),busyForm,
  'reopening during pending POST must retain the existing form');
 busySelect.value='C';busySelect.events.change();
 assert.equal(busySubmit.disabled,true,'selector change must not unlock pending mutation');
 await busyForm.events.submit({preventDefault(){}});
 assert.equal(calls.filter(x=>x.url==='/api/accounts/grant').length,posted,
  'no parallel grant transaction may be submitted');
 assert.equal(refreshes,2,'no refresh until first grant completes');
 resolveGrant({code:'OK',user:{id:'staff-id',locationId:'B',assigned:true}});
 await pending;holdGrant=false;
 assert.equal(refreshes,3);
 assert.equal(busySelect.disabled,false);
 assert.equal(busyCancel.disabled,false);
 assert.equal(button.disabled,false);
 assert.equal(managerButton.disabled,false);
 // No detached view may issue a stale D1 mutation.
 live=false;button.events.click();
 const before=calls.length;
 await nextForm.events.submit({preventDefault(){}});
 assert.equal(calls.length,before);
});
