// Cloudflare Hosted probe: ONE synthetic PBKDF2 operation per invocation.
// Isolated from D1, production auth and real users. The fixed password/hash
// below are public test vectors, never actual credentials.
import { PBKDF2_ITERATIONS, hashWorkerPassword, verifyWorkerPassword } from './auth-core.mjs';
const PASSWORD='synthetic-benchmark-only-no-user';
const WRONG='synthetic-benchmark-only-wrong';
const SALT_HEX='0123456789abcdef1032547698badcfe';
const SALT=Uint8Array.from(SALT_HEX.match(/../g), h=>Number.parseInt(h,16));
const HASH='pbkdf2-sha256$100000$6fc785d4473d0393ccb8894ef9f2c0832eb3929d1f6f1340479beb05c3780277';
export const HOSTED_OPERATIONS=Object.freeze(['hash','verify-correct','verify-wrong']);
export async function runHostedSyntheticOperation(operation){
  if(!HOSTED_OPERATIONS.includes(operation))throw new Error('E_SYNTHETIC_OPERATION');
  let valid;
  if(operation==='hash'){
    const result=await hashWorkerPassword(PASSWORD,SALT);
    valid=result.password_salt===SALT_HEX && result.password_hash===HASH;
  }else{
    const actual=await verifyWorkerPassword(
      operation==='verify-correct'?PASSWORD:WRONG,SALT_HEX,HASH
    );
    valid=actual===(operation==='verify-correct');
  }
  // Cloudflare Hosted Workers can freeze performance.now() between I/O.
  // Do not publish derived wall/CPU timings from JavaScript. The *only*
  // authoritative wallTimeMs/cpuTimeMs values come from invocation logs.
  if(!valid)throw new Error('E_SYNTHETIC_RESULT');
  return {operation,iterations:PBKDF2_ITERATIONS,valid:true};
}
