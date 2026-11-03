// Candidate Durable Object atomic quota core. Dormant: no Worker import/binding.
export const QUOTA_WINDOW_MS=60000;
// Synthetic placeholders; NOT authorized production limits.
export const QUOTA_DEMO_LIMITS=Object.freeze({'native-admin-preauth':3,'native-admin-owner':2});
const KEY='native-admin-quota-v1';
const fault=()=>new Error('E_QUOTA_BACKEND_UNAVAILABLE');

export async function consumeAtomicWindowV1(storage,scope,nowMs){
  const limit=Object.hasOwn(QUOTA_DEMO_LIMITS,scope)?QUOTA_DEMO_LIMITS[scope]:null;
  if(!limit||!Number.isSafeInteger(nowMs)||nowMs<0||
     !storage||typeof storage.transaction!=='function')throw fault();
  const window=Math.floor(nowMs/QUOTA_WINDOW_MS);
  try{
    const allowed=await storage.transaction(async tx=>{
      if(!tx||typeof tx.get!=='function'||typeof tx.put!=='function')throw fault();
      const old=await tx.get(KEY);
      if(old!==undefined){
        if(!old||typeof old!=='object'||Object.getPrototypeOf(old)!==Object.prototype||
           Object.keys(old).sort().join(',')!=='scope,used,window'||
           old.scope!==scope||!Number.isSafeInteger(old.window)||old.window<0||
           !Number.isSafeInteger(old.used)||old.used<1||old.used>limit||
           old.window>window)throw fault();
      }
      const used=old?.window===window?old.used:0;
      if(used>=limit)return false;
      await tx.put(KEY,{scope,window,used:used+1});
      return true;
    });
    if(typeof allowed!=='boolean')throw fault();
    return allowed;
  }catch{throw fault();}
}
