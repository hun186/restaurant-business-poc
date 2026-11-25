// Offline interpretation of supplied G6 read-only observations, not an executor.
// Does NOT authenticate source, freshness, target exclusivity or durable commit.
// Every result requires human review. Never authorizes any write or retry.
const outcomes=Object.freeze(['acknowledged_success','reported_failure','unknown']);
const counts=Object.freeze([[0,0],[2,0],[2,2],[3,2],[3,5]].map(Object.freeze));
const flags=Object.freeze({
 pinned_g6_identity_verified:true,negative_sql_guard:true,
 cloudflare_write_performed:false,cloudflare_migration_performed:false,
 restore_performed:false,exclusive_use_verified:false,indirect_access_verified:false,
 operator_attestation_verified:false,next_stage_execution_authorized:false,
 retry_authorized:false,production_gate_modified:false
});
function record(x,keys){
 if(!x||typeof x!=='object'||Array.isArray(x)||
  ![Object.prototype,null].includes(Object.getPrototypeOf(x)))return null;
 const names=Reflect.ownKeys(x);
 if(names.length!==keys.length||keys.some(k=>!names.includes(k)))return null;
 const out=Object.create(null);
 for(const k of keys){
  const d=Object.getOwnPropertyDescriptor(x,k);
  if(!d||!Object.hasOwn(d,'value')||!d.enumerable)return null;
  out[k]=d.value;
 }
 return out;
}
function stage(x){
 const r=record(x,['status','stage','migration_receipts_verified','synthetic_ledger_rows_verified',...Object.keys(flags)]);
 if(!r||r.status!=='G6_STAGE_READONLY_CLASSIFIED'||!Number.isInteger(r.stage)||r.stage<0||r.stage>4||
  r.migration_receipts_verified!==counts[r.stage][0]||
  r.synthetic_ledger_rows_verified!==counts[r.stage][1]||
  Object.entries(flags).some(([k,v])=>r[k]!==v))return null;
 return r.stage;
}
const result=status=>Object.freeze({status,manual_review_required:true,
 observation_provenance_verified:false,durable_commit_verified:false,
 rollback_verified:false,exclusive_use_verified:false,
 next_stage_execution_authorized:false,retry_authorized:false,
 remote_write_authorized:false,production_gate_modified:false});
export function reconcileG6StageObservation(input){
 try{
  const r=record(input,['phase','command_outcome','before','after']);
  if(!r||!Number.isInteger(r.phase)||r.phase<1||r.phase>4||!outcomes.includes(r.command_outcome))
   return result('G6_STOP_INVALID_INPUT');
  const before=stage(r.before),after=stage(r.after);
  if(before!==r.phase-1)return result('G6_STOP_INVALID_BASELINE');
  if(after===null)return result('G6_STOP_UNCLASSIFIED_AFTER');
  if(after===r.phase){
   return result(r.command_outcome==='acknowledged_success'?
    'G6_EXPECTED_STAGE_OBSERVED_REVIEW_REQUIRED':'G6_EXPECTED_STAGE_OBSERVED_AFTER_AMBIGUOUS_OUTCOME_NO_RETRY');
  }
  if(after===before){
   return result(r.command_outcome==='acknowledged_success'?
    'G6_STOP_SUCCESS_RESPONSE_STATE_UNCHANGED':'G6_STOP_PREVIOUS_STAGE_OBSERVED_NO_RETRY');
  }
  return result('G6_STOP_UNEXPECTED_STAGE_NO_RETRY');
 }catch{return result('G6_STOP_INVALID_INPUT');}
}
