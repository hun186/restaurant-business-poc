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
