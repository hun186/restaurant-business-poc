// Native production D1 dashboard human-resources counts: read-only, scoped,
// with no Preview route changes, dynamic SQL identifiers, writes or gates.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
function scope(alias,principal){
 const active=' EXISTS (SELECT 1 FROM locations l WHERE l.id='+alias+
   '.location_id AND l.active=1)';
 if(principal.role==='owner')return {sql:active,args:[]};
 const grant=alias+'.location_id IN (SELECT ul.location_id FROM user_locations ul '+
  'JOIN locations allowed ON allowed.id=ul.location_id AND allowed.active=1 '+
  'WHERE ul.user_id=?)';
 if(principal.role==='manager')return {sql:active+' AND '+grant,args:[principal.id]};
 return {sql:active+' AND '+grant+' AND '+alias+'.user_id=?',
  args:[principal.id,principal.id]};
}
export function nativeHrMetricQueries(principal,businessDate){
 if(!principal||!['owner','manager','staff'].includes(principal.role)||
  typeof principal.id!=='string'||!principal.id||
  typeof businessDate!=='string'||!DAY.test(businessDate))
   throw Error('E_HR_OVERVIEW_INPUT');
 const leave=scope('r',principal),shifts=scope('s',principal);
 return [
  ['pending_leaves',
   "SELECT COUNT(*) AS n FROM leave_requests r WHERE r.status='pending' AND "+
     leave.sql,leave.args],
  ['today_shifts',
   'SELECT COUNT(*) AS n FROM shifts s WHERE s.shift_date=? AND '+shifts.sql,
   [businessDate,...shifts.args]]
 ];
}
