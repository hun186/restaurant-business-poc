'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

test('Owner timeline translates all known Native D1 audit actions into consistent Traditional Chinese',async()=>{
 const {NATIVE_AUDIT_EVENTS,nativeAuditEventLabel,nativeAuditEntityLabel}=
   await import('../vercel-demo/native-owner-audit-export.mjs');
 const examples={
  'auth.password_change':'變更登入密碼',
  'auth.owner_bootstrap':'正式業主帳號初始化',
  'order.cancel':'取消叫貨',
  'order.receive':'叫貨入庫',
  'ingredient.create':'建立食材',
  'ingredient.update':'修改食材',
  'ingredient.active':'食材啟用狀態變更',
  'location.create':'建立門市',
  'location.update':'修改門市',
  'location.active':'門市啟用狀態變更',
  'user.password_reset':'業主重設員工密碼',
  'user.assign-location':'新增門市授權',
  'user.unassign-location':'移除門市授權',
  'task.assign':'變更工作指派',
  'task.due':'變更工作期限',
  'repair.update':'更新維修單'
 };
 for(const [code,label] of Object.entries(examples))
  assert.equal(nativeAuditEventLabel(code),label,code);
 for(const [code,label] of Object.entries(NATIVE_AUDIT_EVENTS)){
  assert(label&&!/^[A-Za-z_.-]+$/.test(label),'missing Chinese event: '+code);
  assert.equal(nativeAuditEventLabel(code),label);
 }
 for(const [code,label] of Object.entries({
  purchase_orders:'叫貨單',tasks:'工作',ingredients:'食材',
  sessions:'登入工作階段',users:'帳號',user_locations:'門市授權'
 }))assert.equal(nativeAuditEntityLabel(code),label);
 assert.equal(nativeAuditEventLabel('future.action'),'其他事件（future.action）');
 assert.equal(nativeAuditEntityLabel('future_table'),'其他類別（future_table）');
 assert.equal(nativeAuditEventLabel(null),'—');
 assert.equal(nativeAuditEntityLabel(undefined),'—');
});

test('Owner browser timeline and current-page Excel use identical translations and preserve original API codes',async t=>{
 const {renderOwnerAudit}=await import('../vercel-demo/native-owner-audit-ui.mjs');
 const {nativeAuditPageSheet}=await import('../vercel-demo/native-owner-audit-export.mjs');
 class FakeNode{
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.value='';
   this.disabled=false;this.events={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){this.events[name]=fn;}
 }
 const originalDocument=globalThis.document;
 globalThis.document={createElement:tag=>new FakeNode(tag)};
 t.after(()=>{if(originalDocument===undefined)delete globalThis.document;
   else globalThis.document=originalDocument;});
 const rows=[
  {at:'2026-11-17 06:15:00',actor_name:'owner',
    action:'order.receive',entity:'purchase_orders',summary:'已驗收'},
  {at:'2026-11-17 06:13:00',actor_name:'owner',
    action:'order.cancel',entity:'purchase_orders',summary:'已取消'},
  {at:'2026-11-17 06:12:00',actor_name:'owner',
    action:'ingredient.active',entity:'ingredients',summary:'已停用'},
  {at:'2026-11-17 06:10:00',actor_name:'owner',
    action:'auth.password_change',entity:'users',summary:'—'},
  {at:'2026-11-08 13:01:00',actor_name:'production-bootstrap',
    action:'auth.owner_bootstrap',entity:'users',summary:'—'},
  {at:'2026-11-17 06:09:30',actor_name:'owner',
    action:'user.password_reset',entity:'users',summary:'重設對象（目前帳號）：staff01'},
  {at:'2026-11-17 06:09:00',actor_name:'owner',
    action:'future.action',entity:'future_table',summary:'—',password_hash:'DONT_EXPOSE'}
 ];
 const originalRows=JSON.stringify(rows);
 const pane=new FakeNode('div');
 await renderOwnerAudit({pane,api:async()=>({
   mode:'native_d1',rows,offset:0,has_more:false,
   next_offset:null,truncated:false
 }),role:'owner',signal:undefined,notice:()=>{},
 live:()=>true,onAuthExpired:()=>{throw Error('Unexpected auth expiration');}});
 const table=find(pane,node=>node.tag==='table');
 function find(node,predicate){
  if(predicate(node))return node;
  for(const child of node.children){const match=find(child,predicate);if(match)return match;}
  return null;
 }
 assert(table);
 const body=find(table,node=>node.tag==='tbody');
 const sheet=nativeAuditPageSheet(rows);
 assert.equal(body.children.length,rows.length);
 for(let i=0;i<rows.length;i++){
  assert.equal(body.children[i].children[2].textContent,sheet.rows[i][2]);
  assert.equal(body.children[i].children[3].textContent,sheet.rows[i][3]);
 }
 assert.equal(sheet.rows[0][2],'叫貨入庫');
 assert.equal(sheet.rows[0][3],'叫貨單');
 assert.equal(sheet.rows[1][2],'取消叫貨');
 assert.equal(sheet.rows[4][2],'正式業主帳號初始化');
 assert.equal(sheet.rows[4][1],'production-bootstrap');
 assert.equal(sheet.rows[4][3],'帳號');
 assert.equal(sheet.rows[5][2],'業主重設員工密碼');
 assert.equal(sheet.rows[5][4],'重設對象（目前帳號）：staff01');
 assert.equal(body.children[5].children[4].textContent,sheet.rows[5][4]);
 assert.equal(sheet.rows[6][2],'其他事件（future.action）');
 assert.equal(JSON.stringify(rows),originalRows,'projection must not alter audit evidence');
 assert(!JSON.stringify(sheet).includes('DONT_EXPOSE'));
 const enroll=fs.readFileSync(path.join(__dirname,'../tools/cloudflare-production-owner.mjs'),'utf8');
 assert.match(enroll,/auth\.owner_bootstrap/);
 assert.match(enroll,/production-bootstrap/);
 const api=fs.readFileSync(path.join(__dirname,'../cloudflare/native-audit-http.mjs'),'utf8');
 assert.match(api,/SELECT at,actor_name,action,entity,detail, /);
});
