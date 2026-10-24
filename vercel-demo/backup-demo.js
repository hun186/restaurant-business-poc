/* Public demo ONLY: simulated backup metadata, never a SQLite/file backup. */
'use strict';
(function(root){
 const KEYSETS=['locations','users','ingredients','stock','tasks','purchase_orders','stocktakes','stock_moves','repairs','shifts','leave_requests','training_courses','training_records','evaluations','ingredient_prices','menu_dishes','dish_ingredients'];
 const DAY=86400000;
 function fail(message){throw Error(message);}
 function tracked(db){
  // Compare illustrative business contents; audit of demo UI events and backup settings
  // are deliberately excluded. NOT an actual hash, snapshot or integrity check.
  return JSON.stringify(KEYSETS.map(k=>[k,db[k]||[]]));
 }
 function seed(db,now=Date.now()){
  if(db.demoBackup&&Array.isArray(db.demoBackup.history))return db.demoBackup;
  const previous=new Date(now-2*DAY).toISOString();
  db.demoBackup={intervalDays:1,retentionCount:50,lastAutoAt:previous,
   lastAutoId:'demo-auto-1',lastFingerprint:tracked(db),lastResult:'created',
   virtualNow:previous,serial:2,history:[
    {id:'demo-manual-2',type:'manual',createdAt:previous,label:'手動示範 #2',valid:true},
    {id:'demo-auto-1',type:'auto',createdAt:previous,label:'自動示範 #1',valid:true}
   ]};
  return db.demoBackup;
 }
 function due(s){return new Date(Date.parse(s.lastAutoAt)+s.intervalDays*DAY).toISOString();}
 function status(db){
  const s=seed(db);
  return {mode:'SIMULATION_ONLY',intervalDays:s.intervalDays,retentionCount:s.retentionCount,
   lastAutoAt:s.lastAutoAt,nextDueAt:due(s),lastResult:s.lastResult,
   virtualNow:s.virtualNow,history:s.history.map(({id,type,createdAt,label})=>({id,type,createdAt,label})),
   autoCount:s.history.filter(x=>x.type==='auto').length,manualCount:s.history.filter(x=>x.type==='manual').length};
 }
 function append(s,type,when,fingerprint){
  s.serial++;
  const item={id:'demo-'+type+'-'+s.serial,type,createdAt:when,label:(type==='auto'?'自動':'手動')+'示範 #'+s.serial,valid:true};
  s.history.unshift(item);
  if(type==='auto'){s.lastAutoId=item.id;s.lastFingerprint=fingerprint;}
  return item;
 }
 function prune(s){
  let keptAuto=0;
  s.history=s.history.filter(item=>item.type!=='auto'||++keptAuto<=s.retentionCount);
  if(!s.history.some(item=>item.id===s.lastAutoId)){s.lastAutoId=null;s.lastFingerprint=null;}
 }
 function command(db,action,payload={},now=Date.now()){
  const s=seed(db,now);
  if(action==='save'){
   const intervalDays=Number(payload.intervalDays),retentionCount=Number(payload.retentionCount);
   if(!Number.isInteger(intervalDays)||intervalDays<1||intervalDays>365||
      !Number.isInteger(retentionCount)||retentionCount<1||retentionCount>500)
    fail('備份間隔需為 1–365 天，保留份數需為 1–500 份整數');
   s.intervalDays=intervalDays;s.retentionCount=retentionCount;prune(s);
   return {result:'settings_saved',...status(db)};
  }
  if(action==='auto'){
   // "Fast forward" to next due date; no background task is scheduled.
   const when=new Date(Math.max(now,Date.parse(due(s)))).toISOString();
   s.lastAutoAt=when;s.virtualNow=when;
   const digest=tracked(db);
   const existing=s.history.find(x=>x.id===s.lastAutoId&&x.type==='auto'&&x.valid);
   if(existing&&s.lastFingerprint===digest){
    s.lastResult='skipped';
    return {result:'skipped',...status(db)};
   }
   append(s,'auto',when,digest);
   s.lastResult='created';prune(s);
   return {result:'created',...status(db)};
  }
  if(action==='manual'){
   // Manual demonstration is never skipped, even for identical sample data.
   append(s,'manual',new Date(now).toISOString(),null);
   return {result:'created_manual',...status(db)};
  }
  if(action==='delete'){
   if(typeof payload.id!=='string'||!s.history.some(x=>x.id===payload.id))
    fail('找不到模擬備份版本');
   s.history=s.history.filter(x=>x.id!==payload.id);
   if(s.lastAutoId===payload.id){s.lastAutoId=null;s.lastFingerprint=null;}
   return {result:'deleted',...status(db)};
  }
  fail('不支援的模擬備份操作');
 }
 root.RestaurantDemoBackup={seed,status,command,tracked};
})(window);
