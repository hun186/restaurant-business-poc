// Dormant WebCrypto HMAC partition primitive. Do not import from public Worker.
// Input must be a principal ID ALREADY authenticated by an independent gateway;
// this module does not establish provenance and MUST NOT read HTTP headers.
const VERIFIED=/^[a-z][a-z0-9._-]{1,31}:[a-z0-9][a-z0-9._:-]{7,127}$/;
const PREFIX='restaurant:native-admin:preauth:v1\0';
const error=()=>new Error('E_QUOTA_SUBJECT_UNAVAILABLE');
export async function deriveVerifiedPreauthPartitionV1(verifiedGatewaySubject,hmacKey){
  try{
    if(typeof verifiedGatewaySubject!=='string'||
       verifiedGatewaySubject.length>192||!VERIFIED.test(verifiedGatewaySubject))throw error();
    const algorithm=hmacKey?.algorithm,usages=hmacKey?.usages;
    if(hmacKey?.type!=='secret'||hmacKey?.extractable!==false||
       algorithm?.name!=='HMAC'||algorithm.hash?.name!=='SHA-256'||
       !Number.isSafeInteger(algorithm.length)||algorithm.length<256||
       !Array.isArray(usages)||!usages.includes('sign'))throw error();
    const mac=await crypto.subtle.sign('HMAC',hmacKey,
      new TextEncoder().encode(PREFIX+verifiedGatewaySubject));
    const result=Array.from(new Uint8Array(mac),v=>v.toString(16).padStart(2,'0')).join('');
    if(!/^[0-9a-f]{64}$/.test(result))throw error();
    return result;
  }catch{throw error();}
}
