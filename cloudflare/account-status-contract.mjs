// Shared pure policy. Authentication, auditing and session revocation stay on each backend.
export const MANAGED_ACCOUNT_ROLES=Object.freeze(['staff','manager']);
export function canOwnerManageAccountStatus(actorRole,actorId,targetRole,targetId){
 return actorRole==='owner'&&typeof actorId==='string'&&actorId.length>0&&
   typeof targetId==='string'&&targetId.length>0&&actorId!==targetId&&
   MANAGED_ACCOUNT_ROLES.includes(targetRole);
}
export function isAccountStatusTransition(currentActive,nextActive){
 if(typeof nextActive!=='boolean')return false;
 if(currentActive!==0&&currentActive!==1&&currentActive!==false&&currentActive!==true)return false;
 return Boolean(currentActive)!==nextActive;
}
