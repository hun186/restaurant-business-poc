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
