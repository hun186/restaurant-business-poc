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
      active:true,location_ids:['A','absent']}
   ]
  };
  if(url==='/api/data?entity=locations')
   return {rows:[{id:'A',name:'臺北店',active:1},{id:'B',name:'停用店',active:0}]};
  throw Error('unexpected API '+url);
 };
 await renderOwnerAccounts({pane,api,role:'owner',live:()=>true,token:'synthetic-token',
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
 const src=fs.readFileSync(path.join(project,'vercel-demo/native-account-management-ui.mjs'),'utf8');
 assert(!src.includes('innerHTML'));
 assert(src.includes("effectiveStoreGrantLabel(user,stores.rows)"));
});
