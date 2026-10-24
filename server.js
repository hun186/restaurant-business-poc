'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {openDb}=require('./src/db'),{uuid,checkPassword,randomToken,sha}=require('./src/security');
const {rows,command,overview,audit}=require('./src/service');
const APP_ROOT=path.join(__dirname,'public');
const {createManager}=require('./src/backup-manager');
const safeJson=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
function makeHandler(db,backups=null){
 const pepper=crypto.randomBytes(32).toString('hex');
 const ipHash=req=>sha(pepper+String(req.socket.remoteAddress||'unknown'));
 function current(req){
  const cookies=(req.headers.cookie||'').split(';').map(s=>s.trim());const value=cookies.find(x=>x.startsWith('restaurant_session='))?.slice('restaurant_session='.length);
  if(!value||value.length>128)return null;
  const row=db.prepare(`SELECT s.token_hash,s.csrf_token,s.expires_at,u.id,u.username,u.display_name,u.role,u.active FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).get(sha(value));
  if(!row||!row.active||row.expires_at<=new Date().toISOString())return null;
  return row;
 }
 function parse(req){return new Promise((resolve,reject)=>{
  if(!(req.headers['content-type']||'').startsWith('application/json'))return reject(Object.assign(new Error('須使用 application/json'),{status:415}));
  let body='',size=0;
  req.on('data',c=>{size+=c.length;if(size>65536){reject(Object.assign(new Error('資料量超過 64 KiB'),{status:413}));req.destroy();return;}body+=c;});
  req.on('end',()=>{try{const o=JSON.parse(body);if(!o||Array.isArray(o)||typeof o!=='object')throw Error();resolve(o);}catch{reject(Object.assign(new Error('JSON 格式錯誤'),{status:400}));}});req.on('error',reject);
 });}
 function originCheck(req){const o=req.headers.origin;if(o){try{const url=new URL(o);if(url.host!==req.headers.host||!['http:','https:'].includes(url.protocol))throw Error();}catch{throw Object.assign(new Error('來源驗證失敗'),{status:403});}}}
 return async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  try{
   const url=new URL(req.url,'http://localhost');const route=url.pathname;
   if(route.startsWith('/api/')){
    if(req.method==='GET'&&route==='/api/health')return safeJson(res,200,{status:'ok'});
    if(req.method==='POST'&&route==='/api/login'){
     originCheck(req);const x=await parse(req),username=String(x.username||'').trim().slice(0,80),password=x.password;
     const ip=ipHash(req);
     if(!username||username.length>40||typeof password!=='string')return safeJson(res,401,{error:'帳號或密碼錯誤'});
     const recent=db.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE username=? COLLATE NOCASE AND ip_hash=? AND success=0 AND at>=datetime('now','-15 minutes')").get(username,ip).n;
     if(recent>=8)return safeJson(res,429,{error:'登入嘗試過多，請在 15 分鐘後重試'});
     const u=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE AND active=1').get(username);
     const valid=u?checkPassword(password,u.password_salt,u.password_hash):false;
     db.prepare('INSERT INTO login_attempts(id,username,ip_hash,success) VALUES(?,?,?,?)').run(uuid(),username,ip,valid?1:0);
     db.prepare("DELETE FROM login_attempts WHERE at<datetime('now','-2 days')").run();
     if(!valid){db.prepare('INSERT INTO audit_logs(id,actor_name,action,entity,ip_hash,detail) VALUES(?,?,?,?,?,?)').run(uuid(),username,'auth.login_failed','sessions',ip,'{}');return safeJson(res,401,{error:'帳號或密碼錯誤'});}
     const token=randomToken(),csrf=randomToken(),exp=new Date(Date.now()+Math.min(24,Math.max(1,Number(process.env.SESSION_HOURS)||8))*3600000).toISOString();
     db.prepare('INSERT INTO sessions(token_hash,csrf_token,user_id,expires_at) VALUES(?,?,?,?)').run(sha(token),csrf,u.id,exp);
     audit(db,u,'auth.login','sessions',null,null,{});
     res.setHeader('Set-Cookie',`restaurant_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor((new Date(exp).getTime()-Date.now())/1000)}${(req.socket.encrypted||process.env.COOKIE_SECURE==='1')?'; Secure':''}`);
     return safeJson(res,200,{ok:true});
    }
    const u=current(req);
    if(!u)return safeJson(res,401,{error:'請先登入'});
    if(route==='/api/backups'){
     if(u.role!=='owner')return safeJson(res,403,{error:'僅業主可管理資料庫備份'});
     if(!backups)return safeJson(res,503,{error:'E_BACKUP: 此服務未啟用備份管理'});
     if(req.method==='GET'){
      if(url.searchParams.has('file')){
       const name=url.searchParams.get('file');
       const {file}=backups.safeFile(name);
       // O_NOFOLLOW refuses symlink substitution between validation and opening.
       const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));
       const info=fs.fstatSync(fd);
       if(!info.isFile()){fs.closeSync(fd);return safeJson(res,400,{error:'不是有效的備份檔案'});}
       audit(db,u,'backup.download','backups',name,null,{});
       res.writeHead(200,{'Content-Type':'application/vnd.sqlite3','Content-Length':info.size,'Cache-Control':'no-store','Content-Disposition':'attachment; filename="'+name+'"'});
       return fs.createReadStream(null,{fd,autoClose:true}).on('error',()=>res.destroy()).pipe(res);
      }
      return safeJson(res,200,backups.status());
     }
     if(req.method==='POST'){
      originCheck(req);
      if(req.headers['x-csrf-token']!==u.csrf_token)return safeJson(res,403,{error:'CSRF 驗證失敗'});
      const x=await parse(req);
      // An owner may be downgraded/disabled or their session revoked while
      // a client is still streaming the JSON request body.
      const fresh=current(req);
      if(!fresh)return safeJson(res,401,{error:'Session 已失效，請重新登入'});
      if(fresh.role!=='owner')return safeJson(res,403,{error:'僅業主可管理資料庫備份'});
      if(req.headers['x-csrf-token']!==fresh.csrf_token)return safeJson(res,403,{error:'CSRF 驗證失敗'});
      if(x.action==='save'){
       const next=backups.save({intervalDays:x.intervalDays,retentionCount:x.retentionCount});
       audit(db,fresh,'backup.settings','backup_settings','1',null,{intervalDays:x.intervalDays,retentionCount:x.retentionCount});
       return safeJson(res,200,next);
      }
      if(x.action==='create'){
       const result=await backups.run('manual');
       audit(db,fresh,'backup.create','backups',result.name,null,{});
       return safeJson(res,200,{...backups.status(),result});
      }
      if(x.action==='delete'){
       const next=backups.remove(x.name);
       audit(db,fresh,'backup.delete','backups',x.name,null,{});
       return safeJson(res,200,next);
      }
      return safeJson(res,400,{error:'不支援的備份操作'});
     }
     return safeJson(res,405,{error:'不支援的備份方法'});
    }
    if(req.method==='GET'&&route==='/api/me'){
     const locations=db.prepare('SELECT location_id FROM user_locations WHERE user_id=?').all(u.id).map(x=>x.location_id);
     return safeJson(res,200,{user:{id:u.id,username:u.username,display_name:u.display_name,role:u.role,locations},csrf:u.csrf_token});
    }
    if(req.method==='GET'&&route==='/api/overview')return safeJson(res,200,{overview:overview(db,u)});
    if(req.method==='GET'&&route==='/api/data')return safeJson(res,200,{rows:rows(db,u,url.searchParams.get('entity'))});
    if(req.method==='POST'){
     originCheck(req);
     if(req.headers['x-csrf-token']!==u.csrf_token)return safeJson(res,403,{error:'CSRF 驗證失敗'});
     if(route==='/api/logout'){
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(u.token_hash);audit(db,u,'auth.logout','sessions',null,null,{});
      res.setHeader('Set-Cookie','restaurant_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return safeJson(res,200,{ok:true});
     }
     if(route==='/api/command'){
      const x=await parse(req);
      // Never perform a mutation using a role/session snapshot captured
      // before asynchronous body parsing.
      const fresh=current(req);
      if(!fresh)return safeJson(res,401,{error:'Session 已失效，請重新登入'});
      if(req.headers['x-csrf-token']!==fresh.csrf_token)return safeJson(res,403,{error:'CSRF 驗證失敗'});
      if(typeof x.action!=='string')return safeJson(res,400,{error:'缺少操作類型'});
      const out=command(db,fresh,x.action,x.data||{});return safeJson(res,200,{ok:true,result:out});
     }
    }
    return safeJson(res,404,{error:'API 不存在'});
   }
   if(req.method!=='GET'&&req.method!=='HEAD')return safeJson(res,405,{error:'方法不允許'});
   let filename=route==='/'?'/index.html':route;
   if(!['/index.html','/styles.css','/app.js','/backup-ui.js'].includes(filename))return safeJson(res,404,{error:'檔案不存在'});
   const abs=path.join(APP_ROOT,filename.slice(1)),types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8'};
   res.writeHead(200,{'Content-Type':types[path.extname(abs)],'Cache-Control':'no-store'});
   if(req.method==='HEAD')return res.end();fs.createReadStream(abs).pipe(res);
  }catch(e){const status=e.status||({E_CONFIG:400,E_BACKUP:404,E_BACKUP_BUSY:409}[e.code])||(/constraint|UNIQUE|FOREIGN KEY/.test(String(e))?409:500);
   if(status>=500)console.error('E_SERVER:',e.message);
   if(!res.headersSent)safeJson(res,status,{error:status>=500?'E_SERVER: 系統處理失敗':e.message});
   else res.end();
  }
 };
}
function start({folder,port}={}){
 const dataFolder=path.resolve(folder||process.env.DATA_DIR||path.join(__dirname,'data'));
 const {db,bootstrapPassword}=openDb(dataFolder);
 const backups=createManager(db,{folder:dataFolder});
 const p=port||Number(process.env.PORT)||3000;
 if(!Number.isInteger(p)||p<1||p>65535)throw Error('PORT 無效');
 const server=http.createServer(makeHandler(db,backups));
 server.on('close',()=>backups.stop());
 server.listen(p,'127.0.0.1',()=>{
  backups.start();
  console.log('餐廳好管家：http://127.0.0.1:'+server.address().port);
  if(bootstrapPassword){console.log('首次管理帳號：owner');console.log('首次隨機密碼（僅此一次顯示，請妥善保管）：'+bootstrapPassword);}
 });
 return {db,server,bootstrapPassword,backups};
}
if(require.main===module)start();
module.exports={makeHandler,start};
