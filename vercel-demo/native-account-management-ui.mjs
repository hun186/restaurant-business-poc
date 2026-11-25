// Owner-only native D1 account management UI. No client-side authorization claims.
import {effectiveStoreGrantLabel} from './native-account-grant-display.mjs';
// All permissions and account writes must be validated by the Worker/D1 backend.
const field=(caption,input)=>{
  const label=document.createElement('label');label.textContent=caption;label.append(input);return label;
};
const element=(tag,value)=>{
  const node=document.createElement(tag);
  if(value!==undefined)node.textContent=String(value);
  return node;
};
export async function renderOwnerAccounts({pane,api,role,signal,notice,refresh,live,token,onAuthExpired,onCapabilityChange,offset=0}){
  if(typeof onAuthExpired!=='function'){
    pane.replaceChildren();
    notice('無法驗證登入狀態，帳號管理暫停使用。',true);return;
  }
  if(role!=='owner'){notice('只有業主可以管理帳號。',true);return;}
  notice('正在讀取正式帳號資料…');
  try{
    const [data,stores]=await Promise.all([
      api(offset===0?'/api/accounts':'/api/accounts?offset='+offset,{signal}),
      api('/api/data?entity=locations',{signal})
    ]);
    if(!live())return;
    if(!Array.isArray(data.users)||!Array.isArray(stores.rows)||
       !Number.isSafeInteger(data.offset)||data.offset!==offset||
       typeof data.has_more!=='boolean'||
       (data.has_more&&data.next_offset!==offset+50))
      throw Error('帳號資料格式不完整。');
    if(typeof onCapabilityChange==='function')onCapabilityChange({
      create:data.can_create===true,
      status:data.can_manage_status===true,
      role:data.can_manage_role===true,
      grants:data.can_manage_grants===true,
      passwordReset:data.can_reset_password===true
    });
    const activeStores=stores.rows.filter(row=>row.active===1);
    let grantWarnings=0;
    pane.replaceChildren();
    pane.append(element('h3','帳號管理'),
      element('p',data.can_manage_status===true?
        (data.can_manage_role===true?
          '業主可停用／啟用員工並在員工與主管之間調整角色；兩種操作均撤銷原有登入工作階段，保留歷史紀錄。':
          '只有業主可以管理員工與主管的啟用狀態；停用會撤銷所有登入工作階段並保留歷史紀錄。角色調整尚未開放。'):
        (data.can_manage_role===true?
          '業主可調整員工／主管角色，並撤銷既有登入工作階段；停用與':
          (data.can_manage_grants===true?
          '業主可逐一新增或移除員工門市授權；每次修改將撤銷該員工全部登入工作階段，保留稽核歷史。':
          '只有業主可以查看帳號；各項新增／管理權限依後端獨立設定，未授權時不可操作。'))));
    pane.append(element('p',data.can_reset_password===true?
      '業主可重新驗證自己的密碼後，替啟用中的員工或主管重設密碼；舊登入工作階段將全部撤銷。':
      '他人密碼重設尚未開放。'));
    // A local filter never expands the server's Owner-only 50-row page.
    const rowStates=[];
    // One cross-action lock for Grant, status, role and create. A pending
    // transaction must not be masked by another successful refresh.
    let accountPending=false;
    const accountButtons=[],pagerButtons=[];
    let updateGrantEditor=()=>{},closeResetEditor=()=>{};
    let resetUncertain=false;
    const resetButtons=[];
    const setAccountPending=pending=>{
      accountPending=pending;
      if(pending)closeResetEditor();
      for(const button of accountButtons)button.disabled=pending;
      for(const button of resetButtons)button.disabled=pending||resetUncertain;
      for(const [button,originalDisabled] of pagerButtons)
        button.disabled=pending||originalDisabled;
      updateGrantEditor();
    };
    const grantPanel=element('section');grantPanel.className='panel';grantPanel.hidden=true;
    const showGrantEditor=user=>{
      if(!live()||accountPending||data.can_manage_grants!==true||user.active!==true||
         !['staff','manager'].includes(user.role))return;
      closeResetEditor();
      const possible=stores.rows.filter(store=>typeof store.id==='string'&&
        typeof store.name==='string'&&(store.active===1||
          user.location_ids.includes(store.id)));
      if(!possible.length){notice('沒有可調整的門市；請先核對門市主檔。',true);return;}
      const form=element('form'),choose=element('select'),title=element('h3',
        '調整門市授權：'+user.username),desc=element('p',
        '每次僅修改一間門市，成功後該員工所有裝置須重新登入。');
      const labeled=element('label','選擇門市 ');
      const submit=element('button'),cancel=element('button','取消');
      choose.required=true;choose.setAttribute('aria-label','授權目標門市');
      for(const store of possible){
        const option=element('option',store.name+
          (store.active===1?'':'（已停用）'));
        option.value=store.id;choose.append(option);
      }
      const updateVerb=()=>{
        const assigned=user.location_ids.includes(choose.value);
        submit.textContent=assigned?'移除授權':'新增授權';
        submit.disabled=accountPending||!possible.some(store=>store.id===choose.value&&
          (assigned||store.active===1));
        choose.disabled=accountPending;
        cancel.disabled=accountPending;
      };
      updateGrantEditor=updateVerb;
      choose.value=possible[0].id;choose.addEventListener('change',updateVerb);
      submit.type='submit';cancel.type='button';
      cancel.addEventListener('click',()=>{
        if(!live()||accountPending)return;
        grantPanel.hidden=true;grantPanel.replaceChildren();
        updateGrantEditor=()=>{};
      });
      labeled.append(choose);form.append(labeled,submit,cancel);
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(!live()||accountPending||submit.disabled)return;
        const location=possible.find(store=>store.id===choose.value);
        if(!location)return;
        const wasAssigned=user.location_ids.includes(location.id);
        if(!wasAssigned&&location.active!==1){
          notice('停用門市不能新增授權。',true);return;
        }
        const action=wasAssigned?'unassign':'assign';
        if(!globalThis.confirm('確定'+(wasAssigned?'移除':'新增')+
          '「'+user.username+'」對「'+location.name+'」的授權？'+
          '該員工所有登入工作階段都會撤銷，歷史紀錄保留。'))return;
        // Keep the in-flight guard independent of selection-change handlers.
        // A second POST must not start until the first outcome is confirmed.
        setAccountPending(true);updateVerb();notice('正在變更員工門市授權…');
        try{
          const result=await api('/api/accounts/grant',{method:'POST',signal,
            referrerPolicy:'same-origin',
            headers:{Accept:'application/json','Content-Type':'application/json',
              'X-CSRF-Token':token},
            body:JSON.stringify({action,expectedAssigned:wasAssigned,
              expectedRole:user.role,locationId:location.id,targetUserId:user.id})});
          if(!live())return;
          if(result.code!=='OK'||result.user?.id!==user.id||
             result.user?.locationId!==location.id||
             result.user?.assigned!==!wasAssigned)
            throw Error('伺服器未確認門市授權更新。');
          await refresh();
        }catch(error){
          if(!live())return;
          if(error.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
          if(error.status===409)notice('門市授權已變更、目前門市不可用或這是最後一間可用門市，請重新整理核對。',true);
          else notice(error.message||'門市授權更新失敗，未確認寫入。',true);
        }finally{
          setAccountPending(false);
          if(live())updateVerb();
        }
      });
      updateVerb();grantPanel.replaceChildren(title,desc,form);grantPanel.hidden=false;
    };
    const resetPanel=element('section');resetPanel.className='panel';resetPanel.hidden=true;
    const showResetEditor=user=>{
      if(!live()||signal?.aborted||accountPending||resetUncertain||
         data.can_reset_password!==true||user.active!==true||
         !['staff','manager'].includes(user.role))return;
      closeResetEditor();
      grantPanel.hidden=true;grantPanel.replaceChildren();updateGrantEditor=()=>{};
      const form=element('form'),current=element('input'),nextPassword=element('input'),
       confirmation=element('input'),submit=element('button','確認重設密碼'),cancel=element('button','取消');
      form.autocomplete='off';
      for(const [control,name,autocomplete] of [[current,'currentOwnerPassword','current-password'],
       [nextPassword,'newPassword','new-password'],[confirmation,'confirmNewPassword','new-password']]){
        control.type='password';control.name=name;control.required=true;
        control.minLength=12;control.maxLength=256;control.autocomplete=autocomplete;
      }
      const clear=()=>{current.value='';nextPassword.value='';confirmation.value='';};
      let open=true;
      const close=()=>{
        clear();open=false;resetPanel.hidden=true;resetPanel.replaceChildren();
        signal?.removeEventListener('abort',close);
        if(closeResetEditor===close)closeResetEditor=()=>{};
      };
      closeResetEditor=close;
      signal?.addEventListener('abort',close,{once:true});
      submit.type='submit';cancel.type='button';
      cancel.addEventListener('click',close);
      form.append(field('業主目前密碼（重新驗證）',current),
       field('員工新密碼（至少 12 字）',nextPassword),
       field('再次輸入新密碼',confirmation),submit,cancel);
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(!open||!live()||signal?.aborted||accountPending||resetUncertain){close();return;}
        const valid=value=>typeof value==='string'&&value.length>=12&&value.length<=256&&!/[\r\n\0]/.test(value);
        if(!valid(current.value)||!valid(nextPassword.value)||
           current.value===nextPassword.value||nextPassword.value!==confirmation.value){
          clear();notice('請確認密碼長度、兩次新密碼相同，且不可使用業主目前的密碼。',true);return;
        }
        if(!globalThis.confirm('確定替「'+user.username+'」重設密碼？該帳號所有裝置須重新登入。')){
          close();return;
        }
        if(!open||!live()||signal?.aborted||accountPending){close();return;}
        const body=JSON.stringify({targetUserId:user.id,currentOwnerPassword:current.value,newPassword:nextPassword.value});
        // Clear and detach all three inputs before starting the request.
        // Shared lock closes the editor and prevents overlapping account writes.
        setAccountPending(true);notice('正在重設員工密碼…');
        try{
          const result=await api('/api/accounts/password-reset',{method:'POST',signal,
            referrerPolicy:'same-origin',headers:{Accept:'application/json',
             'Content-Type':'application/json','X-CSRF-Token':token},body});
          if(!live()||signal?.aborted)return;
          if(result?.code!=='OK')throw Error('E_UNCONFIRMED_RESET');
          notice('員工密碼已重設，舊登入工作階段已撤銷；請安全交付新密碼。');
        }catch(error){
          if(!live()||signal?.aborted)return;
          if(error?.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
          // Only explicitly rejected requests are known not to have committed.
          if(error?.status===403&&error?.code==='E_INVALID_CURRENT_PASSWORD')
            notice('業主目前密碼不正確，未重設員工密碼。',true);
          else if(error?.status===429)notice('操作頻率超過限制，請稍後再試。',true);
          else{
            resetUncertain=true;
            notice('未確認重設結果，請先核對安全稽核紀錄及員工登入狀態，再重新整理。不要直接重送。',true);
          }
        }finally{clear();setAccountPending(false);}
      });
      resetPanel.replaceChildren(element('h3','重設密碼：'+user.username),
       element('p','成功後此帳號的所有登入工作階段將撤銷；請安全交付新密碼。'),form);
      resetPanel.hidden=false;
    };
    const scroll=element('div');scroll.className='scroll';
    const table=element('table'),thead=element('thead'),tr=element('tr'),
      tbody=element('tbody');
    for(const name of ['登入帳號','顯示名稱','角色','狀態','所屬門市',
      ...(data.can_manage_status===true||data.can_manage_role===true||
        data.can_manage_grants===true||data.can_reset_password===true?['操作']:[])]){
      const th=element('th',name);th.scope='col';tr.append(th);
    }
    thead.append(tr);
    for(const user of data.users){
      const row=element('tr');
      const grants=effectiveStoreGrantLabel(user,stores.rows);
      const needsGrantReview=grants.warning&&user.active===true;
      if(needsGrantReview)grantWarnings++;
      rowStates.push({node:row,needsGrantReview,inactive:user.active!==true,
        search:[user.username,user.display_name,grants.text]
          .filter(value=>typeof value==='string').join(' ').toLocaleLowerCase('zh-TW')});
      for(const value of [user.username,user.display_name,
          {owner:'業主',manager:'主管',staff:'員工'}[user.role]||'未知',
          user.active?'啟用':'停用']){
        row.append(element('td',value));
      }
      const grantCell=element('td',(grants.warning?'⚠ ':'')+grants.text);
      if(grants.warning)grantCell.setAttribute('title',
        '請核對此帳號的門市授權；本頁不會自動修改正式資料。');
      row.append(grantCell);
      if(data.can_manage_status===true||data.can_manage_role===true||
         data.can_manage_grants===true||data.can_reset_password===true){
        const cell=element('td');
        if(user.role==='staff'||user.role==='manager'){
          if(data.can_reset_password===true&&user.active===true){
            const resetButton=element('button','重設密碼');
            resetButton.type='button';resetButton.className='btn';
            resetButton.setAttribute('aria-label','重設帳號 '+user.username+' 的密碼');
            resetButton.addEventListener('click',()=>showResetEditor(user));
            resetButtons.push(resetButton);accountButtons.push(resetButton);cell.append(resetButton);
          }
          if(data.can_manage_grants===true&&user.active===true){
            const editGrant=element('button','調整門市');
            editGrant.type='button';editGrant.className='btn';
            editGrant.setAttribute('aria-label','調整帳號 '+user.username+' 的門市授權');
            editGrant.addEventListener('click',()=>showGrantEditor(user));
            accountButtons.push(editGrant);
            cell.append(editGrant);
          }
          if(data.can_manage_status===true){
          const action=element('button',user.active?'停用':'啟用');
          action.type='button';action.className='btn';
          const nextActive=!user.active;
          action.setAttribute('aria-label',(nextActive?'啟用':'停用')+'帳號 '+user.username);
          action.addEventListener('click',async()=>{
            if(!live()||accountPending||action.disabled)return;
            if(!globalThis.confirm('確定'+(nextActive?'啟用':'停用')+
              '「'+user.username+'」？已登入的工作階段將全部撤銷，歷史紀錄保留。'))return;
            setAccountPending(true);notice('正在更新帳號狀態…');
            try{
              const result=await api('/api/accounts/status',{method:'POST',signal,
                referrerPolicy:'same-origin',
                headers:{Accept:'application/json','Content-Type':'application/json',
                  'X-CSRF-Token':token},
                body:JSON.stringify({targetUserId:user.id,active:nextActive,
                  expectedActive:user.active})});
              if(!live())return;
              if(result.code!=='OK'||result.user?.id!==user.id||
                 result.user?.active!==nextActive)
                throw Error('伺服器未確認狀態更新。');
              await refresh();
            }catch(error){
              if(!live())return;
              if(error.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
              if(error.status===409)notice('帳號狀態已變更，請重新整理。',true);
              else notice(error.message||'帳號狀態更新失敗。',true);
            }finally{setAccountPending(false);}
          });
          accountButtons.push(action);
          cell.append(action);
          }
          if(data.can_manage_role===true&&user.active===true){
            const newRole=user.role==='staff'?'manager':'staff';
            const roleAction=element('button',newRole==='manager'?'升為主管':'改為員工');
            roleAction.type='button';roleAction.className='btn';
            roleAction.setAttribute('aria-label',
              '將帳號 '+user.username+' 角色調整為 '+(newRole==='manager'?'主管':'員工'));
            roleAction.addEventListener('click',async()=>{
              if(!live()||accountPending||roleAction.disabled)return;
              if(!globalThis.confirm('確定要將「'+user.username+'」'+
                (newRole==='manager'?'升為主管':'改為員工')+
                '？這會撤銷該帳號的全部登入工作階段，保留歷史紀錄。'))return;
              setAccountPending(true);notice('正在更新員工角色…');
              try{
                const result=await api('/api/accounts/role',{method:'POST',signal,
                  referrerPolicy:'same-origin',
                  headers:{Accept:'application/json','Content-Type':'application/json',
                    'X-CSRF-Token':token},
                  body:JSON.stringify({targetUserId:user.id,expectedRole:user.role,role:newRole})});
                if(!live())return;
                if(result.code!=='OK'||result.user?.id!==user.id||
                   result.user?.role!==newRole)throw Error('伺服器未確認角色更新。');
                await refresh();
              }catch(error){
                if(!live())return;
                if(error.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
                if(error.status===409)notice('員工角色已變更，請重新整理。',true);
                else notice(error.message||'角色更新失敗。',true);
              }finally{setAccountPending(false);}
            });
            accountButtons.push(roleAction);
            cell.append(roleAction);
          }
        }
        row.append(cell);
      }
      tbody.append(row);
    }
    table.append(thead,tbody);scroll.append(table);
    const filterBar=element('div');filterBar.className='native-data-toolbar';
    const filterLabel=element('label','篩選本頁帳號 '),filter=element('select'),
      searchLabel=element('label','搜尋本頁帳號 '),search=element('input'),
      filterCount=element('span');
    filter.setAttribute('aria-label','篩選本頁帳號');
    for(const [value,caption] of [
      ['all','全部帳號'],['grant','需核對門市授權'],['inactive','已停用帳號']
    ]){
      const option=element('option',caption);option.value=value;filter.append(option);
    }
    filter.value='all';filterLabel.append(filter);
    search.type='search';search.maxLength=80;
    search.placeholder='帳號、姓名或門市名稱';
    search.setAttribute('aria-label','搜尋本頁帳號');
    searchLabel.append(search);
    filterCount.setAttribute('aria-live','polite');
    filterBar.append(filterLabel,searchLabel,filterCount);
    const applyFilter=()=>{
      if(!live())return; // Detached Owner pages must not react to stale controls.
      const mode=filter.value,term=search.value.trim().toLocaleLowerCase('zh-TW');
      if(!['all','grant','inactive'].includes(mode)||term.length>80)return;
      let shown=0;
      for(const entry of rowStates){
        const matchesType=mode==='all'||(mode==='grant'&&entry.needsGrantReview)||
          (mode==='inactive'&&entry.inactive);
        const show=matchesType&&(!term||entry.search.includes(term));
        entry.node.hidden=!show;
        if(show)shown++;
      }
      filterCount.textContent='本頁顯示 '+shown+' / '+rowStates.length+
        ' 筆；僅篩選目前分頁（每頁最多 50 筆），其他頁不受影響。';
    };
    filter.addEventListener('change',applyFilter);
    search.addEventListener('input',applyFilter);
    applyFilter();
    pane.append(filterBar,scroll,grantPanel,resetPanel);
    if(grantWarnings)pane.append(element('p',
      '本頁有 '+grantWarnings+' 個啟用帳號存在無有效門市或停用／未列出門市授權，請核對；本頁不會修改授權。'));
    const pager=element('nav'),previous=element('button','上一頁'),
      next=element('button','下一頁');
    previous.type='button';next.type='button';
    previous.disabled=offset===0;next.disabled=!data.has_more;
    pagerButtons.push([previous,previous.disabled],[next,next.disabled]);
    pager.className='native-data-pagination';
    pager.setAttribute('aria-label','帳號清單分頁');
    const info=element('span','第 '+(Math.floor(offset/50)+1)+' 頁（本頁 '+data.users.length+' 筆）');
    pager.append(previous,info,next);pane.append(pager);
    const navigate=async newOffset=>{
      if(!live()||accountPending)return;
      closeResetEditor();
      // Do not present prior-page capability as current during a new request.
      if(typeof onCapabilityChange==='function')onCapabilityChange(null);
      previous.disabled=true;next.disabled=true;
      await renderOwnerAccounts({pane,api,role,signal,notice,refresh,live,token,onAuthExpired,onCapabilityChange,offset:newOffset});
    };
    previous.addEventListener('click',()=>navigate(Math.max(0,offset-50)));
    next.addEventListener('click',()=>navigate(data.next_offset));
    if(data.can_create!==true){
      pane.append(element('p','帳號新增功能目前未獲獨立授權；其他帳號操作依各自權限開放。'));
      notice('帳號清單已載入；新增權限未開放，其他操作依獨立 Gate。');return;
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
    submit.type='submit';accountButtons.push(submit);
    form.append(field('登入帳號',name),field('顯示名稱',display),
      field('角色',roleSelect),field('初始密碼（至少 12 字）',password),
      field('再次確認密碼',confirm),storesGroup,submit);
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!live()||accountPending||submit.disabled)return;
      const locationIds=checks.filter(x=>x.checked).map(x=>x.value);
      if(!locationIds.length||locationIds.length>16){
        notice('請選擇 1～16 個門市。',true);return;
      }
      if(password.value!==confirm.value){
        notice('兩次輸入的密碼不相同。',true);return;
      }
      setAccountPending(true);notice('正在建立帳號…');
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
        if(error.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
        else if(error.status===409)notice('帳號已存在，請更換帳號名稱。',true);
        else notice(error.message||'建立帳號失敗。',true);
      }finally{setAccountPending(false);}
    });
    section.append(form,element('p',
      '請由安全管道交付初始密碼，讓員工首次登入後立即修改。此頁不保留密碼。'));
    pane.append(section);notice('帳號管理已載入，可建立員工或主管。');
  }catch(error){
    if(!live()||error.name==='AbortError')return;
    if(error.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
    notice(error.message||'無法讀取帳號管理資料。',true);
  }
}
