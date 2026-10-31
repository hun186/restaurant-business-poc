// One-time schema-only gate for a *pristine*, known-empty Production D1.
// Unlike the legacy apply route, this does not claim a restore drill occurred.
// It MUST run in the protected production-migration job before any write token.
// This module never contacts Cloudflare, creates a schema or receives secrets.
import {fileURLToPath} from 'node:url';

const RELEASE='PRISTINE_EMPTY_PRODUCTION_SCHEMA_ONLY';
const ACK='I_APPROVE_EMPTY_PRODUCTION_FIRST_INIT_WITHOUT_RESTORE_DRILL';
const CONFIRM='INITIALIZE_PRISTINE_PROD_D1_V3_0001_0002';
const RUN='41207484827';
const SHA=/^[a-f0-9]{40}$/;

export function verifyPristineFirstInitApproval(v) {
  if(!v || typeof v!=='object' || Array.isArray(v))throw Error('E_G5_FIRST_INIT_GATE');
  const fields=['mode','github_ref','github_sha','expected_sha','confirm',
    'first_init_ack','recovery_ack','pristine_run','release_sha','approval','approved_pristine_run'];
  if(!fields.every(k=>typeof v[k]==='string'))throw Error('E_G5_FIRST_INIT_GATE');
  if(v.mode!=='first-init' || v.github_ref!=='refs/heads/main' ||
    !SHA.test(v.github_sha) || v.expected_sha!==v.github_sha ||
    v.release_sha!==v.github_sha || v.confirm!==CONFIRM ||
    v.first_init_ack!==ACK || v.recovery_ack!=='' ||
    v.approval!==RELEASE || v.pristine_run!==RUN ||
    v.approved_pristine_run!==RUN)
    throw Error('E_G5_FIRST_INIT_GATE');
  return Object.freeze({status:'G5_PRISTINE_FIRST_INIT_RELEASE_GATE_PASS',
    production_write_performed:false,restore_drill_verified:false,production_ready:false});
}

if(process.argv[1] && import.meta.url===new URL('file://'+fileURLToPath(import.meta.url)).href) {
  // Direct entrypoint without external libs, no raw input values in logs.
  const e=process.env;
  try {
    const result=verifyPristineFirstInitApproval({
      mode:e.G5_MODE,github_ref:e.GITHUB_REF,github_sha:e.GITHUB_SHA,
      expected_sha:e.G5_EXPECTED_SHA,confirm:e.G5_CONFIRM,
      first_init_ack:e.G5_FIRST_INIT_ACK,recovery_ack:e.G5_RECOVERY_ACK,
      pristine_run:e.G5_PRISTINE_RUN,release_sha:e.G5_FIRST_INIT_RELEASE_SHA,
      approval:e.G5_FIRST_INIT_APPROVED,approved_pristine_run:e.G5_FIRST_INIT_PREFLIGHT_RUN
    });
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('G5_PRISTINE_FIRST_INIT_GATE_CLOSED\n');process.exitCode=1;}
}
