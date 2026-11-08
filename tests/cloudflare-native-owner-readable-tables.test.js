'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const display=import('../vercel-demo/native-owner-display.mjs');
const src=name=>fs.readFileSync(path.join(root,'vercel-demo',name),'utf8');

test('Chinese column allowlist hides opaque UUIDs and unexpected secrets',async()=>{
 const {presentNativeRows}=await display;
 const x=presentNativeRows('tasks',[{
  id:'private-uuid',location_id:'secret-store',password_hash:'hash123',csrf_token:'csrf123',
  title:'開店盤點',location_name:'中壢店',assigned_name:'小王',status:'doing',due_date:'2026-11-15'
 }]);
 assert.deepEqual(x.columns.map(c=>c.label),['工作事項','門市','指派人員','進度','到期日','建立時間']);
 assert.equal(x.entries[0].cells[3].text,'進行中');
 assert.equal(x.entries[0].cells[3].tone,'warn');
 for(const value of ['private-uuid','secret-store','hash123','csrf123'])
  assert(!JSON.stringify(x).includes(value));
 assert(x.entries[0].search.includes('中壢店'));
});
test('real stock threshold correctly distinguishes low, sufficient and unavailable',async()=>{
 const {presentNativeRows}=await display;
 const x=presentNativeRows('stock',[
  {name:'茶',on_hand:0.125,min_stock:0.5,unit:'kg',ingredient_id:'not-visible'},
  {name:'米',on_hand:3,min_stock:3,unit:'kg'},
  {name:'水',on_hand:null,min_stock:2,unit:'瓶'}]);
 assert.deepEqual(x.entries.map(e=>e.cells.at(-1).text),['低於下限','正常','無法判定']);
 assert.deepEqual(x.entries.map(e=>e.cells.at(-1).tone),['warn','ok','muted']);
 assert.equal(x.entries[0].cells[3].text,'0.125');
 assert.equal(x.entries[0].cells[4].text,'0.5');
 assert(!JSON.stringify(x).includes('not-visible'));
});
test('all nine official entities format statuses, zero values and empty text',async()=>{
 const {presentNativeRows}=await display;
 const cases={
  locations:[{name:'一店',active:0}],
  ingredients:[{sku:'A',name:'麵',unit:'包',min_stock:0,active:1}],
  training_courses:[{title:'消防',description:'',required_score:80,active:1}],
  tasks:[{title:'任務',status:'done'}],
  purchase_orders:[{number:'PO-01',status:'received',qty:2}],
  stock:[{name:'茶',on_hand:0,min_stock:0}],
  stocktakes:[{status:'confirmed',counted_qty:0}],
  repairs:[{equipment:'冷藏櫃',status:'closed'}],
  shifts:[{shift_date:'2026-11-08',start_time:'09:00'}]
 };
 assert.equal(Object.keys(cases).length,9);
 for(const [entity,rows] of Object.entries(cases)){
  const x=presentNativeRows(entity,rows);
  assert.equal(x.entries.length,1);
  assert(x.columns.length>0);
  assert(x.columns.every(c=>typeof c.label==='string'&&!c.label.includes('_id')));
 }
 assert.equal(presentNativeRows('locations',cases.locations).entries[0].cells.at(-1).text,'停用');
 assert.equal(presentNativeRows('purchase_orders',cases.purchase_orders).entries[0].cells.at(-2).text,'已入庫');
 assert.equal(presentNativeRows('training_courses',cases.training_courses).entries[0].cells[1].text,'—');
 assert.equal(presentNativeRows('stock',cases.stock).entries[0].cells[3].text,'0');
});
test('reject malformed native data and do not display unknown states as approved',async()=>{
 const {presentNativeRows}=await display;
 for(const [entity,rows] of [['users',[{username:'owner'}]],['tasks',null],
  ['tasks',[null]],['tasks',[[]]],['tasks',Array.from({length:501},()=>({}))]])
  assert.throws(()=>presentNativeRows(entity,rows),/E_NATIVE_DISPLAY_INVALID/);
 const x=presentNativeRows('purchase_orders',[{status:'unexpected',qty:Infinity}]);
 assert.equal(x.entries[0].cells[6].text,'未識別');
 assert.equal(x.entries[0].cells[4].text,'—');
});
test('native Owner browser uses only DOM text and scoped, loaded rows for search',()=>{
 const js=src('owner-app.js'),projection=src('native-owner-display.mjs');
 assert(js.includes("import {presentNativeRows} from './native-owner-display.mjs'"));
 assert(js.includes('table(view,data.rows)'));
 assert(js.includes('presentNativeRows(entity,rows)'));
 assert(js.includes('document.createDocumentFragment()'));
 assert(js.includes('只搜尋已載入的資料'));
 assert(js.includes('/api/native/status'));
 for(const source of [js,projection]){
  assert(!source.includes('mock.js'));
  assert(!source.includes('localStorage'));
  assert(!source.includes('sessionStorage'));
  assert(!source.includes('innerHTML='));
  assert(!source.includes('/api/access/'));
 }
});
