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

usage() {
  cat <<'USAGE'
maintenance-off.sh — restore Book to normal serving after maintenance (D118).

Usage:  PROJECT_ID=<project> ./infra/maintenance-off.sh [--dry-run] [--help]

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
  echo "[dry-run] would restore normal hosting to ${PROJECT_ID}:"
  echo "  npx firebase deploy --only hosting --project ${PROJECT_ID}"
  echo "[dry-run] No changes made."
  exit 0
fi

if [[ ! -f apps/web/dist/index.html ]]; then
  echo "==> apps/web/dist/index.html missing — building the web app first"
  npm run build:libs
  npm run build:web
fi

echo "==> Restoring NORMAL hosting config to ${PROJECT_ID}"
npx firebase deploy --only hosting --project "${PROJECT_ID}"

echo "==> Book is back online."
