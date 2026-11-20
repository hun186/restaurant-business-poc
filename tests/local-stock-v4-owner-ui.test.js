'use strict';
// No business database: isolated in-memory SQLite and VM browser controls.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),vm=require('node:vm');
const {DatabaseSync}=require('node:sqlite'),{randomUUID,createHash}=require('node:crypto');
const {makeHandler}=require('../server');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
function setup(t){
 const previous=process.env.LOCAL_STOCK_V4_WRITE_GATE;
 t.after(()=>{if(previous===undefined)delete process.env.LOCAL_STOCK_V4_WRITE_GATE;
  else process.env.LOCAL_STOCK_V4_WRITE_GATE=previous;});
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('PRAGMA foreign_keys=ON');db.exec(read('db/schema.sql'));
 const actors={};
 for(const role of ['owner','manager','staff']){
  const id=randomUUID(),token='synthetic-'+role+'-cookie',hash=createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO users(id,username,display_name,role,password_salt,password_hash) VALUES(?,?,?,?,?,?)')
   .run(id,role,'Synthetic '+role,role,'salt','hash');
  db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)')
   .run(hash,'csrf-'+role,id,'2999-01-01T00:00:00.000Z');
  actors[role]={id,cookie:'restaurant_session='+token};
 }
 const migrate=()=>{
  db.exec('BEGIN IMMEDIATE');
  try{db.exec(read('db/migration-proposals/0004_stock_move_kinds.sql'));db.exec('PRAGMA user_version=4; COMMIT');}
  catch(e){db.exec('ROLLBACK');throw e;}
 };
 return {db,actors,migrate};
}
function request(port,route,cookie){return new Promise((resolve,reject)=>{
 const req=http.request({hostname:'127.0.0.1',port,path:route,method:'GET',headers:cookie?{Cookie:cookie}:{}} ,res=>{
  let buf='';res.on('data',c=>buf+=c);
  res.on('end',()=>resolve({status:res.statusCode,json:JSON.parse(buf),
   cache:res.headers['cache-control']}));});
 req.on('error',reject);req.end();
});}
test('Local v4 capability authenticates and hides Gate from staff and anonymous visitors',async t=>{
 const f=setup(t);
 const server=http.createServer(makeHandler(f.db));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const port=server.address().port,route='/api/stock/v4-capability',readAs=role=>request(port,route,f.actors[role].cookie);
 assert.equal((await request(port,route)).status,401);
 process.env.LOCAL_STOCK_V4_WRITE_GATE='operator-released';
 assert.deepEqual((await readAs('owner')).json,{enabled:false},'unmigrated v3 never advertises release');
 f.migrate();
 for(const role of ['owner','manager']){
  const res=await readAs(role);
  assert.equal(res.status,200);assert.deepEqual(res.json,{enabled:true});
  assert.equal(res.cache,'no-store');
 }
 assert.deepEqual((await readAs('staff')).json,{enabled:false});
 process.env.LOCAL_STOCK_V4_WRITE_GATE='disabled';
 assert.deepEqual((await readAs('owner')).json,{enabled:false});
 process.env.LOCAL_STOCK_V4_WRITE_GATE='operator-released';
 f.db.prepare('DELETE FROM sessions WHERE user_id=?').run(f.actors.manager.id);
 assert.equal((await readAs('manager')).status,401,'revoked session cannot read capability');
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM stock_moves").get().n,0,
  'capability reads must never append stock ledger');
 assert.equal(f.db.prepare("SELECT count(*) AS n FROM audit_logs").get().n,0,
  'capability reads must never write audit');
});
function fakeUi(enabled,role='owner'){
 const handlers=new Map(),elements=new Map(),sent=[];
 const el=selector=>{
  if(!elements.has(selector))elements.set(selector,{
   hidden:false,style:{},textContent:'',innerHTML:'',dataset:{},disabled:false,
   classList:{add(){},remove(){},toggle(){}},
   addEventListener(type,fn){handlers.set(selector+':'+type,fn)},
   querySelector(){return {disabled:false}},reset(){}
  });
  return elements.get(selector);
 };
 const document={querySelector:el,querySelectorAll:()=>[],body:el('body')};
 const user={id:'synthetic-user',display_name:'Synthetic owner',role,locations:['mock-store']};
 const stock=[{location_id:'00000000-0000-4000-8000-000000000001',
  ingredient_id:'00000000-0000-4000-8000-000000000002',name:'Mock item',on_hand:10,min_stock:2,unit:'kg'}];
 const orders=[{id:'00000000-0000-4000-8000-000000000003',
  number:'PO-MOCK',ingredient_name:'Mock item',location_name:'Mock store',supplier:'Mock supplier',status:'received'}];
 const fetch=async(url,opts={})=>{
  if(url==='/api/me')return {ok:true,json:async()=>({user,csrf:'synthetic-csrf'})};
  if(url==='/api/overview')return {ok:true,json:async()=>({overview:{todo:0,late:0,low:0,orders:0,repairs:0,trainingPending:0}})};
  if(url==='/api/stock/v4-capability')return {ok:true,json:async()=>({enabled})};
  if(url.startsWith('/api/data?entity=')){
   const name=new URL('https://local.invalid'+url).searchParams.get('entity');
   return {ok:true,json:async()=>({rows:name==='stock'?stock:name==='purchase_orders'?orders:
    name==='ingredients'?[{id:stock[0].ingredient_id,name:'Mock item',active:1}]:
    name==='locations'?[{id:stock[0].location_id,name:'Mock store',active:1}]:[]})};
  }
  if(url==='/api/command'){
   sent.push(JSON.parse(opts.body));
   return {ok:true,json:async()=>({ok:true,result:{id:'fake-ledger-id'}})};
  }
  throw Error('Unexpected route '+url);
 };
 let currentData={};
 class FakeFormData{
  constructor(){}
  *[Symbol.iterator](){for(const x of Object.entries(currentData))yield x;}
  entries(){return Object.entries(currentData)[Symbol.iterator]();}
 }
 const ctx=vm.createContext({document,window:{confirm:()=>true},fetch,FormData:FakeFormData,
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000004'},
  URL,Date,console,setTimeout:()=>1,clearTimeout(){}});
 vm.runInContext(read('public/app.js'),ctx,{filename:'app.js'});
 const settle=async()=>{for(let i=0;i<25;i++)await Promise.resolve()};
 return {ctx,el,handlers,sent,settle,setData(d){currentData=d},stock,orders};
}
test('Local stock toolbar cannot show v4 operations without server capability',async()=>{
 for(const [enabled,role,expected] of [[false,'owner',false],[true,'staff',false],[true,'manager',true],[true,'owner',true]]){
  const h=fakeUi(enabled,role);await h.settle();
  await vm.runInContext("dataPage('stock')",h.ctx);
  const toolbar=h.el('#local-stock-v4-toolbar').innerHTML;
  assert.equal(toolbar.includes('data-create="stock.scrap"'),expected);
  assert.equal(toolbar.includes('data-create="stock.adjust"'),expected);
  assert.equal(toolbar.includes('data-create="stock.supplier_return"'),expected);
  if(!expected){
   await vm.runInContext("showForm('stock.scrap')",h.ctx);
   assert.equal(h.handlers.has('#record-form:submit'),false);
  }
 }
});
test('Local v4 form uses signed quantity, received order, UUID, confirmation and no automatic retry',async()=>{
 const h=fakeUi(true);await h.settle();await vm.runInContext("dataPage('stock')",h.ctx);
 const p={location_id:h.stock[0].location_id,ingredient_id:h.stock[0].ingredient_id,
  reference_id:h.orders[0].id,qty:'0.125',reason:'  損壞退貨  '};
 h.setData(p);
 await vm.runInContext("showForm('stock.supplier_return')",h.ctx);
 assert.match(h.el('#modal-root').innerHTML,/原已驗收叫貨單/);
 assert.match(h.el('#modal-root').innerHTML,/PO-MOCK/);
 const send=h.handlers.get('#record-form:submit');assert.equal(typeof send,'function');
 await send({currentTarget:h.el('#record-form'),preventDefault(){}});
 assert.equal(h.sent.length,1);
 assert.equal(h.sent[0].action,'stock.supplier_return');
 assert.equal(h.sent[0].data.request_id,'00000000-0000-4000-8000-000000000004');
 assert.equal(h.sent[0].data.qty,0.125);
 assert.equal(h.sent[0].data.reason,'損壞退貨');
 assert.equal(h.sent[0].data.reference_id,p.reference_id);
 assert.deepEqual(Object.keys(h.sent[0].data).sort(),
  ['ingredient_id','location_id','qty','reason','reference_id','request_id'].sort());
 await send({currentTarget:h.el('#record-form'),preventDefault(){}});
 assert.equal(h.sent.length,1,'one submit handler cannot send a second debit');
 const inputSource=read('public/app.js');
 assert.match(inputSource,/f\.stockV4/);
 assert.match(inputSource,/step="any" min="0"/,'unrelated recipe quantities preserve precision');
 const s=h.ctx;
 assert.match(vm.runInContext("inputHtml({name:'qty',display:'配方用量',type:'number',required:true})",s),/step="any" min="0"/);
 assert.match(vm.runInContext("inputHtml({name:'qty_delta',display:'調整量',type:'number',required:true,stockV4:true})",s),/step="0\.001" min="-1000000"/);
});
