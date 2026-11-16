// Native Owner security timeline: authenticated GET only, never Demo or local storage.
const el=(tag,value)=>{
  const node=document.createElement(tag);
  if(value!==undefined)node.textContent=String(value);
  return node;
};
const field=(title,control)=>{
  const label=el('label',title);label.append(control);return label;
};
const EVENT_LABEL=Object.freeze({
  'auth.login':'登入成功','auth.login_failed':'登入失敗',
  'auth.logout':'安全登出','user.create':'新增帳號',
  'user.active':'帳號啟用狀態變更','user.role':'帳號角色變更',
  'user.password':'密碼變更','password.change':'密碼變更',
  'task.create':'建立工作','task.status':'工作狀態變更',
  'stocktake.create':'建立盤點','stocktake.confirm':'確認盤點',
  'order.create':'建立叫貨','order.approve':'核准叫貨',
  'order.receive':'叫貨入庫','repair.create':'設備報修',
  'repair.status':'維修狀態變更'
});
function taipeiTime(value){
  if(typeof value!=='string'||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$/.test(value))
    return '時間資料異常';
  const d=new Date(value.replace(' ','T')+'Z');
  return Number.isNaN(d.getTime())?'時間資料異常':
    new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',
      month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
      hour12:false}).format(d);
}
export async function renderOwnerAudit({pane,api,role,signal,notice,live,onAuthExpired}){
  pane.replaceChildren();
  if(role!=='owner'||typeof onAuthExpired!=='function'||typeof live!=='function'){
    notice('只有業主可以查閱安全稽核紀錄。',true);return;
  }
  const heading=el('h3','安全稽核 · 正式 D1');
  const help=el('p','此頁只供檢視，時間採臺灣時間。只顯示允許的事件摘要，不顯示 IP 雜湊、密碼、Token 或原始細節。');
  const form=el('form'),category=el('select'),from=el('input'),to=el('input');
  for(const [value,title] of [['all','全部事件'],['auth','登入與登出'],
    ['account','帳號與權限'],['operations','營運資料異動']]){
    const option=el('option',title);option.value=value;category.append(option);
  }
  category.setAttribute('aria-label','事件分類');
  from.type='date';to.type='date';
  const search=el('button','查詢');search.type='submit';
  form.append(field('事件類別',category),field('開始日期（臺灣）',from),
    field('結束日期（臺灣）',to),search);
  const result=el('section'),pager=el('nav'),
    previous=el('button','上一頁'),next=el('button','下一頁'),
    pageInfo=el('span','尚未載入');
  pager.className='native-data-pagination';
  pager.setAttribute('aria-label','安全稽核分頁');
  previous.type='button';next.type='button';
  previous.disabled=true;next.disabled=true;
  pager.append(previous,pageInfo,next);
  pane.append(heading,help,form,result,pager);
  let requestSequence=0,offset=0;
  const load=async nextOffset=>{
    if(!live())return;
    const sequence=++requestSequence;
    const query=new URLSearchParams({category:category.value||'all',
      offset:String(nextOffset)});
    if(from.value)query.set('from',from.value);
    if(to.value)query.set('to',to.value);
    result.replaceChildren();
    previous.disabled=true;next.disabled=true;search.disabled=true;
    pageInfo.textContent='正在讀取…';notice('正在讀取正式 D1 安全稽核紀錄…');
    try{
      const data=await api('/api/audit?'+query.toString(),{signal});
      if(!live()||sequence!==requestSequence)return;
      if(data.mode!=='native_d1'||!Array.isArray(data.rows)||data.rows.length>50||
         data.offset!==nextOffset||typeof data.has_more!=='boolean'||
         (data.has_more&&data.next_offset!==nextOffset+50))
        throw Error('安全稽核資料格式不完整。');
      const table=el('table'),head=el('thead'),headRow=el('tr'),body=el('tbody');
      for(const name of ['時間（臺灣）','操作者','事件','資料類別','內容摘要']){
        const th=el('th',name);th.scope='col';headRow.append(th);
      }
      head.append(headRow);
      for(const item of data.rows){
        const tr=el('tr');
        for(const value of [taipeiTime(item.at),item.actor_name||'—',
          EVENT_LABEL[item.action]||item.action||'—',item.entity||'—',
          item.summary||'—']){
          tr.append(el('td',value));
        }
        body.append(tr);
      }
      table.append(head,body);
      if(data.rows.length){
        const scroll=el('div');scroll.className='scroll';scroll.append(table);
        result.append(scroll);
      }else result.append(el('p','查無符合條件的稽核事件。'));
      offset=nextOffset;
      previous.disabled=offset===0;
      next.disabled=!data.has_more;
      pageInfo.textContent='第 '+(Math.floor(offset/50)+1)+' 頁（本頁 '+data.rows.length+' 筆）';
      notice('已載入授權範圍內的正式稽核紀錄。');
    }catch(error){
      if(!live()||sequence!==requestSequence||error?.name==='AbortError')return;
      if(error?.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
      if(error?.status===403){
        pane.replaceChildren();notice('權限已調整，安全稽核僅供業主查閱。',true);return;
      }
      pageInfo.textContent='讀取未完成';
      result.replaceChildren();
      result.append(el('p','安全稽核讀取失敗。請重新查詢，勿使用展示資料代替。'));
      notice(error?.message||'無法讀取稽核資料。',true);
    }finally{
      if(live()&&sequence===requestSequence)search.disabled=false;
    }
  };
  form.addEventListener('submit',event=>{
    event.preventDefault();if(!live()||search.disabled)return;
    if(from.value&&to.value&&from.value>to.value){
      notice('起始日期不能晚於結束日期。',true);return;
    }
    load(0);
  });
  previous.addEventListener('click',()=>{if(!previous.disabled&&offset>=50)load(offset-50);});
  next.addEventListener('click',()=>{if(!next.disabled)load(offset+50);});
  await load(0);
}
