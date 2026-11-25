// Owner-only, GET-only Native D1 audit timeline. Never expose IP hashes,
// raw detail JSON, secrets, session tokens or opaque database identifiers.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal} from './auth-core.mjs';

const HEADERS=Object.freeze({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0',
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'
});
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});
const PAGE_SIZE=50,MAX_OFFSET=5000;
const CATEGORY=Object.freeze({
  auth:"action LIKE 'auth.%'",
  account:"action LIKE 'user.%'",
  operations:"action NOT LIKE 'auth.%' AND action NOT LIKE 'user.%'"
});
const DETAIL_KEYS=Object.freeze({
  from:'原狀態',to:'新狀態',status:'狀態',role:'角色',active:'啟用',
  revoked_sessions:'已撤銷登入',sessions_revoked:'已撤銷登入',
  qty:'數量',qty_delta:'數量變化',delta:'盤點差異',
  number:'單號',password_changed:'密碼已更新'
});
const dayValid=value=>{
  if(typeof value!=='string'||!/^20[0-9]{2}-[0-9]{2}-[0-9]{2}$/.test(value))return false;
  const [year,month,day]=value.split('-').map(Number);
  const utc=new Date(Date.UTC(year,month-1,day));
  return utc.toISOString().slice(0,10)===value;
};
const taipeiBoundary=(day,addDays=0)=>{
  const [year,month,date]=day.split('-').map(Number);
  return new Date(Date.UTC(year,month-1,date+addDays)-8*3600000)
    .toISOString().slice(0,19).replace('T',' ');
};
const summaryOf=raw=>{
  if(typeof raw!=='string'||raw.length>3000)return '';
  let value;try{value=JSON.parse(raw);}catch{return '';}
  if(!value||typeof value!=='object'||Array.isArray(value))return '';
  const items=[];
  for(const [name,label] of Object.entries(DETAIL_KEYS)){
    const field=value[name];
    if(typeof field==='boolean')items.push(label+'：'+(field?'是':'否'));
    else if(typeof field==='number'&&Number.isFinite(field)&&Math.abs(field)<=1e9)
      items.push(label+'：'+String(field));
    else if(typeof field==='string'&&field.length<=48&&
      /^[A-Za-z0-9\u4e00-\u9fff ._:-]+$/u.test(field))
      items.push(label+'：'+field);
  }
  return items.join('；').slice(0,240);
};
// Resolve only the current account name for the exact reset event.
// Never infer a name from the original raw detail or return entity IDs.
function auditSummary(row){
 if(row.action!=='user.password_reset')return summaryOf(row.detail);
 if(row.entity!=='users')return '密碼重設事件；目標帳號無法核對';
 const name=row.reset_target_username;
 return typeof name==='string'&&/^[A-Za-z0-9_.-]{1,40}$/.test(name)
  ?'重設對象（目前帳號）：'+name
  :'密碼重設事件；目標帳號無法核對';
}
export async function nativeAuditHttp(request,env){
  if(!nativeLoginEnabled(env))return reply(503,{code:'E_NOT_READY'});
  if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  if(request.headers.has('authorization')||request.headers.has('x-forwarded-user'))
    return reply(400,{code:'E_INVALID_REQUEST'});
  const fetchSite=request.headers.get('sec-fetch-site');
  if(fetchSite&&fetchSite!=='same-origin')return reply(403,{code:'E_FORBIDDEN'});
  let url,offset=0,category='all',from='',to='';
  try{
    url=new URL(request.url);
    if(url.protocol!=='https:'||url.pathname!=='/api/audit'||url.hash||
       url.search.length>140)return reply(400,{code:'E_BAD_QUERY'});
    const keys=[...url.searchParams.keys()];
    if(keys.some(key=>!['offset','category','from','to'].includes(key))||
       new Set(keys).size!==keys.length)return reply(400,{code:'E_BAD_QUERY'});
    if(url.searchParams.has('offset')){
      const raw=url.searchParams.get('offset');
      if(!/^(0|[1-9][0-9]{0,4})$/.test(raw))return reply(400,{code:'E_BAD_QUERY'});
      offset=Number(raw);
      if(offset>MAX_OFFSET||offset%PAGE_SIZE!==0)return reply(400,{code:'E_BAD_QUERY'});
    }
    if(url.searchParams.has('category')){
      category=url.searchParams.get('category');
      if(category!=='all'&&!Object.hasOwn(CATEGORY,category))
        return reply(400,{code:'E_BAD_QUERY'});
    }
    from=url.searchParams.get('from')||'';to=url.searchParams.get('to')||'';
    if((from&&!dayValid(from))||(to&&!dayValid(to))||
       (from&&to&&(from>to||
         (Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z'))>366*86400000)))
      return reply(400,{code:'E_BAD_QUERY'});
  }catch{return reply(400,{code:'E_BAD_QUERY'});}
  try{
    const principal=await loadPrincipal(env.DB,request);
    if(!principal)return reply(401,{code:'E_UNAUTHENTICATED'});
    if(principal.role!=='owner')return reply(403,{code:'E_FORBIDDEN'});
    const marker=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(marker?.contract_version)!==3)return reply(503,{code:'E_SCHEMA_NOT_READY'});
    const conditions=[],params=[];
    if(category!=='all')conditions.push('('+CATEGORY[category]+')');
    if(from){conditions.push('at>=?');params.push(taipeiBoundary(from));}
    if(to){conditions.push('at<?');params.push(taipeiBoundary(to,1));}
    const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
    // Query only display-safe columns. IP hashes, actor IDs and raw details
    // are deliberately excluded from the response projection.
    const rows=await env.DB.prepare(
      'SELECT at,actor_name,action,entity,detail, '+
      "CASE WHEN action='user.password_reset' AND entity='users' THEN "+
      '(SELECT username FROM users WHERE users.id=audit_logs.entity_id) '+
      'ELSE NULL END AS reset_target_username FROM audit_logs'+where+
      ' ORDER BY at DESC,id DESC LIMIT 51 OFFSET ?'
    ).bind(...params,offset).all();
    if(!Array.isArray(rows?.results)||rows.results.length>PAGE_SIZE+1)
      return reply(503,{code:'E_AUDIT_UNAVAILABLE'});
    const page=rows.results.slice(0,PAGE_SIZE).map(row=>({
      at:typeof row.at==='string'?row.at.slice(0,24):'',
      actor_name:typeof row.actor_name==='string'?row.actor_name.slice(0,80):'',
      action:typeof row.action==='string'?row.action.slice(0,80):'',
      entity:typeof row.entity==='string'?row.entity.slice(0,80):'',
      summary:auditSummary(row)
    }));
    const extra=rows.results.length>PAGE_SIZE;
    const truncated=extra&&offset>=MAX_OFFSET;
    const hasMore=extra&&!truncated;
    return reply(200,{mode:'native_d1',rows:page,offset,has_more:hasMore,
      next_offset:hasMore?offset+PAGE_SIZE:null,truncated});
  }catch{
    return reply(503,{code:'E_AUDIT_UNAVAILABLE'});
  }
}
