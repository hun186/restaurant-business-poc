// Native D1 supplementary read-only plans for features already present in
// schema v3. No mutation, dynamic SQL identifiers or Preview route exposure.
const ASSIGNED=" IN (SELECT g.location_id FROM user_locations g "+
  "JOIN locations enabled ON enabled.id=g.location_id AND enabled.active=1 "+
  "WHERE g.user_id=?)";
const QUERIES=Object.freeze({
  stock_moves:Object.freeze({
    sql:'SELECT m.created_at,m.qty_delta,m.move_type,m.note,'+
      'i.name AS ingredient_name,i.unit,l.name AS location_name '+
      'FROM stock_moves m JOIN ingredients i ON i.id=m.ingredient_id '+
      'JOIN locations l ON l.id=m.location_id',
    alias:'m',ownerColumn:null,order:'m.created_at DESC,m.id DESC'
  }),
  leave_requests:Object.freeze({
    sql:'SELECT r.start_date,r.end_date,r.reason,r.status,r.created_at,'+
      'u.display_name AS staff_name,l.name AS location_name '+
      'FROM leave_requests r JOIN users u ON u.id=r.user_id '+
      'JOIN locations l ON l.id=r.location_id',
    alias:'r',ownerColumn:'user_id',order:'r.created_at DESC,r.id DESC'
  }),
  training_records:Object.freeze({
    sql:'SELECT r.score,r.completed_on,c.title AS course_title,'+
      'c.required_score,u.display_name AS staff_name,l.name AS location_name '+
      'FROM training_records r JOIN training_courses c ON c.id=r.course_id '+
      'JOIN users u ON u.id=r.user_id JOIN locations l ON l.id=r.location_id',
    alias:'r',ownerColumn:'user_id',order:'r.completed_on DESC,r.id DESC'
  }),
  evaluations:Object.freeze({
    sql:'SELECT e.period,e.score,e.feedback,e.created_at,'+
      'u.display_name AS staff_name,l.name AS location_name '+
      'FROM evaluations e JOIN users u ON u.id=e.user_id '+
      'JOIN locations l ON l.id=e.location_id',
    alias:'e',ownerColumn:'user_id',order:'e.period DESC,e.created_at DESC,e.id DESC'
  })
});
export const NATIVE_READONLY_PARITY_ENTITIES=Object.freeze(Object.keys(QUERIES));
export function nativeParityReadonlyPlan(entity,principal){
  if(!Object.hasOwn(QUERIES,entity)||!principal||
     !['owner','manager','staff'].includes(principal.role)||
     typeof principal.id!=='string'||!principal.id)return null;
  const def=QUERIES[entity];
  const where=principal.role==='owner'?'':
    ' WHERE '+def.alias+'.location_id'+ASSIGNED+
    (principal.role==='staff'&&def.ownerColumn?
      ' AND '+def.alias+'.'+def.ownerColumn+'=?':'');
  const params=principal.role==='owner'?[]:
    principal.role==='staff'&&def.ownerColumn?[principal.id,principal.id]:[principal.id];
  return Object.freeze({sql:def.sql+where+' ORDER BY '+def.order+' LIMIT 500',params});
}
