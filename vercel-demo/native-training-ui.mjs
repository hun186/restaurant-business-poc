// Scoped course creation, assignment and first score forms. All writes are
// independently authorized by the server. No local storage or automatic retry.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const id=x=>typeof x==='string'&&UUID.test(x);
const text=x=>typeof x==='string';
const day=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const score=x=>Number.isInteger(x)&&x>=0&&x<=100;
const number=x=>/^(0|[1-9][0-9]{0,2})$/.test(x)&&score(Number(x))?Number(x):null;
const validText=(x,max,required=false)=>text(x)&&x.length<=max&&(!required||!!x.trim())&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(x);
const el=(tag,value)=>{const n=document.createElement(tag);if(value!==undefined)n.textContent=value;return n;};
const field=(name,control)=>{const n=el('label',name);n.append(control);return n;};
const choose=(rows,label,format)=>{
 const s=el('select');s.required=true;const p=el('option',label);p.value='';s.append(p);
 rows.forEach((r,i)=>{const o=el('option',format(r));o.value=String(i);s.append(o);});return s;
};
const selected=(s,rows)=>/^(0|[1-9][0-9]*)$/.test(s.value)?rows[Number(s.value)]:null;
const input=(type,max)=>{const n=el('input');n.type=type;if(max)n.maxLength=max;return n;};
const scoreInput=()=>{const n=input('number');n.min='0';n.max='100';n.step='1';n.required=true;return n;};
export async function renderNativeTrainingActions({pane,api,view,role,signal,live,token,notice,refresh,onAuthExpired,onCapabilityChange}){
 const current=()=>live()&&!signal?.aborted;
 if(!current())return;
 onCapabilityChange(false);
 if(!['training_courses','training_records'].includes(view)||!['owner','manager'].includes(role)){
  notice('已取得授權範圍內的訓練資料；目前僅供檢視。');return;}
 let data;
 try{data=await api('/api/training/capability',{signal});}
 catch(e){if(current()){if(e?.status===401)onAuthExpired('工作階段已失效，請重新登入。');
  else notice('無法確認訓練操作權限，請重新整理。',true);}return;}
 if(!current())return;
 if(data?.enabled!==true){notice('已取得授權範圍內的訓練資料；目前僅供檢視。');return;}
 if(!['courses','candidates','pending'].every(k=>Array.isArray(data[k])&&data[k].length<=500)||
  typeof data.truncated!=='boolean'||
  !data.courses.every(x=>id(x?.id)&&text(x?.title)&&score(x?.required_score))||
  !data.candidates.every(x=>id(x?.user_id)&&id(x?.location_id)&&text(x?.staff_name)&&text(x?.location_name))||
  !data.pending.every(x=>id(x?.id)&&text(x?.course_title)&&score(x?.required_score)&&text(x?.staff_name)&&text(x?.location_name))){
  notice('訓練操作資料格式不正確，未開放寫入。',true);return;}
 const panel=el('section');panel.className='panel';
 panel.append(el('h3',view==='training_courses'?'課程建立及指派':'登錄首次訓練成績'));
 if(data.truncated)panel.append(el('p','每類候選資料最多 500 筆；未顯示者不可由此操作。'));
 const controls=[],privateFields=[];let pending=false,locked=false;
 const disable=()=>controls.forEach(n=>{n.disabled=pending||locked;});
 const clear=()=>privateFields.forEach(n=>{n.value='';});
 signal?.addEventListener('abort',clear,{once:true});
 const run=async(action,command,expectedId,confirmation)=>{
  if(!current()||pending||locked||!globalThis.confirm(confirmation)||!current())return;
  const key=crypto.randomUUID(),expected=expectedId??key;
  pending=true;disable();clear();
  try{
   const result=await api('/api/training',{method:'POST',signal,referrerPolicy:'same-origin',
    headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':token,
     'X-Idempotency-Key':key},body:JSON.stringify({action,data:command})});
   if(!current())return;
   if(result?.ok!==true||result.result?.id!==expected)throw Error('E_UNCONFIRMED');
   locked=true;notice('訓練操作已完成。');await refresh();
  }catch(e){
   if(!current())return;locked=true;
   if(e?.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
   notice(e?.status===409?'課程指派或成績狀態已變動，請重新整理並核對紀錄。':
    '未確認訓練操作結果，請先核對原紀錄，不要直接重送。',true);
  }finally{pending=false;disable();}
 };
 const form=(title,fields,nodes,submitLabel,handler)=>{
  const f=el('form'),b=el('button',submitLabel);b.type='submit';controls.push(...nodes,b);
  f.append(el('h4',title),...fields,b);f.addEventListener('submit',e=>{
   e.preventDefault();if(!current()||pending||locked)return;return handler();
  });panel.append(f);
 };
 if(view==='training_courses'){
  const title=input('text',150),description=el('textarea'),required=scoreInput();
  title.required=true;description.maxLength=1200;required.value='80';privateFields.push(title,description);
  form('建立訓練課程',[field('課程名稱',title),field('課程說明',description),field('及格分數',required)],
   [title,description,required],'建立課程',()=>{
    const n=number(required.value);
    if(!validText(title.value,150,true)||!validText(description.value,1200)||n===null){
     notice('請確認課程名稱、說明與 0～100 整數及格分數。',true);return;}
    return run('course.create',{title:title.value.trim(),description:description.value.trim(),required_score:n},null,'確定建立共用訓練課程？');
   });
  if(data.courses.length&&data.candidates.length){
   const course=choose(data.courses,'選擇課程',r=>r.title+'（及格 '+r.required_score+' 分）'),
    person=choose(data.candidates,'選擇門市與員工',r=>r.location_name+'／'+r.staff_name);
   form('指派員工參加訓練',[field('課程',course),field('門市／員工',person)],[course,person],'指派訓練',()=>{
    const c=selected(course,data.courses),p=selected(person,data.candidates);
    if(!c||!p){notice('請選擇課程及受訓人員。',true);return;}
    return run('training.assign',{course_id:c.id,user_id:p.user_id,location_id:p.location_id},null,'確定指派此課程？');
   });
  }else panel.append(el('p','目前沒有可指派的啟用課程或門市人員。'));
 }else if(data.pending.length){
  const record=choose(data.pending,'選擇待評分紀錄',r=>r.location_name+'／'+r.staff_name+'／'+r.course_title),
   points=scoreInput(),date=input('date'),preview=el('p','請選擇待評分紀錄及成績。');
  date.required=true;privateFields.push(points);preview.setAttribute('aria-live','polite');
  const update=()=>{const r=selected(record,data.pending),n=number(points.value);
   preview.textContent=!r||n===null?'請選擇待評分紀錄及成績。':
    '及格門檻 '+r.required_score+' 分；本次 '+n+' 分，'+(n>=r.required_score?'及格':'未及格');};
  record.addEventListener('change',update);points.addEventListener('input',update);
  form('登錄訓練成績',[field('待評分紀錄',record),field('成績',points),field('完成日期',date),preview],
   [record,points,date],'登錄成績',()=>{
    const r=selected(record,data.pending),n=number(points.value);
    if(!r||n===null||!day(date.value)){notice('請確認訓練紀錄、分數及完成日期。',true);return;}
    update();return run('training.score',{id:r.id,score:n,completed_on:date.value},r.id,'確定登錄首次成績？已登錄成績不可直接覆寫。\n'+preview.textContent);
   });
 }else panel.append(el('p','沒有可登錄首次成績的訓練紀錄。'));
 if(!current())return;
 pane.append(panel);onCapabilityChange(controls.length>0);
 notice(controls.length?'已取得授權範圍內的訓練操作資料。':'目前沒有可操作的訓練紀錄。');
}
