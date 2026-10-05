#!/usr/bin/env bash
#
# The backup-integrity job (D102, shaped by D151; OFC-333). Restores the newest
# backup of a source environment into a THROWAWAY named Firestore database in the
# separate `pbe-book-verify` project, checks it with `backup:verify` (freshness,
# exact content, real cache hydration, image presence — N190), and deletes the
# database again. The deletion runs from an EXIT trap, so a run that fails halfway
# still leaves no copy of the directory behind.
#
# Two ways it runs, one script:
#   - Scheduled, inside Cloud Build in `pbe-book-verify` (provisioned by
#     infra/provision-verify-project.sh): `--in-cloud-build` installs Node and the
#     repo's dependencies first, and keeps every line that could carry member data
#     OUT of the build log. The build log holds only progress lines, the
#     counts-and-booleans VERDICT line, and the result marker.
#   - By hand, from a checkout at the repo root, as the operator (Application
#     Default Credentials). The restore's own output is shown, and its artifacts are
#     kept under apps/api/restore-artifacts/ (gitignored — REAL MEMBER PII when the
#     source is production).
#
# What it never does: touch the SOURCE environment. The source's buckets are only
# read; every write lands in a named database in the verify project, which no Book
# instance reads. The restore's live-environment guards are kept honest by D192:
# `--no-forensic-entry` is refused on a default database, and `--confirm` names the
# verify project, never the source one (D151 — why this is a separate project).
#
# Usage (from the repo root; the env FILE names the SOURCE environment):
#   ENV_FILE=infra/environments/prod.env bash infra/verify-backup.sh --dry-run
#   ENV_FILE=infra/environments/prod.env bash infra/verify-backup.sh
#   ENV_FILE=infra/environments/staging.env bash infra/verify-backup.sh
#
# Exit status: 0 verified; 1 a check failed or the run could not complete;
# 2 usage error.
#
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ENV_FILE=infra/environments/<env>.env bash infra/verify-backup.sh [options]

Restore the source environment's newest backup into a throwaway Firestore
database in the verify project, verify it, and delete it (D102/D151, OFC-333).

Options:
  --dry-run          Print what would run; create, read and delete nothing.
  --in-cloud-build   Scheduled mode: install Node + dependencies first, and keep
                     the restore's output (which can name brothers) out of the log.
  --help, -h         Show this help and exit.

Environment (from ENV_FILE, overridable):
  PROJECT_ID, BACKUP_BUCKET, IMAGE_BUCKET   the SOURCE environment (read only)
  VERIFY_PROJECT_ID   default pbe-book-verify
  VERIFY_REGION       default: REGION, then us-central1
  VERIFY_MAX_AGE_HOURS  passed to backup:verify (default: its own, 20)

Exit status: 0 verified, 1 failed or could not complete, 2 usage error.
EOF
}

DRY_RUN=false
IN_CLOUD_BUILD=false
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=true ;;
    --in-cloud-build) IN_CLOUD_BUILD=true ;;
    --help | -h)
      usage
      exit 0
      ;;
    *)
      echo "verify-backup: unknown option ${arg}" >&2
      usage >&2
      exit 2
      ;;
  esac
done

ENV_FILE="${ENV_FILE:-}"
if [[ -z "${ENV_FILE}" || ! -f "${ENV_FILE}" ]]; then
  # No default on purpose: silently verifying staging when production was meant is
  # the failure this job exists to catch (D151's "confirm the first prod run by eye").
  echo "verify-backup: set ENV_FILE to the SOURCE environment's file (got '${ENV_FILE}')." >&2
  exit 2
fi
# shellcheck disable=SC1090
set -a
. "${ENV_FILE}"
set +a

SOURCE_PROJECT="${PROJECT_ID:?ENV_FILE must set PROJECT_ID}"
BACKUP_BUCKET="${BACKUP_BUCKET:?ENV_FILE must set BACKUP_BUCKET}"
IMAGE_BUCKET="${IMAGE_BUCKET:?ENV_FILE must set IMAGE_BUCKET}"
VERIFY_PROJECT_ID="${VERIFY_PROJECT_ID:-pbe-book-verify}"
VERIFY_REGION="${VERIFY_REGION:-${REGION:-us-central1}}"
VERIFY_MAX_AGE_HOURS="${VERIFY_MAX_AGE_HOURS:-}"

if [[ "${VERIFY_PROJECT_ID}" == "${SOURCE_PROJECT}" ]]; then
  echo "verify-backup: the verify project must not be the source project (D151)." >&2
  exit 2
fi

# Firestore database ids: lowercase letters, digits and hyphens, 4–63 chars,
# starting with a letter (N190 validates the same rule in the restore). Unique per
# run, so a recently deleted id never needs to be reused.
DB_ID="verify-$(date -u +%Y%m%d-%H%M%S)"
# A database older than this is a leftover from a run that could not tear down
# (a Cloud Build timeout kills the VM without running the trap). Comfortably longer
# than any real run, so two overlapping runs never delete each other's database.
STALE_AFTER_HOURS=3

# Under `npm run --workspace apps/api` the tools run with cwd apps/api/, so the
# restore is handed the workspace-relative form of the same directory.
ARTIFACT_DIR="apps/api/restore-artifacts/${DB_ID}"
ARTIFACT_DIR_FROM_API="restore-artifacts/${DB_ID}"

echo "==> Backup-integrity check (D102/D151)"
echo "    source:  ${SOURCE_PROJECT}  gs://${BACKUP_BUCKET}  gs://${IMAGE_BUCKET}  (read only)"
echo "    target:  ${VERIFY_PROJECT_ID} / database ${DB_ID} (${VERIFY_REGION}; deleted at exit)"

RESTORE_ARGS=(
  --object latest
  --bucket "${BACKUP_BUCKET}"
  --project "${VERIFY_PROJECT_ID}"
  --confirm "${VERIFY_PROJECT_ID}"
  --database "${DB_ID}"
  --out-dir "${ARTIFACT_DIR_FROM_API}"
  --force
  --skip-ghost-audit
  --no-safety-snapshot
  --no-forensic-entry
)

if [[ "${DRY_RUN}" == true ]]; then
  echo "==> --dry-run: nothing will be created, read or deleted. The run would:"
  echo "    1. delete any verify-* database in ${VERIFY_PROJECT_ID} older than ${STALE_AFTER_HOURS}h"
  echo "    2. gcloud firestore databases create --database=${DB_ID} --location=${VERIFY_REGION} --project=${VERIFY_PROJECT_ID}"
  echo "    3. npm run restore --workspace apps/api -- ${RESTORE_ARGS[*]}"
  echo "    4. npm run backup:verify --workspace apps/api -- --object <the object step 3 resolved>" \
    "--bucket ${BACKUP_BUCKET} --image-bucket ${IMAGE_BUCKET} --project ${VERIFY_PROJECT_ID} --database ${DB_ID}"
  echo "    5. delete ${DB_ID} (from the EXIT trap, whatever happened above)"
  exit 0
fi

DB_CREATED=false

# Cloud Build runs this in the google-cloud-cli image, which has gcloud but no Node.
# Install the newest release of the major the repo pins (.nvmrc — the same file CI's
# setup-node reads), checked against nodejs.org's published SHA-256 list.
install_node() {
  local major base sums file
  major="$(tr -dc '0-9' <.nvmrc)"
  base="https://nodejs.org/dist/latest-v${major}.x"
  sums="$(curl -fsSL "${base}/SHASUMS256.txt")"
  file="$(awk '/ node-v[0-9.]+-linux-x64\.tar\.gz$/ {print $2}' <<<"${sums}")"
  [[ -n "${file}" ]] || { echo "!! no linux-x64 build listed at ${base}" >&2; return 1; }
  curl -fsSL -o "/tmp/${file}" "${base}/${file}"
  (cd /tmp && grep " ${file}\$" <<<"${sums}" | sha256sum -c --quiet -)
  tar -xzf "/tmp/${file}" -C /usr/local --strip-components=1
  echo "    node $(node --version)"
}

teardown() {
  local rc=$?
  set +e
  if [[ "${DB_CREATED}" == true ]]; then
    echo "==> Teardown: deleting ${DB_ID}"
    if gcloud firestore databases delete --database="${DB_ID}" \
      --project="${VERIFY_PROJECT_ID}" --quiet >/dev/null; then
      echo "    deleted"
    else
      echo "!! could not delete ${DB_ID} — the next run's sweep will retry; delete it by hand if this repeats:" >&2
      echo "   gcloud firestore databases delete --database=${DB_ID} --project=${VERIFY_PROJECT_ID}" >&2
      [[ ${rc} -eq 0 ]] && rc=1
    fi
  fi
  if [[ ${rc} -eq 0 ]]; then
    echo "==> VERIFIED: the newest backup of ${SOURCE_PROJECT} restores, hydrates and is complete."
  else
    echo "==> FAILED (exit ${rc}). Nothing in ${SOURCE_PROJECT} was touched."
  fi
  exit "${rc}"
}
trap teardown EXIT

if [[ "${IN_CLOUD_BUILD}" == true ]]; then
  echo "==> Installing Node $(cat .nvmrc) and the repo's dependencies"
  install_node
  # Quiet on success; npm's own output names packages, never members.
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
fi
npm run build:libs --silent >/dev/null

# 1. Sweep leftovers. Only `verify-*` databases, and only ones older than the cutoff.
CUTOFF="$(date -u -d "${STALE_AFTER_HOURS} hours ago" +%Y-%m-%dT%H:%M:%SZ)"
STALE="$(gcloud firestore databases list --project="${VERIFY_PROJECT_ID}" \
  --filter="name~/databases/verify- AND createTime<'${CUTOFF}'" --format="value(name)")"
for name in ${STALE}; do
  id="${name##*/}"
  echo "==> Sweeping leftover database ${id} (older than ${STALE_AFTER_HOURS}h)"
  gcloud firestore databases delete --database="${id}" --project="${VERIFY_PROJECT_ID}" --quiet >/dev/null
done

# 2. The throwaway database. Delete protection and PITR are opt-in and left off:
#    this database exists to be deleted.
echo "==> Creating ${DB_ID}"
DB_CREATED=true # set first: if create half-succeeds, teardown still tries
gcloud firestore databases create --database="${DB_ID}" --location="${VERIFY_REGION}" \
  --type=firestore-native --project="${VERIFY_PROJECT_ID}" --quiet >/dev/null

# 3. Restore. Its output names brothers (the admin-roster delta, any refusal), so in
#    Cloud Build it goes to a file on the build VM's disk, which dies with the VM.
mkdir -p "${ARTIFACT_DIR}"
RESTORE_LOG="${ARTIFACT_DIR}/restore-output.txt"
echo "==> Restoring the newest backup into ${DB_ID}"
set +e
if [[ "${IN_CLOUD_BUILD}" == true ]]; then
  npm run restore --silent --workspace apps/api -- "${RESTORE_ARGS[@]}" >"${RESTORE_LOG}" 2>&1
  RESTORE_RC=$?
else
  npm run restore --silent --workspace apps/api -- "${RESTORE_ARGS[@]}" 2>&1 | tee "${RESTORE_LOG}"
  RESTORE_RC=${PIPESTATUS[0]}
fi
set -e
if [[ ${RESTORE_RC} -ne 0 ]]; then
  echo "!! The restore failed (exit ${RESTORE_RC}). Its output is withheld from this log;" >&2
  echo "   re-run this script by hand to see it." >&2
  exit 1
fi

# The restore resolved `latest` exactly once; backup:verify must judge THAT object,
# not whatever is newest by now (backups land twice a day — N190).
OBJECT="$(sed -n 's/^Resolved "latest" to \([^ ]*\) (taken .*/\1/p' "${RESTORE_LOG}" | head -n1)"
if [[ -z "${OBJECT}" ]]; then
  echo "!! The restore succeeded but did not report which object it resolved." >&2
  exit 1
fi
echo "    restored ${OBJECT}"

# 4. Verify. Its stdout ends with the counts-only VERDICT line; its stderr can name
#    an account or a bucket (N190), so in Cloud Build it is withheld like the above.
echo "==> Verifying ${DB_ID} against ${OBJECT}"
VERIFY_ARGS=(
  --object "${OBJECT}"
  --bucket "${BACKUP_BUCKET}"
  --image-bucket "${IMAGE_BUCKET}"
  --project "${VERIFY_PROJECT_ID}"
  --database "${DB_ID}"
)
if [[ -n "${VERIFY_MAX_AGE_HOURS}" ]]; then
  VERIFY_ARGS+=(--max-age-hours "${VERIFY_MAX_AGE_HOURS}")
fi
VERIFY_OUT="${ARTIFACT_DIR}/verify-output.txt"
set +e
if [[ "${IN_CLOUD_BUILD}" == true ]]; then
  npm run backup:verify --silent --workspace apps/api -- "${VERIFY_ARGS[@]}" >"${VERIFY_OUT}" 2>"${VERIFY_OUT}.stderr"
  VERIFY_RC=$?
  grep '^VERDICT ' "${VERIFY_OUT}" || echo "!! no VERDICT line was printed" >&2
else
  npm run backup:verify --silent --workspace apps/api -- "${VERIFY_ARGS[@]}" 2>&1 | tee "${VERIFY_OUT}"
  VERIFY_RC=${PIPESTATUS[0]}
fi
set -e
exit "${VERIFY_RC}"
