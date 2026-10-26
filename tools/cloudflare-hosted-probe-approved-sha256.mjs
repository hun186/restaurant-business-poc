// SHA-256 fingerprints for reviewed *exact bytes* (no normalization).
// Workflow and delegated-executable inventory is fail-closed. Any authorized
// change MUST explicitly update this allowlist via a separately reviewed PR.
// The preflight CLI itself and this manifest are the trusted checking code.
export const APPROVED_PROBE_SHA256=Object.freeze({
  "cloudflare/pbkdf2-hosted-access-worker.mjs":"3ae15481df2e52c71f8f66f54da92e5a3a091a7b9c6578d36320cb2ab781df7e",
  "cloudflare/pbkdf2-hosted-synthetic.mjs":"dd91d3380d23d5ee9aa278ac466f2915a4394a8cb215f5e7adc788b8ebe8c166"
});
export const APPROVED_WORKFLOW_SHA256=Object.freeze({
  ".github/workflows/verify.yml":"cefd064124b0b7fc103946878d16d6cf57692979f274661ce5444c30fd14b410",
  ".github/workflows/d1-staging-migration.yml":"ff2c7a042eddfbac132e10ddb2adb0c6a1f28060abcc415e7cae19597b52ba6f",
  ".github/workflows/d1-staging-owner-bootstrap.yml":"52fd9259d2f0db8b0a467aac1c9c332890b620b9d0e439ba2617672645a68c2b",
  ".github/workflows/d1-staging-incremental-0002.yml":"b146f8335141988f5922dc070c470df51e84265f90e62f30199d02b71a2f4bfb",
  ".github/workflows/pbkdf2-local-workerd.yml":"dd5287bf5fab4c0055bc908ef6e73078f309edad2e9052f4af7c79a315aaef22"
});
export const APPROVED_LOCAL_EXEC_SHA256=Object.freeze({
  "package.json":"f7bda1324405bc207b0f5cea11c3e8d469b3503481343de9b09ceb40e859de79",
  "tools/backup.js":"cc97f66092ceaeaa369e36d389c0633b64f3d85c72e57f939900b57561cb4cfc",
  "tools/check-cloudflare-staging.mjs":"21f12decd191e54ba35878a63440cee290dc1d8ffe3940d5df60f0b61958326f",
  "tools/cloudflare-staging-0002.mjs":"1051dd5aae3eb7c6fb6b6ad6590bcc5ddf3136461fbee5b1ef541c6ab831a4bb",
  "tools/cloudflare-staging-owner.mjs":"75300aa2da627d3da2c29c7706a0060f32c1f3674830248ea040ac83e8da2a7c",
  "tools/pbkdf2-workerd-sandbox.mjs":"33f2846108c0c4d246c8864ed5918c7e040f727a05a3e3824bcc888fb31d4b01",
  "tools/reset-owner-password.js":"86cb87cd9cbfaf0dfcbbae89c0f19d6e92b50c260b30d72a10c925f6e2c3c80d",
  "tools/run-pbkdf2-local-workerd.mjs":"042a46377d9aa3d5c0e0f61ba71fadf620b78f0b0df1205f4e349f1bf65bd182"
});
