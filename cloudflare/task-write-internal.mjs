// Internal D1 transaction pilot for RB-024 / P0 #34.
// Deliberately NOT imported by the public Worker. No production/staging URL
// exposes it. A separate reviewed and Access-gated rollout is required.
import { loadPrincipal, authorizedMutation } from './auth-core.mjs';

const reply = (status, data) => new Response(JSON.stringify(data), {
  status, headers: {'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'}
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(['todo','doing','done']);

function changeCount(result) {
  const n = result?.meta?.changes ?? result?.changes;
  if (!Number.isSafeInteger(n) || n < 0) throw Error('E_D1_RESULT');
  return n;
}

async function parseCommand(request) {
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') || ''))
    return null;
  const len = Number(request.headers.get('content-length') || 0);
  if (!Number.isSafeInteger(len) || len < 0 || len > 4096) return null;
  const raw = await request.text();
  if (raw.length > 4096) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        value.action !== 'task.status' || !value.data ||
        typeof value.data !== 'object' || Array.isArray(value.data) ||
        Object.keys(value).some(k => k !== 'action' && k !== 'data') ||
        Object.keys(value.data).some(k => k !== 'id' && k !== 'status') ||
        !UUID.test(value.data.id) || !STATES.has(value.data.status)) return null;
    return value.data;
  } catch { return null; }
}

// Guard is repeated in BOTH statements in one D1 batch/transaction. Revoked
// sessions, changed roles, inactive stores and stale store grants fail closed,
// including if they changed after the initial principal/task read.
function writePredicate(principal, now) {
  let sql = 'id=? AND status=? AND EXISTS (' +
    'SELECT 1 FROM locations l WHERE l.id=tasks.location_id AND l.active=1) ' +
    'AND EXISTS (SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id ' +
    'WHERE u.id=? AND u.active=1 AND u.role=? AND s.token_hash=? AND s.expires_at>?)';
  const tail = [principal.id,principal.role,principal.token_hash,now];
  if (principal.role !== 'owner') {
    sql += ' AND location_id IN (SELECT ul.location_id FROM user_locations ul ' +
      'JOIN locations l ON l.id=ul.location_id ' +
      'WHERE ul.user_id=? AND l.active=1)';
    tail.push(principal.id);
  }
  if (principal.role === 'staff') {
    sql += ' AND assigned_to=?';
    tail.push(principal.id);
  }
  return {sql, tail};
}

export async function internalTaskStatusMutation(request, env) {
  // No default configuration or user-supplied header may enable this code.
  if (env?.CLOUD_AUTH_PHASE !== 'preview-readonly' ||
      env?.TASK_WRITE_STAGE !== 'internal-test-only' ||
      typeof env.DB?.prepare !== 'function' || typeof env.DB?.batch !== 'function')
    return reply(503,{code:'E_NOT_READY'});
  if (request.method !== 'POST') return reply(405,{code:'METHOD_NOT_ALLOWED'});
  try {
    const principal = await loadPrincipal(env.DB,request);
    if (!principal) return reply(401,{code:'E_UNAUTHENTICATED'});
    if (!authorizedMutation(request,principal,'staff')) return reply(403,{code:'E_FORBIDDEN'});
    const input = await parseCommand(request);
    if (!input) return reply(400,{code:'E_INVALID_COMMAND'});
    const schema = await env.DB.prepare(
      'SELECT contract_version FROM cloud_schema_contract WHERE id=1').first();
    if (Number(schema?.contract_version) !== 3) return reply(503,{code:'E_SCHEMA_NOT_READY'});

    const task = await env.DB.prepare(
      'SELECT t.id,t.location_id,t.assigned_to,t.status,l.active ' +
      'FROM tasks t JOIN locations l ON l.id=t.location_id WHERE t.id=? LIMIT 1'
    ).bind(input.id).first();
    if (!task || task.active !== 1 ||
        (principal.role !== 'owner' && !principal.locations.includes(task.location_id)) ||
        (principal.role === 'staff' && task.assigned_to !== principal.id))
      return reply(404,{code:'E_TASK_NOT_FOUND'});
    if (task.status === input.status) return reply(409,{code:'E_NO_STATE_CHANGE'});

    const now=new Date().toISOString(), predicate=writePredicate(principal,now);
    const whereArgs=[input.id,task.status,...predicate.tail];
    const eventId=crypto.randomUUID();
    const audit=env.DB.prepare(
      'INSERT INTO audit_logs(id,actor_id,actor_name,action,entity,entity_id,location_id,detail) ' +
      'SELECT ?,?,?,?, ?,?,?,? FROM tasks WHERE '+predicate.sql
    ).bind(eventId,principal.id,principal.username,'task.status','tasks',
      input.id,task.location_id,JSON.stringify({from:task.status,to:input.status}),...whereArgs);
    const update=env.DB.prepare(
      'UPDATE tasks SET status=? WHERE '+predicate.sql
    ).bind(input.status,...whereArgs);
    // D1.batch is transactional; SQL errors roll back both audit and business
    // operation. The identical guards are evaluated without interleaving writes.
    const outcomes=await env.DB.batch([audit,update]);
    if (!Array.isArray(outcomes) || outcomes.length!==2 ||
        outcomes.some(x=>changeCount(x)!==1))
      return reply(409,{code:'E_CONCURRENT_CHANGE'});
    return reply(200,{ok:true,result:{id:input.id,status:input.status}});
  } catch {
    return reply(503,{code:'E_OPERATIONS_UNAVAILABLE'});
  }
}
