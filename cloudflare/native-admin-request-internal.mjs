// Dormant native admin v1 decoder. Synthetic only; NO Worker route or D1 access.
export const MAX_ADMIN_BODY_BYTES=2048;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS=Object.freeze({
  'user.password':['action','newPassword','targetUserId'],
  'user.role':['action','role','targetUserId'],
  'user.active':['action','active','targetUserId'],
  'user.assign-location':['action','locationId','targetUserId'],
  'user.unassign-location':['action','locationId','targetUserId']
});
const ROLES=new Set(['owner','manager','staff']);
const bad=()=>({ok:false,code:'E_INVALID_INPUT'});

export function decodeAdminBodyV1(bytes){
  if(!(bytes instanceof Uint8Array)||!bytes.byteLength||
     bytes.byteLength>MAX_ADMIN_BODY_BYTES)return bad();
  let input;
  try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{return bad();}
  if(input===null||typeof input!=='object'||Array.isArray(input)||
     Object.getPrototypeOf(input)!==Object.prototype||
     typeof input.action!=='string'||!Object.hasOwn(FIELDS,input.action))return bad();
  const expected=FIELDS[input.action],got=Object.keys(input).sort();
  if(got.length!==expected.length||got.some((key,i)=>key!==expected[i])||
     typeof input.targetUserId!=='string'||!UUID.test(input.targetUserId))return bad();
  if(input.action==='user.password'){
    if(typeof input.newPassword!=='string'||input.newPassword.length<12||
       input.newPassword.length>256)return bad();
  }else if(input.action==='user.role'){
    if(typeof input.role!=='string'||!ROLES.has(input.role))return bad();
  }else if(input.action==='user.active'){
    if(typeof input.active!=='boolean')return bad();
  }else if(typeof input.locationId!=='string'||!UUID.test(input.locationId))return bad();
  return {ok:true,input};
}

// Bounded parser, not an HTTP handler. Owner/CSRF/RBAC, slow-drip deadlines and
// rate limiting require separate review BEFORE any public endpoint can use it.
export async function readAdminRequestV1(request){
  if(!request||request.method!=='POST'||!request.headers||
     typeof request.headers.get!=='function')return bad();
  let url;
  try{url=new URL(request.url);}catch{return bad();}
  const type=request.headers.get('content-type')?.trim()||'';
  if(url.protocol!=='https:'||request.headers.get('origin')!==url.origin||
     !/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)||
     request.headers.has('content-encoding'))return bad();
  const len=request.headers.get('content-length');
  if(len!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(len)||
     !Number.isSafeInteger(Number(len))||Number(len)>MAX_ADMIN_BODY_BYTES))return bad();
  if(!request.body||typeof request.body.getReader!=='function')return bad();
  const reader=request.body.getReader();
  const bytes=new Uint8Array(MAX_ADMIN_BODY_BYTES);
  let size=0;
  try{
    for(;;){
      const next=await reader.read();
      if(next.done)break;
      if(!(next.value instanceof Uint8Array))return bad();
      if(next.value.byteLength>MAX_ADMIN_BODY_BYTES-size){
        void reader.cancel().catch(()=>{});
        return bad();
      }
      bytes.set(next.value,size);
      size+=next.value.byteLength;
    }
  }catch{return bad();}
  finally{reader.releaseLock();}
  if(len!==null&&Number(len)!==size)return bad();
  return decodeAdminBodyV1(bytes.subarray(0,size));
}
