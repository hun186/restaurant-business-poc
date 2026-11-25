// Presentation-only labels for the authenticated Native Owner workspace.
// Backend authorization, role restrictions and Cloudflare write gates remain
// authoritative. Never use these labels to decide whether a write is allowed.
const WRITE_VIEWS=new Set(['tasks','locations','ingredients','ingredient_prices','stock','purchase_orders',
 'stocktakes','repairs']);

export function nativeOwnerCapability({view,role,task=false,catalog=false,
 order=false,stocktake=false,repair=false,price=false,stockUsage=false,stockV4=false,account=false,
 accountStatus=false,accountRole=false,accountGrants=false,accountPasswordReset=false}){
 const anyWrite=Boolean(task||catalog||order||stocktake||repair||price||stockUsage||stockV4);
 // Keep the three independent Owner account permissions separate. The
 // capability flags are only supplied by the authenticated /api/accounts GET.
 const owner=role==='owner';
 const canCreate=owner&&account===true;
 const canStatus=owner&&accountStatus===true;
 const canRole=owner&&accountRole===true;
 const canGrants=owner&&accountGrants===true;
 const canReset=owner&&accountPasswordReset===true;
 const accountWritable=canCreate||canStatus||canRole||canGrants||canReset;
 const systemLabel=anyWrite?'正式營運模式':
  accountWritable?(canCreate&&!canStatus&&!canRole&&!canGrants&&!canReset?
    '帳號新增已啟用':'帳號管理已啟用'):'登入服務已啟用';
 const writable={
  tasks:task,
  locations:catalog&&owner,
  ingredients:catalog&&owner,
  ingredient_prices:price&&['owner','manager'].includes(role),
  stock:(stockUsage||stockV4)&&['owner','manager'].includes(role),
  purchase_orders:order,
  stocktakes:stocktake,
  repairs:repair
 };
 const pageWritable=WRITE_VIEWS.has(view)&&Boolean(writable[view]);
 if(view==='accounts')return Object.freeze({
  systemLabel,systemWritable:anyWrite||accountWritable,
  pageLabel:canCreate&&!(canStatus||canRole||canGrants||canReset)?'帳號管理・可新增':
   canCreate&&(canStatus||canRole||canGrants||canReset)?'帳號管理・可新增及管理':
   canStatus||canRole||canGrants||canReset?'帳號管理・可管理':'帳號管理・僅檢視',
  pageWritable:accountWritable,
  description:[
   canCreate?'可建立員工與主管帳號。':'新增帳號尚未開放。',
   canStatus?'可停用／啟用員工及主管，撤銷原工作階段。':'停用／啟用尚未開放。',
   canRole?'可調整員工與主管角色，撤銷原工作階段。':'角色調整尚未開放。',
   canGrants?'可逐一調整員工門市授權，撤銷原工作階段。':'門市授權調整尚未開放。',
   canReset?'可替啟用員工與主管重設密碼，撤銷原工作階段。':'重設他人密碼尚未開放。'
  ].join('')
 });
 if(view==='audit_logs')return Object.freeze({
  systemLabel:anyWrite?'正式營運模式':'登入服務已啟用',
  systemWritable:anyWrite,
  pageLabel:'安全稽核・僅檢視',
  pageWritable:false,
  description:'只有業主可檢視登入、帳號及重要營運異動紀錄；不顯示密碼、Token、IP 雜湊或原始稽核細節。'
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
