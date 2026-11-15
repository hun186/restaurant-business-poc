// Presentation-only labels for the authenticated Native Owner workspace.
// Backend authorization, role restrictions and Cloudflare write gates remain
// authoritative. Never use these labels to decide whether a write is allowed.
const WRITE_VIEWS=new Set(['tasks','locations','ingredients','purchase_orders',
 'stocktakes','repairs']);

export function nativeOwnerCapability({view,role,task=false,catalog=false,
 order=false,stocktake=false,repair=false,account=false}){
 const anyWrite=Boolean(task||catalog||order||stocktake||repair);
 const accountWritable=account===true&&role==='owner';
 const systemLabel=anyWrite?'正式營運模式':accountWritable?'帳號新增已啟用':'登入服務已啟用';
 const writable={
  tasks:task,
  locations:catalog&&role==='owner',
  ingredients:catalog&&role==='owner',
  purchase_orders:order,
  stocktakes:stocktake,
  repairs:repair
 };
 const pageWritable=WRITE_VIEWS.has(view)&&Boolean(writable[view]);
 if(view==='accounts')return Object.freeze({
  systemLabel,systemWritable:anyWrite||accountWritable,
  pageLabel:accountWritable?'帳號管理・可新增':'帳號管理・僅檢視',
  pageWritable:accountWritable,
  description:accountWritable?
   '業主可以新增員工與主管；停用、角色調整及他人密碼重設尚未開放。':
   '業主可查看帳號，新增帳號需獨立寫入權限；其他功能依各頁權限顯示。'
 });
 if(view==='account')return Object.freeze({
  systemLabel:anyWrite?'正式營運模式':'登入服務已啟用',
  systemWritable:anyWrite,
  pageLabel:'帳號安全・密碼管理',
  pageWritable:true,
  description:'可變更本人的登入密碼；不受門市等業務寫入開關影響。成功後所有裝置須重新登入。'
 });
 if(view==='overview')return Object.freeze({
  systemLabel:anyWrite?'正式營運模式':'登入服務已啟用',
  systemWritable:anyWrite,
  pageLabel:'總覽看板・僅檢視',
  pageWritable:false,
  description:'今日總覽只供檢視。新增或修改工作、門市、食材、叫貨、盤點與維修，請使用左側對應功能。'
 });
 return Object.freeze({
  systemLabel:anyWrite?'正式營運模式':'登入服務已啟用',
  systemWritable:anyWrite,
  pageLabel:pageWritable?'本頁操作已啟用':'本頁僅檢視',
  pageWritable,
  description:pageWritable
   ?'可依登入身分及後端授權操作本頁資料；實際寫入仍由伺服器驗證。'
   :'本頁未開放寫入或僅提供查詢；其他功能是否可操作，請看左側對應頁面。'
 });
}
