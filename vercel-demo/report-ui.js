'use strict';
// Browser-only report presentation. Rows ALWAYS come from existing authenticated
// /api/data; never embed SQLite in downloadable files or bypass server-side RBAC.
const ReportKit=(function(){
 const dateKeys=['at','created_at','price_date','shift_date','due_date','start_date','period','completed_on','received_at'];
 function normalizeDate(raw){
  if(typeof raw!=='string')return '';
  // Handles ISO timestamps and legacy zh-TW mock dates like
  // "2026/10/24 上午9:00:00", without locale-dependent Date.parse().
  const found=raw.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  return found?found[1]+'-'+found[2].padStart(2,'0')+'-'+found[3].padStart(2,'0'):'';
 }
 const datesByEntity={audit_logs:'at',tasks:'due_date',ingredient_prices:'price_date',stock_moves:'created_at',
  purchase_orders:'created_at',stocktakes:'created_at',repairs:'created_at',shifts:'shift_date',
  leave_requests:'start_date',training_records:'completed_on',evaluations:'period'};
 function matchesDate(row,entity,from,to){
  if(!from&&!to)return true;
  const key=datesByEntity[entity]||dateKeys.find(k=>row[k]&&typeof row[k]==='string');
  if(!key||typeof row[key]!=='string'||!row[key])return false;
  if(entity==='leave_requests'){
   // Leave is an interval; include periods that overlap the selected date range.
   const start=normalizeDate(row.start_date),end=normalizeDate(String(row.end_date||row.start_date));
   return !!start&&!!end&&(!from||end>=from)&&(!to||start<=to);
  }
  if(entity==='evaluations'){
   // Evaluations use YYYY-MM periods; compare whole calendar months.
   const month=row.period.slice(0,7);
   return (!from||month>=from.slice(0,7))&&(!to||month<=to.slice(0,7));
  }
  const date=normalizeDate(row[key]);
  return !!date&&(!from||date>=from)&&(!to||date<=to);
 }
 function value(v){if(v===null||v===undefined)return '';return typeof v==='object'?JSON.stringify(v):String(v);}
 function project(rows,columns,{keyword='',from='',to='',entity=null,searchAllFields=false}={}){
  const term=String(keyword).trim().toLocaleLowerCase('zh-TW');
  return rows.filter(r=>{
   if(term&&!(searchAllFields?JSON.stringify(r).toLowerCase().includes(term):
    columns.some(([key])=>value(r[key]).toLocaleLowerCase('zh-TW').includes(term))))return false;
   if(!matchesDate(r,entity,from,to))return false;
   return true;
  }).map(r=>columns.map(([key])=>r[key]===null||r[key]===undefined?'':r[key]));
 }
 const safeName=title=>String(title).replace(/[\\/*?:[\]]/g,'').slice(0,31)||'餐飲資料';
 const sanitizeDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(d)?d:'';
 return {project,value,safeName,sanitizeDate};
})();
function reportConfigs(){
 const managerOnly=new Set(['ingredient_prices','inventory_values','menu_dishes','dish_ingredients','dish_costs','dish_cost_lines']);
 return Object.entries(pages).filter(([key,cfg])=>Array.isArray(cfg.columns)&&key!=='staff_directory'&&
  can(['audit_logs','users'].includes(key)?'owner':managerOnly.has(key)?'manager':'staff'));
}
function reportFilters(){
 return {keyword:$('#report-keyword')?.value||'',
  from:ReportKit.sanitizeDate($('#report-from')?.value||''),
  to:ReportKit.sanitizeDate($('#report-to')?.value||'')};
}
async function reportPage(){
 setActive('reports');
 $('#main').innerHTML=head('Excel 匯出與列印','全部是虛構資料：可選多張工作表、欄位及條件；沒有真實帳號／資料庫或 IP 追蹤')+
  '<div class="panel" id="report-config"><p class="notice warning">公開互動教學：所有資料都由瀏覽器虛構產生，匯出的是測試資料，不會下載正式資料庫。示意 IP 使用 192.0.2.20，並非訪客真實 IP。</p>'+
  '<div class="report-filters"><label>關鍵字<input id="report-keyword" placeholder="只留下符合的內容"></label><label>日期起<input id="report-from" type="date"></label><label>日期迄<input id="report-to" type="date"></label></div>'+
  '<h2>選擇匯出分類與欄位</h2><div id="report-sources" class="report-sources"></div>'+
  '<div class="toolbar"><button class="btn primary" id="report-xlsx">下載 Excel (.xlsx)</button><button class="btn" id="report-preview">預覽列印內容</button><button class="btn" id="report-print">列印已選內容</button></div>'+
  '</div><div id="report-print-preview"></div>';
 const container=$('#report-sources'),available=reportConfigs();
 container.innerHTML=available.map(([key,cfg],i)=>'<div class="report-source"><label><input type="checkbox" class="report-source-check" value="'+E(key)+'" '+(i===0?'checked':'')+'> <strong>'+E(cfg.title)+'</strong></label>'+
  '<details><summary>選擇欄位（預設全部）</summary><div class="report-cols">'+cfg.columns.map(([field,title])=>'<label><input type="checkbox" class="report-col-check" data-entity="'+E(key)+'" value="'+E(field)+'" checked> '+E(title)+'</label>').join('')+'</div></details></div>').join('');
 $('#report-xlsx').onclick=()=>makeReports('xlsx');
 $('#report-preview').onclick=()=>makeReports('preview');
 $('#report-print').onclick=()=>makeReports('print');
}
function readSelectedReports(){
 const checked=[...document.querySelectorAll('.report-source-check:checked')];
 if(!checked.length)throw Error('請至少勾選一種資料分類');
 if(checked.length>25)throw Error('每次最多選擇 25 個分類');
 const allowed=new Map(reportConfigs());
 return checked.map(input=>{
  const key=input.value,cfg=allowed.get(key);
  if(!cfg)throw Error('資料分類超出帳號權限');
  const selected=new Set([...document.querySelectorAll('.report-col-check:checked')].filter(x=>x.dataset.entity===key).map(x=>x.value));
  const columns=cfg.columns.filter(([field])=>selected.has(field));
  if(!columns.length)throw Error('「'+cfg.title+'」請至少選擇一個欄位');
  return {key,name:cfg.title,columns};
 });
}
async function fetchReports(selected,filters){
 const sheets=[];
 for(const x of selected){
  // Authoritative scope checks live on the server, never trust a hidden checkbox.
  const response=await api('/api/data?entity='+encodeURIComponent(x.key));
  const rows=ReportKit.project(response.rows,x.columns,{...filters,entity:x.key});
  sheets.push({name:ReportKit.safeName(x.name),
   headers:x.columns.map(c=>c[1]),rows,sourceCount:response.rows.length});
 }
 return sheets;
}
function renderReportPreview(sheets){
 const area=$('#report-print-preview');
 if(!area)return;
 const count=sheets.reduce((n,s)=>n+s.rows.length,0);
 area.innerHTML='<div class="report-print-meta">餐廳好管家 · 報表預覽　共 '+E(count)+' 筆 · '+E(new Date().toLocaleString('zh-TW'))+'</div>'+
 sheets.map(sheet=>'<section class="report-print-sheet"><h2>'+E(sheet.name)+'</h2><p>符合條件 '+E(sheet.rows.length)+' 筆；原始列表 '+E(sheet.sourceCount)+' 筆（可能有 API 筆數上限）</p>'+
 '<div class="table-wrap"><table><thead><tr>'+sheet.headers.map(h=>'<th>'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+
 sheet.rows.map(row=>'<tr>'+row.map(v=>'<td>'+E(ReportKit.value(v))+'</td>').join('')+'</tr>').join('')+
 '</tbody></table></div></section>').join('');
}
async function downloadWorkbook(sheets){
 if(!window.XlsxLite?.buildWorkbook)throw Error('找不到 Excel 匯出模組');
 const bytes=window.XlsxLite.buildWorkbook(sheets);
 const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download='餐廳好管家_資料匯出_'+new Date().toLocaleDateString('sv-SE')+'.xlsx';
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function makeReports(action){
 try{
  const reports=readSelectedReports(),filters=reportFilters();
  if(filters.from&&filters.to&&filters.from>filters.to)throw Error('日期起不得晚於日期迄');
  const sheets=await fetchReports(reports,filters);
  if(action==='xlsx'){await downloadWorkbook(sheets);toast('Excel 已產生，請妥善保存匯出資料');}
  else{
   renderReportPreview(sheets);
   if(action==='print')window.print();
   else toast('已產生預覽，可檢查後按「列印已選內容」');
  }
 }catch(e){toast('匯出未完成：'+e.message);}
}
async function exportCurrentPage(action){
 try{
  const page=S.page,cfg=pages[page];
  if(!cfg?.columns)throw Error('此頁無法匯出');
  // Re-fetch to check live authorization even if earlier cached rows remain.
  const fresh=await api('/api/data?entity='+encodeURIComponent(page));
  const filtered=ReportKit.project(fresh.rows,cfg.columns,{keyword:S.filter,searchAllFields:true,entity:page});
  const sheets=[{name:ReportKit.safeName(cfg.title),headers:cfg.columns.map(c=>c[1]),rows:filtered,sourceCount:fresh.rows.length}];
  if(action==='xlsx'){await downloadWorkbook(sheets);toast('Excel 已下載；僅含目前搜尋結果');}
  else{
   let area=$('#report-print-preview');
   if(!area){area=document.createElement('div');area.id='report-print-preview';$('#main').appendChild(area);}
   renderReportPreview(sheets);
   window.print();
  }
 }catch(err){toast('操作未完成：'+err.message);}
}
