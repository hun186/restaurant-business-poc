// Shared shift-time contract for local SQLite and future Native D1.
// Civil wall-clock arithmetic: UTC is only a numeric encoding, not a timezone
// conversion. Half-open intervals, end < start means next calendar day.
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const CLOCK=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const SECONDS=86400;
export function shiftTimeWindow(date,start,end){
 if(typeof date!=='string'||!DAY.test(date)||
    typeof start!=='string'||!CLOCK.test(start)||
    typeof end!=='string'||!CLOCK.test(end)||start===end)
  throw Error('E_SHIFT_TIME');
 const midnight=Date.parse(date+'T00:00:00Z');
 if(!Number.isFinite(midnight)||new Date(midnight).toISOString().slice(0,10)!==date)
  throw Error('E_SHIFT_DATE');
 const startAt=Date.parse(date+'T'+start+':00Z')/1000;
 const endAt=Date.parse(date+'T'+end+':00Z')/1000+(end<start?SECONDS:0);
 return Object.freeze({startAt,endAt,
  prev:date==='0000-01-01'?date:new Date(midnight-SECONDS*1000).toISOString().slice(0,10),
  next:date==='9999-12-31'?date:new Date(midnight+SECONDS*1000).toISOString().slice(0,10)});
}
// Fixed SQL; only positional values are bound. This predicate MUST be
// evaluated again inside a future Native write transaction, not only as
// a preflight. All stores are included; no information about conflicting
// store or shift is returned. Malformed stored times on neighboring dates
// fail closed rather than silently allowing an overlapping new shift.
const validStored=
 "s.shift_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' "+
 "AND date(s.shift_date,'+0 days')=s.shift_date "+
 "AND s.start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(s.start_time,1,2) BETWEEN '00' AND '23' "+
 "AND s.end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND substr(s.end_time,1,2) BETWEEN '00' AND '23' "+
 "AND s.start_time<>s.end_time "+
 "AND unixepoch(s.shift_date||'T'||s.start_time||':00Z') IS NOT NULL "+
 "AND unixepoch(s.shift_date||'T'||s.end_time||':00Z') IS NOT NULL";
export const SHIFT_CONFLICT_SQL=
 "SELECT 1 AS conflict FROM shifts s WHERE s.user_id=? AND s.shift_date BETWEEN ? AND ? AND ("+
 "COALESCE(("+validStored+"),0)=0 OR ("+
 "unixepoch(s.shift_date||'T'||s.start_time||':00Z')<? AND "+
 "unixepoch(s.shift_date||'T'||s.end_time||':00Z')+CASE WHEN s.end_time<s.start_time THEN 86400 ELSE 0 END>?)) LIMIT 1";
export function shiftConflictBindings(userId,date,start,end){
 if(typeof userId!=='string'||!userId)throw Error('E_SHIFT_USER');
 const w=shiftTimeWindow(date,start,end);
 return Object.freeze([userId,w.prev,w.next,w.endAt,w.startAt]);
}
