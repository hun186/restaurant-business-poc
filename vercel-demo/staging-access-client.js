// Same-origin Cloudflare Access Staging browser client: GET data and a narrowly
// scoped, explicitly confirmed task.status POST when independently enabled.
// Only the browser attaches its protected-preview cookie. We NEVER read or
// copy the Access assertion, store user data, or accept an arbitrary API host.
export const ENTITY_LABELS=Object.freeze({
  tasks:'今日工作',purchase_orders:'叫貨單',stock:'庫存',
  repairs:'設備維修',shifts:'排班',
  ingredients:'食材主檔',locations:'門市',training_courses:'訓練課程'
});
const ERROR_CODES=Object.freeze({
  E_UNAUTHENTICATED:'尚未取得有效 Access 授權，或帳號／門市已被撤銷。',
  E_ACCESS_NOT_ENABLED:'Staging Access 唯讀查詢尚未由管理員啟用。',
  E_ACCESS_CONFIG_UNAVAILABLE:'Staging Access 設定尚未完成。',
  E_NOT_READY:'此環境沒有啟用 Staging Access 唯讀查詢。',
  E_SCHEMA_NOT_READY:'Staging 資料庫尚未完成必要的 Schema。',
  E_ACCESS_UNAVAILABLE:'Staging Access 身分驗證目前無法使用。',
  E_ACCESS_BUSINESS_UNAVAILABLE:'Staging 營運資料目前無法讀取。',
  E_TASK_WRITE_NOT_ENABLED:'管理員尚未啟用 Staging 工作狀態變更（目前僅能唯讀）。',
  E_NO_STATE_CHANGE:'此工作已經是指定狀態，無需重新寫入。',
  E_CONCURRENT_CHANGE:'工作或權限已變動，請重新整理後再操作。',
  E_TASK_NOT_FOUND:'工作不存在，或目前身分／門市無操作權限。',
  E_ORIGIN_DENIED:'瀏覽器來源驗證失敗，無法送出工作狀態更新。',
  E_TASK_WRITE_UNAVAILABLE:'工作狀態更新無法確認，請重新整理查詢後再決定是否重試。'
});
export class AccessPreviewError extends Error{
 constructor(code,status){
  super(ERROR_CODES[code]||'唯讀查詢失敗，請確認 Staging Access 設定及授權。');
  this.name='AccessPreviewError';this.code=code;this.status=status;
 }
}
const isRecord=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const validUser=u=>isRecord(u)&&typeof u.id==='string'&&u.id.length>0&&
  typeof u.username==='string'&&typeof u.display_name==='string'&&
  ['owner','manager','staff'].includes(u.role)&&Array.isArray(u.locations)&&
  u.locations.length<=200&&u.locations.every(x=>typeof x==='string');
function validate(json,type,entity){
 if(!isRecord(json)||json.status!=='staging_access_readonly'||
   json.production_ready!==false||json.session_created!==false||
   json.mutations_enabled!==false)throw new AccessPreviewError('E_INVALID_RESPONSE',200);
 if(type==='me'){
  if(!validUser(json.user))throw new AccessPreviewError('E_INVALID_RESPONSE',200);
 }else if(type==='overview'){
  const m=json.metrics;
  if(!isRecord(m)||!['open_tasks','pending_orders','open_repairs','low_stock']
    .every(k=>Number.isSafeInteger(m[k])&&m[k]>=0))
    throw new AccessPreviewError('E_INVALID_RESPONSE',200);
 }else if(type==='data'){
  if(json.entity!==entity||!Array.isArray(json.rows)||json.rows.length>500||
    !json.rows.every(isRecord))throw new AccessPreviewError('E_INVALID_RESPONSE',200);
 }
 return json;
}
export function createAccessPreviewClient(fetchImpl=fetch){
 if(typeof fetchImpl!=='function')throw new TypeError('fetch is required');
 async function read(path,type,entity,signal){
  // Paths below are hard-coded or built from a fixed allowlist. Never use a
  // caller-provided absolute URL, query string, bearer token or credential.
  const response=await fetchImpl(path,{
   method:'GET',mode:'same-origin',credentials:'same-origin',cache:'no-store',
   redirect:'manual',headers:{Accept:'application/json'},signal
  });
  if(!response||response.type==='opaqueredirect'||!Number.isSafeInteger(response.status))
   throw new AccessPreviewError('E_ACCESS_UNAVAILABLE',0);
  const mime=response.headers?.get('content-type')||'';
  if(!/^application\/json(?:\s*;|$)/i.test(mime))
   throw new AccessPreviewError('E_INVALID_RESPONSE',response.status);
  let json;
  try{json=await response.json();}catch{
   throw new AccessPreviewError('E_INVALID_RESPONSE',response.status);
  }
  if(!response.ok||response.status!==200)
   throw new AccessPreviewError(isRecord(json)&&typeof json.code==='string'?json.code:'E_ACCESS_UNAVAILABLE',response.status);
  return validate(json,type,entity);
 }
 // This is the ONLY mutating browser method. The server independently
 // authenticates Access, live D1 roles/stores and the dedicated write gate.
 async function changeTaskStatus(id,status,signal){
  if(typeof id!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id)||
     !['todo','doing','done'].includes(status))
   throw new AccessPreviewError('E_INVALID_COMMAND',400);
  const response=await fetchImpl('/api/access/task-status',{
   method:'POST',mode:'same-origin',credentials:'same-origin',cache:'no-store',
   redirect:'manual',referrerPolicy:'no-referrer',
   headers:{Accept:'application/json','Content-Type':'application/json',
    'X-Staging-Intent':'task.status'},
   body:JSON.stringify({action:'task.status',data:{id,status}}),signal
  });
  if(!response||response.type==='opaqueredirect'||!Number.isSafeInteger(response.status))
   throw new AccessPreviewError('E_TASK_WRITE_UNAVAILABLE',0);
  const mime=response.headers?.get('content-type')||'';
  if(!/^application\/json(?:\s*;|$)/i.test(mime))
   throw new AccessPreviewError('E_INVALID_RESPONSE',response.status);
  let json;
  try{json=await response.json();}catch{
   throw new AccessPreviewError('E_INVALID_RESPONSE',response.status);
  }
  if(!response.ok||response.status!==200)
   throw new AccessPreviewError(isRecord(json)&&typeof json.code==='string'?
    json.code:'E_TASK_WRITE_UNAVAILABLE',response.status);
  if(!isRecord(json)||json.ok!==true||json.environment!=='staging_access'||
     json.production_ready!==false||!isRecord(json.result)||
     json.result.id!==id||json.result.status!==status)
   throw new AccessPreviewError('E_INVALID_RESPONSE',200);
  return Object.freeze({id,status});
 }

 return Object.freeze({
  me:signal=>read('/api/access/me','me',null,signal),
  overview:signal=>read('/api/access/overview','overview',null,signal),
  data:async (entity,signal)=>{
   if(!Object.hasOwn(ENTITY_LABELS,entity))throw new AccessPreviewError('E_UNKNOWN_ENTITY',400);
   return read('/api/access/data?entity='+encodeURIComponent(entity),'data',entity,signal);
  },
  changeTaskStatus
 });
}
