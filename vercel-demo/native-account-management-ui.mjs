// Owner-only native D1 account creation UI. No client-side authorization claims.
// All permissions and account writes must be validated by the Worker/D1 backend.
const field=(caption,input)=>{
  const label=document.createElement('label');label.textContent=caption;label.append(input);return label;
};
const element=(tag,value)=>{
  const node=document.createElement(tag);
  if(value!==undefined)node.textContent=String(value);
  return node;
};
export async function renderOwnerAccounts({pane,api,role,signal,notice,refresh,live,token}){
  if(role!=='owner'){notice('只有業主可以管理帳號。',true);return;}
  notice('正在讀取正式帳號資料…');
  try{
    const [data,stores]=await Promise.all([
      api('/api/accounts',{signal}),
      api('/api/data?entity=locations',{signal})
    ]);
    if(!live())return;
    if(!Array.isArray(data.users)||!Array.isArray(stores.rows))
      throw Error('帳號資料格式不完整。');
    const storeNames=new Map(stores.rows.map(row=>[row.id,row.name]));
    const activeStores=stores.rows.filter(row=>row.active===1);
    pane.replaceChildren();
    pane.append(element('h3','帳號管理'),
      element('p','只有 Owner 可以查看帳號與建立員工／主管；停用、角色調整及重設他人密碼尚未開放。'));
    const scroll=element('div');scroll.className='scroll';
    const table=element('table'),thead=element('thead'),tr=element('tr'),
      tbody=element('tbody');
    for(const name of ['登入帳號','顯示名稱','角色','狀態','所屬門市']){
      const th=element('th',name);th.scope='col';tr.append(th);
    }
    thead.append(tr);
    for(const user of data.users){
      const row=element('tr');
      const locations=Array.isArray(user.location_ids)?
        user.location_ids.map(id=>storeNames.get(id)||'（舊門市）').join('、'):'';
      for(const value of [user.username,user.display_name,
          {owner:'業主',manager:'主管',staff:'員工'}[user.role]||'未知',
          user.active?'啟用':'停用',locations||'—']){
        row.append(element('td',value));
      }
      tbody.append(row);
    }
    table.append(thead,tbody);scroll.append(table);pane.append(scroll);
    if(data.can_create!==true){
      pane.append(element('p','帳號新增功能目前未獲獨立授權，現有帳號可正常使用。'));
      notice('帳號清單已載入；帳號建立 Gate 尚未開放。');return;
    }
    if(!activeStores.length){
      pane.append(element('p','目前沒有啟用中的門市，不能建立員工帳號。'));return;
    }
    const section=element('section');section.className='panel';
    section.append(element('h3','建立員工／主管帳號'));
    const form=element('form'),name=element('input'),display=element('input'),
      roleSelect=element('select'),password=element('input'),confirm=element('input'),
      submit=element('button','建立帳號');
    name.required=true;name.maxLength=40;name.pattern='[A-Za-z0-9_.-]{1,40}';
    name.autocomplete='off';
    display.required=true;display.maxLength=80;display.autocomplete='off';
    for(const [key,title] of [['staff','員工'],['manager','主管']]){
      const option=element('option',title);option.value=key;roleSelect.append(option);
    }
    password.required=true;password.type='password';password.minLength=12;
    password.maxLength=256;password.autocomplete='new-password';
    confirm.required=true;confirm.type='password';confirm.minLength=12;
    confirm.maxLength=256;confirm.autocomplete='new-password';
    const storesGroup=element('fieldset'),checks=[];
    storesGroup.append(element('legend','可操作的門市'));
    for(const store of activeStores){
      const checkbox=element('input');checkbox.type='checkbox';checkbox.value=store.id;
      checks.push(checkbox);storesGroup.append(field(store.name,checkbox));
    }
    submit.type='submit';
    form.append(field('登入帳號',name),field('顯示名稱',display),
      field('角色',roleSelect),field('初始密碼（至少 12 字）',password),
      field('再次確認密碼',confirm),storesGroup,submit);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!live()||submit.disabled)return;
      const locationIds=checks.filter(x=>x.checked).map(x=>x.value);
      if(!locationIds.length||locationIds.length>16){
        notice('請選擇 1～16 個門市。',true);return;
      }
      if(password.value!==confirm.value){
        notice('兩次輸入的密碼不相同。',true);return;
      }
      submit.disabled=true;notice('正在建立帳號…');
      try{
        const result=await api('/api/accounts',{method:'POST',signal,
          referrerPolicy:'same-origin',
          headers:{Accept:'application/json','Content-Type':'application/json',
            'X-CSRF-Token':token},
          body:JSON.stringify({action:'user.create',username:name.value,
            displayName:display.value,role:roleSelect.value,
            initialPassword:password.value,locationIds})});
        password.value='';confirm.value='';
        if(!live())return;
        if(result.code!=='OK'||!result.user?.id)
          throw Error('伺服器未確認帳號建立成功。');
        await refresh();notice('帳號已建立，請安全交付初始密碼。');
      }catch(error){
        password.value='';confirm.value='';
        if(!live())return;
        if(error.status===401)notice('登入已失效，請重新登入。',true);
        else if(error.status===409)notice('帳號已存在，請更換帳號名稱。',true);
        else notice(error.message||'建立帳號失敗。',true);
      }finally{submit.disabled=false;}
    });
    section.append(form,element('p',
      '請由安全管道交付初始密碼，讓員工首次登入後立即修改。此頁不保留密碼。'));
    pane.append(section);notice('帳號管理已載入，可建立員工或主管。');
  }catch(error){
    if(!live()||error.name==='AbortError')return;
    notice(error.message||'無法讀取帳號管理資料。',true);
  }
}
