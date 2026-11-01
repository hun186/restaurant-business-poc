#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo 'ERROR: Node.js 22.13+ required'; exit 1; }
echo '=== Disposable D1 REST Batch Lab (SCRATCH ONLY) ==='
echo 'Create a NEW EMPTY D1 named restaurant-business-owner-batch-lab-YYYYMMDD.'
echo 'Production, staging and recovery drill targets are prohibited.'
read -r -p 'Enter NEW scratch D1 database UUID: ' uuid
echo '1) Read-only verify scratch target and empty schema'
echo '2) Live batch rollback experiment on new scratch D1 only'
read -r -p 'Select 1 or 2: ' selection
case "$selection" in
  1) node tools/cloudflare-d1-rest-batch-lab.mjs --probe "$uuid" ;;
  2) node tools/cloudflare-d1-rest-batch-lab.mjs --test "$uuid" ;;
  *) echo 'Invalid selection'; exit 1 ;;
esac
