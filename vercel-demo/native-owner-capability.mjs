// Presentation-only labels for the authenticated Native Owner workspace.
// Backend authorization, role restrictions and Cloudflare write gates remain
// authoritative. Never use these labels to decide whether a write is allowed.
const WRITE_VIEWS=new Set(['tasks','locations','ingredients','purchase_orders',
 'stocktakes','repairs']);

export function nativeOwnerCapability({view,role,task=false,catalog=false,
 order=false,stocktake=false,repair=false}){
 const anyWrite=Boolean(task||catalog||order||stocktake||repair);
 const writable={
  tasks:task,
  locations:catalog&&role==='owner',
  ingredients:catalog&&role==='owner',
  purchase_orders:order,
  stocktakes:stocktake,
  repairs:repair
 };
 const pageWritable=WRITE_VIEWS.has(view)&&Boolean(writable[view]);
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
