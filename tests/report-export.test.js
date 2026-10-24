'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..','public');
const {buildWorkbook}=require('../public/xlsx-lite.js');
function extract(bytes,file){
 const buf=Buffer.from(bytes);let pos=0;
 while(pos+30<buf.length&&buf.readUInt32LE(pos)===0x04034b50){
  const method=buf.readUInt16LE(pos+8),size=buf.readUInt32LE(pos+18),
   nameLen=buf.readUInt16LE(pos+26),extraLen=buf.readUInt16LE(pos+28);
  const name=buf.subarray(pos+30,pos+30+nameLen).toString('utf8'),start=pos+30+nameLen+extraLen;
  if(name===file){assert.equal(method,0);return buf.subarray(start,start+size).toString('utf8');}
  pos=start+size;
 }
 throw Error('ZIP missing '+file);
}
test('borrowed xlsx writer creates valid Chinese multi-sheet OOXML, no formulas',()=>{
 const bytes=buildWorkbook([
  {name:'今日工作',headers:['工作','數量'],rows:[['=HYPERLINK("https://fake","x")',12],['打烊盤點',3]]},
  {name:'菜品成本／毛利估算',headers:['菜品','估算毛利率 %'],rows:[['早餐',35.25]]}
 ]);
 const content=extract(bytes,'[Content_Types].xml'),
  first=extract(bytes,'xl/worksheets/sheet1.xml'),
  second=extract(bytes,'xl/worksheets/sheet2.xml'),
  wb=extract(bytes,'xl/workbook.xml');
 assert.match(content,/application\/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main\+xml/);
 assert.match(wb,/今日工作/);assert.match(wb,/菜品成本/);
 assert.match(first,/打烊盤點/);assert.match(first,/HYPERLINK/);
 assert.doesNotMatch(first,/<f(?:\s|>)/,'values must not execute Excel formulas');
 assert.match(first,/t="inlineStr"/);
 assert.match(second,/<v>35.25<\/v>/,'margin input is percent points, not Excel fraction');
 assert.doesNotMatch(second,/s="3"><v>35.25/,'do not apply percent number format to percent-point values');
});
test('column/keyword/date selection isolates requested report contents',()=>{
 const s=fs.readFileSync(path.join(root,'report-ui.js'),'utf8');
 const ctx=vm.createContext({console});
 const project=vm.runInContext(s+'\nReportKit.project;',ctx);
 const rows=[
  {title:'採購番茄',location_name:'總店',created_at:'2026-10-23 10:00:00'},
  {title:'採購雞蛋',location_name:'分店',created_at:'2026-10-25 10:00:00'},
  {title:'採購番茄',location_name:'總店',created_at:'2026-09-02 10:00:00'}
 ];
 const selected=[['title','工作']];
 const result=project(rows,selected,{keyword:'番茄',from:'2026-10-01',to:'2026-10-24'});
 assert.equal(result.length,1);assert.equal(result[0][0],'採購番茄');
 assert.equal(result[0].length,1,'unselected columns excluded');
 const noMatch=project(rows,selected,{keyword:'分店'});
 assert.equal(noMatch.length,0,'filter searches exported columns only');
});
test('report and workbook scripts are served and print view uses CSS print-only preview',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),
  app=fs.readFileSync(path.join(root,'app.js'),'utf8'),
  css=fs.readFileSync(path.join(root,'styles.css'),'utf8'),
  server=fs.readFileSync(path.join(__dirname,'..','server.js'),'utf8');
 assert.ok(html.includes('data-page="reports"'));
 assert.ok(html.indexOf('xlsx-lite.js')<html.indexOf('report-ui.js'));
 assert.ok(app.includes("S.page==='reports'?reportPage()"));
 assert.ok(app.includes("data-export-current"));
 assert.ok(app.includes("data-print-current"));
 assert.ok(css.includes('@media print'));
 assert.ok(css.includes('main>*:not(#report-print-preview)'));
 assert.ok(server.includes("'/report-ui.js'"));
 assert.ok(server.includes("'/xlsx-lite.js'"));
});

test('Vercel interactive export uses only fictional sample data and shows a fictional IP',()=>{
 const demo=path.join(__dirname,'..','vercel-demo');
 const html=fs.readFileSync(path.join(demo,'index.html'),'utf8'),
  app=fs.readFileSync(path.join(demo,'app.js'),'utf8'),
  mock=fs.readFileSync(path.join(demo,'mock.js'),'utf8'),
  report=fs.readFileSync(path.join(demo,'report-ui.js'),'utf8'),
  xlsx=fs.readFileSync(path.join(demo,'xlsx-lite.js'),'utf8');
 assert.match(html,/全部為虛構資料/);
 assert.match(html,/data-page="reports"/);
 assert.ok(html.indexOf('/xlsx-lite.js')<html.indexOf('/report-ui.js'));
 assert.match(app,/reports:\{title:'虛構 Excel/);
 assert.match(app,/S.page==='reports'\?reportPage\(\)/);
 assert.match(mock,/192\.0\.2\.20/);
 assert.match(report,/並非訪客真實 IP/);
 assert.doesNotMatch(report,/fetch\('http/);
 new vm.Script(report);new vm.Script(xlsx);
});

test('leave interval, monthly evaluations and due date use business dates rather than created_at',()=>{
 const src=fs.readFileSync(path.join(root,'report-ui.js'),'utf8');
 const ctx=vm.createContext({console}),project=vm.runInContext(src+'\nReportKit.project;',ctx);
 const leave=[{start_date:'2026-11-10',end_date:'2026-11-12',created_at:'2026-10-11',reason:'病假'},
  {start_date:'2026-10-03',end_date:'2026-10-08',created_at:'2026-11-01',reason:'特休'},
  {start_date:'2026-10-31',end_date:'2026-11-02',created_at:'2026-09-30',reason:'跨月假'}];
 const c=[['reason','假別']];
 assert.deepEqual(Array.from(project(leave,c,{entity:'leave_requests',from:'2026-11-01',to:'2026-11-30'})).map(r=>r[0]),['病假','跨月假']);
 const evals=[{period:'2026-11',created_at:'2026-10-01',score:80},{period:'2026-10',created_at:'2026-11-01',score:75}];
 assert.deepEqual(Array.from(project(evals,[['score','成績']],{entity:'evaluations',from:'2026-11-15',to:'2026-11-30'})).map(r=>r[0]),[80]);
 const tasks=[{due_date:'2026-11-02',created_at:'2026-10-01',title:'開店'}];
 assert.equal(project(tasks,[['title','工作']],{entity:'tasks',from:'2026-11-01',to:'2026-11-30'}).length,1);
});
test('current-page export uses the SAME full-row search as the visible list',()=>{
 const src=fs.readFileSync(path.join(root,'report-ui.js'),'utf8');
 const project=vm.runInContext(src+'\nReportKit.project;',vm.createContext({console}));
 const records=[{number:'PO1',ingredient_name:'番茄',unit:'公斤',qty:1},{number:'PO2',ingredient_name:'雞蛋',unit:'盒',qty:1}];
 const columns=[['number','單號'],['ingredient_name','食材']];
 assert.equal(project(records,columns,{keyword:'公斤',entity:'purchase_orders'}).length,0);
 const full=project(records,columns,{keyword:'公斤',searchAllFields:true,entity:'purchase_orders'});
 assert.equal(full.length,1);assert.equal(full[0][0],'PO1');
});
test('tiny stock and recipe quantities use high precision in restaurant workbook',()=>{
 const xml=extract(buildWorkbook([{name:'庫存管理',headers:['食材','現有庫存'],rows:[['香料',0.001]]},
  {name:'每份菜品配方',headers:['食材','每份用量'],rows:[['香料',0.00001]]}]),'xl/worksheets/sheet1.xml');
 assert.match(xml,/r="B2" s="4"><v>0\.001<\/v>/);
 const wb=buildWorkbook([{name:'每份菜品配方',headers:['食材','每份用量'],rows:[['香料',0.00001]]}]);
 assert.match(extract(wb,'xl/worksheets/sheet1.xml'),/r="B2" s="4"><v>0\.00001<\/v>/);
 assert.match(extract(wb,'xl/styles.xml'),/formatCode="#,##0\.########"/);
});

test('legacy zh-TW slash timestamps normalize to input date filters',()=>{
 for(const dir of ['public','vercel-demo']){
  const s=fs.readFileSync(path.join(__dirname,'..',dir,'report-ui.js'),'utf8');
  const proj=vm.runInContext(s+'\nReportKit.project;',vm.createContext({console}));
  const rows=[{at:'2026/10/24 上午9:00:00',action:'demo.order'},{at:'2026-10-23T22:00:00Z',action:'older'}];
  const got=proj(rows,[['action','事件']],{entity:'audit_logs',from:'2026-10-24',to:'2026-10-24'});
  assert.equal(got.length,1,dir);assert.equal(got[0][0],'demo.order');
 }
});
test('report categories reflect read permissions, not create permissions',()=>{
 const pages={stock:{title:'庫存',columns:[['name','食材']],permission:'owner'},
  shifts:{title:'班表',columns:[['shift_date','日期']],permission:'manager'},
  tasks:{title:'工作',columns:[['title','工作']],permission:'manager'},
  training_records:{title:'訓練',columns:[['score','分數']],permission:'manager'},
  evaluations:{title:'考核',columns:[['score','分數']],permission:'manager'},
  dish_costs:{title:'成本',columns:[['sale_price_twd','售價']],permission:'manager'},
  audit_logs:{title:'稽核',columns:[['at','時間']]},
  users:{title:'帳號',columns:[['username','帳號']]}};
 const roles={staff:1,manager:2,owner:3};
 for(const dir of ['public','vercel-demo']){
  const source=fs.readFileSync(path.join(__dirname,'..',dir,'report-ui.js'),'utf8');
  const S={me:{role:'staff'}},can=role=>roles[S.me.role]>=roles[role];
  const available=vm.runInContext(source+'\nreportConfigs;',vm.createContext({pages,S,can}));
  const staff=available().map(([key])=>key);
  for(const entity of ['stock','shifts','tasks','training_records','evaluations'])assert.ok(staff.includes(entity),dir+': '+entity);
  assert.ok(!staff.includes('audit_logs')&&!staff.includes('users')&&!staff.includes('dish_costs'));
  S.me.role='manager';
  const manager=available().map(([key])=>key);
  assert.ok(manager.includes('dish_costs'));assert.ok(manager.includes('stock'));
  assert.ok(!manager.includes('users'));
  S.me.role='owner';
  assert.ok(available().some(([key])=>key==='audit_logs'));
 }
});

test('real Vercel mock newly created orders, stocktakes and repairs pass todays date filter',async()=>{
 const demo=path.join(__dirname,'..','vercel-demo'),storage=new Map();
 const sessionStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const window={fetch:async()=>{throw Error('unexpected network request')},confirm:()=>true};
 const context=vm.createContext({window,sessionStorage,location:{href:'https://restaurant-business-poc.vercel.app/'},URL,Response,Date,console});
 for(const filename of ['pricing-demo.js','backup-demo.js','mock.js']){
  vm.runInContext(fs.readFileSync(path.join(demo,filename),'utf8'),context,{filename});
 }
 const project=vm.runInContext(fs.readFileSync(path.join(demo,'report-ui.js'),'utf8')+'\nReportKit.project;',context);
 const created={
  purchase_orders:{action:'order.create',data:{location_id:'l1',ingredient_id:'i1',qty:4,supplier:'今天叫貨'}},
  stocktakes:{action:'stocktake.create',data:{location_id:'l1',ingredient_id:'i2',counted_qty:19}},
  repairs:{action:'repair.create',data:{location_id:'l1',equipment:'今天冷藏櫃',description:'溫度異常'}}
 };
 const today=new Date().toLocaleDateString('sv-SE');
 for(const [group,input] of Object.entries(created)){
  const write=await window.fetch('/api/command',{method:'POST',body:JSON.stringify(input)});
  assert.equal(write.status,200,group);
  const output=await (await window.fetch('/api/data?entity='+group)).json();
  const current=project(output.rows,[['created_at','建立時間']],{entity:group,from:today,to:today});
  assert.ok(current.length>=1,group+' todays rows must not vanish');
  assert.ok(output.rows.some(r=>r.created_at?.startsWith(today)),group+' new row has created_at');
 }
});
test('legacy Vercel sessionStorage upgrade fills missing sample dates without discarding rows',async()=>{
 const demo=path.join(__dirname,'..','vercel-demo');
 const saved={tasks:[{id:'old-task',title:'已保存的工作'}],stock:[],
  purchase_orders:[{id:'old-po',number:'PO-OLD'}],stocktakes:[{id:'old-count'}],repairs:[{id:'old-repair'}]};
 const storage=new Map([['restaurant-public-demo-v1',JSON.stringify(saved)]]);
 const sessionStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const window={fetch:async()=>{throw Error('unexpected network')},confirm:()=>true};
 const ctx=vm.createContext({window,sessionStorage,location:{href:'https://restaurant-business-poc.vercel.app/'},URL,Response,Date,console});
 for(const filename of ['pricing-demo.js','backup-demo.js','mock.js'])
  vm.runInContext(fs.readFileSync(path.join(demo,filename),'utf8'),ctx,{filename});
 const existing=await (await window.fetch('/api/data?entity=purchase_orders')).json();
 assert.equal(existing.rows.length,1);assert.equal(existing.rows[0].number,'PO-OLD');
 assert.match(existing.rows[0].created_at,/^\d{4}-\d{2}-\d{2}/);
 assert.equal((await (await window.fetch('/api/data?entity=stocktakes')).json()).rows[0].id,'old-count');
 assert.equal((await (await window.fetch('/api/data?entity=repairs')).json()).rows[0].id,'old-repair');
});
