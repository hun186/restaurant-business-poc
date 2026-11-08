// Native D1 single-line purchase workflow, disabled by default.
// Only approved purchase orders may add stock_moves; never edit on_hand.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal,hasAccess,authorizedMutation} from './auth-core.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff'};
const reply=(code,data)=>new Response(JSON.stringify(data),{status:code,headers:HEADERS});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const BODY_LIMIT=4096;
export const nativeOrderWriteEnabled=env=>
  nativeLoginEnabled(env)&&env.CLOUD_NATIVE_ORDER_WRITE_GATE==='operator-released';
const count=result=>{
  const n=result?.meta?.changes??result?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_BATCH_INVALID');
  return n;
};
const positiveQty=q=>typeof q==='number'&&Number.isFinite(q)&&q>0&&q<=1000000&&
  Math.abs(q*1000-Math.round(q*1000))<0.0000001;
async function boundedJson(request){
  if(request.headers.get('content-type')!=='application/json')return null;
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||
    Number(declared)>BODY_LIMIT))return null;
  const reader=request.body?.getReader();
  if(!reader)return null;
  let timer,size=0;const chunks=[];
  try{
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('E_TIMEOUT')),2000);});
    for(;;){
      const part=await Promise.race([reader.read(),deadline]);
      if(part.done)break;
      if(!(part.value instanceof Uint8Array))return null;
      size+=part.value.byteLength;if(size>BODY_LIMIT)return null;
      chunks.push(part.value);
    }
    if(!size)return null;
    const bytes=new Uint8Array(size);let offset=0;
    for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
    const obj=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!obj||typeof obj!=='object'||Array.isArray(obj)||
       Object.keys(obj).sort().join(',')!=='action,data'||!obj.data||
       typeof obj.data!=='object'||Array.isArray(obj.data))return null;
    const data=obj.data,keys=Object.keys(data).sort().join(',');
    if(obj.action==='order.create'&&
       keys==='ingredient_id,location_id,qty,supplier'&&
       typeof data.location_id==='string'&&UUID.test(data.location_id)&&
       typeof data.ingredient_id==='string'&&UUID.test(data.ingredient_id)&&
       typeof data.supplier==='string'&&positiveQty(data.qty)){
      const supplier=data.supplier.trim();
      if(supplier.length>=1&&supplier.length<=120)
        return {action:obj.action,location_id:data.location_id,
          ingredient_id:data.ingredient_id,qty:data.qty,supplier};
    }
    if(['order.approve','order.receive','order.cancel'].includes(obj.action)&&
       keys==='expected_status,id'&&typeof data.id==='string'&&UUID.test(data.id)&&
       (data.expected_status==='requested'||data.expected_status==='approved')){
      return {action:obj.action,id:data.id,expected_status:data.expected_status};
    }
    return null;
  }catch{return null;}
  finally{
    if(timer)clearTimeout(timer);
    try{const p=reader.cancel();p?.catch?.(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
}
function actorSql(role='staff'){
  const roleGuard=role==='manager'?
    "AND u.role IN ('owner','manager') ":"AND u.role IN ('owner','manager','staff') ";
  return 'EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id '+
    'WHERE u.id=? AND u.active=1 AND u.role=? '+roleGuard+
    'AND s.token_hash=? AND s.expires_at>?)';
}
function activeStoreSql(alias){
  return 'EXISTS(SELECT 1 FROM locations l WHERE l.id='+alias+'.location_id AND l.active=1)';
}
function scopedSql(alias){
  return "(?='owner' OR EXISTS(SELECT 1 FROM user_locations ul "+
    'WHERE ul.user_id=? AND ul.location_id='+alias+'.location_id))';
}
function actorArgs(p,now){return [p.id,p.role,p.token_hash,now,p.role,p.id];}
async function createOrder(db,p,cmd){
  const id=crypto.randomUUID(),auditId=crypto.randomUUID(),now=new Date().toISOString();
  const number='PO-'+id.replaceAll('-','').toUpperCase();
  const insert=db.prepare(
    'INSERT INTO purchase_orders(id,number,location_id,ingredient_id,supplier,qty,created_by) '+
    'SELECT ?,?,?,?,?,?,? WHERE '+
    'EXISTS(SELECT 1 FROM locations l WHERE l.id=? AND l.active=1) AND '+
    'EXISTS(SELECT 1 FROM ingredients i WHERE i.id=? AND i.active=1) AND '+
    actorSql()+' AND (?=\'owner\' OR EXISTS(SELECT 1 FROM user_locations ul '+
    'WHERE ul.user_id=? AND ul.location_id=?))'
  ).bind(id,number,cmd.location_id,cmd.ingredient_id,cmd.supplier,cmd.qty,p.id,
    cmd.location_id,cmd.ingredient_id,p.id,p.role,p.token_hash,now,
    p.role,p.id,cmd.location_id);
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    "SELECT ?,?,?,'order.create','purchase_orders',o.id,o.location_id,? "+
    'FROM purchase_orders o WHERE o.id=? AND o.created_by=?'
  ).bind(auditId,p.id,p.username,JSON.stringify({number,ingredient_id:cmd.ingredient_id,
    qty:cmd.qty}),id,p.id);
  const verify=db.prepare(
    'UPDATE purchase_orders SET supplier=CASE WHEN EXISTS('+
    "SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity='purchase_orders' "+
    'AND a.entity_id=purchase_orders.id) THEN supplier ELSE NULL END WHERE id=?'
  ).bind(auditId,id);
  const results=await db.batch([insert,audit,verify]);
  if(!Array.isArray(results)||results.length!==3||
     results.some(x=>count(x)!==1))return reply(409,{code:'E_CONCURRENT_CHANGE'});
  return reply(200,{ok:true,result:{id,number,location_id:cmd.location_id,
    ingredient_id:cmd.ingredient_id,qty:cmd.qty,status:'requested'}});
}
async function changeOrder(db,p,cmd){
  if(!hasAccess(p,'manager'))return reply(403,{code:'E_FORBIDDEN'});
  const item=await db.prepare(
    'SELECT o.id,o.number,o.status,o.qty,o.location_id,o.ingredient_id,l.active '+
    'FROM purchase_orders o JOIN locations l ON l.id=o.location_id '+
    'WHERE o.id=? LIMIT 1'
  ).bind(cmd.id).first();
  if(!item||item.active!==1||!hasAccess(p,'manager',item.location_id))
    return reply(404,{code:'E_ORDER_NOT_FOUND'});
  // Native single-line orders are safe; imported/grouped legacy orders require
  // an independent whole-group transaction and must remain read-only.
  if(item.number!=='PO-'+item.id.replaceAll('-','').toUpperCase())
    return reply(409,{code:'E_ORDER_GROUP_UNSUPPORTED'});
  if(item.status!==cmd.expected_status||
     (cmd.action==='order.approve'&&item.status!=='requested')||
     (cmd.action==='order.receive'&&item.status!=='approved')||
     (cmd.action==='order.cancel'&&!['requested','approved'].includes(item.status)))
    return reply(409,{code:'E_ORDER_STATE_CONFLICT'});
  const target=cmd.action==='order.approve'?'approved':
    cmd.action==='order.receive'?'received':'cancelled';
  const now=new Date().toISOString(),auditId=crypto.randomUUID(),
    moveId=cmd.action==='order.receive'?crypto.randomUUID():null;
  const where=[
    'o.id=? AND o.status=?',
    'AND '+activeStoreSql('o'),
    'AND EXISTS(SELECT 1 FROM ingredients i WHERE i.id=o.ingredient_id AND i.active=1)',
    'AND '+actorSql('manager'),'AND '+scopedSql('o'),
    "AND NOT EXISTS(SELECT 1 FROM stock_moves m WHERE m.reference_id=o.id AND m.move_type='purchase')"
  ].join(' ');
  const args=[cmd.id,item.status,...actorArgs(p,now)];
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    'SELECT ?,?,?,?,\'purchase_orders\',o.id,o.location_id,? FROM purchase_orders o WHERE '+where
  ).bind(auditId,p.id,p.username,cmd.action,JSON.stringify({number:item.number,
    from:item.status,to:target,stock_move_id:moveId}),...args);
  const update=db.prepare(
    'UPDATE purchase_orders AS o SET status=?,approved_by='+
    (target==='approved'?'?':'approved_by')+',received_at='+
    (target==='received'?'CURRENT_TIMESTAMP':'received_at')+
    ' WHERE '+where+' AND EXISTS(SELECT 1 FROM audit_logs a '+
    "WHERE a.id=? AND a.entity='purchase_orders' AND a.entity_id=o.id)"
  ).bind(...(target==='approved'?[target,p.id]:[target]),...args,auditId);
  const steps=[audit,update];
  if(target==='received'){
    steps.push(db.prepare(
      'INSERT INTO stock_moves(id,ingredient_id,location_id,qty_delta,move_type,reference_id,note,actor_id) '+
      "SELECT ?,o.ingredient_id,o.location_id,o.qty,'purchase',o.id,?,? "+
      'FROM purchase_orders o WHERE o.id=? AND o.status=\'received\' '+
      'AND EXISTS(SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity_id=o.id) '+
      "AND NOT EXISTS(SELECT 1 FROM stock_moves m WHERE m.reference_id=o.id AND m.move_type='purchase')"
    ).bind(moveId,'已核准叫貨單 '+item.number,p.id,item.id,auditId));
  }
  // Invalid updates/ledger failures force atomic rollback through NOT NULL.
  const validation=target==='received'?
    'EXISTS(SELECT 1 FROM purchase_orders o JOIN stock_moves m '+
    'ON m.reference_id=o.id WHERE o.id=? AND o.status=\'received\' '+
    "AND m.id=? AND m.move_type='purchase' AND m.qty_delta=o.qty)":
    'EXISTS(SELECT 1 FROM purchase_orders o WHERE o.id=? AND o.status=?)';
  steps.push(db.prepare('UPDATE audit_logs SET detail=CASE WHEN '+
    validation+' THEN detail ELSE NULL END WHERE id=?').bind(
      ...(target==='received'?[item.id,moveId,auditId]:[item.id,target,auditId])));
  const result=await db.batch(steps);
  if(!Array.isArray(result)||result.length!==steps.length||
     result.some(x=>count(x)!==1))return reply(409,{code:'E_CONCURRENT_CHANGE'});
  return reply(200,{ok:true,result:{id:item.id,status:target,
    ...(moveId?{stock_move_id:moveId}:{} )}});
}
export async function nativeOrderHttp(request,env){
  if(!nativeOrderWriteEnabled(env))return reply(503,{code:'E_NOT_READY'});
  if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/order'||url.search||url.hash)
      return reply(400,{code:'E_BAD_REQUEST'});
    if(request.headers.get('sec-fetch-site')!=='same-origin'||
       request.headers.has('authorization'))return reply(403,{code:'E_ORIGIN_DENIED'});
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    if(!authorizedMutation(request,principal,'staff'))
      return reply(403,{code:'E_FORBIDDEN'});
    const cmd=await boundedJson(request);
    if(!cmd)return reply(400,{code:'E_INVALID_COMMAND'});
    const schema=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(schema?.contract_version)!==3)
      return reply(503,{code:'E_SCHEMA_NOT_READY'});
    return cmd.action==='order.create'
      ?await createOrder(env.DB,principal,cmd)
      :await changeOrder(env.DB,principal,cmd);
  }catch{return reply(503,{code:'E_ORDER_UNAVAILABLE'});}
}
