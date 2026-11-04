// Dedicated native D1 browser client; never imports the public demo mock.
const $=id=>document.getElementById(id);
const labels={overview:'今日總覽',tasks:'工作',purchase_orders:'叫貨',
  stock:'庫存',repairs:'維修',shifts:'排班',ingredients:'食材',
  locations:'門市',training_courses:'訓練'};
const metrics={open_tasks:'待辦工作',pending_orders:'待處理叫貨',
  open_repairs:'未結維修',low_stock:'庫存不足'};
let csrf=null,view='overview',revision=0,controller=null;
const el=(tag,label)=>{const n=document.createElement(tag);if(label!==undefined)n.textContent=String(label??'—');return n;};
function say(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
async function api(url,opts={}){
  const r=await fetch(url,{method:'GET',mode:'same-origin',credentials:'same-origin',
    cache:'no-store',redirect:'manual',headers:{Accept:'application/json'},...opts});
  if(r.type==='opaqueredirect'||!/^application\/json(?:\s*;|$)/i.test(r.headers.get('content-type')||''))
    throw Object.assign(Error('此網址不是正式 API，請使用 Cloudflare 正式營運網站。'),{code:'E_RESPONSE'});
  let json;try{json=await r.json();}catch{throw Error('服務回應異常。');}
  if(!r.ok){
    const code=json?.code||'E_REQUEST';
    const msg=r.status===401?(code==='E_INVALID_CREDENTIALS'?'帳號或密碼錯誤。':'登入已失效。')
      :r.status===429?'登入嘗試過多，請稍後再試。'
      :r.status===503?'正式服務尚未啟用或資料庫暫時不可用。':'操作未成功，請重新整理。';
    throw Object.assign(Error(msg),{code,status:r.status});
  }
  return json;
}
function showLogin(message){
  csrf=null;revision++;if(controller)controller.abort();
  $('workspace').hidden=true;$('login').hidden=false;
  $('identity').textContent='';say(message||'請使用個人帳號登入。',!!message);
}
function table(rows){
  const frame=el('div');frame.className='scroll';
  const table=el('table'),thead=el('thead'),head=el('tr'),body=el('tbody');
  const columns=Object.keys(rows[0]).filter(k=>!['password_hash','password_salt',
    'token_hash','csrf_token'].includes(k)).slice(0,12);
  for(const col of columns)head.append(el('th',col));
  for(const row of rows){const tr=el('tr');
    for(const col of columns)tr.append(el('td',row[col]===undefined||row[col]===null?'—':row[col]));
    body.append(tr);
  }
  thead.append(head);table.append(thead,body);frame.append(table);return frame;
}
function render(data){
  if(data?.mode!=='native_d1')throw Error('伺服器資料模式不正確。');
  const content=$('content');content.replaceChildren();
  if(view==='overview'){
    const grid=el('div');grid.className='grid';
    for(const [key,label] of Object.entries(metrics)){
      if(!Number.isSafeInteger(data.metrics?.[key])||data.metrics[key]<0)throw Error('總覽資料格式不正確。');
      const item=el('div');item.className='metric';
      item.append(el('strong',data.metrics[key]),el('div',label));grid.append(item);
    }
    content.append(grid);return;
  }
  if(data.entity!==view||!Array.isArray(data.rows)||data.rows.length>500)
    throw Error('營運資料格式不正確。');
  content.append(data.rows.length?table(data.rows):el('p','此門市目前沒有符合條件的資料。'));
}
async function refresh(){
  const marker=++revision;if(controller)controller.abort();
  controller=new AbortController();$('content').replaceChildren();say('正在讀取真實 D1 資料…');
  try{
    const url=view==='overview'?'/api/overview':'/api/data?entity='+encodeURIComponent(view);
    const data=await api(url,{signal:controller.signal});
    if(marker!==revision)return;render(data);say('已取得授權範圍內的最新資料。');
  }catch(e){if(marker!==revision||e.name==='AbortError')return;
    if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
    say(e.message||'無法讀取資料。',true);
  }
}
function showWorkspace(me){
  if(!me?.user||typeof me.csrf!=='string')throw Error('身分驗證回應不完整。');
  csrf=me.csrf;$('login').hidden=true;$('workspace').hidden=false;
  $('identity').textContent=me.user.display_name+'（'+
    ({owner:'業主',manager:'主管',staff:'員工'}[me.user.role]||'')+'）';
  refresh();
}
async function start(){
  $('login').hidden=true;$('workspace').hidden=true;
  try{
    const status=await api('/api/native/status');
    if(status.mode!=='native'||status.login_enabled!==true){
      say('正式營運服務尚未由管理員啟用；公開 Demo 不接受真實帳密。',true);return;
    }
    try{showWorkspace(await api('/api/me'));}
    catch(e){if(e.status===401){showLogin();return;}throw e;}
  }catch(e){say(e.message||'無法確認正式服務狀態。',true);}
}
$('login-form').addEventListener('submit',async ev=>{
  ev.preventDefault();const f=ev.currentTarget,btn=$('login-submit');
  const username=f.elements.username.value,password=f.elements.password.value;
  if(!username||password.length<12||password.length>256)return;
  btn.disabled=true;say('正在驗證帳號…');
  try{
    await api('/api/login',{method:'POST',referrerPolicy:'same-origin',
      headers:{Accept:'application/json','Content-Type':'application/json'},
      body:JSON.stringify({username,password})});
    f.reset();showWorkspace(await api('/api/me'));
  }catch(e){f.elements.password.value='';say(e.message||'登入失敗。',true);}
  finally{btn.disabled=false;}
});
$('logout').addEventListener('click',async()=>{
  if(!csrf)return;const token=csrf;csrf=null;
  revision++;if(controller)controller.abort();$('workspace').hidden=true;
  try{
    await api('/api/logout',{method:'POST',referrerPolicy:'same-origin',
      headers:{Accept:'application/json','X-CSRF-Token':token}});
    showLogin();
  }catch{showLogin('無法確認登出結果，請關閉分頁並聯絡管理員撤銷工作階段。');}
});
for(const b of document.querySelectorAll('#nav button[data-view]'))
  b.addEventListener('click',()=>{
    if(!Object.hasOwn(labels,b.dataset.view))return;
    view=b.dataset.view;$('title').textContent=labels[view];
    refresh();
  });
$('refresh').addEventListener('click',refresh);
start();