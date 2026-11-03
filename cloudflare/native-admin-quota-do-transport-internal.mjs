// Internal Durable Object namespace adapter. Not wired to any public Worker.
// A trusted per-request HMAC-derived preauth key MUST be provided externally.
const SHA256HEX=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fault=()=>new Error('E_QUOTA_BACKEND_UNAVAILABLE');
export function createDormantDoQuotaTransportV1(namespace,options){
  let trustedPreauthKey;
  try{trustedPreauthKey=options?.trustedPreauthKey;
    if(!namespace||typeof namespace.getByName!=='function'||
       typeof trustedPreauthKey!=='string'||!SHA256HEX.test(trustedPreauthKey))return null;
  }catch{return null;}
  return Object.freeze({
    async consumeAtomic(payload,{signal}={}){
      try{
        if(typeof AbortSignal!=='function'||!(signal instanceof AbortSignal)||
           signal.aborted||!payload||typeof payload!=='object'||
           Object.getPrototypeOf(payload)!==Object.prototype)throw fault();
        const keys=Reflect.ownKeys(payload).sort();
        const scope=Object.getOwnPropertyDescriptor(payload,'scope');
        if(!scope||!Object.hasOwn(scope,'value')||typeof scope.value!=='string')throw fault();
        let name;
        if(scope.value==='native-admin-preauth'){
          if(keys.length!==1||keys[0]!=='scope')throw fault();
          name='native-admin-quota-v1:preauth:'+trustedPreauthKey;
        }else if(scope.value==='native-admin-owner'){
          const actor=Object.getOwnPropertyDescriptor(payload,'actorId');
          if(keys.length!==2||keys[0]!=='actorId'||keys[1]!=='scope'||
             !actor||!Object.hasOwn(actor,'value')||typeof actor.value!=='string'||
             !UUID.test(actor.value))throw fault();
          name='native-admin-quota-v1:owner:'+actor.value;
        }else throw fault();
        const stub=namespace.getByName(name);
        if(!stub||typeof stub.consumeQuotaV1!=='function')throw fault();
        // RPC cannot transmit AbortSignal; a timed-out RPC may still consume
        // quota. Failure must always deny the caller; never auto-retry.
        const result=await stub.consumeQuotaV1(scope.value);
        if(signal.aborted||typeof result!=='boolean')throw fault();
        return result;
      }catch{throw fault();}
    }
  });
}
