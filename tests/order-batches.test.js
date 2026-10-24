'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {openDb}=require('../src/db'),{rows,command,balance,scope}=require('../src/service');
const {details,groupOf}=require('../src/order-batches');
const {fingerprint}=require('../src/backup-manager');
function fixture(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'restaurant-batch-'));
 const {db}=openDb(folder),owner=db.prepare("SELECT id,username,role FROM users WHERE username='owner'").get();
 const location=db.prepare('SELECT id FROM locations LIMIT 1').get().id;
 const ing1=command(db,owner,'ingredient.create',{sku:'BATCH-A',name:'豬梅花肉',unit:'公斤',min_stock:3}).id;
 const ing2=command(db,owner,'ingredient.create',{sku:'BATCH-B',name:'豬五花肉',unit:'公斤',min_stock:2}).id;
 const ing3=command(db,owner,'ingredient.create',{sku:'BATCH-C',name:'牛肉片',unit:'公斤',min_stock:1}).id;
 t.after(()=>{db.close();fs.rmSync(folder,{recursive:true,force:true})});
 return {db,owner,location,ing1,ing2,ing3};
}
const cmd=(f,action,x,user=f.owner)=>command(f.db,user,action,x);
function create(f){
 const result=cmd(f,'order.batch-create',{location_id:f.location,items:[
  {ingredient_id:f.ing1,qty:12,supplier:'家樂肉商'},
  {ingredient_id:f.ing2,qty:8,supplier:'家樂肉商'},
  {ingredient_id:f.ing3,qty:5,supplier:'另一家肉商'}
 ]});
 assert.equal(result.groups.length,2);
 return result;
}
test('one vendor-facing order number can represent multiple separate stock-ledger lines',t=>{
 const f=fixture(t),start=fingerprint(f.db),batch=create(f);
 const vendor=batch.groups.find(g=>g.supplier==='家樂肉商'),other=batch.groups.find(g=>g.supplier==='另一家肉商');
 assert.equal(vendor.item_count,2);assert.equal(other.item_count,1);
 assert.match(vendor.number,/^POB-[A-F0-9]{32}$/);
 assert.notEqual(fingerprint(f.db),start);
 const all=rows(f.db,f.owner,'purchase_orders'),lines=all.filter(r=>r.group_number===vendor.number);
 assert.equal(lines.length,2);
 assert.equal(new Set(lines.map(r=>r.number)).size,2,'each line keeps a unique internal key');
 assert.ok(lines.every(r=>groupOf(r.number)===vendor.number));
 const group=details(f.db,f.owner,vendor.number,scope);
 assert.equal(group.rows.length,2);
 assert.deepEqual(group.states,['requested']);
 assert.equal(group.location_id,f.location);
 assert.deepEqual(lines.map(r=>r.ingredient_name).sort(),['豬五花肉','豬梅花肉']);
 assert.ok(rows(f.db,f.owner,'audit_logs').some(r=>r.action==='order.batch-create'));
});
test('supplier suggestions honor location scopes, and unknown suppliers require manual selection',t=>{
 const f=fixture(t);
 cmd(f,'price.record',{location_id:f.location,ingredient_id:f.ing1,unit_price_twd:'80',price_date:'2020-01-01',supplier:'舊肉商'});
 cmd(f,'price.record',{location_id:f.location,ingredient_id:f.ing1,unit_price_twd:'85',price_date:'2021-01-01',supplier:'家樂肉商'});
 let suggestions=rows(f.db,f.owner,'purchase_supplier_suggestions');
 assert.equal(suggestions.find(s=>s.ingredient_id===f.ing1).supplier,'家樂肉商');
 assert.throws(()=>cmd(f,'order.batch-create',{location_id:f.location,items:[{ingredient_id:f.ing2,qty:1}]}),{status:400});
 const batch=cmd(f,'order.batch-create',{location_id:f.location,items:[{ingredient_id:f.ing1,qty:3}]});
 assert.equal(batch.groups[0].supplier,'家樂肉商');
 const otherLocation=cmd(f,'location.create',{name:'測試第二店'}).id;
 const staffId=cmd(f,'user.create',{username:'batchstaff',display_name:'叫貨員',password:'safe-password-1234',role:'staff',location_id:f.location}).id;
 const staff={id:staffId,role:'staff',username:'batchstaff'};
 assert.ok(rows(f.db,staff,'purchase_supplier_suggestions').every(x=>x.location_id===f.location));
 assert.throws(()=>cmd(f,'order.batch-create',{location_id:otherLocation,items:[{ingredient_id:f.ing1,qty:1,supplier:'家樂肉商'}]},staff),{status:403});
 assert.throws(()=>details(f.db,staff,batch.groups[0].number,scope),{status:403},'staff cannot view owners group');
});
test('whole-group approval and receipt are atomic, one inventory entry per item and not repeatable',t=>{
 const f=fixture(t),batch=create(f),main=batch.groups.find(x=>x.item_count===2);
 const lines=details(f.db,f.owner,main.number,scope).rows;
 const staffId=cmd(f,'user.create',{username:'batchother',display_name:'測試員工',password:'safe-password-1234',role:'staff',location_id:f.location}).id;
 const staff={id:staffId,role:'staff',username:'batchother'};
 assert.throws(()=>cmd(f,'order.batch-approve',{number:main.number},staff),{status:403});
 assert.throws(()=>cmd(f,'order.batch-receive',{number:main.number}),{status:409});
 cmd(f,'order.batch-approve',{number:main.number});
 assert.throws(()=>cmd(f,'order.batch-approve',{number:main.number}),{status:409});
 const oldAudit=f.db.prepare('SELECT count(*) n FROM audit_logs').get().n;
 const prices={};
 prices[lines[0].id]={unit_price_twd:'90.00',unit:'公斤',price_date:'2020-01-01'};
 prices[lines[1].id]={unit_price_twd:'invalid',unit:'公斤',price_date:'2020-01-01'};
 assert.throws(()=>cmd(f,'order.batch-receive',{number:main.number,prices}),{status:400},'invalid line price rolls back every stock delta');
 assert.equal(balance(f.db,f.ing1,f.location),0);
 assert.equal(balance(f.db,f.ing2,f.location),0);
 assert.ok(details(f.db,f.owner,main.number,scope).rows.every(x=>x.status==='approved'));
 assert.equal(f.db.prepare('SELECT count(*) n FROM audit_logs').get().n,oldAudit);
 prices[lines[1].id]={unit_price_twd:'95.00',unit:'公斤',price_date:'2020-01-01'};
 cmd(f,'order.batch-receive',{number:main.number,prices});
 assert.equal(balance(f.db,f.ing1,f.location),12);
 assert.equal(balance(f.db,f.ing2,f.location),8);
 assert.equal(balance(f.db,f.ing3,f.location),0,'another supplier unaffected');
 assert.ok(details(f.db,f.owner,main.number,scope).rows.every(x=>x.status==='received'));
 assert.equal(f.db.prepare('SELECT count(*) n FROM stock_moves WHERE reference_id IN (?,?)').get(lines[0].id,lines[1].id).n,2);
 assert.equal(rows(f.db,f.owner,'ingredient_prices').filter(p=>[lines[0].id,lines[1].id].includes(p.reference_id)).length,2);
 assert.throws(()=>cmd(f,'order.batch-receive',{number:main.number}),{status:409});
 assert.equal(f.db.prepare('SELECT count(*) n FROM stock_moves').get().n,2);
});
test('existing single-line orders still use the original approval and receipt actions',t=>{
 const f=fixture(t),legacy=cmd(f,'order.create',{location_id:f.location,ingredient_id:f.ing3,qty:4,supplier:'手動舊供應商'});
 assert.ok(legacy.number.startsWith('PO-'));
 assert.equal(rows(f.db,f.owner,'purchase_orders').find(r=>r.id===legacy.id).group_number,legacy.number);
 cmd(f,'order.approve',{id:legacy.id});
 cmd(f,'order.receive',{id:legacy.id});
 assert.equal(balance(f.db,f.ing3,f.location),4);
 assert.throws(()=>cmd(f,'order.receive',{id:legacy.id}),{status:409});
});
test('LINE draft builds Chinese per-supplier text without performing a network send',t=>{
 const f=fixture(t),batch=create(f),num=batch.groups.find(g=>g.item_count===2).number;
 cmd(f,'order.batch-approve',{number:num});
 const data=details(f.db,f.owner,num,scope);
 const ctx=vm.createContext({window:{},console});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','public','order-batch-ui.js'),'utf8'),ctx);
 const text=ctx.window.OrderBatchUI.lineText(data);
 assert.match(text,/家樂肉商 您好/);
 assert.match(text,/豬梅花肉：12 公斤/);
 assert.match(text,/豬五花肉：8 公斤/);
 assert.doesNotMatch(text,/牛肉片/,'supplier group must not contain the other vendor');
 assert.match(text,/單號：POB-/);
 const ui=fs.readFileSync(path.join(__dirname,'..','public','order-batch-ui.js'),'utf8');
 assert.match(ui,/https:\/\/line\.me\/R\/share\?text=/);
 assert.match(ui,/navigator\.clipboard\.writeText/);
 assert.doesNotMatch(ui,/Messaging API|access_token|channel_secret/);
});
test('Vercel demo can split mock batch, approve and receive without any backend or database',async()=>{
 const demo=path.join(__dirname,'..','vercel-demo'),store=new Map();
 const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)};
 const win={fetch:async()=>{throw Error('unexpected real network')},confirm:()=>true};
 const ctx=vm.createContext({window:win,sessionStorage:storage,location:{href:'https://restaurant-business-poc.vercel.app/'},URL,Response,Date,console});
 for(const name of ['pricing-demo.js','backup-demo.js','order-batch-demo.js','mock.js'])
  vm.runInContext(fs.readFileSync(path.join(demo,name),'utf8'),ctx,{filename:name});
 const send=async(action,data)=>{const res=await win.fetch('/api/command',{method:'POST',body:JSON.stringify({action,data})});return {status:res.status,data:await res.json()};};
 const created=await send('order.batch-create',{location_id:'l1',items:[
  {ingredient_id:'i1',qty:12,supplier:'蔬果商'},
  {ingredient_id:'i3',qty:8,supplier:'蔬果商'},
  {ingredient_id:'i2',qty:5,supplier:'肉品商'}
 ]});
 assert.equal(created.status,200);
 assert.equal(created.data.result.groups.length,2);
 const supplier=created.data.result.groups.find(g=>g.item_count===2);
 const detail=await (await win.fetch('/api/order-batch?number='+supplier.number)).json();
 assert.equal(detail.rows.length,2);
 assert.deepEqual(Array.from(detail.rows.map(x=>x.ingredient_name)).sort(),['牛番茄','生菜']);
 assert.equal((await send('order.batch-receive',{number:supplier.number})).status,400);
 assert.equal((await send('order.batch-approve',{number:supplier.number})).status,200);
 assert.equal((await send('order.batch-receive',{number:supplier.number})).status,200);
 assert.equal((await send('order.batch-receive',{number:supplier.number})).status,400);
 const listing=(await (await win.fetch('/api/data?entity=purchase_orders')).json()).rows;
 assert.equal(listing.filter(x=>x.group_number===supplier.number).length,2);
 const html=fs.readFileSync(path.join(demo,'index.html'),'utf8');
 assert.ok(html.indexOf('order-batch-demo.js')<html.indexOf('mock.js'));
 assert.ok(html.indexOf('order-batch-ui.js')>html.indexOf('app.js'));
});
