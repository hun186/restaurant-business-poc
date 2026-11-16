// Owner-only account list presentation: distinguish actual usable store
// grants from stale/disabled stores. No authorization decisions, writes,
// request identifiers or raw data are exposed by this pure UI projection.
export function effectiveStoreGrantLabel(user,locations){
 if(!user||typeof user!=='object'||!Array.isArray(locations)||locations.length>500||
    !Array.isArray(user.location_ids)||user.location_ids.length>1600||
    locations.some(l=>!l||typeof l.id!=='string'||typeof l.name!=='string'||
      (l.active!==0&&l.active!==1&&l.active!==true&&l.active!==false))||
    user.location_ids.some(x=>typeof x!=='string'||!x))
   throw Error('E_STORE_GRANT_DISPLAY_INVALID');
 if(user.role==='owner')return Object.freeze({
  text:'全部啟用門市（業主權限）',warning:false,active_count:null
 });
 if(user.role!=='staff'&&user.role!=='manager')
  throw Error('E_STORE_GRANT_DISPLAY_INVALID');
 const lookup=new Map(locations.map(l=>[l.id,l]));
 const unique=[...new Set(user.location_ids)];
 const active=[],inactive=[];
 let notListed=0;
 for(const id of unique){
  const location=lookup.get(id);
  if(!location){notListed++;continue;}
  if(location.active===1||location.active===true)active.push(location.name);
  else inactive.push(location.name);
 }
 const parts=[];
 if(active.length)parts.push('可用：'+active.join('、'));
 if(inactive.length)parts.push('已停用：'+inactive.join('、'));
 if(notListed)parts.push('未在本次門市清單：'+notListed+' 筆');
 const warning=!active.length||inactive.length>0||notListed>0;
 return Object.freeze({text:parts.join('；')||'未設定門市授權',
  warning,active_count:active.length});
}
