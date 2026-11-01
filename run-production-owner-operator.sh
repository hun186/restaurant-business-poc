#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "ERROR: Node.js 22+ required"; exit 1; }
printf 'Production D1 Owner local operator (secrets are not saved)\n'
printf '1) Check status only\n2) Enroll first Owner ONCE\n'
read -r -p 'Select 1 or 2: ' selection
case "$selection" in
  1) node tools/cloudflare-prod-owner-operator.mjs --check ;;
  2) node tools/cloudflare-prod-owner-operator.mjs --enroll ;;
  *) echo "Invalid selection"; exit 1 ;;
esac
