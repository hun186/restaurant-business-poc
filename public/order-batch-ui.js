'use strict';
// The vendor-facing LINE message is a draft: this module never sends anything.
// User verifies supplier/contact in LINE and performs the final Send action.
window.OrderBatchUI=(()=>{
 const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const plain=v=>String(v??'').replace(/[\r\n\t]+/g,' ').trim();
 const lineText=data=>{
  const lines=[plain(data.supplier)+' 您好，今日叫貨如下：','單號：'+plain(data.number),'門市：'+plain(data.location_name),''];
  data.rows.forEach((r,i)=>lines.push(String(i+1)+'. '+plain(r.ingredient_name)+'：'+r.qty+' '+plain(r.unit)));
  lines.push('','麻煩確認品項與數量，謝謝！','請確認後依約定時段送貨。');
  return lines.join('\n');
 };
 const modal=()=>document.querySelector('#modal-root');
 function show(html){const node=modal();node.hidden=false;node.innerHTML=html;node.querySelector('[data-close-batch]')?.addEventListener('click',()=>{node.hidden=true;node.innerHTML='';});return node;}
 async function start(){
  const [locRes,ingRes,supplierRes]=await Promise.all([
   api('/api/data?entity=locations'),api('/api/data?entity=ingredients'),api('/api/data?entity=purchase_supplier_suggestions')
  ]);
  const locations=locRes.rows.filter(r=>r.active!==0),ingredients=ingRes.rows.filter(r=>r.active!==0);
  const catalog=supplierRes.rows;
  const node=show('<div class="modal" role="dialog" aria-modal="true" aria-label="建立多品項叫貨">'+
   '<h2>一次選品，自動依廠商分單</h2><p>供應商建議來自各門市近期有效進價紀錄，可能不是目前的合約廠商；請在送單前確認。</p>'+
   '<form id="batch-form"><label>門市<select id="batch-location" required>'+locations.map(l=>'<option value="'+safe(l.id)+'">'+safe(l.name)+'</option>').join('')+'</select></label>'+
   '<div id="batch-lines"></div><button type="button" class="btn ghost" id="batch-add">＋ 加入食材</button> '+
   '<button type="button" class="btn ghost" id="batch-suggest">依安全庫存填入補貨建議</button>'+
   '<div class="form-actions"><button type="button" class="btn" data-close-batch>取消</button><button type="submit" class="btn primary">依供應商產生叫貨單</button></div></form></div>');
  const options=ingredients.map(i=>'<option value="'+safe(i.id)+'">'+safe(i.name)+'（'+safe(i.unit)+'）</option>').join('');
  let supplierEdited=new WeakSet();
  const add=()=>{
   if(node.querySelectorAll('.batch-line').length>=60){toast('每次最多 60 種食材');return;}
   const row=document.createElement('div');row.className='batch-line';
   row.innerHTML='<label>食材<select class="batch-ingredient" required><option value="">選擇食材</option>'+options+'</select></label>'+
    '<label>叫貨數量<input class="batch-qty" type="number" min="0.000001" step="any" required placeholder="數量"></label>'+
    '<label>供應商<input class="batch-supplier" maxlength="120" required placeholder="請指定供應商"></label>'+
    '<button type="button" class="btn ghost batch-remove">移除此列</button>';
   row.querySelector('.batch-remove').onclick=()=>row.remove();
   row.querySelector('.batch-supplier').addEventListener('input',()=>supplierEdited.add(row));
   node.querySelector('#batch-lines').appendChild(row);
   return row;
  };
  const fillSupplier=row=>{
   const k=row.querySelector('.batch-ingredient').value,l=node.querySelector('#batch-location').value;
   const recommended=catalog.find(x=>x.ingredient_id===k&&x.location_id===l)?.supplier||'';
   const input=row.querySelector('.batch-supplier');
   if(!supplierEdited.has(row)||!input.value){input.value=recommended;supplierEdited.delete(row);}
   input.title=recommended?'歷史進價建議：'+recommended:'無最近有效供應商，請自行選擇';
  };
  node.querySelector('#batch-add').onclick=()=>add();
  node.querySelector('#batch-suggest').onclick=async()=>{
   try{
    const location=node.querySelector('#batch-location').value;
    const stock=(await api('/api/data?entity=stock')).rows.filter(r=>r.location_id===location);
    const shortages=stock.filter(r=>Number(r.min_stock)>Number(r.on_hand));
    if(!shortages.length){toast('目前沒有低於安全庫存的食材；仍可手動輸入叫貨。');return;}
    let added=0;
    for(const item of shortages){
     if([...node.querySelectorAll('.batch-ingredient')].some(s=>s.value===item.ingredient_id))continue;
     const target=[...node.querySelectorAll('.batch-line')].find(r=>!r.querySelector('.batch-ingredient').value)||add();
     if(!target)break;
     target.querySelector('.batch-ingredient').value=item.ingredient_id;
     target.querySelector('.batch-qty').value=Math.round((Number(item.min_stock)-Number(item.on_hand))*1000000)/1000000;
     fillSupplier(target);added++;
    }
    toast('已填入 '+added+' 項安全庫存缺口；不含預估營業用量，送單前請人工確認。');
   }catch(e){toast('補貨建議失敗：'+e.message);}
  };
  node.querySelector('#batch-location').onchange=()=>node.querySelectorAll('.batch-line').forEach(fillSupplier);
  node.querySelector('#batch-lines').addEventListener('change',e=>{const row=e.target.closest('.batch-line');if(row&&e.target.matches('.batch-ingredient'))fillSupplier(row);});
  add();
  node.querySelector('#batch-form').onsubmit=async e=>{
   e.preventDefault();
   try{
    const rows=[...node.querySelectorAll('.batch-line')],selected=rows.filter(r=>r.querySelector('.batch-ingredient').value);
    if(!selected.length)throw Error('請至少選擇一項食材');
    const items=selected.map(r=>({ingredient_id:r.querySelector('.batch-ingredient').value,qty:Number(r.querySelector('.batch-qty').value),
     supplier:r.querySelector('.batch-supplier').value.trim()}));
    if(new Set(items.map(x=>x.ingredient_id)).size!==items.length)throw Error('同一食材不可重複；請合併數量');
    if(items.some(x=>!(x.qty>0)||!Number.isFinite(x.qty)||!x.supplier))throw Error('數量和供應商必須完整');
    const answer=await api('/api/command','POST',{action:'order.batch-create',data:{
     location_id:node.querySelector('#batch-location').value,items}});
    node.hidden=true;node.innerHTML='';
    toast('已按供應商產生 '+answer.result.groups.length+' 張叫貨單，需主管核准後才能發送');
    await refresh();
   }catch(error){toast('無法建立叫貨：'+error.message);}
  };
 }
 async function preview(number){
  const data=await api('/api/order-batch?number='+encodeURIComponent(number));
  const state=data.states.length===1?data.states[0]:'mixed';
  const status={requested:'待主管核准',approved:'已核准，待人工發送',received:'已驗收入庫',cancelled:'已取消',mixed:'明細狀態不一致'}[state]||state;
  const message=lineText(data);
  const sent=data.line_manual_confirmation;
  const approved=state==='approved',manager=can('manager');
  const node=show('<div class="modal order-batch-modal" role="dialog" aria-modal="true" aria-label="廠商叫貨單">'+
   '<h2>廠商叫貨單預覽</h2><p><strong>'+safe(data.number)+'</strong> · '+safe(status)+' · '+safe(data.supplier)+'</p>'+
   '<table><thead><tr><th>食材</th><th>數量</th><th>單位</th><th>狀態</th></tr></thead><tbody>'+
   data.rows.map(r=>'<tr><td>'+safe(r.ingredient_name)+'</td><td>'+safe(r.qty)+'</td><td>'+safe(r.unit)+'</td><td>'+safe(r.status)+'</td></tr>').join('')+'</tbody></table>'+
   '<p>LINE 文字草稿（請自行核對廠商與數量）</p><textarea id="batch-share-text" readonly rows="10">'+safe(message)+'</textarea>'+
   '<p class="notice warning">系統不會自動向 LINE 傳訊。人工確認送出僅是操作者的自填紀錄，並非 LINE 平台的送達／已讀回執。</p>'+
   (sent?'<p>人工確認送出：'+safe(sent.at)+' · '+safe(sent.actor_name)+'</p>':'<p>LINE 傳送紀錄：尚未有人確認送出。</p>')+
   '<div class="form-actions">'+
   (manager&&state==='requested'?'<button type="button" class="btn primary" data-batch-action="order.batch-approve">主管核准</button>':'')+
   (approved?'<button type="button" class="btn primary" id="batch-copy">複製 LINE 文字</button>'+
     '<a class="btn" id="batch-share" target="_blank" rel="noopener noreferrer">開啟 LINE 分享畫面</a>':'')+
   (approved&&!sent?'<button type="button" class="btn" data-batch-action="order.batch-mark-sent">我已在 LINE 手動送出</button>':'')+
   (manager&&approved?'<button type="button" class="btn" data-batch-action="order.batch-receive">整張驗收入庫</button>':'')+
   (manager&&['requested','approved'].includes(state)?'<button type="button" class="btn ghost" data-batch-action="order.batch-cancel">取消整張單</button>':'')+
   '<button type="button" class="btn" data-close-batch>關閉</button></div></div>');
  if(approved){
   node.querySelector('#batch-share').href='https://line.me/R/share?text='+encodeURIComponent(message);
   node.querySelector('#batch-copy').onclick=async()=>{
    try{
     await navigator.clipboard.writeText(message);
     toast('LINE 草稿已複製；請在 LINE 選擇正確供應商並自行按送出');
    }catch{const area=node.querySelector('#batch-share-text');area.focus();area.select();toast('瀏覽器不允許自動複製，請按 Ctrl+C 複製已選取的文字');}
   };
  }
  node.querySelectorAll('[data-batch-action]').forEach(b=>b.addEventListener('click',async()=>{
   const action=b.dataset.batchAction;
   if(!window.confirm(action==='order.batch-receive'?'確認所有品項均已實際驗收？這會逐筆入庫，不能重複。':
    action==='order.batch-approve'?'主管確認此廠商叫貨單的所有食材及數量？':
    action==='order.batch-mark-sent'?'你是否已真的在 LINE 選擇正確廠商並按送出？此操作僅記錄人工確認，不代表 LINE 已送達。':'確定取消整張叫貨單？若已透過 LINE 送出，還必須人工聯絡供應商取消。'))return;
   try{await api('/api/command','POST',{action,data:{number}});node.hidden=true;node.innerHTML='';toast('叫貨單狀態已更新');await refresh();}
   catch(err){toast('處理失敗：'+err.message);}
  }));
 }
 return {start,preview,lineText};
})();
