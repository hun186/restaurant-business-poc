'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');

const source=fs.readFileSync(path.resolve(__dirname,'../vercel-demo/owner-app.js'),'utf8');
function take(start,end){
 const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
 assert(a>=0&&b>a,'native browser code marker missing: '+start);
 return source.slice(a,b);
}
const functions=[
 ['writeTask','async function writeTask(action,data,marker){','function catalogRowValid(entity,row){'],
 ['writeCatalog','async function writeCatalog(action,data,marker){','function openCatalogEditor(entity,row,marker){'],
 ['writeOrder','async function writeOrder(action,data,marker){','async function orderActions(rows,marker){'],
 ['writeStocktake','async function writeStocktake(action,data,marker){','async function stocktakeActions(rows,marker){'],
 ['writeRepair','async function writeRepair(action,data,marker){','async function repairActions(rows,marker){']
];
function harness(){
 const events={api:[],notice:[],login:[],refresh:0};
 const pending=[];
 const ctx=vm.createContext({
  authEpoch:4,csrf:'old-session-csrf',revision:7,view:'locations',role:'owner',
  writeEnabled:true,catalogWriteEnabled:true,orderWriteEnabled:true,
  stocktakeWriteEnabled:true,repairWriteEnabled:true,
  normalizeCatalogCommand:(_action,data)=>data,
  say:(message,error)=>events.notice.push({message,error}),
  showLogin:message=>events.login.push(message),
  refresh:async()=>{events.refresh++;},
  api:(url,options)=>{events.api.push({url,options});return new Promise((resolve,reject)=>{
   pending.push({resolve,reject});
  });}
 });
 const helper=source.match(/^const liveAuth=.*$/m);
 assert(helper,'session identity predicate missing in production JS');
 vm.runInContext(helper[0]+'\n'+functions.map(([,a,z])=>take(a,z)).join('\n')+
  '\nthis.writes={'+functions.map(([name])=>name).join(',')+'};',ctx);
 return {ctx,events,pending};
}

test('native writes cannot submit through detached view controls or after logout',async()=>{
 const {ctx,events}=harness();
 for(const [name] of functions){
  await ctx.writes[name]('test',{id:'synthetic'},6);
  assert.equal(events.api.length,0,name+' must reject stale rendered revision');
 }
 ctx.csrf=null;
 for(const [name] of functions){
  await ctx.writes[name]('test',{id:'synthetic'},7);
  assert.equal(events.api.length,0,name+' must reject logged-out session');
 }
});

for(const [name] of functions){
 test(name+': delayed old-session 401 cannot log out a newly authenticated Owner',async()=>{
  const {ctx,events,pending}=harness();
  const action=ctx.writes[name]('synthetic.action',{id:'synthetic'},7);
  assert.equal(events.api.length,1);
  assert.equal(events.api[0].options.headers['X-CSRF-Token'],'old-session-csrf');
  assert.equal(pending.length,1);
  // An earlier POST may finish after logout and a distinct, successful login.
  ctx.authEpoch=6;ctx.csrf='new-session-csrf';ctx.revision=9;
  pending.shift().reject(Object.assign(Error('old session rejected'),{status:401}));
  await action;
  assert.equal(events.login.length,0,'a stale 401 cannot clear new login');
  assert.equal(events.refresh,0,'old response cannot trigger current-user data fetch');
  assert.equal(events.notice.length,1,'old response cannot overwrite latest view notification');
  const fresh=ctx.writes[name]('synthetic.action',{id:'synthetic'},9);
  assert.equal(events.api[1].options.headers['X-CSRF-Token'],'new-session-csrf');
  pending.shift().resolve({ok:true});
  await fresh;
  assert.equal(events.refresh,1,'new authenticated action still refreshes correctly');
 });
 test(name+': delayed old success cannot refresh new user, real 401 still locks current session',async()=>{
  const {ctx,events,pending}=harness();
  const old=ctx.writes[name]('synthetic.action',{id:'synthetic'},7);
  ctx.authEpoch=8;ctx.csrf='new-session-csrf';ctx.revision=9;
  pending.shift().resolve({ok:true});
  await old;
  assert.equal(events.refresh,0);
  const live=ctx.writes[name]('synthetic.action',{id:'synthetic'},9);
  pending.shift().reject(Object.assign(Error('401'),{status:401}));
  await live;
  assert.equal(events.login.length,1,'current-session invalidation is not suppressed');
 });
}

test('navigation without an auth change must not refresh another view after old write',async()=>{
 const {ctx,events,pending}=harness();
 const old=ctx.writes.writeCatalog('location.update',
  {id:'synthetic',expected:{name:'old'},changes:{name:'new'}},7);
 ctx.revision=8;ctx.view='tasks';
 pending.shift().resolve({ok:true});
 await old;
 assert.equal(events.refresh,0);
 assert.equal(events.login.length,0);
});

test('native Owner login, logout and catalog-create form enforce auth and view epochs',()=>{
 assert.match(source,/function showLogin\(message\)\{[\s\S]*?authEpoch\+\+;csrf=null;role=null;revision\+\+/);
 assert.match(source,/function showWorkspace\(me\)\{[\s\S]*?authEpoch\+\+;csrf=me\.csrf/);
 assert.match(source,/if\(!csrf\)return;const token=csrf;authEpoch\+\+;csrf=null/);
 assert.match(source,/if\(marker!==revision\|\|!catalogWriteEnabled\|\|role!=='owner'\|\|!csrf\|\|submit\.disabled\)return/);
 assert.match(source,/if\(!liveAuth\(epoch,token\)\)return;[\s\S]*?if\(marker===revision\)await refresh\(\)/);
 assert.doesNotMatch(source,/localStorage|sessionStorage|mock\.js/);
});
