// Dormant external atomic quota transport adapter. Never imported by public Worker.
// NO backend, binding, storage, source-IP inference or production authorization here.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fault=()=>new Error('E_QUOTA_CONTRACT_UNAVAILABLE');

// Read only plain own data descriptors. Do not invoke caller-defined getters,
// or let a malicious Proxy exception reach an external quota backend.
function canonicalDecision(value){
  try{
    if(value===null||typeof value!=='object'||
       Object.getPrototypeOf(value)!==Object.prototype)return null;
    const keys=Reflect.ownKeys(value).sort();
    if(keys.some(k=>typeof k!=='string'))return null;
    const scope=Object.getOwnPropertyDescriptor(value,'scope');
    if(!scope||!Object.hasOwn(scope,'value')||typeof scope.value!=='string')
      return null;
    if(scope.value==='native-admin-preauth')
      return keys.length===1&&keys[0]==='scope'?
        {scope:'native-admin-preauth'}:null;
    if(scope.value!=='native-admin-owner'||keys.length!==2||
       keys[0]!=='actorId'||keys[1]!=='scope')return null;
    const actor=Object.getOwnPropertyDescriptor(value,'actorId');
    if(!actor||!Object.hasOwn(actor,'value')||
       typeof actor.value!=='string'||!UUID.test(actor.value))return null;
    return {scope:'native-admin-owner',actorId:actor.value};
  }catch{return null;}
}

// A real provider must supply durable, atomic cross-isolate consumeAtomic.
// No in-memory counter, trusted preauth subject, backend or binding is provided.
export function createExternalNativeAdminQuotaV1(transport){
  let consumeAtomic;
  try{consumeAtomic=transport?.consumeAtomic;}catch{return null;}
  if(typeof consumeAtomic!=='function')return null;
  return Object.freeze({
    async consume(decision,{signal}={}){
      const payload=canonicalDecision(decision);
      try{
        if(!payload||typeof AbortSignal!=='function'||
           !(signal instanceof AbortSignal)||signal.aborted)throw fault();
        // Allowlisted scope/actorId and real AbortSignal only.
        const outcome=await consumeAtomic.call(transport,payload,{signal});
        if(signal.aborted||typeof outcome!=='boolean')throw fault();
        return outcome;
      }catch{
        // Even trusted backend implementations may throw secret-bearing errors.
        throw fault();
      }
    }
  });
}
