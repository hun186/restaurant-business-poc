// Staging/Preview D1 dashboard summary. Only authenticated, scoped SELECTs.
// Production stays disabled; no credential acceptance or writes in this module.
import {loadPrincipal, hasAccess} from './auth-core.mjs';

const headers = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
});
const respond = (status, body) => new Response(JSON.stringify(body), {status, headers});

// SQL identifiers, roles, columns and predicates are entirely server owned.
// A stale user_locations grant to a disabled store must never grant visibility.
function visibility(alias, principal, createdBy) {
  const active = ` EXISTS (SELECT 1 FROM locations active_l WHERE active_l.id=${alias}.location_id AND active_l.active=1)`;
  if (principal.role === 'owner') return {sql: active, args: []};
  const grant = ` AND ${alias}.location_id IN (SELECT ul.location_id FROM user_locations ul JOIN locations allowed_l ON allowed_l.id=ul.location_id WHERE ul.user_id=? AND allowed_l.active=1)`;
  if (principal.role === 'staff' && createdBy)
    return {sql:active+grant+` AND ${alias}.${createdBy}=?`, args:[principal.id, principal.id]};
  return {sql:active+grant, args:[principal.id]};
}

function metricQueries(principal) {
  const tasks=visibility('t',principal,'assigned_to');
  const orders=visibility('o',principal,'created_by');
  const repairs=visibility('r',principal,'created_by');
  const shops=principal.role === 'owner'
    ? {sql:'',args:[]}
    : {sql:' AND l.id IN (SELECT ul.location_id FROM user_locations ul WHERE ul.user_id=?)',args:[principal.id]};
  return [
    ['open_tasks',
      "SELECT COUNT(*) AS n FROM tasks t WHERE t.status IN ('todo','doing') AND "+tasks.sql, tasks.args],
    ['pending_orders',
      "SELECT COUNT(*) AS n FROM purchase_orders o WHERE o.status IN ('requested','approved') AND "+orders.sql, orders.args],
    ['open_repairs',
      "SELECT COUNT(*) AS n FROM repairs r WHERE r.status IN ('reported','assigned') AND "+repairs.sql, repairs.args],
    ['low_stock',
      'SELECT COUNT(*) AS n FROM (SELECT i.id,l.id FROM ingredients i JOIN locations l ON l.active=1 '+
      'LEFT JOIN stock_moves m ON m.ingredient_id=i.id AND m.location_id=l.id '+
      'WHERE i.active=1'+shops.sql+
      ' GROUP BY i.id,l.id,i.min_stock HAVING COALESCE(SUM(m.qty_delta),0)<i.min_stock)',
      shops.args]
  ];
}

export async function previewOperationalOverview(request,env) {
  if (env?.CLOUD_AUTH_PHASE!=='preview-readonly' || !env.DB?.prepare)
    return respond(503,{code:'E_NOT_READY'});
  if (request.method!=='GET') return respond(405,{code:'METHOD_NOT_ALLOWED'});
  const url=new URL(request.url);
  if(url.search || url.hash) return respond(400,{code:'E_BAD_QUERY'});
  try {
    const principal=await loadPrincipal(env.DB,request);
    if(!hasAccess(principal,'staff')) return respond(401,{code:'E_UNAUTHENTICATED'});
    const contract=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(contract?.contract_version)!==3)
      return respond(503,{code:'E_SCHEMA_NOT_READY'});
    const metrics={};
    for(const [name,sql,args] of metricQueries(principal)){
      const stmt=env.DB.prepare(sql);
      const result=await (args.length?stmt.bind(...args):stmt).first();
      if(!Number.isSafeInteger(result?.n) || result.n<0) throw new Error('E_METRIC_INVALID');
      metrics[name]=result.n;
    }
    return respond(200,{status:'staging_readonly',metrics,production_ready:false});
  }catch{
    // Never echo raw D1 errors, SQL or session metadata.
    return respond(503,{code:'E_OVERVIEW_UNAVAILABLE'});
  }
}
