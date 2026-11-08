// Native-session D1 read service. Only reachable after operator-released gates.
import {nativeLoginEnabled} from './native-login-http.mjs';
import {loadPrincipal,hasAccess} from './auth-core.mjs';
import {queryFor} from './operations-readonly.mjs';
import {metricQueries} from './overview-readonly.mjs';

const ENTITIES=new Set(['locations','ingredients','training_courses','tasks','assignable_staff',
  'purchase_orders','repairs','shifts','stock']);
const HEADERS=Object.freeze({'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer'});
const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:HEADERS});

export async function nativeBusinessReadHttp(request,env){
  if(!nativeLoginEnabled(env))return reply(503,{code:'E_NOT_READY'});
  if(request?.method!=='GET')return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try{
    const url=new URL(request.url);
    if(url.protocol!=='https:'||url.hash||url.search.length>100)
      return reply(400,{code:'E_BAD_QUERY'});
    const isData=url.pathname==='/api/data',isOverview=url.pathname==='/api/overview';
    if(!isData&&!isOverview)return reply(404,{code:'E_NOT_FOUND'});
    let entity=null;
    if(isData){
      const keys=[...url.searchParams.keys()];
      if(keys.length!==1||keys[0]!=='entity')return reply(400,{code:'E_BAD_QUERY'});
      entity=url.searchParams.get('entity');
      if(!ENTITIES.has(entity))return reply(404,{code:'E_UNKNOWN_ENTITY'});
    }else if(url.search)return reply(400,{code:'E_BAD_QUERY'});
    const principal=await loadPrincipal(env.DB,request);
    if(!hasAccess(principal,'staff'))return reply(401,{code:'E_UNAUTHENTICATED'});
    const schema=await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(schema?.contract_version)!==3)
      return reply(503,{code:'E_SCHEMA_NOT_READY'});
    if(isData){
      // Assignment candidates are never available to ordinary staff.
      // Store membership and active role are checked again inside the task INSERT.
      if(entity==='assignable_staff'){
        if(!hasAccess(principal,'manager'))return reply(403,{code:'E_FORBIDDEN'});
        const sql="SELECT u.id,u.display_name,u.role,ul.location_id FROM users u "+
          "JOIN user_locations ul ON ul.user_id=u.id "+
          "JOIN locations l ON l.id=ul.location_id "+
          "WHERE u.active=1 AND l.active=1 AND u.role IN ('manager','staff') "+
          (principal.role==='owner'?'':"AND ul.location_id IN ("+
            "SELECT grants.location_id FROM user_locations grants "+
            "JOIN locations allowed ON allowed.id=grants.location_id AND allowed.active=1 "+
            "WHERE grants.user_id=?) ")+
          "ORDER BY u.display_name,u.id LIMIT 500";
        const args=principal.role==='owner'?[]:[principal.id];
        const statement=env.DB.prepare(sql);
        const list=await (args.length?statement.bind(...args):statement).all();
        if(!Array.isArray(list?.results)||list.results.length>500)
          throw Error('E_D1_INVALID_ROWS');
        return reply(200,{mode:'native_d1',entity,rows:list.results});
      }
      const plan=queryFor(entity,principal);
      if(!plan)return reply(404,{code:'E_UNKNOWN_ENTITY'});
      const result=await env.DB.prepare(plan.sql).bind(...plan.params).all();
      if(!Array.isArray(result?.results)||result.results.length>500)
        throw Error('E_D1_INVALID_ROWS');
      return reply(200,{mode:'native_d1',entity,rows:result.results});
    }
    const metrics={};
    for(const [name,sql,args] of metricQueries(principal)){
      const statement=env.DB.prepare(sql);
      const metric=await (args.length?statement.bind(...args):statement).first();
      if(!Number.isSafeInteger(metric?.n)||metric.n<0)throw Error('E_D1_INVALID_METRIC');
      metrics[name]=metric.n;
    }
    return reply(200,{mode:'native_d1',metrics});
  }catch{
    return reply(503,{code:'E_BUSINESS_UNAVAILABLE'});
  }
}