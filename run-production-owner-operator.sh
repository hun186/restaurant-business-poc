#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "ERROR: Node.js 22+ required"; exit 1; }
printf 'Production D1 Owner local operator (secrets are not saved)\n'
printf '1) Check status only\n2) Enroll first Owner ONCE\n3) Check Owner + Time Travel (READ ONLY)\n'
read -r -p 'Select 1, 2 or 3: ' selection
case "$selection" in
  1) node tools/cloudflare-prod-owner-operator.mjs --check ;;
  2) node tools/cloudflare-prod-owner-operator.mjs --enroll ;;
  3) node tools/cloudflare-prod-owner-operator.mjs --preflight ;;
  *) echo "Invalid selection"; exit 1 ;;
esac
