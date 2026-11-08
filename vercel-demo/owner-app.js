// Dedicated native D1 browser client; never imports the public demo mock.
const $=id=>document.getElementById(id);
const labels={overview:'今日總覽',tasks:'工作',purchase_orders:'叫貨',
  stock:'庫存',stocktakes:'盤點',repairs:'維修',shifts:'排班',ingredients:'食材',
  locations:'門市',training_courses:'訓練'};
const metrics={open_tasks:'待辦工作',pending_orders:'待處理叫貨',
  open_repairs:'未結維修',low_stock:'庫存不足'};
const viewHints={overview:'授權範圍內的即時營運資訊',tasks:'今日工作與進度追蹤',
  purchase_orders:'門市請購、核准及收貨紀錄',stock:'由庫存流水帳本計算的現況',
  stocktakes:'盤點與差額調整紀錄',repairs:'設備報修與處理進度',
  shifts:'班表資訊（目前唯讀）',ingredients:'食材及安全庫存主檔',
  locations:'門市基本資訊',training_courses:'教育訓練資訊（目前唯讀）'};
let csrf=null,view='overview',revision=0,controller=null,role=null,writeEnabled=false,
  catalogWriteEnabled=false,orderWriteEnabled=false,stocktakeWriteEnabled=false,
  repairWriteEnabled=false;
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
  csrf=null;revision++;if(controller)controller.abort();closeMenu();
  $('workspace').hidden=true;$('locked').hidden=true;$('login').hidden=false;
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
  content.append(data.rows.length?table(data.rows):el('p','此門市目前沒有符合條件的資料，請確認目前門市權限或稍後重新整理。'));
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
async function catalogActions(marker){
  if(!catalogWriteEnabled||role!=='owner')return;
  if(view!=='locations'&&view!=='ingredients')return;
  const pane=el('section');pane.className='panel';
  const form=el('form'),submit=el('button',view==='locations'?'建立門市':'建立食材');
  submit.type='submit';
  pane.append(el('h3',view==='locations'?'新增門市':'新增食材主檔'));
  const field=(label,options={})=>{
    const input=el('input');input.type=options.type||'text';
    input.placeholder=label;input.required=options.required!==false;
    if(options.maxLength)input.maxLength=options.maxLength;
    if(options.step)input.step=options.step;
    if(options.min!==undefined)input.min=String(options.min);
    if(options.max!==undefined)input.max=String(options.max);
    input.setAttribute('aria-label',label);
    form.append(el('label',label+' '),input);return input;
  };
  const isStore=view==='locations';
  const name=field(isStore?'門市名稱':'食材名稱',{maxLength:120});
  let sku,unit,minimum;
  if(!isStore){
    sku=field('食材代碼（英文數字、底線或連字號）',{maxLength:40});
    unit=field('單位（例如 kg、包）',{maxLength:20});
    minimum=field('最低庫存',{type:'number',required:false,step:'0.001',min:0,max:1000000});
    minimum.value='0';
  }
  form.append(submit);
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(!catalogWriteEnabled||!csrf||submit.disabled)return;
    const data=isStore?{name:name.value.trim()}:{
      name:name.value.trim(),sku:sku.value.trim(),unit:unit.value.trim(),
      min_stock:Number(minimum.value||0)};
    if(!data.name)return;
    submit.disabled=true;
    try{
      say('正在儲存 D1 主檔，請勿重複送出…');
      const result=await api('/api/catalog',{method:'POST',
        headers:{Accept:'application/json','Content-Type':'application/json',
          'X-CSRF-Token':csrf},referrerPolicy:'same-origin',
        body:JSON.stringify({action:isStore?'location.create':'ingredient.create',data})});
      if(result?.ok!==true)throw Error('未確認主檔已儲存。');
      await refresh();
    }catch(e){
      if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
      say((e.status===409?'門市名稱或食材代碼已存在。':e.message||'寫入結果不明')+
        ' 請先重新整理確認，不要直接重複送出。',true);
    }finally{submit.disabled=false;}
  });
  pane.append(form);$('content').prepend(pane);
}
async function writeOrder(action,data){
  if(!orderWriteEnabled||!csrf)return;
  try{
    say('正在儲存真實 D1 叫貨資料，請勿重複送出…');
    const result=await api('/api/order',{method:'POST',
      headers:{Accept:'application/json','Content-Type':'application/json',
        'X-CSRF-Token':csrf},referrerPolicy:'same-origin',
      body:JSON.stringify({action,data})});
    if(result?.ok!==true)throw Error('伺服器未確認交易完成。');
    await refresh();
  }catch(e){
    if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
    say((e.status===409?'叫貨單狀態已變更或權限已調整。':e.message||'寫入結果不明')+
      ' 請重新整理核對庫存與叫貨單，勿直接重複驗收入庫。',true);
  }
}
async function orderActions(rows,marker){
  if(!orderWriteEnabled)return;
  const [stores,ingredients]=await Promise.all([
    api('/api/data?entity=locations',{signal:controller.signal}),
    api('/api/data?entity=ingredients',{signal:controller.signal})]);
  if(marker!==revision)return;
  if(stores?.mode!=='native_d1'||ingredients?.mode!=='native_d1'||
     !Array.isArray(stores.rows)||!Array.isArray(ingredients.rows))
    throw Error('門市或食材清單無法取得，請重新整理。');
  const pane=el('section');pane.className='panel';
  pane.append(el('h3','建立叫貨申請'));
  const form=el('form'),store=el('select'),ingredient=el('select'),
    supplier=el('input'),qty=el('input'),submit=el('button','送出叫貨申請');
  supplier.required=true;supplier.maxLength=120;
  supplier.placeholder='供應商名稱';
  qty.type='number';qty.min='0.001';qty.max='1000000';qty.step='0.001';
  qty.required=true;qty.placeholder='數量';
  for(const x of stores.rows){
    if(x.active!==1||!taskId.test(x.id))continue;
    const opt=el('option',x.name);opt.value=x.id;store.append(opt);
  }
  for(const x of ingredients.rows){
    if(x.active!==1||!taskId.test(x.id))continue;
    const opt=el('option',x.name+'（'+x.unit+'）');opt.value=x.id;ingredient.append(opt);
  }
  submit.type='submit';submit.disabled=!store.options.length||!ingredient.options.length;
  form.append(el('label','門市 '),store,el('label','食材 '),ingredient,
    el('label','供應商 '),supplier,el('label','數量 '),qty,submit);
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(submit.disabled||!taskId.test(store.value)||!taskId.test(ingredient.value))return;
    const count=Number(qty.value);
    if(!Number.isFinite(count)||count<=0||count>1000000)return;
    submit.disabled=true;
    try{await writeOrder('order.create',{
      location_id:store.value,ingredient_id:ingredient.value,
      supplier:supplier.value.trim(),qty:count});
    }finally{submit.disabled=false;}
  });
  pane.append(form);$('content').prepend(pane);
  if(role!=='manager'&&role!=='owner')return;
  const controls=el('section');controls.className='panel';
  controls.append(el('h3','叫貨核准與入庫'));
  let shown=0;
  for(const row of rows){
    if(!taskId.test(row.id)||!['requested','approved'].includes(row.status))continue;
    const validNumber='PO-'+row.id.replaceAll('-','').toUpperCase();
    if(row.number!==validNumber)continue;
    const line=el('div');line.style.marginBottom='12px';
    line.append(el('strong',row.number+' · '+row.ingredient_name+
      ' · '+row.qty+' '+row.unit));
    const actions=row.status==='requested'?
      [['order.approve','核准叫貨'],['order.cancel','取消']]:
      [['order.receive','驗收入庫'],['order.cancel','取消']];
    for(const [action,label] of actions){
      const btn=el('button',label);btn.type='button';btn.style.marginLeft='8px';
      btn.addEventListener('click',async()=>{
        if(btn.disabled||!window.confirm(
          action==='order.receive'?'確認貨物已收到？驗收將寫入真實 D1 庫存流水。':'確定執行「'+label+'」？'))return;
        btn.disabled=true;
        try{await writeOrder(action,{id:row.id,expected_status:row.status});}
        finally{btn.disabled=false;}
      });
      line.append(btn);
    }
    controls.append(line);shown++;
  }
  if(shown)$('content').append(controls);
}

async function writeStocktake(action,data){
  if(!stocktakeWriteEnabled||!csrf)return;
  try{
    say('正在儲存真實 D1 盤點資料，請勿重複送出…');
    const result=await api('/api/stocktake',{method:'POST',
      headers:{Accept:'application/json','Content-Type':'application/json',
        'X-CSRF-Token':csrf},referrerPolicy:'same-origin',
      body:JSON.stringify({action,data})});
    if(result?.ok!==true)throw Error('伺服器未確認盤點異動。');
    await refresh();
  }catch(e){
    if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
    say((e.status===409?'盤點已過期或庫存已變動，請重新盤點。':
      e.message||'盤點結果不明')+
      ' 請先重新整理查詢帳本，勿直接重複確認。',true);
  }
}
async function stocktakeActions(rows,marker){
  if(!stocktakeWriteEnabled)return;
  const [stores,ingredients]=await Promise.all([
    api('/api/data?entity=locations',{signal:controller.signal}),
    api('/api/data?entity=ingredients',{signal:controller.signal})]);
  if(marker!==revision)return;
  if(stores?.mode!=='native_d1'||ingredients?.mode!=='native_d1'||
     !Array.isArray(stores.rows)||!Array.isArray(ingredients.rows))
    throw Error('門市或食材資料無法取得。');
  const pane=el('section');pane.className='panel';
  pane.append(el('h3','建立盤點記錄'));
  const form=el('form'),store=el('select'),ingredient=el('select'),
    counted=el('input'),submit=el('button','建立待核准盤點');
  for(const x of stores.rows){
    if(x.active!==1||!taskId.test(x.id))continue;
    const opt=el('option',x.name);opt.value=x.id;store.append(opt);
  }
  for(const x of ingredients.rows){
    if(x.active!==1||!taskId.test(x.id))continue;
    const opt=el('option',x.name+'（'+x.unit+'）');
    opt.value=x.id;ingredient.append(opt);
  }
  counted.type='number';counted.step='0.001';counted.min='0';
  counted.max='1000000';counted.required=true;counted.placeholder='實際盤點數量';
  submit.type='submit';submit.disabled=!store.options.length||!ingredient.options.length;
  form.append(el('label','門市 '),store,el('label','食材 '),ingredient,
    el('label','實際數量 '),counted,submit);
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(submit.disabled||!taskId.test(store.value)||!taskId.test(ingredient.value))return;
    const count=Number(counted.value);
    if(!Number.isFinite(count)||count<0||count>1000000)return;
    submit.disabled=true;
    try{await writeStocktake('stocktake.create',{
      location_id:store.value,ingredient_id:ingredient.value,counted_qty:count});
    }finally{submit.disabled=false;}
  });
  pane.append(form);$('content').prepend(pane);
  if(role!=='manager'&&role!=='owner')return;
  const controls=el('section');controls.className='panel';
  controls.append(el('h3','主管確認盤點'));
  let shown=0;
  for(const row of rows){
    if(!taskId.test(row.id)||row.status!=='pending')continue;
    const line=el('div');line.style.marginBottom='12px';
    line.append(el('strong',(row.ingredient_name||'食材')+' · 帳面 '+row.expected_qty+
      ' / 實點 '+row.counted_qty+' '+(row.unit||'')));
    const button=el('button','確認並入帳');button.type='button';
    button.style.marginLeft='8px';
    button.addEventListener('click',async()=>{
      if(button.disabled||!window.confirm(
        '確定盤點差異並寫入真實 D1 庫存流水？若盤點後庫存已變動，系統將拒絕。'))return;
      button.disabled=true;
      try{await writeStocktake('stocktake.confirm',
        {id:row.id,expected_status:'pending'});}
      finally{button.disabled=false;}
    });
    line.append(button);controls.append(line);shown++;
  }
  if(shown)$('content').append(controls);
}

async function writeRepair(action,data){
  if(!repairWriteEnabled||!csrf)return;
  try{
    say('正在儲存真實 D1 維修資料，請勿重複送出…');
    const result=await api('/api/repair',{method:'POST',
      headers:{Accept:'application/json','Content-Type':'application/json',
        'X-CSRF-Token':csrf},referrerPolicy:'same-origin',
      body:JSON.stringify({action,data})});
    if(result?.ok!==true)throw Error('伺服器未確認報修異動。');
    await refresh();
  }catch(e){
    if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
    say((e.status===409?'報修單已變更或受指派人失去權限。':
      e.message||'寫入結果不明')+
      ' 請先重新整理核對，不要直接重複送出。',true);
  }
}
async function repairActions(rows,marker){
  if(!repairWriteEnabled)return;
  const isManager=role==='manager'||role==='owner';
  const [stores,people]=await Promise.all([
    api('/api/data?entity=locations',{signal:controller.signal}),
    isManager?api('/api/data?entity=assignable_staff',{signal:controller.signal}):
      Promise.resolve({mode:'native_d1',rows:[]})]);
  if(marker!==revision)return;
  if(stores?.mode!=='native_d1'||people?.mode!=='native_d1'||
     !Array.isArray(stores.rows)||!Array.isArray(people.rows))
    throw Error('無法取得維修所需的門市與人員清單。');
  const pane=el('section');pane.className='panel';
  pane.append(el('h3','新增設備報修'));
  const form=el('form'),store=el('select'),equipment=el('input'),
    description=el('textarea'),submit=el('button','送出報修');
  equipment.placeholder='設備名稱';equipment.required=true;equipment.maxLength=120;
  description.placeholder='故障情況';description.required=true;description.maxLength=1000;
  for(const x of stores.rows){
    if(x.active!==1||!taskId.test(x.id))continue;
    const opt=el('option',x.name);opt.value=x.id;store.append(opt);
  }
  submit.type='submit';submit.disabled=!store.options.length;
  form.append(el('label','門市 '),store,el('label','設備 '),equipment,
    el('label','故障內容 '),description,submit);
  form.addEventListener('submit',async ev=>{
    ev.preventDefault();
    if(submit.disabled||!taskId.test(store.value))return;
    const data={location_id:store.value,equipment:equipment.value.trim(),
      description:description.value.trim()};
    if(!data.equipment||!data.description)return;
    submit.disabled=true;
    try{await writeRepair('repair.create',data);}
    finally{submit.disabled=false;}
  });
  pane.append(form);$('content').prepend(pane);
  if(!isManager)return;
  const controls=el('section');controls.className='panel';
  controls.append(el('h3','報修指派與結案'));
  let count=0;
  for(const row of rows){
    if(!taskId.test(row.id)||!['reported','assigned'].includes(row.status))continue;
    const line=el('div');line.style.marginBottom='12px';
    line.append(el('strong',(row.equipment||'設備')+' · '+
      (row.status==='reported'?'待分派':'處理中')));
    const sel=el('select');
    const empty=el('option','選擇處理人');empty.value='';sel.append(empty);
    for(const p of people.rows){
      if(p.location_id!==row.location_id||!taskId.test(p.id)||
         !['staff','manager'].includes(p.role))continue;
      const option=el('option',p.display_name||'員工');option.value=p.id;sel.append(option);
    }
    const previous=row.assigned_to??null;
    if(previous&&[...sel.options].some(x=>x.value===previous))sel.value=previous;
    const assign=el('button','指派');assign.type='button';
    assign.disabled=!sel.value||(row.status==='assigned'&&previous===sel.value);
    sel.addEventListener('change',()=>{
      assign.disabled=!sel.value||(row.status==='assigned'&&previous===sel.value);
    });
    assign.addEventListener('click',async()=>{
      if(assign.disabled||!window.confirm('確定指派真實 D1 維修工作？'))return;
      assign.disabled=true;
      try{await writeRepair('repair.update',{id:row.id,
        expected_status:row.status,expected_assigned_to:previous,
        status:'assigned',assigned_to:sel.value});}
      finally{assign.disabled=false;}
    });
    const close=el('button','結案');close.type='button';
    close.addEventListener('click',async()=>{
      if(close.disabled||!window.confirm('確定將真實 D1 報修單結案？'))return;
      close.disabled=true;
      try{await writeRepair('repair.update',{id:row.id,
        expected_status:row.status,expected_assigned_to:previous,status:'closed'});}
      finally{close.disabled=false;}
    });
    line.append(el('span',' · 處理人 '),sel,assign,close);
    controls.append(line);count++;
  }
  if(count)$('content').append(controls);
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
    if(view==='locations'||view==='ingredients')await catalogActions(marker);
    if(view==='purchase_orders')await orderActions(data.rows,marker);
    if(view==='stocktakes')await stocktakeActions(data.rows,marker);
    if(view==='repairs')await repairActions(data.rows,marker);
    if(marker===revision)say('已取得授權範圍內的最新資料。');
  }catch(e){if(marker!==revision||e.name==='AbortError')return;
    if(e.status===401){showLogin('工作階段已失效，請重新登入。');return;}
    say(e.message||'無法讀取資料。',true);
  }
}
function closeMenu(){
  $('sidebar').classList.remove('open');
  $('menu-btn').setAttribute('aria-expanded','false');
  $('nav-backdrop').hidden=true;
}
function syncView(){
  $('crumb').textContent=labels[view];
  $('section-hint').textContent=viewHints[view];
  const writable=(view==='tasks'&&writeEnabled)||
    ((view==='ingredients'||view==='locations')&&catalogWriteEnabled&&role==='owner')||
    (view==='purchase_orders'&&orderWriteEnabled)||
    (view==='stocktakes'&&stocktakeWriteEnabled)||
    (view==='repairs'&&repairWriteEnabled);
  $('capability').textContent=writable?'操作已啟用':'唯讀';
  $('capability').classList.toggle('enabled',Boolean(writable));
  for(const b of document.querySelectorAll('#nav button[data-view]')){
    const selected=b.dataset.view===view;
    b.classList.toggle('active',selected);
    if(selected)b.setAttribute('aria-current','page');
    else b.removeAttribute('aria-current');
  }
}
function showWorkspace(me){
  if(!me?.user||typeof me.csrf!=='string')throw Error('身分驗證回應不完整。');
  csrf=me.csrf;role=me.user.role;$('locked').hidden=true;
  $('login').hidden=true;$('workspace').hidden=false;
  const name=String(me.user.display_name||'');
  $('identity').textContent=name+'（'+
    ({owner:'業主',manager:'主管',staff:'員工'}[me.user.role]||'')+'）';
  $('avatar').textContent=Array.from(name)[0]||'餐';
  syncView();closeMenu();refresh();
}
async function start(){
  $('login').hidden=true;$('workspace').hidden=true;$('locked').hidden=true;
  try{
    const status=await api('/api/native/status');
    if(status.mode!=='native'||status.login_enabled!==true){
      $('locked').hidden=false;
      say('正式營運服務尚未由管理員啟用；公開 Demo 不接受真實帳密。',true);return;
    }
    writeEnabled=status.task_write_enabled===true;
    catalogWriteEnabled=status.catalog_write_enabled===true;
    orderWriteEnabled=status.order_write_enabled===true;
    stocktakeWriteEnabled=status.stocktake_write_enabled===true;
    repairWriteEnabled=status.repair_write_enabled===true;
    try{showWorkspace(await api('/api/me'));}
    catch(e){if(e.status===401){showLogin();return;}throw e;}
  }catch(e){$('locked').hidden=false;say(e.message||'無法確認正式服務狀態。',true);}
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
  revision++;if(controller)controller.abort();closeMenu();$('workspace').hidden=true;
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
    syncView();closeMenu();refresh();
  });
$('menu-btn').addEventListener('click',()=>{
  const opened=$('sidebar').classList.toggle('open');
  $('menu-btn').setAttribute('aria-expanded',String(opened));
  $('nav-backdrop').hidden=!opened;
});
$('nav-backdrop').addEventListener('click',closeMenu);
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
$('refresh').addEventListener('click',refresh);
start();