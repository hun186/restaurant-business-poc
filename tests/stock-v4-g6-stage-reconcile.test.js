'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const imported=import('../src/stock-v4-g6-stage-reconcile.mjs');
const flags={pinned_g6_identity_verified:true,negative_sql_guard:true,
 cloudflare_write_performed:false,cloudflare_migration_performed:false,
 restore_performed:false,exclusive_use_verified:false,indirect_access_verified:false,
 operator_attestation_verified:false,next_stage_execution_authorized:false,
 retry_authorized:false,production_gate_modified:false};
const cert=stage=>({status:'G6_STAGE_READONLY_CLASSIFIED',stage,
 migration_receipts_verified:[0,2,2,3,3][stage],synthetic_ledger_rows_verified:[0,0,2,2,5][stage],...flags});
const guard=r=>{
 assert.equal(r.manual_review_required,true);
 for(const k of ['observation_provenance_verified','durable_commit_verified','rollback_verified',
  'exclusive_use_verified','next_stage_execution_authorized','retry_authorized',
  'remote_write_authorized','production_gate_modified'])assert.equal(r[k],false,k);
 assert.ok(Object.isFrozen(r));
};
test('all four phases, three command outcomes and all five observed stages fail closed',async()=>{
 const {reconcileG6StageObservation:run}=await imported;
 for(let phase=1;phase<=4;phase++)for(const command_outcome of ['acknowledged_success','reported_failure','unknown'])
  for(let after=0;after<=4;after++){
   const r=run({phase,command_outcome,before:cert(phase-1),after:cert(after)});
   guard(r);
   const expected=after===phase?(command_outcome==='acknowledged_success'?
    'G6_EXPECTED_STAGE_OBSERVED_REVIEW_REQUIRED':'G6_EXPECTED_STAGE_OBSERVED_AFTER_AMBIGUOUS_OUTCOME_NO_RETRY'):
    after===phase-1?(command_outcome==='acknowledged_success'?'G6_STOP_SUCCESS_RESPONSE_STATE_UNCHANGED':
     'G6_STOP_PREVIOUS_STAGE_OBSERVED_NO_RETRY'):'G6_STOP_UNEXPECTED_STAGE_NO_RETRY';
   assert.equal(r.status,expected);
  }
});
test('wrong baseline, unavailable after-state, forged or extra flags and receipt counts never permit progress',async()=>{
 const {reconcileG6StageObservation:run}=await imported;
 const input={phase:3,command_outcome:'unknown',before:cert(2),after:cert(3)};
 for(const after of [null,{},cert(5),{...cert(3),migration_receipts_verified:2},
  {...cert(3),synthetic_ledger_rows_verified:5},{...cert(3),retry_authorized:true},
  {...cert(3),exclusive_use_verified:true},{...cert(3),token:'synthetic-never-log'}]){
  const r=run({...input,after});guard(r);assert.equal(r.status,'G6_STOP_UNCLASSIFIED_AFTER');
  assert.doesNotMatch(JSON.stringify(r),/synthetic-never-log/);
 }
 for(const before of [null,cert(0),cert(3),{...cert(2),pinned_g6_identity_verified:false}]){
  const r=run({...input,before});guard(r);assert.equal(r.status,'G6_STOP_INVALID_BASELINE');
 }
 for(const x of [null,[],{...input,phase:0},{...input,phase:5},{...input,phase:'3'},{...input,command_outcome:'success'},{...input,extra:true}]){
  const r=run(x);guard(r);assert.equal(r.status,'G6_STOP_INVALID_INPUT');
 }
});
test('accessors are not invoked and output does not imply proof even when observed expected stage',async()=>{
 const {reconcileG6StageObservation:run}=await imported;
 let touched=0;const after=cert(3);
 Object.defineProperty(after,'stage',{enumerable:true,get(){touched++;return 3;}});
 const input={phase:3,command_outcome:'unknown',before:cert(2),after};
 const r=run(input);guard(r);assert.equal(r.status,'G6_STOP_UNCLASSIFIED_AFTER');assert.equal(touched,0);
 const clean=run({...input,after:cert(3)});guard(clean);
 assert.equal(clean.status,'G6_EXPECTED_STAGE_OBSERVED_AFTER_AMBIGUOUS_OUTCOME_NO_RETRY');
});
