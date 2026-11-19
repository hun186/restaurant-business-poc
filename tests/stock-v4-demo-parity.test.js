'use strict';
// Isolated public-demo VM. No real network, native D1, Local SQLite or logins.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function demo(){
 const storage=new Map();
 const window={
  RestaurantDemoOrders:{suppliers(){return []},groupOf(x){return x}},
  RestaurantDemoPricing:{seed(){},rows(){return null},makePrice(){throw Error('not tested')}},
  RestaurantDemoBackup:{seed(){},status(){return {}},command(){throw Error('not tested')}},
  fetch:async()=>{throw Error('REAL_NETWORK_DISALLOWED');}
 };
 const location={href:'https://demo.example.invalid/',reload(){throw Error('no reload in tests')}};
 const ctx=vm.createContext({window,location,sessionStorage:{
  getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)
 },URL,Date,Response,console});
 vm.runInContext(read('vercel-demo/stock-v4-demo.js'),ctx,{filename:'stock-v4-demo.js'});
 vm.runInContext(read('vercel-demo/mock.js'),ctx,{filename:'mock.js'});
 const data=async entity=>{
  const res=await window.fetch('/api/data?entity='+encodeURIComponent(entity));
  assert.equal(res.status,200);return (await res.json()).rows;
 };
 const command=async(action,data)=>{
  const res=await window.fetch('/api/command',{method:'POST',
   body:JSON.stringify({action,data})});
  return {status:res.status,body:await res.json()};
 };
 const ids={location_id:'l1',ingredient_id:'i1',reference_id:'o3'};
 return {window,ctx,data,command,ids,storage};
}
test('Demo stock v4 is browser-only and never loaded by Native or local API',()=>{
 const html=read('vercel-demo/index.html');
 const p=html.indexOf('<script src="/stock-v4-demo.js" defer></script>');
 const q=html.indexOf('<script src="/mock.js" defer></script>');
 assert(p>=0&&q>p);
 const helper=read('vercel-demo/stock-v4-demo.js');
 assert.match(helper,/PUBLIC DEMO ONLY/);
 assert.doesNotMatch(helper,/\b(?:fetch|DatabaseSync|Cloudflare|\.DB\.|localStorage)\b/);
 for(const p of ['cloudflare/worker.mjs','src/service.js'])
  assert.doesNotMatch(read(p),/stock-v4-demo\.js|RestaurantDemoStockV4/);
 const live=read('vercel-demo/owner-app.js');
 assert.doesNotMatch(live,/stock-v4-demo\.js|RestaurantDemoStockV4/);
});
test('scrap and signed adjustment append demo ledger and audit, preserve received PO',async()=>{
 const d=demo(),{location_id,ingredient_id}=d.ids;
 const po=(await d.data('purchase_orders')).find(x=>x.id==='o3');
 assert.equal(po.status,'received');
 const first=await d.command('stock.scrap',{location_id,ingredient_id,qty:0.125,reason:'過期'});
 assert.equal(first.status,200,JSON.stringify(first.body));
 assert.equal(first.body.result.qty_delta,-0.125);
 const next=await d.command('stock.adjust',{location_id,ingredient_id,qty_delta:-2.375,reason:'盤點差額'});
 assert.equal(next.status,200);
 const more=await d.command('stock.adjust',{location_id,ingredient_id,qty_delta:0.5,reason:'盤點回補'});
 assert.equal(more.status,200);
 const stock=(await d.data('stock')).find(x=>x.location_id==='l1'&&x.ingredient_id==='i1');
 assert.equal(stock.on_hand,4);
 const movements=(await d.data('stock_moves')).filter(x=>['scrap','adjustment'].includes(x.move_type));
 assert.equal(movements.length,3);
 assert.deepEqual(movements.map(x=>x.qty_delta),[0.5,-2.375,-0.125]);
 const audit=(await d.data('audit_logs')).filter(x=>x.entity==='stock_moves');
 assert.equal(audit.length,3);
 assert.deepEqual((await d.data('purchase_orders')).find(x=>x.id==='o3'),po);
});
test('supplier return is tied to an exact received PO, purchase ledger and cumulative remaining amount',async()=>{
 const d=demo(),{location_id,ingredient_id,reference_id}=d.ids;
 const command=qty=>d.command('stock.supplier_return',
  {location_id,ingredient_id,reference_id,qty,reason:'瑕疵原料'});
 assert.equal((await command(2.125)).status,200);
 assert.equal((await command(3.875)).status,200);
 assert.equal((await command(0.001)).status,400);
 const moves=(await d.data('stock_moves')).filter(x=>x.move_type==='supplier_return');
 assert.equal(moves.length,2);assert.deepEqual(moves.map(x=>x.reference_id),['o3','o3']);
 assert.equal((await d.data('stock')).find(x=>x.ingredient_id==='i1').on_hand,0);
 assert.equal((await d.data('audit_logs')).filter(x=>x.entity==='stock_moves').length,2);
});
test('failed return, negative stock and invalid payload never mutate fake ledger/audit',async()=>{
 const d=demo(),ids=d.ids;
 const original=async()=>({stock:await d.data('stock'),moves:await d.data('stock_moves'),
  audits:await d.data('audit_logs')});
 const before=await original();
 const invalid=[
  ['stock.scrap',{location_id:'l1',ingredient_id:'i1',qty:7,reason:'不足'}],
  ['stock.scrap',{location_id:'l2',ingredient_id:'i1',qty:1,reason:'不存在的該店庫存'}],
  ['stock.scrap',{location_id:'l1',ingredient_id:'i1',qty:0.0001,reason:'精度'}],
  ['stock.adjust',{location_id:'l1',ingredient_id:'i1',qty_delta:0,reason:'零'}],
  ['stock.adjust',{location_id:'l1',ingredient_id:'i1',qty_delta:-6.001,reason:'不足'}],
  ['stock.adjust',{location_id:'l1',ingredient_id:'i1',qty_delta:'1',reason:'字串'}],
  ['stock.supplier_return',{...ids,qty:1,reason:'',reference_id:'o3'}],
  ['stock.supplier_return',{...ids,qty:1,reason:'已退',reference_id:'o1'}],
  ['stock.supplier_return',{...ids,qty:1,reason:'已退',reference_id:'o2'}],
  ['stock.supplier_return',{...ids,qty:1,reason:'已退',reference_id:'bad-order'}],
  ['stock.scrap',{location_id:'l1',ingredient_id:'i1',qty:1,reason:'已過期',role:'owner'}]
 ];
 for(const [action,data] of invalid){
  const res=await d.command(action,data);
  assert.equal(res.status,400,JSON.stringify({action,data,res}));
  assert.deepEqual(await original(),before);
 }
});
test('demo stock v4 UI exposes distinct actions and forces typed quantity conversion',()=>{
 const app=read('vercel-demo/app.js');
 for(const action of ['stock.scrap','stock.adjust','stock.supplier_return'])
  assert.match(app,new RegExp("data-create=."+action.replace('.','\\.')+"| '"+action.replace('.','\\.')+"':\\{title:"));
 assert.match(app,/received_orders/);
 assert.match(app,/Number\(raw\.qty_delta\)/);
 assert.match(app,/Number\(raw\.qty\)/);
 assert.match(app,/step="0\.001" min="-1000000"/);
 assert.match(app,/正數增加、負數減少/);
 assert.match(app,/window\.confirm/);
});
