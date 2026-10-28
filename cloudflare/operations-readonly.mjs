// First Cloudflare D1 business-data increment: staging Preview only.
// No credential enrollment, mutations, production activation or public demo data.
import { loadPrincipal, hasAccess } from './auth-core.mjs';

const headers = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff'
});
const reply = (status, data) => new Response(JSON.stringify(data), {status, headers});

// All SQL identifiers and predicates are server-owned. Never interpolate entity
// or requester-supplied store IDs into SQL. Filter in SQL BEFORE LIMIT.
function queryFor(entity, p) {
  const owner = p.role === 'owner';
  const staff = p.role === 'staff';
  const allowed = ' IN (SELECT location_id FROM user_locations WHERE user_id=?)';
  const scope = (alias, ownColumn) => owner ? {where:'', params:[]} : {
    where:' WHERE '+alias+'.location_id'+allowed+(staff && ownColumn ? ' AND '+alias+'.'+ownColumn+'=?' : ''),
    params:staff && ownColumn ? [p.id,p.id] : [p.id]
  };
  const simple = (sql, params=[]) => ({sql,params});
  if(entity==='locations') {
    if(owner) return simple('SELECT l.id,l.name,l.active FROM locations l ORDER BY l.name LIMIT 500');
    return simple('SELECT l.id,l.name,l.active FROM locations l JOIN user_locations ul ON ul.location_id=l.id WHERE ul.user_id=? ORDER BY l.name LIMIT 500',[p.id]);
  }
  if(entity==='ingredients') return simple('SELECT id,sku,name,unit,min_stock,active FROM ingredients ORDER BY name LIMIT 500');
  if(entity==='training_courses') return simple('SELECT id,title,description,required_score,active FROM training_courses ORDER BY title LIMIT 500');
  if(entity==='tasks') {
    const x=scope('t','assigned_to');
    return simple('SELECT t.*,u.display_name AS assigned_name,l.name AS location_name FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to JOIN locations l ON l.id=t.location_id'+x.where+' ORDER BY t.created_at DESC LIMIT 500',x.params);
  }
  if(entity==='purchase_orders') {
    const x=scope('o','created_by');
    return simple('SELECT o.*,i.name AS ingredient_name,i.unit,l.name AS location_name FROM purchase_orders o JOIN ingredients i ON i.id=o.ingredient_id JOIN locations l ON l.id=o.location_id'+x.where+' ORDER BY o.created_at DESC LIMIT 500',x.params);
  }
  if(entity==='repairs') {
    const x=scope('r','created_by');
    return simple('SELECT r.*,l.name AS location_name,u.display_name AS assigned_name FROM repairs r JOIN locations l ON l.id=r.location_id LEFT JOIN users u ON u.id=r.assigned_to'+x.where+' ORDER BY r.created_at DESC LIMIT 500',x.params);
  }
  if(entity==='shifts') {
    const x=scope('s','user_id');
    return simple('SELECT s.*,u.display_name AS staff_name,l.name AS location_name FROM shifts s JOIN users u ON u.id=s.user_id JOIN locations l ON l.id=s.location_id'+x.where+' ORDER BY s.shift_date DESC,s.start_time LIMIT 500',x.params);
  }
  if(entity==='stock') {
    const where=owner?' WHERE i.active=1 AND l.active=1':' WHERE i.active=1 AND l.active=1 AND l.id'+allowed;
    return simple('SELECT i.id AS ingredient_id,i.sku,i.name,i.unit,i.min_stock,l.id AS location_id,l.name AS location_name,COALESCE(SUM(m.qty_delta),0) AS on_hand FROM ingredients i CROSS JOIN locations l LEFT JOIN stock_moves m ON m.ingredient_id=i.id AND m.location_id=l.id'+where+' GROUP BY i.id,l.id ORDER BY l.name,i.name LIMIT 500',owner?[]:[p.id]);
  }
  if(entity==='staff_directory') {
    const where=owner?'':' WHERE ul.location_id'+allowed;
    return simple('SELECT u.id,u.display_name,u.role,u.active,ul.location_id FROM users u JOIN user_locations ul ON ul.user_id=u.id'+where+' ORDER BY u.display_name LIMIT 500',owner?[]:[p.id]);
  }
  if(entity==='users' && owner)
    return simple("SELECT u.id,u.username,u.display_name,u.role,u.active,group_concat(l.name,'、') AS locations FROM users u LEFT JOIN user_locations ul ON ul.user_id=u.id LEFT JOIN locations l ON l.id=ul.location_id GROUP BY u.id ORDER BY u.role,u.display_name LIMIT 500");
  if(entity==='audit_logs' && owner)
    return simple('SELECT id,at,actor_name,action,entity,entity_id,location_id,detail FROM audit_logs ORDER BY at DESC LIMIT 500');
  return null;
}

export async function previewOperationalData(request, env) {
  if(env?.CLOUD_AUTH_PHASE!=='preview-readonly' || !env.DB?.prepare)
    return reply(503,{code:'E_NOT_READY'});
  if(request.method!=='GET') return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try {
    const principal=await loadPrincipal(env.DB,request);
    if(!hasAccess(principal,'staff')) return reply(401,{code:'E_UNAUTHENTICATED'});
    const entity=new URL(request.url).searchParams.get('entity');
    const plan=queryFor(entity,principal);
    if(!plan) return reply(404,{code:'E_UNKNOWN_ENTITY'});
    const marker=await env.DB.prepare('SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if(Number(marker?.contract_version)!==3) return reply(503,{code:'E_SCHEMA_NOT_READY'});
    const data=await env.DB.prepare(plan.sql).bind(...plan.params).all();
    if(!Array.isArray(data?.results)) throw new Error('E_D1_RESPONSE');
    return reply(200,{rows:data.results});
  } catch {
    // Database/schema/driver failures must not disclose SQL or internal details.
    return reply(503,{code:'E_OPERATIONS_UNAVAILABLE'});
  }
}
