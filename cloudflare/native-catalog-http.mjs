// Native Owner-only D1 store/ingredient setup. Disabled unless separately
// released by an operator; never creates owners, users or permissions.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {normalizeCatalogCommand} from './catalog-crud-contract.mjs';
import {loadPrincipal,authorizedMutation,hasAccess} from './auth-core.mjs';

const HEADERS={'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const LIMIT=2048;
export const nativeCatalogWriteEnabled=env=>
  nativeLoginEnabled(env)&&env.CLOUD_NATIVE_CATALOG_WRITE_GATE==='operator-released';
const changes=result=>{
  const n=result?.meta?.changes??result?.changes;
  if(!Number.isSafeInteger(n)||n<0)throw Error('E_D1_BATCH_RESULT');
  return n;
};
function qtyOk(n){return typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1000000&&
  Math.abs(n*1000-Math.round(n*1000))<0.0000001;}
async function decode(request){
  if(request.headers.get('content-type')!=='application/json')return null;
  const declared=request.headers.get('content-length');
  if(declared!==null&&(!/^(0|[1-9][0-9]*)$/.test(declared)||
    Number(declared)>LIMIT))return null;
  const reader=request.body?.getReader();
  if(!reader)return null;
  let timer,size=0;
  const parts=[];
  try{
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('E_TIMEOUT')),2000);});
    while(true){
      const step=await Promise.race([reader.read(),deadline]);
      if(step.done)break;
      if(!(step.value instanceof Uint8Array))return null;
      size+=step.value.byteLength;
      if(size>LIMIT)return null;
      parts.push(step.value);
    }
    if(!size)return null;
    const bytes=new Uint8Array(size);let index=0;
    for(const part of parts){bytes.set(part,index);index+=part.byteLength;}
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if(!data||typeof data!=='object'||Array.isArray(data)||
       Object.keys(data).sort().join(',')!=='action,data'||
       !data.data||typeof data.data!=='object'||Array.isArray(data.data))return null;
    const v=data.data,fields=Object.keys(v).sort().join(',');
    if(data.action==='location.create'&&fields==='name'&&
       typeof v.name==='string'){
      const name=v.name.trim();
      if(name.length>=1&&name.length<=120)return {action:data.action,name};
    }
    if(data.action==='ingredient.create'&&
       (fields==='name,sku,unit'||fields==='min_stock,name,sku,unit')&&
       typeof v.sku==='string'&&/^[A-Za-z0-9_.-]{1,40}$/.test(v.sku)&&
       typeof v.name==='string'&&typeof v.unit==='string'&&
       (v.min_stock===undefined||qtyOk(v.min_stock))){
      const name=v.name.trim(),unit=v.unit.trim();
      if(name.length>=1&&name.length<=120&&unit.length>=1&&unit.length<=20)
        return {action:data.action,sku:v.sku,name,unit,min_stock:v.min_stock??0};
    }
    if(['ingredient.update','ingredient.active','location.update','location.active']
      .includes(data.action)){
      const normalized=normalizeCatalogCommand(data.action,v);
      if(data.action==='ingredient.update'&&
         (!/^[A-Za-z0-9_.-]{1,40}$/.test(normalized.expected.sku)||
          !qtyOk(normalized.expected.min_stock)||
          !qtyOk(normalized.changes.min_stock)))return null;
      return {action:data.action,...normalized};
    }
    return null;
  }catch{return null;}
  finally{
    if(timer)clearTimeout(timer);
    try{const p=reader.cancel();p?.catch?.(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
}
async function createRecord(db,principal,cmd){
  const id=crypto.randomUUID(),auditId=crypto.randomUUID(),now=new Date().toISOString();
  let table,insert,audit;
  const isLocation=cmd.action==='location.create';
  if(isLocation){
    table='locations';
    const exists=await db.prepare('SELECT id FROM locations WHERE name=? LIMIT 1')
      .bind(cmd.name).first();
    if(exists)return reply(409,{code:'E_CATALOG_DUPLICATE'});
    insert=db.prepare(
      'INSERT INTO locations(id,name) SELECT ?,? WHERE EXISTS('+
      'SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id '+
      "WHERE u.id=? AND u.active=1 AND u.role='owner' "+
      'AND s.token_hash=? AND s.expires_at>?)'
    ).bind(id,cmd.name,principal.id,principal.token_hash,now);
  }else{
    table='ingredients';
    const exists=await db.prepare('SELECT id FROM ingredients WHERE sku=? LIMIT 1')
      .bind(cmd.sku).first();
    if(exists)return reply(409,{code:'E_CATALOG_DUPLICATE'});
    insert=db.prepare(
      'INSERT INTO ingredients(id,sku,name,unit,min_stock) SELECT ?,?,?,?,? WHERE EXISTS('+
      'SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id '+
      "WHERE u.id=? AND u.active=1 AND u.role='owner' "+
      'AND s.token_hash=? AND s.expires_at>?)'
    ).bind(id,cmd.sku,cmd.name,cmd.unit,cmd.min_stock,
      principal.id,principal.token_hash,now);
  }
  // Audit only if the row was actually created. Missing audit forces a NOT NULL
  // violation inside D1.batch so a successful row is never unaudited.
  audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    'SELECT ?,?,?,?,?,?,NULL,? FROM '+table+' WHERE id=?'
  ).bind(auditId,principal.id,principal.username,cmd.action,table,id,
    JSON.stringify(isLocation?{name:cmd.name}:{sku:cmd.sku,name:cmd.name,unit:cmd.unit}),
    id);
  const guard=db.prepare(
    'UPDATE '+table+' SET name=CASE WHEN EXISTS('+
    "SELECT 1 FROM audit_logs a WHERE a.id=? AND a.entity=? AND a.entity_id=?"+
    ') THEN name ELSE NULL END WHERE id=?'
  ).bind(auditId,table,id,id);
  const results=await db.batch([insert,audit,guard]);
  if(!Array.isArray(results)||results.length!==3||
     results.some(x=>changes(x)!==1))return reply(409,{code:'E_CONCURRENT_CHANGE'});
  return reply(200,{ok:true,result:{id,
    ...(isLocation?{name:cmd.name}:{sku:cmd.sku,name:cmd.name,
      unit:cmd.unit,min_stock:cmd.min_stock})}});
}

// Only names from these fixed tables are interpolated into SQL.
const OWNER_LIVE="EXISTS(SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id "+
  "WHERE u.id=? AND u.active=1 AND u.role='owner' AND "+
  "s.token_hash=? AND s.expires_at>?)";
const UNIT_REFERENCES=['stock_moves','purchase_orders','stocktakes',
  'ingredient_prices','dish_ingredients'];
async function mutateRecord(db,principal,cmd){
  const isStore=cmd.action.startsWith('location.');
  const table=isStore?'locations':'ingredients';
  const edit=cmd.action.endsWith('.update');
  const before=await db.prepare('SELECT * FROM '+table+' WHERE id=?').bind(cmd.id).first();
  if(!before)return reply(404,{code:'E_CATALOG_NOT_FOUND'});
  const now=new Date().toISOString();
  let sql,args,detail;
  if(edit){
    const e=cmd.expected,c=cmd.changes;
    if(isStore){
      if(before.name!==e.name||before.name===c.name)
        return reply(409,{code:'E_CONCURRENT_CHANGE'});
      const duplicate=await db.prepare('SELECT id FROM locations WHERE name=? AND id<>? LIMIT 1')
        .bind(c.name,cmd.id).first();
      if(duplicate)return reply(409,{code:'E_CATALOG_DUPLICATE'});
      sql='UPDATE locations SET name=? WHERE id=? AND name=? AND '+OWNER_LIVE;
      args=[c.name,cmd.id,e.name,principal.id,principal.token_hash,now];
      detail={before:e.name,after:c.name};
    }else{
      if(before.active!==1||before.sku!==e.sku||before.name!==e.name||
        before.unit!==e.unit||Number(before.min_stock)!==e.min_stock||
        (before.name===c.name&&before.unit===c.unit&&
          Number(before.min_stock)===c.min_stock))
        return reply(409,{code:'E_CONCURRENT_CHANGE'});
      const unitChanged=before.unit!==c.unit;
      if(unitChanged){
        for(const ref of UNIT_REFERENCES){
          if(await db.prepare('SELECT 1 FROM '+ref+' WHERE ingredient_id=? LIMIT 1')
            .bind(cmd.id).first())
            return reply(409,{code:'E_CATALOG_UNIT_REFERENCED'});
        }
      }
      sql='UPDATE ingredients SET name=?,unit=?,min_stock=? WHERE '+
        'id=? AND sku=? AND name=? AND unit=? AND min_stock=? AND active=1 AND '+OWNER_LIVE+
        (unitChanged?UNIT_REFERENCES.map(ref=>
          ' AND NOT EXISTS(SELECT 1 FROM '+ref+' WHERE ingredient_id=?)').join(''):'');
      args=[c.name,c.unit,c.min_stock,cmd.id,e.sku,e.name,e.unit,e.min_stock,
        principal.id,principal.token_hash,now,
        ...(unitChanged?UNIT_REFERENCES.map(()=>cmd.id):[])];
      detail={before:e,after:c};
    }
  }else{
    if(before.active!==cmd.expected_active)
      return reply(409,{code:'E_CONCURRENT_CHANGE'});
    if(cmd.active===0){
      if(isStore){
        const count=await db.prepare('SELECT COUNT(*) AS n FROM locations WHERE active=1')
          .first();
        if(!Number.isSafeInteger(count?.n)||count.n<=1)
          return reply(409,{code:'E_CATALOG_LAST_LOCATION'});
      }
      const key=isStore?'location_id':'ingredient_id';
      for(const [ref,filter] of [
        ['purchase_orders',"status IN ('requested','approved')"],
        ['stocktakes',"status='pending'"]]){
        if(await db.prepare('SELECT 1 FROM '+ref+' WHERE '+key+'=? AND '+
          filter+' LIMIT 1').bind(cmd.id).first())
          return reply(409,{code:'E_CATALOG_PENDING_WORK'});
      }
    }
    sql='UPDATE '+table+' SET active=? WHERE id=? AND active=? AND '+OWNER_LIVE;
    if(cmd.active===0){
      const key=isStore?'location_id':'ingredient_id';
      if(isStore)sql+=' AND (SELECT COUNT(*) FROM locations WHERE active=1)>1';
      sql+=" AND NOT EXISTS(SELECT 1 FROM purchase_orders WHERE "+key+
        "=? AND status IN ('requested','approved'))"+
        " AND NOT EXISTS(SELECT 1 FROM stocktakes WHERE "+key+
        "=? AND status='pending')";
    }
    args=[cmd.active,cmd.id,cmd.expected_active,principal.id,principal.token_hash,now,
      ...(cmd.active===0?[cmd.id,cmd.id]:[])];
    detail={from:cmd.expected_active,to:cmd.active};
  }
  // D1.batch is transactional; changes() must be from the immediately
  // preceding conditional UPDATE, so an unsuccessful CAS cannot be audited.
  const statement=db.prepare(sql).bind(...args),auditId=crypto.randomUUID();
  const audit=db.prepare(
    'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) '+
    'SELECT ?,?,?,?,?,?,?,? FROM '+table+' WHERE id=? AND changes()=1'
  ).bind(auditId,principal.id,principal.username,cmd.action,table,cmd.id,
    isStore?cmd.id:null,JSON.stringify(detail),cmd.id);
  const operations=[statement,audit];
  if(isStore&&!edit&&cmd.active===0){
    // The audit precedes session invalidation, which can revoke the caller.
    operations.push(db.prepare(
      'DELETE FROM sessions WHERE user_id IN ('+
      'SELECT user_id FROM user_locations WHERE location_id=?) AND EXISTS ('+
      "SELECT 1 FROM audit_logs WHERE id=? AND action='location.active')"
    ).bind(cmd.id,auditId));
  }
  // A missing audit on an existing row forces a NOT NULL error and rolls
  // the entire transaction back, rather than committing an unaudited write.
  operations.push(db.prepare(
    'UPDATE '+table+' SET name=CASE WHEN EXISTS('+
    'SELECT 1 FROM audit_logs WHERE id=? AND entity=? AND entity_id=?'+
    ') THEN name ELSE NULL END WHERE id=?'
  ).bind(auditId,table,cmd.id,cmd.id));
  const results=await db.batch(operations);
  if(!Array.isArray(results)||results.length!==operations.length||
     changes(results[0])!==1||changes(results[1])!==1||
     changes(results[results.length-1])!==1)
    return reply(409,{code:'E_CONCURRENT_CHANGE'});
  return reply(200,{ok:true,result:{id:cmd.id,
    ...(edit?{}:{active:cmd.active})}});
}

export async function nativeCatalogHttp(request,env){
  if(!nativeCatalogWriteEnabled(env))return reply(503,{code:'E_NOT_READY'});
  if(request?.method!=='POST')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/catalog'||url.search||url.hash)
      return reply(400,{code:'E_BAD_REQUEST'});
    if(request.headers.get('sec-fetch-site')!=='same-origin'||
       request.headers.has('authorization'))return reply(403,{code:'E_ORIGIN_DENIED'});
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    if(!hasAccess(principal,'owner')||
       !authorizedMutation(request,principal,'owner'))
      return reply(403,{code:'E_FORBIDDEN'});
    const cmd=await decode(request);
    if(!cmd)return reply(400,{code:'E_INVALID_COMMAND'});
    const marker=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(marker?.contract_version)!==3)
      return reply(503,{code:'E_SCHEMA_NOT_READY'});
    return cmd.action.endsWith('.create')?
      await createRecord(env.DB,principal,cmd):
      await mutateRecord(env.DB,principal,cmd);
  }catch{return reply(503,{code:'E_CATALOG_UNAVAILABLE'});}
}
