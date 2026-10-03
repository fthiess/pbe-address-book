#!/usr/bin/env bash
#
# maintenance-end.sh — bring Book back after maintenance-begin.sh (D118 → D187).
#
# Re-releases, through the Firebase Hosting API, exactly the version that was live
# immediately before the maintenance release — the released build, with its
# CI-injected values, never a local build (OFC-449). Nothing is built or deployed
# from this machine. Brothers see Book again on their next load; nobody is signed
# out (sessions live in Firestore, not Hosting).
#
# ⚠ It REFUSES, and changes nothing, unless the newest live release is still the
# maintenance one. Any ordinary Hosting deploy in between (a production release, or
# on staging any merge to main) has already ended maintenance, and restoring the
# pre-maintenance version would roll that deploy back.
#
# ⚠ If maintenance covered an out-of-band Firestore write (a restore, a bulk load),
# force the cold start (D181) BEFORE running this, so the first visitors see the
# new data.
#
# Usage:
#   bash infra/maintenance-end.sh [--dry-run]                                  # staging
#   ENV_FILE=infra/environments/prod.env bash infra/maintenance-end.sh        # production
set -euo pipefail

usage() {
  cat <<'USAGE'
maintenance-end.sh — bring Book back after maintenance (D118/D187).

Usage:  [ENV_FILE=infra/environments/prod.env] bash infra/maintenance-end.sh [--dry-run] [--help]

  --dry-run   Say which version WOULD be restored; change nothing.
  --help      Show this help.

Env:  ENV_FILE   environment file (default: infra/environments/staging.env)
USAGE
}

ARGS=()
for arg in "$@"; do
  case "$arg" in
    --help|-h) usage; exit 0 ;;
    --dry-run) ARGS+=(--dry-run) ;;
    *) echo "unknown argument: $arg" >&2; usage >&2; exit 2 ;;
  esac
done

ENV_FILE="${ENV_FILE:-$(dirname "$0")/environments/staging.env}"
if [ ! -f "${ENV_FILE}" ]; then
  echo "!! ENV_FILE=${ENV_FILE} does not exist (cwd: $(pwd)). Refusing to fall back to staging defaults." >&2
  exit 1
fi
set -a; . "${ENV_FILE}"; set +a

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec npx tsx scripts/maintenance.ts end --project "${PROJECT_ID}" ${ARGS[@]+"${ARGS[@]}"}
