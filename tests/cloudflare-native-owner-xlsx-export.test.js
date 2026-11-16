'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const projection=import('../vercel-demo/native-owner-report.mjs');
const display=import('../vercel-demo/native-owner-display.mjs');
const {buildWorkbook}=require('../public/xlsx-lite.js');
function zipPart(bytes,target){
 const buf=Buffer.from(bytes);let pos=0;
 while(pos+30<buf.length&&buf.readUInt32LE(pos)===0x04034b50){
  const size=buf.readUInt32LE(pos+18),len=buf.readUInt16LE(pos+26),
    extra=buf.readUInt16LE(pos+28);
  const name=buf.subarray(pos+30,pos+30+len).toString('utf8');
  const start=pos+30+len+extra;
  if(name===target)return buf.subarray(start,start+size).toString('utf8');
  pos=start+size;
 }
 throw Error('missing OOXML zip member '+target);
}
test('Native D1 Excel uses only the same allowlisted table columns and existing shared writer',async()=>{
 const {nativeOwnerReportSheet}=await projection;
 const rows=[
  {title:'備料工作',location_name:'一店',status:'done',due_date:'2026-11-16',
   description:'raw private detail',password_hash:'SENSITIVE_HASH',
   csrf_token:'SENSITIVE_TOKEN',id:'SENSITIVE_ID'},
  {title:'清潔工作',location_name:'二店',status:'todo',due_date:'2026-11-17',
   password_hash:'SENSITIVE_HASH_2'}
 ];
 const sheet=nativeOwnerReportSheet('tasks',rows,{keyword:'備料',name:'今日工作'});
 const page=(await display).presentNativeRows('tasks',rows);
 assert.deepEqual(sheet.headers,page.columns.map(x=>x.label));
 assert.deepEqual(sheet.rows,[page.entries[0].cells.map(x=>x.text)]);
 const bytes=buildWorkbook([sheet]),xml=zipPart(bytes,'xl/worksheets/sheet1.xml');
 assert.match(xml,/備料工作/);assert.match(xml,/已完成/);
 for(const bad of ['SENSITIVE_HASH','SENSITIVE_TOKEN','SENSITIVE_ID','raw private detail','清潔工作'])
  assert(!xml.includes(bad),'leaked '+bad);
 assert.match(xml,/inlineStr/);
});
test('Numeric quantities remain Excel numeric cells and untrusted text cannot become formulas',async()=>{
 const {nativeOwnerReportSheet}=await projection;
 const sheet=nativeOwnerReportSheet('stock_moves',[
  {location_name:'總店',ingredient_name:'麵條',qty_delta:-2.125,unit:'包',
   move_type:'usage',note:'=HYPERLINK("https://example.com","x")',
   token_hash:'SECRET'}
 ],{name:'庫存流水'});
 assert.equal(sheet.rows[0][2],-2.125);
 assert.equal(sheet.rows[0][4],'耗用');
 assert.deepEqual(sheet.precision_columns,[2]);
 const xml=zipPart(buildWorkbook([sheet]),'xl/worksheets/sheet1.xml');
 assert.match(xml,/<c r="C2" s="4"><v>-2\.125<\/v><\/c>/);
 assert.match(xml,/<v>-2\.125<\/v>/);
 assert.match(xml,/inlineStr/);
 assert.match(xml,/HYPERLINK/);
 assert.doesNotMatch(xml,/<f(?:\s|>)/,'must never emit executable Excel formulas');
 assert(!xml.includes('SECRET'));
});
test('Native D1 stock 0.001 does not display as 0.00 in Excel (review P2 regression)',async()=>{
 const {nativeOwnerReportSheet}=await projection;
 const cases=[
  ['stock',{location_name:'總店',name:'米',sku:'RICE',on_hand:0.001,
    min_stock:0.002,unit:'公斤'},[3,4],['D2','E2']],
  ['ingredients',{sku:'RICE',name:'米',unit:'公斤',min_stock:0.001},[3],['D2']],
  ['purchase_orders',{number:'P1',location_name:'總店',ingredient_name:'米',
    supplier:'供應商',qty:0.001,unit:'公斤',status:'requested'},[4],['E2']],
  ['stocktakes',{location_name:'總店',ingredient_name:'米',expected_qty:0.001,
    counted_qty:0.002,unit:'公斤',status:'pending'},[2,3],['C2','D2']]
 ];
 for(const [entity,row,expected,addresses] of cases){
  const sheet=nativeOwnerReportSheet(entity,[row],{name:{
   stock:'庫存',ingredients:'食材',purchase_orders:'叫貨',stocktakes:'盤點'
  }[entity]});
  assert.deepEqual(sheet.precision_columns,expected,entity);
  const xml=zipPart(buildWorkbook([sheet]),'xl/worksheets/sheet1.xml');
  for(const addr of addresses){
   const c=new RegExp('<c r="'+addr+'" s="4"><v>0\\.00[12]</v></c>');
   assert.match(xml,c,entity+' '+addr+' should use precision style 4');
  }
 }
 const local=fs.readFileSync(path.join(root,'public/xlsx-lite.js'),'utf8');
 const demo=fs.readFileSync(path.join(root,'vercel-demo/xlsx-lite.js'),'utf8');
 assert.equal(local,demo,'local and Demo/Native must retain exactly the same shared writer');
});
test('Native D1 export refuses invalid entities, oversized rows and hidden columns',async()=>{
 const {nativeOwnerReportSheet}=await projection;
 for(const [entity,rows,opt] of [
  ['users',[{username:'owner'}],{name:'帳號'}],
  ['audit_logs',[{detail:'secret'}],{name:'稽核'}],
  ['tasks',Array(501).fill({}),{name:'今日工作'}],
  ['tasks',null,{name:'今日工作'}],
  ['tasks',[{title:'a'}],{name:'工作',keyword:'A'.repeat(81)}],
  ['tasks',[{title:'a'}],{name:'工作'.repeat(30)}]
 ])assert.throws(()=>nativeOwnerReportSheet(entity,rows,opt));
 const data=nativeOwnerReportSheet('evaluations',[
  {staff_name:'小明',score:85,feedback:'工作良好',extra:'SENSITIVE'}
 ],{name:'員工考核'});
 assert(data.headers.includes('分數'));
 assert(data.rows[0].some(x=>x===85));
 assert(!JSON.stringify(data).includes('SENSITIVE'));
});
test('Native browser export requires live auth and current view, never refetches or writes',async()=>{
 const {presentNativeRows,pageNativeEntries}=await display;
 const {nativeOwnerReportSheet}=await projection;
 const source=fs.readFileSync(path.join(root,'vercel-demo/owner-app.js'),'utf8');
 const a=source.indexOf('function table(entity,rows){'),
  b=source.indexOf('\nfunction render(data){',a);
 assert(a>=0&&b>a);
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.value='';this.disabled=false;
   this.events={};this.textContent='';this.hidden=false;}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(name,callback){this.events[name]=callback;}
  setAttribute(name,value){this[name]=value;}
  click(){this.clicked=true;}
  remove(){this.removed=true;}
 }
 const body=new Node('body'),downloads=[],messages=[];
 let confirmations=0,book=0;
 const ctx=vm.createContext({
  presentNativeRows,pageNativeEntries,nativeOwnerReportSheet,
  document:{createElement:t=>new Node(t),createDocumentFragment:()=>new Node('fragment'),body},
  el:(tag,label)=>{const x=new Node(tag);if(label!==undefined)x.textContent=String(label);return x;},
  labels:{tasks:'工作'},role:'staff',catalogWriteEnabled:false,
  authEpoch:1,csrf:'test_token',revision:10,
  liveAuth:(epoch,token)=>epoch===ctx.authEpoch&&token===ctx.csrf,
  window:{confirm:()=>{confirmations++;return true;}},
  Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:synthetic';},
   revokeObjectURL:()=>{}},
  setTimeout:()=>{},say:(msg,err)=>messages.push([msg,err])
 });
 vm.runInContext('globalThis.XlsxLite={buildWorkbook:()=>{return new Uint8Array([80,75]);}}',ctx);
 vm.runInContext(source.slice(a,b)+'\nthis.nativeTable=table',ctx);
 const rows=[{title:'備料A',location_name:'一店',status:'done'},
             {title:'清潔B',location_name:'一店',status:'todo'}];
 const first=ctx.nativeTable('tasks',rows);
 function find(node,check){
  if(check(node))return node;
  for(const child of node.children){const match=find(child,check);if(match)return match;}
  return null;
 }
 const button=find(first,n=>n.tag==='button'&&n.textContent.includes('Excel'));
 const input=find(first,n=>n.tag==='input'&&n.type==='search');
 assert(button&&input);assert.equal(button.disabled,false);
 input.value='備料';input.events.input();
 button.events.click();
 assert.equal(confirmations,1);assert.equal(downloads.length,1);
 assert(body.children.some(n=>n.download==='餐廳好管家_tasks_資料.xlsx'));
 assert(messages.at(-1)[0].includes('1 筆'));
 ctx.revision=11;button.events.click();
 assert.equal(confirmations,1,'previous view must not export');
 const second=ctx.nativeTable('tasks',rows);
 const secondButton=find(second,n=>n.tag==='button'&&n.textContent.includes('Excel'));
 ctx.authEpoch=2;secondButton.events.click();
 assert.equal(confirmations,1,'previous session must not export');
 assert(!source.includes('mock.js'));
 assert(!source.includes('localStorage'));
 assert(!source.includes('sessionStorage'));
 assert(!source.includes('innerHTML='));
 assert(source.includes("import './xlsx-lite.js'"));
});
