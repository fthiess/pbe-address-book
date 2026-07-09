#!/usr/bin/env bash
#
# maintenance-on.sh — put Book into the "down for maintenance" state (D118).
#
# The operator's edge-swap mechanism (Forrest's chosen mechanism over an admin-page
# toggle): it deploys an alternate Firebase Hosting config (firebase.maintenance.json)
# that rewrites EVERY path to the static /maintenance.html — served by Hosting
# independently of Cloud Run, so a fresh visitor gets an honest page even while the
# backend is stopped. A cached, already-open SPA that keeps polling /api/* also
# receives the static page (non-JSON), trips its own retry, and lands on the
# in-app maintenance/outage screen — one calm message either way (the 5b-2
# simplification of D118: no planned-vs-unplanned distinction on the cached path).
#
# Restore normal serving with the companion maintenance-off.sh.
#
# Usage:  PROJECT_ID=pbe-book-staging ./infra/maintenance-on.sh
#
# NOTE (matches the CI deploy, infra/README.md): if the Firebase CLI fails a WIF/STS
# token exchange under Node 24 ("Premature close"), run this under Node 20.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-pbe-book-staging}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# The maintenance page ships in the web build output (apps/web/public → dist). Build
# if it isn't there, so the rewrite target exists.
if [[ ! -f apps/web/dist/maintenance.html ]]; then
  echo "==> apps/web/dist/maintenance.html missing — building the web app first"
  npm run build:libs
  npm run build:web
fi

echo "==> Deploying MAINTENANCE hosting config to ${PROJECT_ID} (all paths → /maintenance.html)"
npx firebase deploy --only hosting --config firebase.maintenance.json --project "${PROJECT_ID}"

echo "==> Book is now in maintenance mode. Restore with: PROJECT_ID=${PROJECT_ID} ./infra/maintenance-off.sh"
