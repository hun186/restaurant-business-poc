'use strict';
// Offline process-tree cleanup: no Wrangler, Cloudflare credentials or Production D1.
const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {createServer,createConnection}=require('node:net');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
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

async function signalCase(t,signal,phase){
 const port=await freePort();
 const descendant=`require('node:net').createServer(()=>{}).listen(${port},'127.0.0.1');setInterval(()=>{},1000);`;
 const launcher=`require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:'ignore',windowsHide:true});setInterval(()=>{},1000);`;
 const uri=pathToFileURL(path.join(__dirname,'../tools/cloudflare-prod-owner-password-recovery.mjs')).href;
 // Distinct operator process installs the ACTUAL exported guard at the instant
 // its detached synthetic launcher is spawned. No Cloudflare or Wrangler used.
 const operatorScript=`
 (async()=>{
  const {spawn}=require('node:child_process');
  const recovery=await import(${JSON.stringify(uri)});
  const worker=spawn(process.execPath,['-e',${JSON.stringify(launcher)}],{
   detached:true,stdio:['ignore','ignore','ignore'],windowsHide:true
  });
  const local={child:worker,port:${port},interrupted:false};
  recovery.installRecoverySignalGuard(local);
  process.on('message',m=>{if(m?.signal)process.emit(m.signal);});
  process.send({stage:'spawned',workerPid:worker.pid});
  setInterval(()=>{},1000);
 })().catch(e=>{process.stderr.write('synthetic guard fixture startup failed');process.exit(2)});
 `;
 const operator=spawn(process.execPath,['-e',operatorScript],{
  stdio:['ignore','ignore','pipe','ipc'],windowsHide:true
 });
 let workerPid=null;
 t.after(()=>{
  if(operator.exitCode===null)try{operator.kill('SIGKILL');}catch{}
  if(workerPid)emergencyKill({pid:workerPid});
 });
 const started=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('operator startup timeout')),10000);
  operator.once('message',msg=>{
   clearTimeout(timer);resolve(msg);
  });
  operator.once('exit',(code)=>{
   clearTimeout(timer);reject(Error('operator exited early: '+code));
  });
 });
 assert.equal(started.stage,'spawned');
 assert.equal(Number.isSafeInteger(started.workerPid),true);
 workerPid=started.workerPid;
 if(phase==='active'){
  let listening=false;
  for(let n=0;n<100;n++){
   if(await open(port)){listening=true;break;}
   await delay(100);
  }
  assert.equal(listening,true,'synthetic listener must be active before signal');
 }
 const done=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('operator signal cleanup timeout')),12000);
  operator.once('exit',(code,rawSignal)=>{
   clearTimeout(timer);resolve({code,rawSignal});
  });
 });
 // On POSIX this is an actual OS signal. Node on Windows forcibly terminates
 // on process.kill(SIGTERM), so deliver its corresponding event over IPC.
 if(process.platform==='win32')operator.send({signal});
 else process.kill(operator.pid,signal);
 const exit=await done;
 assert.equal(exit.code,signal==='SIGINT'?130:143);
 assert.equal(exit.rawSignal,null);
 assert.equal(await open(port),false,
  'detached grandchild listener must not survive operator signal exit');
 await delay(450);
 assert.equal(await open(port),false,
  'listener must not appear after early-startup termination');
}
test('SIGTERM during active recovery closes detached Worker descendants',{
 timeout:25000
},async t=>signalCase(t,'SIGTERM','active'));
test('SIGINT (Ctrl+C) during Worker startup closes descendants',{
 timeout:25000
},async t=>signalCase(t,'SIGINT','startup'));
