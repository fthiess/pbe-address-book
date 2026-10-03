#!/usr/bin/env bash
#
# maintenance-begin.sh — take Book down for maintenance (D118 → D187).
#
# Deploys firebase.maintenance.json: a Firebase Hosting config whose public
# directory (infra/maintenance-site/) holds ONLY maintenance.html, with every path
# rewritten to it. So every visitor — the bare origin, a bookmarked profile, the
# "Book" link from pbe400.org — gets the calm static page from Hosting's edge, and
# nothing reaches Cloud Run. (Before D187 the config published apps/web/dist, and
# because Hosting prefers a matching static file over a rewrite, `/` kept serving
# the SPA throughout maintenance — OFC-334.)
#
# Nothing is built here and the SPA is never republished from this machine: the
# release is tagged, and maintenance-end.sh puts back exactly the version that was
# live before it, through the Hosting API (OFC-449). Safe on production.
#
# A brother who already has Book open keeps what is on screen; his next request to
# the server gets the maintenance page instead of data. Cloud Run is untouched.
#
# Usage:
#   bash infra/maintenance-begin.sh [--dry-run]                                # staging
#   ENV_FILE=infra/environments/prod.env bash infra/maintenance-begin.sh      # production
#
# Needs `gcloud auth login` (the Hosting API) and a Firebase CLI login. The logic
# lives in scripts/maintenance.ts (decisions unit-tested in scripts/lib/).
set -euo pipefail

usage() {
  cat <<'USAGE'
maintenance-begin.sh — take Book down for maintenance (D118/D187).

Usage:  [ENV_FILE=infra/environments/prod.env] bash infra/maintenance-begin.sh [--dry-run] [--help]

  --dry-run   Read the live release history and say what WOULD happen; change nothing.
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
exec npx tsx scripts/maintenance.ts begin --project "${PROJECT_ID}" ${ARGS[@]+"${ARGS[@]}"}
