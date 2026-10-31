import {createAccessPreviewClient,ENTITY_LABELS} from './staging-access-client.js';

// This page intentionally never loads the public mock.js or app.js. It only
// uses signed-Access /api/access/* on its OWN origin; only task.status may
// perform a manually confirmed POST if the server's independent Staging write
// gate is enabled. No storage, passwords, tokens or cross-origin endpoints.
const client=createAccessPreviewClient();
const $=id=>document.getElementById(id);
const viewNames={overview:'今日營運總覽',...ENTITY_LABELS};
const metricsLabels={
 open_tasks:'待處理工作',pending_orders:'待處理叫貨單',
 open_repairs:'待處理維修',low_stock:'低於安全庫存'
};
let view='overview',seq=0,controller=null,mutationInFlight=false;

function el(tag,text,cls){
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text!==undefined&&text!==null)node.textContent=String(text);
 return node;
}
function clear(){
 $('preview-user').textContent='尚未取得身分';
 $('preview-content').replaceChildren();
 $('preview-content').hidden=true;
}
function status(message,state='loading'){
 const target=$('preview-status');
 target.textContent=message;
 target.dataset.state=state;
}
function showMetrics(metrics){
 const grid=el('div',null,'preview-metrics');
 for(const [key,label] of Object.entries(metricsLabels)){
  const item=el('div',null,'preview-metric');
  item.append(el('strong',metrics[key]),el('span',label));
  grid.append(item);
 }
 $('preview-content').replaceChildren(grid);
 $('preview-content').hidden=false;
}
function displayValue(value){
 if(value===null||value===undefined||value==='')return '—';
 if(typeof value==='object')return JSON.stringify(value);
 return String(value);
}
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const taskStates=Object.freeze({todo:'待辦',doing:'處理中',done:'已完成'});
function taskAction(item){
 // This is only a convenience UI: the Worker alone decides authorization.
 if(typeof item.id!=='string'||!UUID.test(item.id)||
    !Object.hasOwn(taskStates,item.status))return el('span','不可變更');
 const cell=el('div',null,'preview-task-action');
 const select=el('select');
 select.setAttribute('aria-label','工作狀態');
 for(const [key,title] of Object.entries(taskStates)){
  const option=el('option',title);
  option.value=key;
  option.selected=key===item.status;
  select.append(option);
 }
 const submit=el('button','確認更新（Staging）','btn small');
 submit.type='button';submit.disabled=true;
 select.addEventListener('change',()=>{
  submit.disabled=mutationInFlight||select.value===item.status;
 });
 submit.addEventListener('click',async()=>{
  const desired=select.value;
  if(mutationInFlight||!Object.hasOwn(taskStates,desired)||
     desired===item.status)return;
  if(!window.confirm('這會變更 Staging D1 的工作狀態並新增稽核紀錄。\\n確定要更新嗎？'))return;
  mutationInFlight=true;
  const atSeq=seq;
  for(const button of document.querySelectorAll('.preview-task-action button'))
   button.disabled=true;
  status('正在更新 Staging 工作狀態；請勿重複送出…');
  try{
   await client.changeTaskStatus(item.id,desired);
   if(atSeq===seq&&view==='tasks')refresh();
  }catch(error){
   // A failed network response might still follow a committed transaction:
   // never retry automatically, or display stale prior data as current.
   if(atSeq===seq){
    clear();
    status((error?.message||'工作狀態更新結果無法確認。')+
     ' 請先重新整理確認最新狀態，不要直接重複送出。','error');
   }
  }finally{
   mutationInFlight=false;
  }
 });
 cell.append(select,submit);
 return cell;
}

function showRows(rows){
 const content=$('preview-content');
 if(rows.length===0){
  content.replaceChildren(el('div','目前沒有符合該身分與門市授權的資料。','preview-empty'));
  content.hidden=false;
  return;
 }
 const columns=Object.keys(rows[0]).slice(0,24);
 const isTaskView=view==='tasks';
 const table=el('table'),thead=el('thead'),headrow=el('tr');
 for(const column of columns)headrow.append(el('th',column));
 if(isTaskView)headrow.append(el('th','Staging 工作狀態操作'));
 thead.append(headrow);
 const tbody=el('tbody');
 for(const item of rows){
  const row=el('tr');
  for(const column of columns)row.append(el('td',displayValue(item[column])));
  if(isTaskView){const c=el('td');c.append(taskAction(item));row.append(c);}
  tbody.append(row);
 }
 table.append(thead,tbody);
 const frame=el('div',null,'preview-table');
 frame.append(table);
 if(isTaskView){
  const note=el('p','工作狀態更新需由管理員另行開啟 Staging 專用 Write Gate；未啟用時伺服器會拒絕，不會修改資料。其他所有頁面維持唯讀。','preview-task-note');
  content.replaceChildren(note,frame);
 }else content.replaceChildren(frame);
 content.hidden=false;
}
async function refresh(){
 const current=++seq;
 if(controller)controller.abort();
 controller=new AbortController();
 const signal=controller.signal;
 clear();status('正在確認 Cloudflare Access 身分及 D1 授權…');
 try{
  const identity=await client.me(signal);
  if(current!==seq)return;
  const result=view==='overview'?
    await client.overview(signal):await client.data(view,signal);
  if(current!==seq)return;
  const user=identity.user;
  $('preview-user').textContent=user.display_name+'（'+
    ({owner:'業主',manager:'主管',staff:'員工'}[user.role]||'未授權')+
    '）· 授權門市數：'+user.locations.length;
  if(view==='overview')showMetrics(result.metrics);
  else showRows(result.rows);
  status('讀取完成，權限已由伺服器核對。','success');
 }catch(error){
  if(current!==seq||error?.name==='AbortError')return;
  // Clear even previously loaded rows when a JWT / identity link expires.
  clear();
  status(error?.message||'Staging Access 尚未就緒，無法讀取營運資料。','error');
 }
}
for(const button of document.querySelectorAll('#preview-nav button[data-view]')){
 button.addEventListener('click',()=>{
  const next=button.dataset.view;
  if(next!=='overview'&&!Object.hasOwn(ENTITY_LABELS,next))return;
  view=next;
  for(const node of document.querySelectorAll('#preview-nav button[data-view]'))
   node.classList.toggle('active',node===button);
  $('preview-title').textContent=viewNames[view];
  $('preview-heading').textContent=viewNames[view];
  refresh();
 });
}
$('preview-reload').addEventListener('click',refresh);
refresh();
