'use strict';
// Compatible command-line manual backup; uses the same verified process as the web UI.
const {perform}=require('../src/backup-manager');
const result=perform({type:'manual'});
console.log('驗證成功的手動備份：'+result.name);
