// UI-only validation and preview; the shared server time contract and
// transactional conflict check remain authoritative.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const CLOCK=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const id=x=>typeof x==='string'&&UUID.test(x);
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const field=(name,control)=>{const n=el('label',name);n.append(control);return n;};
const validTime=(start,end)=>CLOCK.test(start)&&CLOCK.test(end)&&start!==end;
export async function renderNativeShiftActions({pane,api,role,signal,live,token,notice,refresh,onAuthExpired,onCapabilityChange}){
 const current=()=>live()&&!signal?.aborted;
 if(!current())return;
 onCapabilityChange(false);
 if(!['owner','manager'].includes(role)){notice('已取得授權範圍內的班表；目前僅供檢視。');return;}
 let data;
 try{data=await api('/api/shift/capability',{signal});}
 catch(e){if(current()){if(e?.status===401)onAuthExpired('工作階段已失效，請重新登入。');
  else notice('無法確認排班操作權限，請重新整理。',true);}return;}
 if(!current())return;
 if(data?.enabled!==true){notice('已取得授權範圍內的班表；目前僅供檢視。');return;}
 if(!Array.isArray(data.candidates)||data.candidates.length>500||typeof data.truncated!=='boolean'||
  !data.candidates.every(x=>id(x?.user_id)&&id(x?.location_id)&&
   typeof x?.staff_name==='string'&&typeof x?.location_name==='string')){
  notice('排班操作資料格式不正確，未開放寫入。',true);return;
 }
 const panel=el('section');panel.className='panel';
 panel.append(el('h3','新增排班'));
 if(data.truncated)panel.append(el('p','本次最多載入 500 組可排班的門市／人員；未顯示者不可由此操作。'));
 if(!data.candidates.length){
  panel.append(el('p','沒有可排班的啟用門市及人員。'));pane.append(panel);
  notice('目前沒有可排班的人員。');return;
 }
 const form=el('form'),candidate=el('select'),date=el('input'),start=el('input'),
  end=el('input'),note=el('input'),preview=el('p','請選擇日期及上下班時間。'),
  submit=el('button','建立排班');
 candidate.required=true;date.type='date';start.type=end.type='time';
 date.required=start.required=end.required=true;start.step=end.step='60';
 note.type='text';note.maxLength=200;submit.type='submit';
 preview.setAttribute('aria-live','polite');
 const placeholder=el('option','請選擇門市與人員');placeholder.value='';candidate.append(placeholder);
 data.candidates.forEach((x,i)=>{const o=el('option',x.location_name+'／'+x.staff_name);o.value=String(i);candidate.append(o);});
 const updatePreview=()=>{
  if(!day(date.value)||!validTime(start.value,end.value)){
   preview.textContent='請選擇有效日期及不同的上下班時間。';return;
  }
  const mins=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
  const overnight=end.value<start.value,duration=mins(end.value)-mins(start.value)+(overnight?1440:0);
  preview.textContent=(overnight?'跨日班次：':'班次：')+date.value+' '+start.value+' ～ '+
   (overnight?'次日 ':'')+end.value+'（共 '+Math.floor(duration/60)+' 小時 '+duration%60+' 分鐘）';
 };
 for(const n of [date,start,end])n.addEventListener('input',updatePreview);
 const controls=[candidate,date,start,end,note,submit];
 let pending=false,locked=false;
 const setDisabled=()=>controls.forEach(n=>{n.disabled=pending||locked;});
 const clear=()=>{note.value='';};
 signal?.addEventListener('abort',clear,{once:true});
 form.append(field('門市／人員',candidate),field('排班日期',date),field('上班時間',start),
  field('下班時間',end),preview,field('備註（選填）',note),submit);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!current()||pending||locked)return;
  const item=/^(0|[1-9][0-9]*)$/.test(candidate.value)?data.candidates[Number(candidate.value)]:null;
  if(!item||!day(date.value)||!validTime(start.value,end.value)||note.value.length>200||/[\x00-\x1f\x7f]/.test(note.value)){
   notice('請確認門市、人員、日期、上下班時間及備註。',true);return;
  }
  updatePreview();
  if(!globalThis.confirm('確定建立此班次？\n'+preview.textContent))return;
  if(!current()||pending||locked)return;
  const key=crypto.randomUUID();
  const command={user_id:item.user_id,location_id:item.location_id,shift_date:date.value,
   start_time:start.value,end_time:end.value,note:note.value.trim()};
  pending=true;setDisabled();clear();
  try{
   const result=await api('/api/shift',{method:'POST',signal,referrerPolicy:'same-origin',
    headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':token,
     'X-Idempotency-Key':key},body:JSON.stringify({action:'shift.create',data:command})});
   if(!current())return;
   if(result?.ok!==true||result.result?.id!==key)throw Error('E_UNCONFIRMED');
   locked=true;notice('排班已建立。');await refresh();
  }catch(e){
   if(!current())return;
   if(e?.status===401){locked=true;onAuthExpired('工作階段已失效，請重新登入。');return;}
   if(e?.status===409&&e?.code==='E_SHIFT_OVERLAP'&&!locked){
    // Known pre-write rejection only: allow a deliberately adjusted submission.
    notice('員工班次時間重疊（含跨日及跨門市），請調整時間。',true);
   }else{
    locked=true;
    notice('未確認排班操作結果，請先重新整理並核對班表，不要直接重送。',true);
   }
  }finally{pending=false;setDisabled();}
 });
 panel.append(form);pane.append(panel);onCapabilityChange(true);
 notice('已取得授權範圍內的排班操作資料。');
}
