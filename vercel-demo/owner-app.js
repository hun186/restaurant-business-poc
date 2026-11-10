import {presentNativeRows,pageNativeEntries} from './native-owner-display.mjs';
import {normalizeCatalogCommand} from './catalog-crud-contract.mjs';
// Dedicated native D1 browser client; never imports the public demo mock.
const $=id=>document.getElementById(id);
const labels={overview:'今日總覽',tasks:'工作',purchase_orders:'叫貨',
  stock:'庫存',stocktakes:'盤點',repairs:'維修',shifts:'排班',ingredients:'食材',
  locations:'門市',training_courses:'訓練'};
const metrics={open_tasks:'待辦工作',pending_orders:'待處理叫貨',
  open_repairs:'未結維修',low_stock:'庫存不足'};
const mobileNav=window.matchMedia('(max-width: 760px)');
const viewHints={overview:'授權範圍內的即時營運資訊',tasks:'今日工作與進度追蹤',
  purchase_orders:'門市請購、核准及收貨紀錄',stock:'由庫存流水帳本計算的現況',
  stocktakes:'盤點與差額調整紀錄',repairs:'設備報修與處理進度',
  shifts:'班表資訊（目前唯讀）',ingredients:'食材及安全庫存主檔',
  locations:'門市基本資訊',training_courses:'教育訓練資訊（目前唯讀）'};
let csrf=null,view='overview',revision=0,controller=null,role=null,writeEnabled=false,
  catalogWriteEnabled=false,orderWriteEnabled=false,stocktakeWriteEnabled=false,
  repairWriteEnabled=false;
const el=(tag,label)=>{const n=document.createElement(tag);if(label!==undefined)n.textContent=String(label??'—');return n;};
const labeledField=(caption,control)=>{const label=el('label',caption);label.append(control);return label;};
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
function table(entity,rows){
 const model=presentNativeRows(entity,rows);
 const catalogManage=catalogWriteEnabled&&role==='owner'&&
   (entity==='locations'||entity==='ingredients');
 const current=revision;
 const items=model.entries.map((entry,index)=>({...entry,record:rows[index]}));
 const wrapper=el('div'),toolbar=el('div'),label=el('label','快速搜尋 '),
   input=el('input'),count=el('span'),empty=el('p','沒有符合搜尋條件的資料。');
 toolbar.className='native-data-toolbar';count.className='native-data-count';
 input.type='search';input.maxLength=80;input.placeholder='搜尋目前已載入的資料';
 label.append(input);toolbar.append(label,count);
 const pager=el('nav'),sizeLabel=el('label','每頁筆數 '),sizeSelect=el('select'),
   previous=el('button','上一頁'),next=el('button','下一頁'),pageInfo=el('span');
 pager.className='native-data-pagination';
 pager.setAttribute('aria-label','資料分頁');
 pageInfo.className='native-page-info';pageInfo.setAttribute('aria-live','polite');
 sizeSelect.setAttribute('aria-label','每頁筆數');
 for(const n of [25,50,100]){
  const opt=el('option',n+' 筆');opt.value=String(n);sizeSelect.append(opt);
 }
 sizeLabel.append(sizeSelect);previous.type='button';next.type='button';
 pager.append(sizeLabel,previous,pageInfo,next);
 let page=1,pageSize=25;
 const frame=el('div');frame.className='scroll';
 const grid=el('table'),caption=el('caption',labels[entity]+'資料清單');
 caption.className='native-data-caption';
 const header=el('thead'),head=el('tr'),body=el('tbody');
 for(const col of model.columns){
  const th=el('th',col.label);th.scope='col';head.append(th);
 }
 if(catalogManage){const th=el('th','操作');th.scope='col';head.append(th);}
 header.append(head);grid.append(caption,header,body);frame.append(grid);
 empty.className='native-search-empty';empty.hidden=true;
 function draw(){
  const term=input.value.trim().toLocaleLowerCase('zh-TW');
  const shown=term?items.filter(item=>item.search.includes(term)):items;
  const paged=pageNativeEntries(shown,page,pageSize);page=paged.page;
  const fragment=document.createDocumentFragment();
  for(const entry of paged.rows){
   const tr=el('tr');
   for(const cell of entry.cells){
    const td=el('td');
    if(cell.tone){
     const badge=el('span',cell.text);badge.className='native-status '+cell.tone;
     td.append(badge);
    }else td.textContent=cell.text;
    tr.append(td);
   }
   if(catalogManage){
    const record=entry.record,cell=el('td'),buttons=el('div'),
      edit=el('button','編輯'),toggle=el('button',record.active===1?'停用':'恢復');
    const valid=catalogRowValid(entity,record);
    buttons.className='native-catalog-actions';
    edit.type='button';toggle.type='button';
    edit.disabled=!valid||(entity==='ingredients'&&record.active!==1);
    toggle.disabled=!valid;
    edit.setAttribute('aria-label','編輯'+(record.name||'主檔'));
    toggle.setAttribute('aria-label',(record.active===1?'停用':'恢復')+(record.name||'主檔'));
    edit.addEventListener('click',()=>{
      if(current!==revision||!valid)return;
      openCatalogEditor(entity,record,current);
    });
    toggle.addEventListener('click',async()=>{
      if(current!==revision||!valid||toggle.disabled)return;
      const action=entity==='locations'?'location.active':'ingredient.active';
      const data={id:record.id,expected_active:record.active,
        active:record.active===1?0:1};
      const verb=data.active===0?'停用':'恢復';
      const note=entity==='locations'&&data.active===0?
        '停用門市會撤銷相關使用者的工作階段，未結單可能阻止停用。':'歷史資料會完整保留。';
      if(!window.confirm('確定'+verb+'真實 D1 '+(record.name||'主檔')+'？'+note))return;
      toggle.disabled=true;
      await writeCatalog(action,data,current);
    });
    buttons.append(edit,toggle);cell.append(buttons);tr.append(cell);
   }
   fragment.append(tr);
  }
  body.replaceChildren(fragment);
  count.textContent='符合 '+shown.length+' / '+model.entries.length+
   ' 筆（只搜尋已載入的資料，伺服器最多提供 500 筆）';
  pageInfo.textContent='第 '+paged.from+'–'+paged.to+' 筆 · '+paged.page+' / '+paged.pages+' 頁';
  previous.disabled=paged.page<=1;next.disabled=paged.page>=paged.pages;
  empty.hidden=shown.length!==0;
 }
 input.addEventListener('input',()=>{page=1;draw();});
 sizeSelect.addEventListener('change',()=>{pageSize=Number(sizeSelect.value);page=1;draw();});
 previous.addEventListener('click',()=>{if(page>1){page--;draw();}});
 next.addEventListener('click',()=>{page++;draw();});
 wrapper.append(toolbar,frame,empty,pager);draw();return wrapper;
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
  content.append(data.rows.length?table(view,data.rows):el('p','此門市目前沒有符合條件的資料，請確認目前門市權限或稍後重新整理。'));
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

function catalogRowValid(entity,row){
 if(!row||typeof row!=='object'||!taskId.test(row.id)||
    typeof row.name!=='string'||!(row.active===0||row.active===1))return false;
 if(entity==='locations')return row.name.length>0&&row.name.length<=120;
 return entity==='ingredients'&&
   typeof row.sku==='string'&&/^[A-Za-z0-9_.-]{1,40}$/.test(row.sku)&&
   typeof row.unit==='string'&&row.unit.length>0&&row.unit.length<=20&&
   typeof row.min_stock==='number'&&Number.isFinite(row.min_stock)&&
   row.min_stock>=0&&row.min_stock<=1000000;
}
async function writeCatalog(action,data,marker){
 if(marker!==revision||!catalogWriteEnabled||role!=='owner'||!csrf||
   (view!=='locations'&&view!=='ingredients'))return false;
 let command;
 try{command=normalizeCatalogCommand(action,data);}
 catch{say('主檔內容不符合欄位規格，請檢查後再試。',true);return false;}
 try{
   say('正在更新真實 D1 主檔，請勿重複送出…');
   const result=await api('/api/catalog',{method:'POST',referrerPolicy:'same-origin',
     headers:{Accept:'application/json','Content-Type':'application/json',
       'X-CSRF-Token':csrf},
     body:JSON.stringify({action,data:command})});
   if(result?.ok!==true)throw Error('伺服器尚未確認主檔變更。');
   if(marker===revision)await refresh();
   return true;
 }catch(e){
   if(e.status===401){showLogin('工作階段已失效，請重新登入。');return false;}
   if(marker===revision)say((e.status===409?
      '主檔可能已更新、有未結叫貨／盤點、最後一間門市或計量單位已有歷史引用。':
      e.message||'主檔寫入結果不明')+
      ' 請先重新整理確認真實 D1 狀態，不要直接重複送出。',true);
   return false;
 }
}
function openCatalogEditor(entity,row,marker){
 if(marker!==revision||!catalogWriteEnabled||role!=='owner'||!csrf||
   !catalogRowValid(entity,row)||(entity==='ingredients'&&row.active!==1))return;
 const previous=$('catalog-editor');if(previous)previous.remove();
 const pane=el('section');pane.id='catalog-editor';pane.className='panel native-catalog-editor';
 pane.append(el('h3','編輯 '+row.name));
 const form=el('form'),actions=el('div'),submit=el('button','儲存變更'),
   cancel=el('button','取消');
 actions.className='native-catalog-editor-actions';
 const field=(caption,value,max,options={})=>{
   const input=el('input');input.type=options.type||'text';input.required=true;
   input.value=String(value);input.maxLength=max;
   if(options.step)input.step=options.step;
   if(options.min!==undefined)input.min=String(options.min);
   if(options.max!==undefined)input.max=String(options.max);
   form.append(labeledField(caption,input));return input;
 };
 const isStore=entity==='locations';
 if(!isStore)pane.append(el('p','食材代碼 '+row.sku+' 不可更改；已有庫存、叫貨、價格或配方紀錄時不可更換單位。'));
 const name=field(isStore?'門市名稱':'食材名稱',row.name,isStore?60:120);
 let unit,minimum;
 if(!isStore){
   unit=field('計量單位',row.unit,20);
   minimum=field('最低庫存',row.min_stock,30,
     {type:'number',step:'0.001',min:0,max:1000000});
 }
 submit.type='submit';cancel.type='button';
 cancel.addEventListener('click',()=>pane.remove());
 actions.append(submit,cancel);form.append(actions);pane.append(form);
 form.addEventListener('submit',async event=>{
   event.preventDefault();
   if(marker!==revision||submit.disabled||!form.reportValidity())return;
   const action=isStore?'location.update':'ingredient.update';
   const expected=isStore?{name:row.name}:
     {sku:row.sku,name:row.name,unit:row.unit,min_stock:row.min_stock};
   const changes=isStore?{name:name.value.trim()}:
     {name:name.value.trim(),unit:unit.value.trim(),min_stock:Number(minimum.value)};
   submit.disabled=true;
   const ok=await writeCatalog(action,{id:row.id,expected,changes},marker);
   if(!ok&&marker===revision)submit.disabled=false;
 });
 $('content').prepend(pane);
 name.focus();
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
    form.append(labeledField(label,input));return input;
  };
  const isStore=view==='locations';
  const name=field(isStore?'門市名稱':'食材名稱',{maxLength:isStore?60:120});
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
  form.append(labeledField('門市',store),labeledField('食材',ingredient),
    labeledField('供應商',supplier),labeledField('數量',qty),submit);
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
  form.append(labeledField('門市',store),labeledField('食材',ingredient),
    labeledField('實際數量',counted),submit);
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
  form.append(labeledField('門市',store),labeledField('設備',equipment),
    labeledField('故障內容',description),submit);
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
    form.append(labeledField('門市',select),labeledField('指派給',assignee),
      labeledField('工作內容',input),labeledField('期限（選填）',due),submit);
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
function closeMenu(returnFocus=false){
  const wasOpen=$('sidebar').classList.contains('open');
  $('sidebar').classList.remove('open');
  $('sidebar').inert=mobileNav.matches;
  $('menu-btn').setAttribute('aria-expanded','false');
  $('nav-backdrop').hidden=true;
  if(returnFocus&&wasOpen&&mobileNav.matches)$('menu-btn').focus();
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
    syncView();closeMenu(true);refresh();
  });
$('menu-btn').addEventListener('click',()=>{
  const opened=$('sidebar').classList.toggle('open');
  $('sidebar').inert=false;
  $('menu-btn').setAttribute('aria-expanded',String(opened));
  $('nav-backdrop').hidden=!opened;
  if(opened)$('nav').querySelector('button[data-view]')?.focus();
  else closeMenu(true);
});
$('nav-backdrop').addEventListener('click',()=>closeMenu(true));
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu(true);});
mobileNav.addEventListener('change',()=>closeMenu());
$('refresh').addEventListener('click',refresh);
closeMenu();
start();