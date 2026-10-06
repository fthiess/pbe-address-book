#!/usr/bin/env bash
#
# Provision the backup-integrity job's home: the separate, persistent-but-empty
# `pbe-book-verify` project (D151; OFC-333, PL-6b). Persistent = the project and a
# thin control plane (two service accounts, their grants, a Cloud Scheduler job,
# a log-based alert). Ephemeral = the data plane: infra/verify-backup.sh creates a
# named Firestore database per run and deletes it at teardown, so no copy of the
# directory sits here between runs.
#
# How a scheduled run happens:
#   Cloud Scheduler ──(OAuth, as book-verify-scheduler)──▶ Cloud Build API
#     builds.create, an inline one-step build that runs AS book-verify:
#       fetch the source of the repo's LATEST GITHUB RELEASE (the code production
#       runs, so the checker matches the writer of the backup — Forrest's call,
#       PL-6b) → `bash infra/verify-backup.sh --in-cloud-build` → print
#       BOOK-VERIFY-RESULT=PASS|FAIL.
#   A FAIL marker, or a Scheduler attempt that errored, emails ALERT_EMAIL.
#
# Why Cloud Build and not GitHub Actions (D151): this repo is PUBLIC, so workflow
# logs are world-readable, and the job handles the whole member directory. Cloud
# Build logs stay private to this project — and the wrapper still keeps anything
# that could name a brother out of them.
#
# ⚠ THIS SCRIPT CHANGES PRODUCTION IAM: it grants `book-verify` read
# (roles/storage.objectViewer) on the SOURCE environment's backup and image
# buckets — the whole member directory and every headshot. That is the job's
# purpose and the reason it is Forrest's to run. Nothing else in the source
# project is touched.
#
# ⚠ The Scheduler job is created PAUSED. Arm it only after one run has been
# watched end to end (`gcloud scheduler jobs run …`, below) — D151: detection is
# presence-based only, so a job that silently verifies nothing must be caught by
# eye the first time. A re-run of this script never changes a job's paused/enabled
# state.
#
# IDEMPOTENT: every create is guarded by a describe/list, and the scheduler job and
# alert policy CONVERGE on re-run (the OFC-72 lesson), so edit cadence and names in
# the env file, never the console.
#
# Prerequisites: gcloud authenticated as an owner of the billing account and of the
# source project's buckets; the `beta` component (Monitoring channels).
#
# Usage (the env file names the SOURCE environment; the verify values live there):
#   ENV_FILE=infra/environments/prod.env BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX \
#     bash infra/provision-verify-project.sh
#
set -euo pipefail

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,46p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

ENV_FILE="${ENV_FILE:-}"
if [[ -z "${ENV_FILE}" || ! -f "${ENV_FILE}" ]]; then
  echo "!! set ENV_FILE to the SOURCE environment's file (got '${ENV_FILE}'). No default:" >&2
  echo "   wiring the job to the wrong environment is the failure it exists to catch." >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a
. "${ENV_FILE}"
set +a

SOURCE_PROJECT="${PROJECT_ID:?ENV_FILE must set PROJECT_ID}"
BACKUP_BUCKET="${BACKUP_BUCKET:?ENV_FILE must set BACKUP_BUCKET}"
IMAGE_BUCKET="${IMAGE_BUCKET:?ENV_FILE must set IMAGE_BUCKET}"
VERIFY_PROJECT_ID="${VERIFY_PROJECT_ID:?ENV_FILE must set VERIFY_PROJECT_ID}"
VERIFY_REGION="${VERIFY_REGION:-${REGION:-us-central1}}"
VERIFY_CADENCE="${VERIFY_CADENCE:?ENV_FILE must set VERIFY_CADENCE (weekly|monthly)}"
VERIFY_POLICY_NAME="${VERIFY_POLICY_NAME:?ENV_FILE must set VERIFY_POLICY_NAME}"
ALERT_EMAIL="${ALERT_EMAIL:?ENV_FILE must set ALERT_EMAIL}"
ALERT_CHANNEL_NAME="${ALERT_CHANNEL_NAME:-book-alerts}"
GITHUB_REPO="${GITHUB_REPO:?ENV_FILE must set GITHUB_REPO}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
ENV_BASENAME="$(basename "${ENV_FILE}")"

if [[ "${VERIFY_PROJECT_ID}" == "${SOURCE_PROJECT}" ]]; then
  echo "!! VERIFY_PROJECT_ID must not be the source project (D151)." >&2
  exit 1
fi

# Cadence (D151 as applied at PL-6b, Forrest's call): weekly for the job's first
# four weeks, then monthly. Times are UTC, chosen ~3.5h after the 03:10 backup so
# the newest snapshot is comfortably inside backup:verify's 20h freshness window.
# (Kept as a word, not a cron string: env-file values carry no spaces.)
case "${VERIFY_CADENCE}" in
  weekly) VERIFY_SCHEDULE="40 6 * * 1" ;; # Mondays 06:40 UTC
  monthly) VERIFY_SCHEDULE="40 6 1 * *" ;; # the 1st, 06:40 UTC
  *)
    echo "!! VERIFY_CADENCE must be weekly or monthly (got '${VERIFY_CADENCE}')." >&2
    exit 1
    ;;
esac

RUNNER_SA_NAME=book-verify
RUNNER_SA="${RUNNER_SA_NAME}@${VERIFY_PROJECT_ID}.iam.gserviceaccount.com"
SCHEDULER_SA_NAME=book-verify-scheduler
SCHEDULER_SA="${SCHEDULER_SA_NAME}@${VERIFY_PROJECT_ID}.iam.gserviceaccount.com"
JOB_NAME=book-backup-verify
METRIC_FAILED=book_verify_failed
METRIC_OK=book_verify_ok
METRIC_SCHEDULER=book_verify_scheduler_error
# The wrapper finishes in minutes; the inner limit lets the bootstrap print a FAIL
# marker (and sweep) before Cloud Build's own timeout kills everything silently.
INNER_TIMEOUT_SECONDS=2400
BUILD_TIMEOUT_SECONDS=3600

# Same propagation helper as the sibling provisioners: a minutes-old service
# account is not yet visible to IAM, so a binding naming it can fail for a while.
retry_gcp() {
  local attempt=1 max=8
  until "$@" >/dev/null; do
    if ((attempt >= max)); then
      echo "!! command still failing after ${max} attempts: $*" >&2
      return 1
    fi
    echo "    (attempt ${attempt}/${max} failed — waiting 8s for propagation…)" >&2
    sleep 8
    attempt=$((attempt + 1))
  done
}

echo "==> Verify project ${VERIFY_PROJECT_ID} (${VERIFY_REGION}) ← source ${SOURCE_PROJECT}"
echo "    reads gs://${BACKUP_BUCKET} and gs://${IMAGE_BUCKET}; cadence ${VERIFY_CADENCE} (${VERIFY_SCHEDULE} UTC)"

# 1. Project + billing.
if ! gcloud projects describe "${VERIFY_PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating project ${VERIFY_PROJECT_ID}"
  gcloud projects create "${VERIFY_PROJECT_ID}" --name="PBE Book backup verification"
fi
if [[ -n "${BILLING_ACCOUNT}" ]]; then
  echo "==> Linking billing account"
  gcloud billing projects link "${VERIFY_PROJECT_ID}" --billing-account="${BILLING_ACCOUNT}" >/dev/null
else
  echo "!! BILLING_ACCOUNT not set — skipping. Billable steps fail until billing is linked."
fi

# 2. APIs. No Cloud Run, no Hosting, no Firebase: the rehearsal is thin (D151 (3)).
echo "==> Enabling APIs"
gcloud services enable \
  firestore.googleapis.com cloudbuild.googleapis.com cloudscheduler.googleapis.com \
  logging.googleapis.com monitoring.googleapis.com iam.googleapis.com \
  --project "${VERIFY_PROJECT_ID}"

# 3. Service accounts. Keyless: Cloud Build and Cloud Scheduler mint their tokens.
for pair in "${RUNNER_SA_NAME}|Backup-integrity build runner (D151)" \
  "${SCHEDULER_SA_NAME}|Starts the backup-integrity build (D151)"; do
  name="${pair%%|*}"
  if ! gcloud iam service-accounts describe "${name}@${VERIFY_PROJECT_ID}.iam.gserviceaccount.com" \
    --project "${VERIFY_PROJECT_ID}" >/dev/null 2>&1; then
    echo "==> Creating service account ${name}"
    gcloud iam service-accounts create "${name}" --display-name="${pair#*|}" \
      --project "${VERIFY_PROJECT_ID}"
  fi
done

# 4. Grants inside the verify project.
#    - runner: create, write, read and delete the throwaway databases; write its
#      own build log (CLOUD_LOGGING_ONLY — a build run as a user-specified service
#      account must name its log destination).
#    - scheduler: start builds, and act as the runner while doing so.
echo "==> Granting the runner datastore.owner + logging.logWriter in ${VERIFY_PROJECT_ID}"
for role in roles/datastore.owner roles/logging.logWriter; do
  retry_gcp gcloud projects add-iam-policy-binding "${VERIFY_PROJECT_ID}" \
    --member="serviceAccount:${RUNNER_SA}" --role="${role}" --condition=None
done
echo "==> Granting the scheduler cloudbuild.builds.editor, and actAs on the runner"
retry_gcp gcloud projects add-iam-policy-binding "${VERIFY_PROJECT_ID}" \
  --member="serviceAccount:${SCHEDULER_SA}" --role=roles/cloudbuild.builds.editor --condition=None
retry_gcp gcloud iam service-accounts add-iam-policy-binding "${RUNNER_SA}" \
  --member="serviceAccount:${SCHEDULER_SA}" --role=roles/iam.serviceAccountUser \
  --project "${VERIFY_PROJECT_ID}"

# 5. ⚠ The cross-project grant on the SOURCE environment: read-only, bucket-scoped
#    (never project-level), on exactly the two buckets the check reads.
for bucket in "${BACKUP_BUCKET}" "${IMAGE_BUCKET}"; do
  echo "==> Granting the runner objectViewer on gs://${bucket} (${SOURCE_PROJECT})"
  retry_gcp gcloud storage buckets add-iam-policy-binding "gs://${bucket}" \
    --member="serviceAccount:${RUNNER_SA}" --role=roles/storage.objectViewer
done

# 6. The build the scheduler submits. One step, so the bootstrap that prints the
#    result marker wraps everything after it. The `script` field gets no Cloud
#    Build substitution, so `$` below is plain bash (docs: "Running bash scripts").
#    Source = the latest GitHub Release, resolved through github.com's own
#    /releases/latest redirect (not the REST API, whose unauthenticated rate limit
#    is per IP — and Cloud Build's egress IPs are shared).
read -r -d '' BOOTSTRAP <<EOF || true
#!/usr/bin/env bash
set -uo pipefail
repo="${GITHUB_REPO}"
rc=0
# The step image ships without curl since its Debian 13 rebuild (N197), and both
# this bootstrap and verify-backup.sh's Node install need it. Conditional, so an
# image that carries curl again skips the install; a failed install falls through
# to the FAIL marker below like any other failure.
if ! command -v curl >/dev/null 2>&1; then
  echo "==> Installing curl (not in the step image)"
  { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null; } \
    || echo "!! could not install curl" >&2
fi
tag="\$(curl -fsSI "https://github.com/\${repo}/releases/latest" | tr -d '\015' | sed -n 's#^[Ll]ocation: .*/releases/tag/##p')"
if [ -z "\${tag}" ]; then
  echo "!! could not resolve the latest release of \${repo}" >&2
  rc=1
else
  echo "==> Source: \${repo} release \${tag}"
  mkdir -p /workspace/src
  if curl -fsSL "https://github.com/\${repo}/archive/refs/tags/\${tag}.tar.gz" | tar -xz -C /workspace/src --strip-components=1; then
    cd /workspace/src
    ENV_FILE="infra/environments/${ENV_BASENAME}" VERIFY_DB_ID_FILE=/workspace/verify-db-id timeout -k 60 ${INNER_TIMEOUT_SECONDS} bash infra/verify-backup.sh --in-cloud-build || rc=\$?
  else
    echo "!! could not fetch the source of \${tag}" >&2
    rc=1
  fi
fi
if { [ "\${rc}" -eq 124 ] || [ "\${rc}" -eq 137 ]; } && [ -s /workspace/verify-db-id ]; then
  # Timed out: the wrapper's teardown may not have run. Delete THIS run's
  # database only (the wrapper recorded its id before creating it) — an
  # operator's hand run in the same project must never lose its database.
  db="\$(cat /workspace/verify-db-id)"
  echo "!! timed out after ${INNER_TIMEOUT_SECONDS}s — deleting \${db}" >&2
  gcloud firestore databases delete --database="\${db}" --project="${VERIFY_PROJECT_ID}" --quiet >/dev/null || true
fi
result=FAIL
[ "\${rc}" -eq 0 ] && result=PASS
echo "BOOK-VERIFY-RESULT=\${result}"
exit "\${rc}"
EOF

json_string() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\t'/\\t}"
  s="${s//$'\n'/\\n}"
  printf '"%s"' "${s}"
}

BUILD_FILE="$(mktemp)"
trap 'rm -f "${BUILD_FILE}"' EXIT
cat >"${BUILD_FILE}" <<EOF
{
  "steps": [
    {
      "name": "gcr.io/google.com/cloudsdktool/google-cloud-cli:stable",
      "script": $(json_string "${BOOTSTRAP}")
    }
  ],
  "serviceAccount": "projects/${VERIFY_PROJECT_ID}/serviceAccounts/${RUNNER_SA}",
  "options": { "logging": "CLOUD_LOGGING_ONLY" },
  "timeout": "${BUILD_TIMEOUT_SECONDS}s",
  "tags": ["book-backup-verify"]
}
EOF

# 7. The schedule. Created PAUSED; converged on re-run without touching its state.
BUILDS_URI="https://cloudbuild.googleapis.com/v1/projects/${VERIFY_PROJECT_ID}/locations/${VERIFY_REGION}/builds"
if gcloud scheduler jobs describe "${JOB_NAME}" --location="${VERIFY_REGION}" \
  --project "${VERIFY_PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Converging Cloud Scheduler job ${JOB_NAME} (state unchanged)"
  VERB=update
  NEW_JOB=false
  # The two verbs spell the header flag differently (gcloud 585 --help): only
  # `update http` has --update-headers, and only `create http` has --headers.
  HEADER_FLAG=--update-headers
else
  echo "==> Creating Cloud Scheduler job ${JOB_NAME} (it will be PAUSED)"
  VERB=create
  NEW_JOB=true
  HEADER_FLAG=--headers
fi
retry_gcp gcloud scheduler jobs "${VERB}" http "${JOB_NAME}" \
  --location="${VERIFY_REGION}" --project "${VERIFY_PROJECT_ID}" \
  --schedule="${VERIFY_SCHEDULE}" --time-zone=Etc/UTC \
  --uri="${BUILDS_URI}" --http-method=POST \
  --oauth-service-account-email="${SCHEDULER_SA}" \
  --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform \
  "${HEADER_FLAG}=Content-Type=application/json" \
  --message-body-from-file="${BUILD_FILE}" \
  --attempt-deadline=180s \
  --description="Book backup-integrity job (D102/D151, OFC-333): ${VERIFY_CADENCE}, source ${SOURCE_PROJECT}"
if [[ "${NEW_JOB}" == true ]]; then
  gcloud scheduler jobs pause "${JOB_NAME}" --location="${VERIFY_REGION}" \
    --project "${VERIFY_PROJECT_ID}" >/dev/null
fi

# 8. Alerting, in the verify project (presence-based only — D151/D148).
create_or_update_metric() {
  local name="$1" desc="$2" filter="$3"
  if ! gcloud logging metrics describe "${name}" --project "${VERIFY_PROJECT_ID}" >/dev/null 2>&1; then
    echo "==> Creating log-based metric ${name}"
    gcloud logging metrics create "${name}" --description="${desc}" \
      --log-filter="${filter}" --project "${VERIFY_PROJECT_ID}"
  else
    echo "==> Converging log-based metric ${name}"
    gcloud logging metrics update "${name}" --description="${desc}" \
      --log-filter="${filter}" --project "${VERIFY_PROJECT_ID}"
  fi
}
create_or_update_metric "${METRIC_FAILED}" \
  "Book: a backup-integrity run ended in FAIL (D102/D151)" \
  'resource.type="build" AND textPayload:"BOOK-VERIFY-RESULT=FAIL"'
create_or_update_metric "${METRIC_OK}" \
  "Book: a backup-integrity run ended in PASS (D102/D151) — history only, nothing alerts on it" \
  'resource.type="build" AND textPayload:"BOOK-VERIFY-RESULT=PASS"'
create_or_update_metric "${METRIC_SCHEDULER}" \
  "Book: the backup-integrity schedule failed to start a build (D151)" \
  "resource.type=\"cloud_scheduler_job\" AND resource.labels.job_id=\"${JOB_NAME}\" AND severity>=ERROR"

# Same split list/head as provision-observability.sh: a failed list must abort,
# not read as "none" and create a duplicate.
CHANNEL_MATCHES="$(gcloud beta monitoring channels list --project "${VERIFY_PROJECT_ID}" \
  --filter="type=\"email\" AND labels.email_address=\"${ALERT_EMAIL}\"" --format="value(name)")"
CHANNEL="$(printf '%s\n' "${CHANNEL_MATCHES}" | head -n1)"
if [[ -z "${CHANNEL}" ]]; then
  echo "==> Creating notification channel ${ALERT_CHANNEL_NAME}"
  CHANNEL="$(gcloud beta monitoring channels create --project "${VERIFY_PROJECT_ID}" \
    --display-name="${ALERT_CHANNEL_NAME}" --description="Backup-integrity job alerts (OFC-333)" \
    --type=email --channel-labels="email_address=${ALERT_EMAIL}" --format="value(name)")"
fi

POLICY_MATCHES="$(gcloud monitoring policies list --project "${VERIFY_PROJECT_ID}" \
  --filter="displayName=\"${VERIFY_POLICY_NAME}\"" --format="value(name)")"
EXISTING_POLICY="$(printf '%s\n' "${POLICY_MATCHES}" | head -n1)"
POLICY_FILE="$(mktemp)"
trap 'rm -f "${BUILD_FILE}" "${POLICY_FILE}"' EXIT
# Any occurrence trips it (> 0): a weekly job has no burst to wait for. Two
# conditions, one email: both mean "the backup is unverified this cycle".
# ⚠ Monitoring REQUIRES a resource.type in every condition filter (first live run,
# 2026-10-05: INVALID_ARGUMENT without one). A log-based metric is written against
# its log entries' monitored resource: `build` for the Cloud Build log, and
# `cloud_scheduler_job` for the Scheduler's attempt log — both listed by the verify
# project's monitoredResourceDescriptors.
cat >"${POLICY_FILE}" <<YAML
displayName: "${VERIFY_POLICY_NAME}"
combiner: OR
conditions:
  - displayName: "backup-integrity run reported FAIL"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/${METRIC_FAILED}" AND resource.type="build"'
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_DELTA
          crossSeriesReducer: REDUCE_SUM
      comparison: COMPARISON_GT
      thresholdValue: 0
      duration: 0s
      trigger:
        count: 1
  - displayName: "backup-integrity schedule could not start a build"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/${METRIC_SCHEDULER}" AND resource.type="cloud_scheduler_job"'
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_DELTA
          crossSeriesReducer: REDUCE_SUM
      comparison: COMPARISON_GT
      thresholdValue: 0
      duration: 0s
      trigger:
        count: 1
alertStrategy:
  autoClose: 86400s
documentation:
  content: "The backup-integrity job (OFC-333) did not verify ${SOURCE_PROJECT}'s newest backup. Runbook: infra/DR-RUNBOOK.md, 'When the integrity job fails'."
  mimeType: text/markdown
YAML
if [[ -z "${EXISTING_POLICY}" ]]; then
  echo "==> Creating alert policy ${VERIFY_POLICY_NAME} → ${ALERT_EMAIL}"
  gcloud monitoring policies create --project "${VERIFY_PROJECT_ID}" \
    --policy-from-file="${POLICY_FILE}" --notification-channels="${CHANNEL}" >/dev/null
else
  echo "==> Converging alert policy ${VERIFY_POLICY_NAME} → ${ALERT_EMAIL}"
  gcloud monitoring policies update "${EXISTING_POLICY}" --project "${VERIFY_PROJECT_ID}" \
    --policy-from-file="${POLICY_FILE}" --set-notification-channels="${CHANNEL}" >/dev/null
fi

STATE="$(gcloud scheduler jobs describe "${JOB_NAME}" --location="${VERIFY_REGION}" \
  --project "${VERIFY_PROJECT_ID}" --format='value(state)')"
echo
echo "==> Done. Scheduler job ${JOB_NAME} is ${STATE}."
echo "    ⚠ The build runs the LATEST GITHUB RELEASE's code (D193). Until a release"
echo "      contains infra/verify-backup.sh, every run FAILs — release first."
echo "    Run it once and WATCH it (D151 — first run confirmed by eye):"
echo "      gcloud scheduler jobs run ${JOB_NAME} --location=${VERIFY_REGION} --project=${VERIFY_PROJECT_ID}"
echo "      https://console.cloud.google.com/cloud-build/builds;region=${VERIFY_REGION}?project=${VERIFY_PROJECT_ID}"
echo "    Then, and only then, arm it:"
echo "      gcloud scheduler jobs resume ${JOB_NAME} --location=${VERIFY_REGION} --project=${VERIFY_PROJECT_ID}"
