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

usage() {
  cat <<'USAGE'
maintenance-on.sh — put Book into "down for maintenance" (D118).

Usage:  PROJECT_ID=<project> ./infra/maintenance-on.sh [--dry-run] [--help]

  --dry-run   Print the firebase deploy that WOULD run, and do nothing else.
  --help      Show this help.

Env:  PROJECT_ID   Firebase/GCP project (default: pbe-book-staging)
USAGE
}

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --dry-run) DRY_RUN=1 ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

PROJECT_ID="${PROJECT_ID:-pbe-book-staging}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[dry-run] would deploy the maintenance page to ${PROJECT_ID}:"
  echo "  npx firebase deploy --only hosting --config firebase.maintenance.json --project ${PROJECT_ID}"
  echo "[dry-run] all paths would serve /maintenance.html until maintenance-off.sh runs. No changes made."
  exit 0
fi

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
