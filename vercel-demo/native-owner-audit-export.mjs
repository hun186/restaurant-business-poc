// Pure allowlisted audit timeline projection shared by Owner screen and Excel.
// Only the already-authorized current page (<=50 entries) can be exported.
// Never touch raw detail/ip_hash/actor_id, D1 or storage.
export const NATIVE_AUDIT_EVENTS=Object.freeze({
  'auth.login':'登入成功','auth.login_failed':'登入失敗',
  'auth.logout':'安全登出','auth.password_change':'變更登入密碼',
  'auth.owner_bootstrap':'正式業主帳號初始化',
  'password.change':'密碼變更',
  'user.create':'新增帳號','user.active':'帳號啟用狀態變更',
  'user.role':'帳號角色變更','user.password':'重設帳號密碼',
  'user.password_reset':'業主重設員工密碼',
  'user.assign-location':'新增門市授權',
  'user.unassign-location':'移除門市授權',
  'location.create':'建立門市','location.update':'修改門市',
  'location.active':'門市啟用狀態變更',
  'ingredient.create':'建立食材','ingredient.update':'修改食材',
  'ingredient.active':'食材啟用狀態變更',
  'task.create':'建立工作','task.status':'工作狀態變更',
  'task.assign':'變更工作指派','task.due':'變更工作期限',
  'order.create':'建立叫貨','order.approve':'核准叫貨',
  'order.receive':'叫貨入庫','order.cancel':'取消叫貨',
  'stocktake.create':'建立盤點','stocktake.confirm':'確認盤點',
  'repair.create':'設備報修','repair.status':'維修狀態變更',
  'repair.update':'更新維修單',
  'shift.create':'新增排班',
  'leave.create':'提出請假申請',
  'leave.review':'請假審核',
  'course.create':'建立訓練課程',
  'training.assign':'指派教育訓練',
  'training.score':'登錄訓練成績',
  'evaluation.create':'建立員工考核',
});
// The two Owner presentation surfaces share this display-only allowlist.
// D1 still stores and filters the exact immutable original action/entity codes.
export const NATIVE_AUDIT_ENTITIES=Object.freeze({
  users:'帳號',sessions:'登入工作階段',user_locations:'門市授權',
  locations:'門市',ingredients:'食材',tasks:'工作',
  purchase_orders:'叫貨單',stocktakes:'盤點紀錄',
  stock_moves:'庫存流水',repairs:'維修單',
  audit_logs:'安全稽核',
  'shifts':'班表',
  'leave_requests':'請假申請',
  'training_courses':'訓練課程',
  'training_records':'訓練紀錄',
  'evaluations':'員工考核',
});
const auditCode=value=>typeof value==='string'?value.slice(0,80):'';
export function nativeAuditEventLabel(value){
 const code=auditCode(value);
 return !code?'—':Object.hasOwn(NATIVE_AUDIT_EVENTS,code)?
   NATIVE_AUDIT_EVENTS[code]:'其他事件（'+code+'）';
}
export function nativeAuditEntityLabel(value){
 const code=auditCode(value);
 return !code?'—':Object.hasOwn(NATIVE_AUDIT_ENTITIES,code)?
   NATIVE_AUDIT_ENTITIES[code]:'其他類別（'+code+'）';
}
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
   nativeAuditEventLabel(item.action),
   nativeAuditEntityLabel(item.entity),safeText(item.summary)
  ])
 });
}
