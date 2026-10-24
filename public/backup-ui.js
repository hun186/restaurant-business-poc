'use strict';
// Database backup administration is only available to an authenticated owner.
async function backupPage(){
 setActive('backups');
 $('#main').innerHTML=head('資料庫備份管理','每天自動備份、版本保留、無變更跳過與手動備份')+'<div class="panel" id="backup-panel">正在載入備份紀錄…</div>';
 await backupLoad();
}
const backupDate=x=>x?new Date(x).toLocaleString('zh-TW',{hour12:false}):'尚無紀錄';
const backupSize=x=>(Number(x)/1048576).toFixed(2)+' MB';
async function backupLoad(){
 const root=$('#backup-panel');if(!root||S.page!=='backups')return;
 try{
  const s=await api('/api/backups');if(S.page!=='backups')return;
  const backups=s.backups||[];
  root.innerHTML=`<div class="backup-notice"><strong>正式 SQLite 備份（僅業主）</strong><p>只有本機服務正在運作時才會檢查排程；關機期間不執行，重新啟動後會補檢一次。與上次有效自動備份相比，持久資料未變更就跳過。備份不等於異地災難復原，還原必須先停機。</p></div>
  <h2>自動備份設定</h2><form id="backup-settings" class="backup-settings">
   <label>備份間隔（天）<input type="number" name="intervalDays" required min="1" max="365" step="1" value="${E(s.intervalDays)}"></label>
   <label>自動備份保留份數<input type="number" name="retentionCount" required min="1" max="500" step="1" value="${E(s.retentionCount)}"></label>
   <button type="submit" class="btn primary">儲存備份設定</button></form>
   <p class="panel-sub">預設每 1 天建立一次，最多保留 50 份自動備份；手動備份與升級前備份不受輪替清除。</p>
   <div class="backup-stats"><span>最近自動檢查：<b>${E(backupDate(s.lastAutoAt))}</b></span><span>下次到期：<b>${E(backupDate(s.nextDueAt))}</b></span><span>結果：<b>${E(s.lastResult==='skipped'?'無變更，已跳過':s.lastResult==='created'?'已建立新備份':'尚未執行')}</b></span></div>
   ${s.lastError?`<p class="backup-error" role="alert">⚠ ${E(s.lastError)}</p>`:''}
   <div class="toolbar"><button type="button" class="btn primary" id="backup-create" ${s.running?'disabled':''}>立即建立手動備份</button><button type="button" class="btn" id="backup-refresh">重新整理</button></div>
   <h2>備份歷史（${backups.length}）</h2><p class="panel-sub">下載的是可供離線驗證的 SQLite 副本，請妥善保護；線上直接還原不開放。</p>
   <div class="table-wrap"><table><thead><tr><th>建立時間</th><th>備份類型</th><th>檔案大小</th><th>版本檔名</th><th>管理</th></tr></thead><tbody>
   ${backups.map(b=>`<tr><td>${E(backupDate(b.createdAt))}</td><td>${E(b.type==='auto'?'自動':b.type==='migration'?'升級保留':'手動')}</td><td>${E(backupSize(b.size))}</td><td>${E(b.name)}</td><td class="actions"><button class="btn small ghost" data-backup-download="${E(b.name)}">下載</button> <button class="btn small danger" data-backup-delete="${E(b.name)}">刪除</button></td></tr>`).join('')||'<tr><td colspan="5">還沒有備份紀錄</td></tr>'}
   </tbody></table></div>`;
  $('#backup-settings').onsubmit=async e=>{
   e.preventDefault();const form=e.currentTarget,intervalDays=Number(form.elements.intervalDays.value),retentionCount=Number(form.elements.retentionCount.value);
   if(!Number.isInteger(intervalDays)||!Number.isInteger(retentionCount))return toast('請輸入整數');
   const older=backups.filter(x=>x.type==='auto').length-retentionCount;
   if(older>0&&!confirm(`儲存後將清理 ${older} 份較舊的「自動備份」（手動備份不受影響），確定？`))return;
   try{await api('/api/backups','POST',{action:'save',intervalDays,retentionCount});toast('設定已儲存');await backupLoad();}catch(err){toast(err.message);}
  };
  $('#backup-create').onclick=async e=>{e.currentTarget.disabled=true;try{await api('/api/backups','POST',{action:'create'});toast('手動備份成功，完整性驗證已通過');await backupLoad();}catch(err){toast(err.message);e.currentTarget.disabled=false;}};
  $('#backup-refresh').onclick=backupLoad;
  root.querySelectorAll('[data-backup-download]').forEach(b=>b.onclick=()=>{window.location.href='/api/backups?file='+encodeURIComponent(b.dataset.backupDownload);});
  root.querySelectorAll('[data-backup-delete]').forEach(b=>b.onclick=async()=>{
   const name=b.dataset.backupDelete;if(!confirm('確認永久刪除此份備份？此操作無法復原。\n'+name))return;
   try{await api('/api/backups','POST',{action:'delete',name});toast('已刪除備份');await backupLoad();}catch(e){toast(e.message);}
  });
 }catch(e){if(root)root.innerHTML='<p class="backup-error">無法載入備份：'+E(e.message)+'</p><button class="btn" id="backup-retry">重試</button>';$('#backup-retry')?.addEventListener('click',backupLoad);}
}
