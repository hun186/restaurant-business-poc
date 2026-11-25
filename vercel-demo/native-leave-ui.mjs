// Native leave operation panel; history stays in the existing read-only table.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const id=x=>typeof x==='string'&&UUID.test(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const field=(name,control)=>{const n=el('label',name);n.append(control);return n;};
const string=x=>typeof x==='string';
export async function renderNativeLeaveActions({pane,api,role,signal,live,token,notice,refresh,onAuthExpired,onCapabilityChange}){
 const current=()=>live()&&!signal?.aborted;
 if(!current())return;
 onCapabilityChange(false);
 let data;
 try{data=await api('/api/leave/capability',{signal});}
 catch(e){if(current()){if(e?.status===401)onAuthExpired('工作階段已失效，請重新登入。');
  else notice('無法確認請假操作權限，請重新整理。',true);}return;}
 if(!current())return;
 if(data?.enabled!==true)return;
 if(!['owner','manager','staff'].includes(role)||!Array.isArray(data.candidates)||data.candidates.length>500||
  !Array.isArray(data.pending)||data.pending.length>500||typeof data.truncated!=='boolean'||
  !data.candidates.every(x=>id(x?.user_id)&&id(x?.location_id)&&string(x?.staff_name)&&string(x?.location_name))||
  !data.pending.every(x=>id(x?.id)&&day(x?.start_date)&&day(x?.end_date)&&string(x?.reason)&&
   string(x?.staff_name)&&string(x?.location_name))||(role==='staff'&&data.pending.length)){
  notice('請假操作資料格式不正確，未開放寫入。',true);return;
 }
 const panel=el('section');panel.className='panel';
 panel.append(el('h3','請假操作'));
 if(data.truncated)panel.append(el('p','本次最多載入 500 筆候選或待審資料，未顯示的案件不可由此操作。'));
 const controls=[];let pending=false,uncertain=false;
 const setDisabled=()=>controls.forEach(n=>{n.disabled=pending||uncertain;});
 const run=async(action,command,key,expectedStatus)=>{
  if(!current()||pending||uncertain)return;
  pending=true;setDisabled();
  try{
   const result=await api('/api/leave',{method:'POST',signal,referrerPolicy:'same-origin',
    headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':token,
     'X-Idempotency-Key':key},body:JSON.stringify({action,data:command})});
   if(!current())return;
   if(result?.ok!==true||result.result?.id!==key||result.result?.status!==expectedStatus)throw Error('E_UNCONFIRMED');
   notice('請假操作已完成。');
   // Keep locked until the entire panel is refreshed.
   await refresh();
  }catch(e){
   if(!current())return;
   if(e?.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
   uncertain=true;
   notice(e?.status===409?'資料狀態已變動，請先重新整理並核對原紀錄。':
    '未確認請假操作結果，請先核對請假清單，不要直接重送。',true);
  }finally{pending=false;setDisabled();}
 };
 if(data.candidates.length){
  const form=el('form'),candidate=el('select'),start=el('input'),end=el('input'),
   reason=el('textarea'),submit=el('button','提出請假申請');
  candidate.required=true;start.type=end.type='date';start.required=end.required=true;
  reason.required=true;reason.maxLength=400;submit.type='submit';
  const placeholder=el('option','請選擇門市與申請人');placeholder.value='';candidate.append(placeholder);
  data.candidates.forEach((x,i)=>{const o=el('option',x.location_name+'／'+x.staff_name);o.value=String(i);candidate.append(o);});
  form.append(field('門市／申請人',candidate),field('起始日',start),field('結束日',end),
   field('請假原因',reason),submit);
  controls.push(candidate,start,end,reason,submit);
  const clear=()=>{reason.value='';};
  signal?.addEventListener('abort',clear,{once:true});
  form.addEventListener('submit',event=>{
   event.preventDefault();if(!current()||pending||uncertain)return;
   const item=/^(0|[1-9][0-9]*)$/.test(candidate.value)?data.candidates[Number(candidate.value)]:null;
   if(!item||!day(start.value)||!day(end.value)||start.value>end.value||
    !reason.value.trim()||reason.value.length>400||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(reason.value)){
    notice('請確認申請人、日期及請假原因。',true);return;
   }
   if(!globalThis.confirm('確定提出此請假申請？'))return;
   if(!current()||pending||uncertain)return;
   const command={user_id:item.user_id,location_id:item.location_id,start_date:start.value,end_date:end.value,reason:reason.value.trim()};
   clear();return run('leave.create',command,crypto.randomUUID(),'pending');
  });
  panel.append(form);
 }else panel.append(el('p','沒有可申請的啟用門市或人員。'));
 if(role!=='staff'){
  panel.append(el('h3','可審核的待審申請'));
  if(!data.pending.length)panel.append(el('p','沒有可審核的申請。'));
  for(const row of data.pending){
   const article=el('article');
   article.append(el('strong',row.location_name+'／'+row.staff_name),
    el('p',row.start_date+' ～ '+row.end_date),el('p',row.reason));
   for(const [label,status] of [['核准','approved'],['駁回','rejected']]){
    const button=el('button',label);button.type='button';controls.push(button);
    button.addEventListener('click',()=>{
     if(!current()||pending||uncertain||!globalThis.confirm('確定'+label+'此請假申請？'))return;
     return run('leave.review',{id:row.id,status},row.id,status);
    });article.append(button);
   }panel.append(article);
  }
 }
 if(!current())return;
 pane.append(panel);onCapabilityChange(controls.length>0);
}
