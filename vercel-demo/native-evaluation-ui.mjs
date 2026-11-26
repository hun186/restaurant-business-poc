// Append-only evaluation form. Backend independently verifies all authority.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const id=x=>typeof x==='string'&&UUID.test(x);
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const field=(label,control)=>{const n=el('label',label);n.append(control);return n;};
export async function renderNativeEvaluationActions({pane,api,role,signal,live,token,notice,refresh,onAuthExpired,onCapabilityChange}){
 const current=()=>live()&&!signal?.aborted;
 if(!current())return;
 onCapabilityChange(false);
 if(!['owner','manager'].includes(role)){notice('已取得授權範圍內的考核紀錄；目前僅供檢視。');return;}
 let data;
 try{data=await api('/api/evaluation/capability',{signal});}
 catch(e){if(current()){if(e?.status===401)onAuthExpired('工作階段已失效，請重新登入。');
  else notice('無法確認考核操作權限，請重新整理。',true);}return;}
 if(!current())return;
 if(data?.enabled!==true){notice('已取得授權範圍內的考核紀錄；目前僅供檢視。');return;}
 if(!Array.isArray(data.candidates)||data.candidates.length>500||typeof data.truncated!=='boolean'||
  !data.candidates.every(x=>id(x?.user_id)&&id(x?.location_id)&&typeof x?.staff_name==='string'&&typeof x?.location_name==='string')){
  notice('考核操作資料格式不正確，未開放寫入。',true);return;}
 const panel=el('section');panel.className='panel';panel.append(el('h3','建立員工考核'));
 if(data.truncated)panel.append(el('p','最多載入 500 組門市／人員；未顯示者不可由此操作。'));
 if(!data.candidates.length){panel.append(el('p','沒有可考核的啟用門市及人員。'));pane.append(panel);notice('目前沒有可考核的人員。');return;}
 const form=el('form'),person=el('select'),period=el('input'),score=el('input'),feedback=el('textarea'),submit=el('button','建立考核');
 person.required=true;period.type='text';period.required=true;period.maxLength=30;period.placeholder='例如 2026-11';
 score.type='number';score.min='0';score.max='100';score.step='1';score.required=true;
 feedback.maxLength=1000;submit.type='submit';
 const p=el('option','請選擇門市與受考核人員');p.value='';person.append(p);
 data.candidates.forEach((x,i)=>{const o=el('option',x.location_name+'／'+x.staff_name);o.value=String(i);person.append(o);});
 const controls=[person,period,score,feedback,submit];let pending=false,locked=false;
 const disable=()=>controls.forEach(n=>{n.disabled=pending||locked;});
 const clear=()=>{period.value='';score.value='';feedback.value='';};
 signal?.addEventListener('abort',clear,{once:true});
 form.append(field('門市／受考核人員',person),field('考核期間',period),field('考核分數（0～100）',score),
  field('考核評語（選填）',feedback),el('p','新增考核會保留既有紀錄；同一期間可有不同考核，送出後不可直接覆寫。'),submit);
 form.addEventListener('submit',async e=>{
  e.preventDefault();if(!current()||pending||locked)return;
  const item=/^(0|[1-9][0-9]*)$/.test(person.value)?data.candidates[Number(person.value)]:null;
  const points=Number(score.value);
  if(!item||!period.value.trim()||period.value.length>30||/[\x00-\x1f\x7f]/.test(period.value)||
   !/^(0|[1-9][0-9]{0,2})$/.test(score.value)||!Number.isInteger(points)||points<0||points>100||
   feedback.value.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(feedback.value)){
   notice('請確認人員、考核期間、整數分數及評語。',true);return;}
  if(!globalThis.confirm('確定新增考核？既有紀錄不會被覆寫。')||!current()||pending||locked)return;
  const key=crypto.randomUUID(),command={user_id:item.user_id,location_id:item.location_id,period:period.value.trim(),score:points,feedback:feedback.value.trim()};
  pending=true;disable();clear();
  try{
   const result=await api('/api/evaluation',{method:'POST',signal,referrerPolicy:'same-origin',
    headers:{Accept:'application/json','Content-Type':'application/json','X-CSRF-Token':token,'X-Idempotency-Key':key},
    body:JSON.stringify({action:'evaluation.create',data:command})});
   if(!current())return;
   if(result?.ok!==true||result.result?.id!==key)throw Error('E_UNCONFIRMED');
   locked=true;notice('考核已建立。');await refresh();
  }catch(e){
   if(!current())return;locked=true;
   if(e?.status===401){onAuthExpired('工作階段已失效，請重新登入。');return;}
   notice(e?.status===409?'考核請求已存在，請重新整理並核對紀錄。':'未確認考核操作結果，請先核對考核紀錄，不要直接重送。',true);
  }finally{pending=false;disable();}
 });
 panel.append(form);pane.append(panel);onCapabilityChange(true);notice('已取得授權範圍內的考核操作資料。');
}
