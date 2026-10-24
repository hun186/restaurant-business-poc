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
