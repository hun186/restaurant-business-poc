# Cloudflare Workers Build — read-only failure triage

## Evidence as of 2026-11-04

Main commit `e862c6b7352c313e6cf13ab9b2bbc8173af7653f`:
- GitHub Verify run #41686620606: completed, 5/5 PASS.
- Vercel: Production READY at the same SHA.
- Independent check `Workers Builds: restaurant-business-poc`:
  **completed FAILURE**, Build ID `7a0ec384-ee66-4657-a0f8-cc4f9e735239`.
- Previous main `af042d62bd2ef6634dfdec077e9088afde239ac1`
  had successful Workers Builds, ID `6786d6d3-df23-440c-b862-eef3f62b92de`.

[Failed Cloudflare build log](https://dash.cloudflare.com/31b409b04896d260ba0fadf6cc2bb305/workers/services/view/restaurant-business-poc/production/builds/7a0ec384-ee66-4657-a0f8-cc4f9e735239)

The GitHub check exposes no compiler log, just the dashboard Build ID.
The specific cause is **not known**. Do not assume code or credentials are
the culprit without inspecting the first failed build-log step.

## Safe offline reproduction

The existing Hosted PBKDF2 job pins `wrangler@4.152.0` in an isolated
uncredentialed Ubuntu runner. It now additionally executes:

```sh
./node_modules/.bin/wrangler deploy --dry-run --config wrangler.jsonc --outdir /tmp/cloudflare-bundle-dryrun
```

This compiles the real configured production Worker without uploading it.
If the dry run fails, correct its exact error in a reviewed PR. A dry-run
success **does not** establish that a remote build, Cloudflare secret,
account binding, version upload or actual Worker deployment succeeded.

For failures only in the dashboard: compare Settings > Build (root directory,
build/deploy commands, selected token), the first build-log error, supported
Wrangler version, any configured bindings and current cloud status. Cloudflare
retains build logs for a limited period; avoid sharing tokens or secret values.

Do not initiate Cloudflare retries, deploys, Owner enrollment, Production D1
writes, live quota activation or auth configuration changes under this runbook.
