#!/usr/bin/env bash
#
# maintenance-off.sh — restore Book to normal serving after maintenance (D118).
#
# Redeploys the real Firebase Hosting config (firebase.json) — the SPA plus the
# /api/* and /img/* rewrites to Cloud Run — undoing maintenance-on.sh. Assumes the
# current apps/web/dist is the build you want live; if not, redeploy through the
# normal pipeline (a push to main) instead.
#
# Usage:  PROJECT_ID=pbe-book-staging ./infra/maintenance-off.sh
#
# NOTE: run under Node 20 if the Firebase CLI hits the Node-24 WIF/STS bug (see
# infra/README.md and maintenance-on.sh).
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-pbe-book-staging}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f apps/web/dist/index.html ]]; then
  echo "==> apps/web/dist/index.html missing — building the web app first"
  npm run build:libs
  npm run build:web
fi

echo "==> Restoring NORMAL hosting config to ${PROJECT_ID}"
npx firebase deploy --only hosting --project "${PROJECT_ID}"

echo "==> Book is back online."
