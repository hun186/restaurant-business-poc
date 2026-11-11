'use strict';
// Offline process-tree cleanup: no Wrangler, Cloudflare credentials or Production D1.
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {createServer,createConnection}=require('node:net');
const recovery=import('../tools/cloudflare-prod-owner-password-recovery.mjs');
const delay=n=>new Promise(resolve=>setTimeout(resolve,n));
function freePort(){
 return new Promise((resolve,reject)=>{
  const server=createServer();
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
   const p=server.address().port;
   server.close(error=>error?reject(error):resolve(p));
  });
 });
}
function open(port){
 return new Promise(resolve=>{
  const s=createConnection({host:'127.0.0.1',port});
  let finished=false;
  const done=v=>{if(finished)return;finished=true;s.destroy();resolve(v);};
  s.once('connect',()=>done(true));s.once('error',()=>done(false));
  s.setTimeout(400,()=>done(false));
 });
}
function emergencyKill(child){
 if(!child?.pid)return;
 try{
  if(process.platform==='win32')
   execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{
    windowsHide:true,stdio:'ignore',timeout:8000
   });
  else process.kill(-child.pid,'SIGKILL');
 }catch{}
}
test('operator cleanup kills process-group descendants, not only launcher',async t=>{
 const port=await freePort();
 const grandchild=`require('node:net').createServer(()=>{}).listen(${port},'127.0.0.1');setInterval(()=>{},1000);`;
 const parent=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000);`;
 const child=spawn(process.execPath,['-e',parent],{
  detached:true,stdio:['ignore','ignore','ignore'],windowsHide:true
 });
 t.after(()=>emergencyKill(child));
 let ready=false;
 for(let n=0;n<100;n++){
  if(await open(port)){ready=true;break;}
  await delay(100);
 }
 assert.equal(ready,true,'synthetic descendant must actually listen before cleanup');
 const r=await recovery;
 await r.stopRecoveryWorkerProcess({child,port});
 assert.equal(await open(port),false,
  'localhost listener must be closed after full process-tree termination');
});
