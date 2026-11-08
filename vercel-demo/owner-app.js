// Dedicated native D1 browser client; never imports the public demo mock.
const $=id=>document.getElementById(id);
const labels={overview:'今日總覽',tasks:'工作',purchase_orders:'叫貨',
  stock:'庫存',repairs:'維修',shifts:'排班',ingredients:'食材',
  locations:'門市',training_courses:'訓練'};
const metrics={open_tasks:'待辦工作',pending_orders:'待處理叫貨',
  open_repairs:'未結維修',low_stock:'庫存不足'};
let csrf=null,view='overview',revision=0,controller=null,role=null,writeEnabled=false;
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

const taskId=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
async function writeTask(action,data){
  if(!writeEnabled||!csrf)return;
  try{
    say('正在儲存真實 D1 工作資料，請勿重複送出…');
    const result=await api('/api/task',{method:'POST',referrerPolicy:'same-origin',
      headers:{Accept:'application/json','Content-Type':'application/json',
        'X-CSRF-Token':csrf},
      body:JSON.stringify({action,data})});
    if(result?.ok!==true)throw Error('伺服器未確認寫入。');
    await refresh();
  }catch(e){
    if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
    say((e.message||'寫入結果不明')+' 請先重新整理確認結果，不要直接重複送出。',true);
  }
}
async function taskActions(rows,marker){
  const content=$('content');
  let candidatePeople=[];
  if(!writeEnabled){
    content.append(el('p','工作狀態目前唯讀；正式寫入尚待管理員授權。'));return;
  }
  if(role==='owner'||role==='manager'){
    const [stores,people]=await Promise.all([
      api('/api/data?entity=locations',{signal:controller.signal}),
      api('/api/data?entity=assignable_staff',{signal:controller.signal})]);
    if(marker!==revision)return;
    if(stores?.mode!=='native_d1'||!Array.isArray(stores.rows)||
       people?.mode!=='native_d1'||!Array.isArray(people.rows))
      throw Error('門市與可指派人員未取得，無法新增工作。');
    candidatePeople=people.rows;
    const pane=el('section'),title=el('h3','新增工作');
    pane.className='panel';
    const form=el('form'),select=el('select'),assignee=el('select'),
      input=el('input'),due=el('input'),submit=el('button','新增工作');
    due.type='date';due.setAttribute('aria-label','工作期限（選填）');
    input.placeholder='輸入工作內容';input.required=true;input.maxLength=120;
    for(const store of stores.rows){
      if(store.active!==1||typeof store.id!=='string'||!taskId.test(store.id))continue;
      const option=el('option',store.name);option.value=store.id;select.append(option);
    }
    const updateAssignees=()=>{
      assignee.replaceChildren();
      const unassigned=el('option','暫不指派');unassigned.value='';assignee.append(unassigned);
      for(const person of people.rows){
        if(person.location_id!==select.value||!taskId.test(person.id)||
           !['staff','manager'].includes(person.role))continue;
        const option=el('option',person.display_name||'員工');
        option.value=person.id;assignee.append(option);
      }
    };
    select.addEventListener('change',updateAssignees);
    updateAssignees();
    submit.type='submit';submit.disabled=!select.options.length;
    form.append(el('label','門市 '),select,el('label','指派給 '),assignee,
      el('label','工作內容 '),input,el('label','期限（選填） '),due,submit);
    form.addEventListener('submit',async ev=>{
      ev.preventDefault();const title=input.value.trim();
      if(!title||title.length>120||!taskId.test(select.value))return;
      submit.disabled=true;
      const data={location_id:select.value,title};
      if(assignee.value&&taskId.test(assignee.value))data.assigned_to=assignee.value;
      if(due.value)data.due_date=due.value;
      await writeTask('task.create',data);
      submit.disabled=false;
    });
    pane.append(title,form);content.prepend(pane);
  }
  const list=el('section');list.className='panel';
  list.append(el('h3','更新工作狀態'));
  let count=0;
  for(const row of rows){
    if(!taskId.test(row.id)||!['todo','doing','done'].includes(row.status))continue;
    const container=el('div'),select=el('select'),save=el('button','儲存狀態');
    container.style.marginBottom='12px';
    for(const [value,label] of Object.entries({todo:'待辦',doing:'處理中',done:'已完成'})){
      const opt=el('option',label);opt.value=value;opt.selected=value===row.status;select.append(opt);
    }
    save.type='button';
    save.disabled=true;
    select.addEventListener('change',()=>{save.disabled=select.value===row.status;});
    save.addEventListener('click',async()=>{
      if(save.disabled||!window.confirm('確定更新真實 D1 工作狀態？'))return;
      save.disabled=true;await writeTask('task.status',{id:row.id,status:select.value});
    });
    container.append(el('strong',row.title||'工作'),el('span',' · '),select,save);
    if((role==='owner'||role==='manager')&&row.status!=='done'&&
       taskId.test(row.location_id)&&
       (row.assigned_to===null||taskId.test(row.assigned_to))){
      const original=row.assigned_to??null;
      const assignee=el('select'),assignSave=el('button','更新指派');
      let empty=el('option','暫不指派');empty.value='';assignee.append(empty);
      for(const person of candidatePeople){
        if(person.location_id!==row.location_id||!taskId.test(person.id)||
           !['staff','manager'].includes(person.role))continue;
        const option=el('option',person.display_name||'員工');
        option.value=person.id;assignee.append(option);
      }
      // A no-longer-active assignee cannot be newly selected; retain old ID
      // only for compare-and-set, so an authorized manager can unassign.
      assignee.value=original&&[...assignee.options].some(x=>x.value===original)
        ? original:'';
      assignSave.type='button';
      assignSave.disabled=(assignee.value||null)===original;
      assignee.addEventListener('change',()=>{
        assignSave.disabled=(assignee.value||null)===original;
      });
      assignSave.addEventListener('click',async()=>{
        if(assignSave.disabled||!window.confirm('確定變更真實 D1 工作指派？'))return;
        assignSave.disabled=true;
        await writeTask('task.assign',{id:row.id,assigned_to:assignee.value||null,
          expected_assigned_to:original});
      });
      container.append(el('span',' · 指派 '),assignee,assignSave);
    }
    if((role==='owner'||role==='manager')&&row.status!=='done'&&
       taskId.test(row.location_id)&&
       (row.due_date===null||typeof row.due_date==='string'&&
         /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(row.due_date))){
      const previous=row.due_date??null,date=el('input'),
        saveDue=el('button','更新期限');
      date.type='date';date.value=previous||'';
      date.setAttribute('aria-label','工作期限');
      saveDue.type='button';saveDue.disabled=(date.value||null)===previous;
      date.addEventListener('change',()=>{
        saveDue.disabled=(date.value||null)===previous;
      });
      saveDue.addEventListener('click',async()=>{
        if(saveDue.disabled||!window.confirm('確定更新真實 D1 工作期限？'))return;
        saveDue.disabled=true;
        await writeTask('task.due',{id:row.id,due_date:date.value||null,
          expected_due_date:previous});
      });
      container.append(el('span',' · 期限 '),date,saveDue);
    }
    list.append(container);count++;
  }
  if(count)content.append(list);
}

async function refresh(){
  const marker=++revision;if(controller)controller.abort();
  controller=new AbortController();$('content').replaceChildren();say('正在讀取真實 D1 資料…');
  try{
    const url=view==='overview'?'/api/overview':'/api/data?entity='+encodeURIComponent(view);
    const data=await api(url,{signal:controller.signal});
    if(marker!==revision)return;
    render(data);
    if(view==='tasks')await taskActions(data.rows,marker);
    if(marker===revision)say('已取得授權範圍內的最新資料。');
  }catch(e){if(marker!==revision||e.name==='AbortError')return;
    if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
    say(e.message||'無法讀取資料。',true);
  }
}
function showWorkspace(me){
  if(!me?.user||typeof me.csrf!=='string')throw Error('身分驗證回應不完整。');
  csrf=me.csrf;role=me.user.role;$('login').hidden=true;$('workspace').hidden=false;
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
    writeEnabled=status.task_write_enabled===true;
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