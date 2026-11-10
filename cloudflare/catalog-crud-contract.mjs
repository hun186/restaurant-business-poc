// One audited, platform-neutral catalog contract. This module is inert: it
// never performs network, storage, authorization, D1 or SQLite operations.
// Backends must independently enforce role, store scope, CSRF, CAS and audit.
export const CATALOG_POLICY_VERSION=1;
export const CATALOG_RESOURCES=Object.freeze({
  ingredients:Object.freeze({
    label:'食材主檔',create:'ingredient.create',update:'ingredient.update',
    setActive:'ingredient.active',fields:Object.freeze(['sku','name','unit','min_stock']),
    editable:Object.freeze(['name','unit','min_stock']),deletion:'deactivate'
  }),
  locations:Object.freeze({
    label:'門市管理',create:'location.create',update:'location.update',
    setActive:'location.active',fields:Object.freeze(['name']),
    editable:Object.freeze(['name']),deletion:'deactivate'
  })
});
export const CATALOG_COMMANDS=Object.freeze(Object.values(CATALOG_RESOURCES)
  .flatMap(x=>[x.create,x.update,x.setActive]));
const hasOwn=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(obj,required)=>{
  if(!object(obj))throw Error('E_CATALOG_SHAPE');
  const keys=Object.keys(obj).sort(),expected=[...required].sort();
  if(JSON.stringify(keys)!==JSON.stringify(expected))throw Error('E_CATALOG_FIELDS');
};
const text=(v,max)=>{
  if(typeof v!=='string')throw Error('E_CATALOG_TEXT');
  const s=v.trim();
  if(!s||s.length>max||/[\u0000-\u001f\u007f]/u.test(s))throw Error('E_CATALOG_TEXT');
  return s;
};
const number=v=>{
  if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1000000)
    throw Error('E_CATALOG_NUMBER');
  return v;
};
const id=v=>{
  if(typeof v!=='string'||!(/^[a-zA-Z0-9_-]{1,128}$/u).test(v))
    throw Error('E_CATALOG_ID');
  return v;
};
const bit=v=>{
  if(v!==0&&v!==1)throw Error('E_CATALOG_ACTIVE');
  return v;
};
const fields=(resource,data,variant)=>{
  const required=variant==='update'?resource.editable:resource.fields;
  exact(data,required);
  const out={};
  for(const k of required){
    if(k==='sku')out[k]=text(data[k],40);
    else if(k==='name')out[k]=text(data[k],resource===CATALOG_RESOURCES.locations?(variant==='snapshot'?120:60):120);
    else if(k==='unit')out[k]=text(data[k],20);
    else if(k==='min_stock')out[k]=number(data[k]);
    else throw Error('E_CATALOG_UNKNOWN_FIELD');
  }
  return out;
};
// Immutable contract for future local SQLite, Vercel mock, and Worker D1
// adapters. A successful parse NEVER grants write permission.
export function normalizeCatalogCommand(action,payload){
  if(typeof action!=='string'||!CATALOG_COMMANDS.includes(action))
    throw Error('E_CATALOG_ACTION');
  const resource=action.startsWith('ingredient.')?
    CATALOG_RESOURCES.ingredients:CATALOG_RESOURCES.locations;
  if(action===resource.create)return fields(resource,payload,'create');
  if(action===resource.update){
    exact(payload,['id','expected','changes']);
    const expected=fields(resource,payload.expected,'snapshot');
    const changes=fields(resource,payload.changes,'update');
    // Updates must not silently change the immutable ingredient SKU.
    return {id:id(payload.id),expected,changes};
  }
  exact(payload,['id','expected_active','active']);
  const before=bit(payload.expected_active),after=bit(payload.active);
  if(before===after)throw Error('E_CATALOG_NO_CHANGE');
  return {id:id(payload.id),expected_active:before,active:after};
}
export function operationFor(resource,kind){
  const item=CATALOG_RESOURCES[resource];
  if(!item||!['create','update','setActive'].includes(kind))
    throw Error('E_CATALOG_ACTION');
  return item[kind];
}
