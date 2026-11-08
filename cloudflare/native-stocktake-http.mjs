// Native D1 stocktake workflow. Disabled until separate operator release.
// Stock movement ledger is the sole inventory source; no on_hand writes.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal,hasAccess,authorizedMutation} from './auth-core.mjs';
const HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'});
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export const nativeStocktakeWriteEnabled=env=>
  nativeLoginEnabled(env)&&env.CLOUD_NATIVE_STOCKTAKE_WRITE_GATE==='operator-released';
const qtyOk=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000&&
  Math.abs(n*1000-Math.round(n*1000))<0.0000001;
const changes=o=>{
  const n=o?.meta?.changes??o?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_INVALID_D1_RESULT');
  return n;
};
async function command(request){
  const LIMIT=2048;
  if(request.headers.get('content-type')!=='application/json')return null;
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||
    Number(declared)>LIMIT))return null;
  const reader=request.body?.getReader();
  if(!reader)return null;
  let timeout,size=0;
  const chunks=[];
  try{
    const deadline=new Promise((_,reject)=>{timeout=setTimeout(
      ()=>reject(Error('E_TIMEOUT')),2000);});
    for(;;){
      const chunk=await Promise.race([reader.read(),deadline]);
      if(chunk.done)break;
      if(!(chunk.value instanceof Uint8Array))return null;
      size+=chunk.value.byteLength;
      if(size>LIMIT)return null;
      chunks.push(chunk.value);
    }
    if(!size)return null;
    const bytes=new Uint8Array(size);let at=0;
    for(const c of chunks){bytes.set(c,at);at+=c.byteLength;}
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
       Object.keys(parsed).sort().join(',')!=='action,data'||
       !parsed.data||typeof parsed.data!=='object'||Array.isArray(parsed.data))
      return null;
    const d=parsed.data,fields=Object.keys(d).sort().join(',');
    if(parsed.action==='stocktake.create'&&
       fields==='counted_qty,ingredient_id,location_id'&&
       typeof d.location_id==='string'&&UUID.test(d.location_id)&&
       typeof d.ingredient_id==='string'&&UUID.test(d.ingredient_id)&&qtyOk(d.counted_qty))
      return {action:parsed.action,location_id:d.location_id,
        ingredient_id:d.ingredient_id,counted_qty:d.counted_qty};
    if(parsed.action==='stocktake.confirm'&&fields==='expected_status,id'&&
       typeof d.id==='string'&&UUID.test(d.id)&&d.expected_status==='pending')
      return {action:parsed.action,id:d.id};
    return null;
  }catch{return null;}finally{
    if(timeout)clearTimeout(timeout);
    try{const result=reader.cancel();result?.catch?.(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
}
function authSql(){
  return "EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id "+
    "WHERE u.id=? AND u.role=? AND u.active=1 AND s.token_hash=? AND s.expires_at>?)";
}
function authArgs(p,now){return [p.id,p.role,p.token_hash,now,p.role,p.id];}
function scopeSql(alias){
  return "(?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    'WHERE ul.user_id=? AND ul.location_id='+alias+'.location_id))';
}
const balanceSql=alias=>
  '(SELECT COALESCE(SUM(m.qty_delta),0) FROM stock_moves m '+
  'WHERE m.ingredient_id='+alias+'.ingredient_id AND m.location_id='+alias+'.location_id)';
const activeSql=alias=>
  'EXISTS(SELECT 1 FROM locations l WHERE l.id='+alias+'.location_id AND l.active=1) '+
  'AND EXISTS(SELECT 1 FROM ingredients i WHERE i.id='+alias+'.ingredient_id AND i.active=1)';
async function createStocktake(db,p,cmd){
  const id=crypto.randomUUID(),auditId=crypto.randomUUID(),now=new Date().toISOString();
  const insert=db.prepare(
    'INSERT INTO stocktakes(id,location_id,ingredient_id,expected_qty,counted_qty,created_by) '+
    'SELECT ?,l.id,i.id,COALESCE((SELECT SUM(m.qty_delta) FROM stock_moves m '+
    'WHERE m.location_id=l.id AND m.ingredient_id=i.id),0),?,? '+
    'FROM locations l JOIN ingredients i ON i.id=? '+
    'WHERE l.id=? AND l.active=1 AND i.active=1 AND '+
    authSql()+' AND (?=\'owner\' OR EXISTS(SELECT 1 FROM user_locations ul '+
    'WHERE ul.user_id=? AND ul.location_id=l.id))'
  ).bind(id,cmd.counted_qty,p.id,cmd.ingredient_id,cmd.location_id,
    p.id,p.role,p.token_hash,now,p.role,p.id);
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    "SELECT ?,?,?,'stocktake.create','stocktakes',t.id,t.location_id,? "+
    'FROM stocktakes t WHERE t.id=? AND t.created_by=?'
  ).bind(auditId,p.id,p.username,JSON.stringify({ingredient_id:cmd.ingredient_id,
    counted_qty:cmd.counted_qty}),id,p.id);
  const verify=db.prepare(
    'UPDATE stocktakes SET status=CASE WHEN EXISTS('+
    "SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='stocktakes' "+
    'AND a.entity_id=stocktakes.id) THEN status ELSE NULL END WHERE id=?'
  ).bind(auditId,id);
  const result=await db.batch([insert,audit,verify]);
  if(!Array.isArray(result)||result.length!==3||
     result.some(x=>changes(x)!==1))return reply(409,{code:'E_STOCKTAKE_CONFLICT'});
  return reply(200,{ok:true,result:{id,location_id:cmd.location_id,
    ingredient_id:cmd.ingredient_id,counted_qty:cmd.counted_qty,status:'pending'}});
}
async function confirmStocktake(db,p,cmd){
  if(!hasAccess(p,'manager'))return reply(403,{code:'E_FORBIDDEN'});
  const row=await db.prepare(
    'SELECT t.id,t.location_id,t.ingredient_id,t.status,t.expected_qty,t.counted_qty,'+
    'l.active AS location_active,i.active AS ingredient_active '+
    'FROM stocktakes t JOIN locations l ON l.id=t.location_id '+
    'JOIN ingredients i ON i.id=t.ingredient_id WHERE t.id=? LIMIT 1'
  ).bind(cmd.id).first();
  if(!row||row.location_active!==1||row.ingredient_active!==1||
     !hasAccess(p,'manager',row.location_id))
    return reply(404,{code:'E_STOCKTAKE_NOT_FOUND'});
  if(row.status!=='pending')return reply(409,{code:'E_STOCKTAKE_CONFLICT'});
  // Read-only fast rejection; the current ledger snapshot is independently
  // rechecked in the atomic D1 batch before any confirmation is committed.
  const current=await db.prepare(
    'SELECT COALESCE(SUM(qty_delta),0) AS n FROM stock_moves '+
    'WHERE ingredient_id=? AND location_id=?'
  ).bind(row.ingredient_id,row.location_id).first();
  if(!Number.isFinite(current?.n)||Math.abs(current.n-row.expected_qty)>=0.000001)
    return reply(409,{code:'E_STOCK_CHANGED_RECOUNT'});
  const delta=row.counted_qty-row.expected_qty,
    needMove=Math.abs(delta)>0.000001;
  const auditId=crypto.randomUUID(),moveId=needMove?crypto.randomUUID():null,
    now=new Date().toISOString();
  const where=[
    "t.id=? AND t.status='pending'",
    'AND '+activeSql('t'),
    'AND ABS('+balanceSql('t')+'-t.expected_qty)<0.000001',
    'AND '+authSql(),
  ];
   where.push('AND '+scopeSql('t'));
  const predicate=where.join(' ');
  const args=[cmd.id,...authArgs(p,now)];
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    "SELECT ?,?,?,'stocktake.confirm','stocktakes',t.id,t.location_id,? "+
    'FROM stocktakes t WHERE '+predicate
  ).bind(auditId,p.id,p.username,JSON.stringify({expected_qty:row.expected_qty,
    counted_qty:row.counted_qty,delta:needMove?delta:0}),...args);
  const update=db.prepare(
    "UPDATE stocktakes AS t SET status='confirmed',confirmed_by=? WHERE "+
    predicate+' AND EXISTS(SELECT 1 FROM audit_logs a '+
    "WHERE a.id=? AND a.entity='stocktakes' AND a.entity_id=t.id)"
  ).bind(p.id,...args,auditId);
  const steps=[audit,update];
  if(needMove){
    steps.push(db.prepare(
      'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) '+
      "SELECT ?,t.ingredient_id,t.location_id,t.counted_qty-t.expected_qty,'adjustment',t.id,?,? "+
      "FROM stocktakes t WHERE t.id=? AND t.status='confirmed' "+
      'AND ABS(t.counted_qty-t.expected_qty)>0.000001 '+
      "AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='stocktakes' AND a.entity_id=t.id) "+
      "AND NOT EXISTS(SELECT 1 FROM stock_moves m WHERE m.reference_id=t.id AND m.move_type='adjustment')"
    ).bind(moveId,'盤點確認',p.id,cmd.id,auditId));
  }
  const validation=db.prepare(
    'UPDATE audit_logs SET detail=CASE WHEN EXISTS('+
    "SELECT 1 FROM stocktakes t WHERE t.id=? AND t.status='confirmed' "+
    (needMove?
      'AND EXISTS(SELECT 1 FROM stock_moves m WHERE m.id=? AND m.reference_id=t.id '+
      "AND m.move_type='adjustment' AND ABS(m.qty_delta-(t.counted_qty-t.expected_qty))<0.000001)":
      'AND ABS(t.counted_qty-t.expected_qty)<0.000001 '+
      "AND NOT EXISTS(SELECT 1 FROM stock_moves m WHERE m.reference_id=t.id AND m.move_type='adjustment')")+
    ') THEN detail ELSE NULL END WHERE id=?'
  ).bind(...(needMove?[cmd.id,moveId,auditId]:[cmd.id,auditId]));
  steps.push(validation);
  const result=await db.batch(steps);
  if(!Array.isArray(result)||result.length!==steps.length||
     result.some(x=>changes(x)!==1))return reply(409,{code:'E_STOCKTAKE_CONFLICT'});
  return reply(200,{ok:true,result:{id:cmd.id,status:'confirmed',
    adjustment:needMove?delta:0}});
}
export async function nativeStocktakeHttp(request,env){
  if(!nativeStocktakeWriteEnabled(env))return reply(503,{code:'E_NOT_READY'});
  if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/stocktake'||url.search||url.hash)
      return reply(400,{code:'E_BAD_REQUEST'});
    if(request.headers.get('sec-fetch-site')!=='same-origin'||
       request.headers.has('authorization'))return reply(403,{code:'E_ORIGIN_DENIED'});
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,principal,'staff'))
      return reply(403,{code:'E_FORBIDDEN'});
    const data=await command(request);
    if(!data)return reply(400,{code:'E_INVALID_COMMAND'});
    const schema=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(schema?.contract_version)!==3)
      return reply(503,{code:'E_SCHEMA_NOT_READY'});
    return data.action==='stocktake.create'?
      await createStocktake(env.DB,principal,data):
      await confirmStocktake(env.DB,principal,data);
  }catch{return reply(503,{code:'E_STOCKTAKE_UNAVAILABLE'});}
}
