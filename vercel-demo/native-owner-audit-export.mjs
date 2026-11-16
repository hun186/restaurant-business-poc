// Pure allowlisted audit timeline projection shared by Owner screen and Excel.
// Only the already-authorized current page (<=50 entries) can be exported.
// Never touch raw detail/ip_hash/actor_id, D1 or storage.
export const NATIVE_AUDIT_EVENTS=Object.freeze({
  'auth.login':'登入成功','auth.login_failed':'登入失敗',
  'auth.logout':'安全登出','user.create':'新增帳號',
  'user.active':'帳號啟用狀態變更','user.role':'帳號角色變更',
  'user.password':'密碼變更','password.change':'密碼變更',
  'task.create':'建立工作','task.status':'工作狀態變更',
  'stocktake.create':'建立盤點','stocktake.confirm':'確認盤點',
  'order.create':'建立叫貨','order.approve':'核准叫貨',
  'order.receive':'叫貨入庫','repair.create':'設備報修',
  'repair.status':'維修狀態變更'
});
const safeText=x=>typeof x==='string'?x.slice(0,32767):'—';
export function taipeiAuditTime(value){
 if(typeof value!=='string'||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(value))
  return '時間資料異常';
 const d=new Date(value.replace(' ','T')+'Z');
 return Number.isNaN(d.getTime())?'時間資料異常':
   new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',
     month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
     hour12:false}).format(d);
}
export function nativeAuditPageSheet(rows){
 if(!Array.isArray(rows)||rows.length>50||
    rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))
  throw Error('E_AUDIT_EXPORT_INVALID');
 return Object.freeze({
  name:'安全稽核',
  headers:['時間（臺灣）','操作者','事件','資料類別','內容摘要'],
  rows:rows.map(item=>[
   taipeiAuditTime(item.at),safeText(item.actor_name),
   (typeof item.action==='string'&&Object.hasOwn(NATIVE_AUDIT_EVENTS,item.action)?
     NATIVE_AUDIT_EVENTS[item.action]:safeText(item.action)),
   safeText(item.entity),safeText(item.summary)
  ])
 });
}
