// Native Owner D1 display allowlist. No network, storage, DOM or Demo dependencies.
const FIELDS={
 locations:[['name','門市'],['active','啟用狀態']],
 ingredients:[['sku','食材代碼'],['name','食材名稱'],['unit','單位'],['min_stock','最低庫存'],['active','啟用狀態']],
 training_courses:[['title','課程'],['description','說明'],['required_score','合格分數'],['active','啟用狀態']],
 tasks:[['title','工作事項'],['location_name','門市'],['assigned_name','指派人員'],['status','進度'],['due_date','到期日'],['created_at','建立時間']],
 purchase_orders:[['number','叫貨單號'],['location_name','門市'],['ingredient_name','食材'],['supplier','供應商'],['qty','數量'],['unit','單位'],['status','叫貨狀態'],['created_at','申請時間']],
 stock:[['location_name','門市'],['name','食材'],['sku','代碼'],['on_hand','現有庫存'],['min_stock','最低庫存'],['unit','單位'],['stock_alert','庫存狀態']],
 stocktakes:[['location_name','門市'],['ingredient_name','食材'],['expected_qty','帳面庫存'],['counted_qty','實際盤點'],['unit','單位'],['status','盤點狀態'],['created_at','建立時間']],
 repairs:[['location_name','門市'],['equipment','設備'],['description','故障說明'],['assigned_name','指派人員'],['status','維修狀態'],['created_at','報修時間']],
 shifts:[['location_name','門市'],['staff_name','員工'],['shift_date','班表日期'],['start_time','開始時間'],['end_time','結束時間'],['note','備註']]
};
const STATUS={
 tasks:{todo:'待辦',doing:'進行中',done:'已完成'},
 purchase_orders:{requested:'待核准',approved:'已核准',received:'已入庫',cancelled:'已取消'},
 stocktakes:{pending:'待確認',confirmed:'已確認'},
 repairs:{reported:'待處理',assigned:'已指派',closed:'已結案'}
};
const POSITIVE=new Set(['done','received','confirmed','closed']);
const ATTENTION=new Set(['todo','doing','requested','approved','pending','reported','assigned']);
const QUANTITIES=new Set(['qty','on_hand','min_stock','expected_qty','counted_qty','required_score']);
const numberFormat=new Intl.NumberFormat('zh-TW',{maximumFractionDigits:3});
const blank=()=>({text:'—',tone:''});
function cell(entity,row,key){
 if(key==='stock_alert'){
  if(typeof row.on_hand!=='number'||!Number.isFinite(row.on_hand)||
     typeof row.min_stock!=='number'||!Number.isFinite(row.min_stock))
    return {text:'無法判定',tone:'muted'};
  return row.on_hand<row.min_stock?{text:'低於下限',tone:'warn'}:{text:'正常',tone:'ok'};
 }
 if(!Object.hasOwn(row,key)||row[key]===null||row[key]===undefined||row[key]==='')return blank();
 const value=row[key];
 if(key==='active'){
  if(value===1||value===true)return {text:'啟用',tone:'ok'};
  if(value===0||value===false)return {text:'停用',tone:'muted'};
  return {text:'未識別',tone:'warn'};
 }
 if(key==='status'){
  if(typeof value!=='string'||!Object.hasOwn(STATUS[entity]||{},value))
   return {text:'未識別',tone:'warn'};
  return {text:STATUS[entity][value],tone:POSITIVE.has(value)?'ok':ATTENTION.has(value)?'warn':'muted'};
 }
 if(QUANTITIES.has(key)){
  return typeof value==='number'&&Number.isFinite(value)?
   {text:numberFormat.format(value),tone:''}:blank();
 }
 if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')
  return {text:String(value),tone:''};
 return blank();
}
export function presentNativeRows(entity,rows){
 if(!Object.hasOwn(FIELDS,entity)||!Array.isArray(rows)||rows.length>500||
    rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))
  throw Error('E_NATIVE_DISPLAY_INVALID');
 const columns=FIELDS[entity].map(([key,label])=>({key,label}));
 return {columns,entries:rows.map(row=>{
  const cells=columns.map(col=>cell(entity,row,col.key));
  return {cells,search:cells.map(c=>c.text).join(' ').toLocaleLowerCase('zh-TW')};
 })};
}

const NATIVE_PAGE_SIZES=Object.freeze([25,50,100]);
export function pageNativeEntries(entries,page=1,pageSize=25){
 if(!Array.isArray(entries)||entries.length>500||!Number.isSafeInteger(page)||
    page<1||!NATIVE_PAGE_SIZES.includes(pageSize))
  throw Error('E_NATIVE_PAGE_INVALID');
 const pages=Math.max(1,Math.ceil(entries.length/pageSize));
 const current=Math.min(page,pages),start=(current-1)*pageSize;
 return {rows:entries.slice(start,start+pageSize),page:current,pages,
  total:entries.length,from:entries.length?start+1:0,
  to:Math.min(start+pageSize,entries.length)};
}
