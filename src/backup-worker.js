'use strict';
const {parentPort,workerData}=require('node:worker_threads');
try{const result=require('./backup-manager').perform(workerData);parentPort.postMessage({ok:true,result});}
catch(e){parentPort.postMessage({ok:false,code:e.code||'E_BACKUP',message:e.code==='E_BACKUP_BUSY'?'備份正在執行，請稍後重試':'備份操作未成功，請檢查備份位置及 SQLite 完整性'});}
