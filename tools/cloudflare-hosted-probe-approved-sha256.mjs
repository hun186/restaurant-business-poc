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

// Full reviewed execution surface, including transitive Node imports/requires,
// tests/*.test.js, browser modules/assets, SQL and all Wrangler configurations.
// This is an intentionally conservative superset of the executable dependency
// graph; the preflight enforces closed inventories for every listed directory.
// Never auto-regenerate hashes in CI. Update after human review only.
export const APPROVED_TRANSITIVE_DEPENDENCIES_SHA256=Object.freeze({
  "public/app.js":"5d205b563a971c5331ff28fa0794c1398137d3ae27a5cda1dc1583498290422e",
  "public/backup-ui.js":"4b9f3bc7c86c6ae24e92568172c62a024b9fee868bb57b6aef872c60c4ec46d7",
  "public/index.html":"24e7ca3a1fe36801dcd958aaa460c274172c6c9d69ffca2afc5902174dc5c82f",
  "public/order-batch-ui.js":"f9b8e1e91daa88eefba0ce33b24209d45a4b7ce1753d4f0193f0192d683f9c22",
  "public/report-ui.js":"65bcd9f3a36cba6b05a8f566e74b825c2aa48a15ffb19ce59091844ffaf47752",
  "public/styles.css":"64bbe3755a8c85a7d912c4750458e306df912b848df21cd1aa15bae36fae65d1",
  "public/xlsx-lite.js":"197df982a0b7835778422b43e4521376b14af1d7339c587a371fb3767b6a7630",
  "src/backup-acl.js":"6711f4b2681808bbe583095040e9c5005c3ceb810f6f0a936cb334e7580629f4",
  "src/backup-manager.js":"8d2a28456621557933c59bc19d239708832c68ae7aab092bb0a52bc45cd0e5b0",
  "src/backup-worker.js":"dccc00adaf3c1dd3a1f25ded9a8dcd4f60fb79c88f10fab20ac7314b306d17bd",
  "src/db.js":"74b975176bf2c5813b198782baf299e4e64d9ea245baad500af036b78c0bdcb5",
  "src/order-batches.js":"8cc1a7ea90528b7407e846d8645dd94ac54f08c2c4f2471ecc936e5d60efa95b",
  "src/pricing.js":"895858e6936155dcda46d7d451fdae26ba139ca6aab26a4414eb16f2d1e6ae33",
  "src/request-ip.js":"5127c470a065e4ceddde47cd0762bc18bd2e110a569a13f427eb02cc15abb800",
  "src/security.js":"7ed9547085a65205b2f174fcd942780f18f6bc49a4d9ad874f9ec159c60f2ee5",
  "src/service.js":"b0edcccfcffd686fb9522b9486ba42838452a6abbb081d1972b8b7b6ebee63a8",
  "cloudflare/auth-core.mjs":"e9acfa72ca8edbac0497e7855fb3fc3408b1a53661ba2b8ff978c12f7c54f7f6",
  "cloudflare/d1-readiness.mjs":"76c2c9be11d3ed4e7b689d883382a0189e29a8bacbb4679e05fecd9bc714e593",
  "cloudflare/identity.mjs":"36b3e99c4596398f39022ac4498f35d1271aacdad27368c41812e01383473b40",
  "cloudflare/login-service.mjs":"f904ce69b0df9261fe5fd0a9b7b727576ba49d089332fb6a5e531e112a948e9d",
  "cloudflare/migrations/0001_initial_v3.sql":"33a73b2b6a64f4e60339d10609c2eec957914cf57bf1dff1aece68b1c3a1a616",
  "cloudflare/migrations/0002_login_attempts_window_indexes.sql":"d97cec3593c69e60614554f95d36a7cfa14bf509f8e7c5961bcdc59550d12592",
  "cloudflare/pbkdf2-local-probe-worker.mjs":"b6a5f61d552def61ab39b968c6cad5f9441c44718992ceb03915295cadbabc84",
  "cloudflare/pbkdf2-local-probe.mjs":"cd363b2ac17a184b0f2a0660899f3aaaa6a546ed9f50178c5304041e06c7469a",
  "cloudflare/worker.mjs":"587a55f47a22b79b5ae4e498fa6a76f90960a53543ee96bea1073d6765a180c9",
  "cloudflare/wrangler.d1.example.jsonc":"b6db7434a57a81a31d7700c9e93560da301655aba2a41af127d11f994e0aa06b",
  "cloudflare/wrangler.preview-migrations.example.jsonc":"3e4a8feb7459c9bcfa08a2a36f8d7b4e45bac1a1dbbfe020bf8466b22d2b2f67",
  "db/backup.sql":"2823994610ca8373e11d342358392144532f1414570ad5fdbc95b470891d53ce",
  "db/pricing.sql":"9f39233e8ca336d9a7cc7747ba262250ff5b4e6e434d92cc00ec1cb4175adadd",
  "db/schema.sql":"81b2be4f700f34e0fb978a7054677d79ede35255f91cb5a9d58d518c3339e2ce",
});
