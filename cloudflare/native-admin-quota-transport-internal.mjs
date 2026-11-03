// Dormant external atomic quota transport adapter. Never imported by public Worker.
// NO backend, binding, storage, source-IP inference or production authorization here.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fault=()=>new Error('E_QUOTA_CONTRACT_UNAVAILABLE');

function validDecision(value){
  if(value===null||typeof value!=='object'||
     Object.getPrototypeOf(value)!==Object.prototype)return false;
  const keys=Object.keys(value).sort();
  if(value.scope==='native-admin-preauth')
    return keys.length===1&&keys[0]==='scope';
  return value.scope==='native-admin-owner'&&
    keys.length===2&&keys[0]==='actorId'&&keys[1]==='scope'&&
    typeof value.actorId==='string'&&UUID.test(value.actorId);
}

// A real provider must provide durable, atomic, cross-isolate consumeAtomic.
// This contract does NOT make an in-memory or remote mock atomic. Production
// configuration must be separately reviewed, including a trusted preauth key.
export function createExternalNativeAdminQuotaV1(transport){
  if(!transport||typeof transport.consumeAtomic!=='function')return null;
  return Object.freeze({
    async consume(decision,{signal}={}){
      if(!validDecision(decision)||!signal||
         typeof signal.aborted!=='boolean'||
         typeof signal.addEventListener!=='function'||signal.aborted)
        throw fault();
      // Copy only the allowlisted fields. Never pass Cookie, IP headers,
      // Request, Session, CSRF or any caller-controlled extra properties.
      const payload=decision.scope==='native-admin-preauth'?
        {scope:'native-admin-preauth'}:
        {scope:'native-admin-owner',actorId:decision.actorId};
      const outcome=await transport.consumeAtomic(payload,{signal});
      if(signal.aborted||typeof outcome!=='boolean')throw fault();
      return outcome;
    }
  });
}
