// Dormant native admin v1 decoder. Synthetic only; NO Worker route or D1 access.
export const MAX_ADMIN_BODY_BYTES=2048;
// A chunk budget prevents an endless chain of synchronously resolved empty reads
// from starving timers. The monotonic total timer covers slow-drip producers.
// Both are synthetic guards only; live threat-model approval is still required.
export const MAX_ADMIN_READ_CHUNKS=4096;
export const MAX_ADMIN_READ_MS=2000;
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

// Shared path-only check. HTTPS, origin, method and authorization are separate.
// URL normalization is performed by the platform before Request.url is exposed.
export function validAdminPathV1(input){
  try{
    const url=new URL(input);
    return url.pathname==='/api/admin/account'&&!url.search&&!url.hash&&
      url.username===''&&url.password==='';
  }catch{return false;}
}

// Single shared fail-closed contract for the cheap JSON body envelope.
// This does not authenticate a request or check the actual streamed body size.
export function validAdminBodyHeadersV1(headers){
  if(!headers || typeof headers.get!=='function' ||
     typeof headers.has!=='function')return false;
  try{
    const type=headers.get('content-type')?.trim()||'';
    if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(type)||
       headers.has('content-encoding'))return false;
    const len=headers.get('content-length');
    return len===null || (/^(?:0|[1-9][0-9]*)$/.test(len) &&
      Number.isSafeInteger(Number(len)) && Number(len)<=MAX_ADMIN_BODY_BYTES);
  }catch{return false;}
}

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
  let url,len,reader;
  try{
    url=new URL(request.url);
    // Both dormant parsers use the same exact route and URL-userinfo policy.
    if(!validAdminPathV1(url))return bad();
    if(url.protocol!=='https:'||request.headers.get('origin')!==url.origin||
       !validAdminBodyHeadersV1(request.headers))return bad();
    len=request.headers.get('content-length');
    if(!request.body||typeof request.body.getReader!=='function')return bad();
    reader=request.body.getReader();
    if(!reader||typeof reader.read!=='function'||
       typeof reader.cancel!=='function'||
       typeof reader.releaseLock!=='function')return bad();
  }catch{return bad();}
  // Synchronous exceptions from a nonstandard reader's cancel/release path
  // must not turn a failed parse into an unhandled error.
  const cancel=()=>{
    try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{}
  };
  const bytes=new Uint8Array(MAX_ADMIN_BODY_BYTES);
  let size=0,reads=0,timer;
  const deadline=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new Error('E_READ_DEADLINE')),MAX_ADMIN_READ_MS);
  });
  try{
    for(;;){
      const next=await Promise.race([reader.read(),deadline]);
      if(next.done)break;
      if(++reads>MAX_ADMIN_READ_CHUNKS){
        cancel();
        return bad();
      }
      if(!(next.value instanceof Uint8Array)){cancel();return bad();}
      if(next.value.byteLength>MAX_ADMIN_BODY_BYTES-size){
        cancel();
        return bad();
      }
      bytes.set(next.value,size);
      size+=next.value.byteLength;
    }
  }catch{
    cancel();
    return bad();
  }finally{
    clearTimeout(timer);
    try{reader.releaseLock();}catch{}
  }
  if(len!==null&&Number(len)!==size)return bad();
  return decodeAdminBodyV1(bytes.subarray(0,size));
}
