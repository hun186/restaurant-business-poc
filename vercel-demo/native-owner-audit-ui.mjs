// Native Owner security timeline: authenticated GET only, never Demo or local storage.
import {nativeAuditEventLabel,nativeAuditEntityLabel,taipeiAuditTime,nativeAuditPageSheet} from './native-owner-audit-export.mjs';
const el=(tag,value)=>{
  const node=document.createElement(tag);
  if(value!==undefined)node.textContent=String(value);
  return node;
};
const field=(title,control)=>{
  const label=el('label',title);label.append(control);return label;
};
export async function renderOwnerAudit({pane,api,role,signal,notice,live,onAuthExpired}){
  pane.replaceChildren();
  if(role!=='owner'||typeof onAuthExpired!=='function'||typeof live!=='function'){
    notice('只有業主可以查閱安全稽核紀錄。',true);return;
  }
  const heading=el('h3','安全稽核 · 正式 D1');
  const help=el('p','此頁只供檢視，時間採臺灣時間。只顯示允許的事件摘要，不顯示 IP 雜湊、密碼、Token 或原始細節。變更篩選後須按「查詢」才生效。Excel 只下載本頁最多 50 筆，不是全部稽核紀錄。');
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
    pageInfo=el('span','尚未載入'),
    exportButton=el('button','下載本頁 Excel (.xlsx)');
  pager.className='native-data-pagination';
  pager.setAttribute('aria-label','安全稽核分頁');
  previous.type='button';next.type='button';exportButton.type='button';
  previous.disabled=true;next.disabled=true;exportButton.disabled=true;
  pager.append(previous,pageInfo,next,exportButton);
  pane.append(heading,help,form,result,pager);
  let requestSequence=0,offset=0,lastRows=[],loadedSequence=0;
  let applied=Object.freeze({category:'all',from:'',to:''});
  const load=async nextOffset=>{
    if(!live())return;
    const sequence=++requestSequence;
    // Pagination must use the most recently submitted filters, never
    // unsubmitted input edits or changes made while a fetch is pending.
    const selected=applied;
    const query=new URLSearchParams({category:selected.category,
      offset:String(nextOffset)});
    if(selected.from)query.set('from',selected.from);
    if(selected.to)query.set('to',selected.to);
    result.replaceChildren();
    lastRows=[];loadedSequence=0;exportButton.disabled=true;
    previous.disabled=true;next.disabled=true;search.disabled=true;
    pageInfo.textContent='正在讀取…';notice('正在讀取正式 D1 安全稽核紀錄…');
    try{
      const data=await api('/api/audit?'+query.toString(),{signal});
      if(!live()||sequence!==requestSequence)return;
      if(data.mode!=='native_d1'||!Array.isArray(data.rows)||data.rows.length>50||
         data.offset!==nextOffset||typeof data.has_more!=='boolean'||
         typeof data.truncated!=='boolean'||
         (data.has_more&&data.next_offset!==nextOffset+50)||
         (!data.has_more&&data.next_offset!==null)||
         (data.truncated&&data.has_more))
        throw Error('安全稽核資料格式不完整。');
      const table=el('table'),head=el('thead'),headRow=el('tr'),body=el('tbody');
      for(const name of ['時間（臺灣）','操作者','事件','資料類別','內容摘要']){
        const th=el('th',name);th.scope='col';headRow.append(th);
      }
      head.append(headRow);
      for(const item of data.rows){
        const tr=el('tr');
        for(const value of [taipeiAuditTime(item.at),item.actor_name||'—',
          nativeAuditEventLabel(item.action),nativeAuditEntityLabel(item.entity),
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
      lastRows=data.rows;loadedSequence=sequence;
      exportButton.disabled=!lastRows.length;
      previous.disabled=offset===0;
      next.disabled=!data.has_more;
      pageInfo.textContent='第 '+(Math.floor(offset/50)+1)+' 頁（本頁 '+data.rows.length+' 筆）'+
        (data.truncated?'；超過查詢上限，請縮小日期範圍':'');
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
    applied=Object.freeze({category:category.value||'all',from:from.value,to:to.value});
    return load(0);
  });
  exportButton.addEventListener('click',()=>{
    if(!live()||exportButton.disabled||loadedSequence!==requestSequence||
       !lastRows.length)return;
    try{
      const sheet=nativeAuditPageSheet(lastRows);
      if(!globalThis.confirm('確認下載本頁 '+sheet.rows.length+
        ' 筆安全稽核紀錄？檔案含操作者與營運事件，請妥善保管。'))return;
      if(!live()||loadedSequence!==requestSequence)return;
      const writer=globalThis.XlsxLite;
      if(typeof writer?.buildWorkbook!=='function')throw Error('E_AUDIT_EXCEL_UNAVAILABLE');
      const bytes=writer.buildWorkbook([sheet]);
      if(!(bytes instanceof Uint8Array))throw Error('E_AUDIT_EXCEL_INVALID');
      const blob=new Blob([bytes],{type:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const href=URL.createObjectURL(blob),link=el('a');
      link.href=href;link.download='餐廳好管家_安全稽核_第'+
        (Math.floor(offset/50)+1)+'頁.xlsx';
      document.body.append(link);
      try{link.click();}finally{link.remove();setTimeout(()=>URL.revokeObjectURL(href),30000);}
      notice('已準備本頁 '+sheet.rows.length+' 筆安全稽核 Excel，請妥善保管。');
    }catch{notice('安全稽核 Excel 匯出失敗；未修改 D1 紀錄。',true);}
  });
  previous.addEventListener('click',()=>{if(!previous.disabled&&offset>=50)return load(offset-50);});
  next.addEventListener('click',()=>{if(!next.disabled)return load(offset+50);});
  await load(0);
}
