// Isolated, synthetic-only PBKDF2 probe for local workerd. NOT a public route.
// Always call the SAME auth-core functions used by the disabled D1 login service.
import { PBKDF2_ITERATIONS, hashWorkerPassword, verifyWorkerPassword } from './auth-core.mjs';

const SYNTHETIC_PASSWORD = 'synthetic-benchmark-only-no-user';
const SYNTHETIC_WRONG = 'synthetic-benchmark-only-wrong';
const SYNTHETIC_SALT = Uint8Array.from([
  0x01,0x23,0x45,0x67,0x89,0xab,0xcd,0xef,
  0x10,0x32,0x54,0x76,0x98,0xba,0xdc,0xfe,
]);
const elapsed = (since, clock) => Math.max(0, clock() - since);
const finiteMs = n => Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN;

// Results are elapsed *wall clock* timings, NOT Cloudflare invocation CPU time.
// No real password, salt, hash, token, IP or D1 binding is ever inspected.
export async function runSyntheticPbkdf2Probe(clock = () => performance.now()) {
  const a = clock();
  const stored = await hashWorkerPassword(SYNTHETIC_PASSWORD, SYNTHETIC_SALT);
  const hash_ms = finiteMs(elapsed(a,clock));

  const b = clock();
  const correct = await verifyWorkerPassword(SYNTHETIC_PASSWORD,stored.password_salt,stored.password_hash);
  const verify_correct_ms = finiteMs(elapsed(b,clock));

  const c = clock();
  const incorrect = await verifyWorkerPassword(SYNTHETIC_WRONG,stored.password_salt,stored.password_hash);
  const verify_wrong_ms = finiteMs(elapsed(c,clock));

  if (!correct || incorrect || ![hash_ms,verify_correct_ms,verify_wrong_ms].every(Number.isFinite))
    throw new Error('E_SYNTHETIC_KDF_PROBE');
  return {
    kind:'synthetic_local_workerd_wall_ms_not_cpu',
    iterations:PBKDF2_ITERATIONS,
    hash_ms, verify_correct_ms, verify_wrong_ms,
    correct_match:true, wrong_match:false,
  };
}
