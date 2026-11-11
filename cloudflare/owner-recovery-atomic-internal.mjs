// Offline-importable D1 Worker Binding transaction primitive.
// Never imported by the public Worker; no endpoint and no Cloudflare REST fallback.
// Cloudflare documents db.batch() as one transaction, rolling back on a statement error.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const HASH=/^pbkdf2-sha256\$100000\$[0-9a-f]{64}$/;
const SALT=/^[0-9a-f]{32}$/;
const fail=()=>{throw Error('E_OWNER_RECOVERY_ATOMIC');};
const rowCount=result=>result?.meta?.changes??result?.changes;

export async function atomicOwnerRecovery(db,original,replacement,auditId){
 if(!db||typeof db.batch!=='function'||typeof db.prepare!=='function'||
    !original||!replacement||!UUID.test(original.owner_id||'')||
    !UUID.test(auditId||'')||!SALT.test(original.password_salt||'')||
    !SALT.test(replacement.password_salt||'')||
    !HASH.test(original.password_hash||'')||
    !HASH.test(replacement.password_hash||'')||
    original.password_hash===replacement.password_hash||
    original.password_salt===replacement.password_salt)fail();
 const batch=[
  db.prepare(`UPDATE users SET password_salt=?,password_hash=?
   WHERE id=? AND username='owner' COLLATE NOCASE AND role='owner' AND active=1
   AND password_salt=? AND password_hash=?
   AND (SELECT COUNT(*) FROM users WHERE role='owner')=1
   AND (SELECT COUNT(*) FROM audit_logs WHERE actor_name='production-bootstrap'
    AND action='auth.owner_bootstrap' AND entity='users' AND entity_id=?)=1
   AND (SELECT contract_version FROM cloud_schema_contract WHERE id=1)=3`).bind(
    replacement.password_salt,replacement.password_hash,original.owner_id,
    original.password_salt,original.password_hash,original.owner_id),
  db.prepare(`DELETE FROM sessions WHERE user_id=? AND EXISTS(
   SELECT 1 FROM users WHERE id=? AND password_salt=? AND password_hash=?)`).bind(
    original.owner_id,original.owner_id,replacement.password_salt,replacement.password_hash),
  db.prepare(`INSERT INTO audit_logs(id,actor_name,action,entity,entity_id,detail)
   SELECT ?,'production-password-recovery','auth.password_reset','users',id,'{}'
   FROM users WHERE id=? AND password_salt=? AND password_hash=?`).bind(
    auditId,original.owner_id,replacement.password_salt,replacement.password_hash)
 ];
 const result=await db.batch(batch);
 if(!Array.isArray(result)||result.length!==3||
    rowCount(result[0])!==1||rowCount(result[2])!==1||
    !Number.isSafeInteger(rowCount(result[1]))||rowCount(result[1])<0)fail();
 return Object.freeze({atomic_binding_batch:true,write_attempts:1});
}
