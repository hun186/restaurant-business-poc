'use strict';
// UI renders only simulated browser state. It NEVER creates downloadable files.
async function demoBackupPage(){
 setActive('backup_demo');
 $('#main').innerHTML=head('智慧備份示範','瞭解排程、無異動跳過、手動建立與版本輪替；全部是虛構資料')+
  '<div class="panel" id="demo-backup-panel"><div class="loading">讀取示範狀態…</div></div>';
 await demoBackupLoad();
}
const demoBackupTime=v=>v?new Date(v).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}):'尚無紀錄';
async function demoBackupAction(action,params,message){
 try{
  const r=await api('/api/demo-backups','POST',{action,...params});
  toast(action==='auto'?(r.result==='skipped'?'資料未變更，已跳過建立自動版本':'偵測到資料變更，已新增虛構自動版本'):message);
  await demoBackupLoad();
 }catch(err){toast(err.message);}
}
async function demoBackupLoad(){
 const panel=$('#demo-backup-panel');if(!panel||S.page!=='backup_demo')return;
 try{
  const s=await api('/api/demo-backups');if(S.page!=='backup_demo')return;
  const result=s.lastResult==='skipped'?'資料未變更，已跳過新版本':s.lastResult==='created'?'已模擬建立自動版本':'尚未執行';
  const rows=s.history.map(item=>'<tr><td>'+E(demoBackupTime(item.createdAt))+'</td><td>'+
   (item.type==='auto'?'自動':'手動')+'</td><td>'+E(item.label)+'</td><td><button class="btn small danger" data-demo-backup-delete="'+E(item.id)+'">刪除示範紀錄</button></td></tr>').join('');
  panel.innerHTML=[
   '<div class="demo-backup-banner"><strong>虛構資料互動教學 · 非真正備份</strong>',
   '<p>只有此瀏覽器分頁中的模擬版本清單，不產生 SQLite、沒有背景定時備份，也不提供下載／還原。「模擬下次到期檢查」會快轉展示時鐘。</p></div>',
   '<h2>自動備份示範設定</h2><form id="demo-backup-settings" class="demo-backup-settings">',
   '<label>備份間隔（天）<input name="intervalDays" type="number" min="1" max="365" step="1" required value="'+E(s.intervalDays)+'"></label>',
   '<label>自動備份保留份數<input name="retentionCount" type="number" min="1" max="500" step="1" required value="'+E(s.retentionCount)+'"></label>',
   '<button type="submit" class="btn primary">儲存示範設定</button></form>',
   '<p class="panel-sub">預設每 1 天檢查、只保留最新 50 份自動版本；手動示範紀錄不受自動輪替影響。</p>',
   '<div class="demo-backup-stats"><span>最近模擬自動檢查 <strong>'+E(demoBackupTime(s.lastAutoAt))+'</strong></span>',
   '<span>模擬下次到期 <strong>'+E(demoBackupTime(s.nextDueAt))+'</strong></span>',
   '<span>檢查結果 <strong>'+E(result)+'</strong></span></div>',
   '<div class="toolbar demo-backup-actions">',
   '<button id="demo-backup-auto" class="btn primary" type="button">模擬下次到期檢查</button>',
   '<button id="demo-backup-change" class="btn" type="button">模擬一筆營運異動</button>',
   '<button id="demo-backup-manual" class="btn" type="button">模擬手動備份</button>',
   '<button id="demo-backup-reload" class="btn" type="button">重新整理</button></div>',
   '<p class="panel-sub">建議：先模擬檢查，觀看「無異動跳過」；再新增一筆虛構工作，重新模擬檢查就會產生新的自動紀錄。</p>',
   '<h2>虛構備份歷史（'+E(s.history.length)+'）</h2>',
   '<p class="panel-sub">自動 '+E(s.autoCount)+' 份／手動 '+E(s.manualCount)+' 份；此處只有示意版號，不能真正下載或還原。</p>',
   '<div class="table-wrap"><table><thead><tr><th>模擬建立時間</th><th>類型</th><th>虛構版本</th><th>操作</th></tr></thead><tbody>',
   rows||'<tr><td colspan="4">尚無示範版本</td></tr>','</tbody></table></div>',
   '<p class="notice warning">正式 Node.js + SQLite 版才具備實際背景排程、完整性驗證與檔案下載；這個網頁不執行上述正式備份。</p>'
  ].join('');
  $('#demo-backup-settings').onsubmit=async e=>{
   e.preventDefault();const form=e.currentTarget;
   const intervalDays=Number(form.elements.intervalDays.value),retentionCount=Number(form.elements.retentionCount.value);
   if(!Number.isInteger(intervalDays)||!Number.isInteger(retentionCount))return toast('設定必須是整數');
   const old=Math.max(0,s.autoCount-retentionCount);
   if(old&&!window.confirm('將清理 '+old+' 筆較舊的自動示範紀錄，手動紀錄不受影響。確定嗎？'))return;
   await demoBackupAction('save',{intervalDays,retentionCount},'模擬備份設定已儲存');
  };
  $('#demo-backup-auto').onclick=()=>demoBackupAction('auto',{},'');
  $('#demo-backup-manual').onclick=()=>demoBackupAction('manual',{},'已新增手動示範紀錄，沒有真正產生備份檔');
  $('#demo-backup-reload').onclick=demoBackupLoad;
  $('#demo-backup-change').onclick=async()=>{
   try{
    await api('/api/command','POST',{action:'task.create',data:{
     title:'虛構智慧備份教學：營運異動 '+new Date().toLocaleString('zh-TW'),location_id:'l1'
    }});
    toast('已新增一筆虛構工作，下一次模擬檢查將建立自動版本');
    await demoBackupLoad();
   }catch(err){toast(err.message);}
  };
  panel.querySelectorAll('[data-demo-backup-delete]').forEach(button=>button.onclick=async()=>{
   if(!window.confirm('確定刪除此筆虛構版本紀錄？不會影響任何真實檔案。'))return;
   await demoBackupAction('delete',{id:button.dataset.demoBackupDelete},'已刪除模擬版本紀錄');
  });
 }catch(err){
  panel.innerHTML='<p class="empty">無法載入示範狀態：'+E(err.message)+'</p><button class="btn" id="demo-backup-retry">重試</button>';
  $('#demo-backup-retry').onclick=demoBackupLoad;
 }
}
