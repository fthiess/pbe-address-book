#!/usr/bin/env bash
#
# Provision Book's observability layer (Phase 7a-3c, OFC-300): the audit-log
# retention bucket + sink, the security log-based metrics, the sign-in-denial
# alert, and the keyless log-reader service account.
#
# This is the companion to provision-staging.sh (which builds the environment)
# and setup-wif.sh (which wires keyless CI deploys): this one makes Book's three
# log streams — audit / diagnostic / access (ENGINEERING-DESIGN §6.1, D142/N126/
# N127) — actually *observed*. The streams already emit distinguishable structured
# JSON (`logType`, `severity`, `action`); nothing yet routes, retains, measures, or
# alerts on them. `audit-log.ts` claims `logType:"audit"` "routes this stream to its
# longer-retention bucket" — until this script runs, that routing does not exist.
#
# It spans TWO GCP products, both project-native (no new Book dependency):
#   - Cloud LOGGING  — the audit bucket, the sink, the log-based metrics, and the
#                      log-reader SA's read scope.
#   - Cloud MONITORING — the email notification channel and the alert policy.
#     Cloud Monitoring's own infrastructure sends the alert email; Book has no mail
#     wiring and is not involved (that is the point — see Q&A in the 7a-3c session).
#
# WHY IT IS A SEPARATE SCRIPT (not folded into provision-staging.sh): it keys on log
# labels that only came to exist in 7a-3a/7a-3b, it is run *after* the app is
# deployed and emitting, and — like all live IAM / sink / alert changes — it is
# Forrest's to run, kept apart from the from-scratch environment build. (D144.)
#
# Governing decisions: D61/P10 (names-not-values on all streams), P16 (3-month
# audit retention, aligned with backup/headshot windows), D91 (the log-reader is
# constrained to first-party / on-premise / local-model processing — it is NEVER
# wired to an external cloud LLM; this script provisions the SA and STOPS there),
# D58/§5.2 (the off-Ghost-path keyless-SA pattern the Linter established), D99/§6.1
# (the consolidated health-check job and the watchdog alerts — see the DEFERRED note
# at the end for which of those have no signal to alert on yet).
#
# IDEMPOTENT where that is cheap: every create is guarded by a describe/list, so a
# re-run converges rather than erroring. Safe to run repeatedly.
#
# Prerequisites (interactive, not scripted here):
#   - gcloud installed and authenticated as an owner of the project (`gcloud auth
#     login`), with the `beta` components available (`gcloud components install beta`
#     or the bundled SDK) — the Monitoring channel command is on the beta track.
#   - The environment already provisioned (infra/provision-staging.sh) and the API
#     DEPLOYED and having served at least one request, so the log streams exist to
#     route and measure. The sink/metric filters match nothing until then — harmless,
#     but the live-test at the end needs real `auth.signin` entries to fire.
#
# Usage:
#   PROJECT_ID=pbe-book-staging REGION=us-central1 ALERT_EMAIL=fthiess@gmail.com \
#   bash infra/provision-observability.sh
#
set -euo pipefail

# Load the shared environment values (single source of truth; OFC-84) so this
# script, provision-staging.sh, setup-wif.sh, and the deploy workflow agree. The
# ${VAR:-default} fallbacks below still apply to anything the file omits.
ENV_FILE="$(dirname "$0")/environments/staging.env"
# shellcheck disable=SC1090,SC1091
if [ -f "${ENV_FILE}" ]; then set -a; . "${ENV_FILE}"; set +a; fi

PROJECT_ID="${PROJECT_ID:-pbe-book-staging}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-pbe-book-api}"

# Where the audit stream is retained. A Cloud Logging bucket is PROJECT-scoped (its
# name need only be unique within the project + location, unlike the globally-unique
# GCS image bucket), so a plain name is fine. Regional, co-located with the rest of
# the environment for data-residency alignment (overridable).
AUDIT_BUCKET="${AUDIT_BUCKET:-audit-logs}"
LOG_LOCATION="${LOG_LOCATION:-${REGION}}"
AUDIT_SINK="${AUDIT_SINK:-audit-sink}"
AUDIT_RETENTION_DAYS="${AUDIT_RETENTION_DAYS:-90}"   # P16 — 3 months.

# The dedicated, keyless log-reader identity (D58/§5.2 pattern; D91 constraint).
READER_SA_NAME="${READER_SA_NAME:-book-log-reader}"
READER_SA_EMAIL="${READER_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

# Log-based metric names (their Monitoring metric type becomes
# logging.googleapis.com/user/<name>). Kept distinct on purpose (N126): a Ghost-side
# JWKS outage must never inflate the sign-in-denial metric, and a forged-token burst
# (a no-matching-`kid`, classified a *denial*, not `auth.jwks`) must never hide in
# the JWKS metric.
METRIC_DENIED="${METRIC_DENIED:-book_auth_signin_denied}"
METRIC_JWKS="${METRIC_JWKS:-book_auth_jwks_failure}"

# Alerting. The notification channel is an email channel Cloud Monitoring delivers
# itself. DENIAL_BURST_THRESHOLD is the count of denials per 5-minute window above
# which the alert trips — a deliberately conservative starting point to TUNE against
# the real denial baseline once the metric has history (staging has ~none).
ALERT_EMAIL="${ALERT_EMAIL:-fthiess@gmail.com}"
ALERT_CHANNEL_NAME="${ALERT_CHANNEL_NAME:-Book staging alerts (email)}"
DENIAL_POLICY_NAME="${DENIAL_POLICY_NAME:-Book — sign-in denial burst (staging)}"
DENIAL_BURST_THRESHOLD="${DENIAL_BURST_THRESHOLD:-10}"

echo "==> Project ${PROJECT_ID} | region ${REGION} | audit bucket ${AUDIT_BUCKET} (${LOG_LOCATION}, ${AUDIT_RETENTION_DAYS}d)"
gcloud config set project "${PROJECT_ID}" >/dev/null

# 0. Enable the APIs this layer needs (idempotent). Logging is already implicitly on
#    (Cloud Run writes to it), but assert it; Monitoring is needed for channel+policy.
echo "==> Enabling Logging + Monitoring APIs"
gcloud services enable logging.googleapis.com monitoring.googleapis.com \
  --project "${PROJECT_ID}"

# 1. The audit retention bucket (P16 — 3 months). A user-defined Cloud Logging
#    bucket with a 90-day retention horizon; the project's `_Default` bucket keeps
#    its 30-day default. Retention is the only knob that matters here — the ACL
#    restriction that makes this "the longer-retention, access-controlled bucket"
#    is enforced by the log-VIEW grant in step 4, not by a bucket ACL (Logging has
#    no per-bucket ACL; least-privilege read is a view-scoped IAM condition).
if ! gcloud logging buckets describe "${AUDIT_BUCKET}" \
      --location="${LOG_LOCATION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating audit log bucket ${AUDIT_BUCKET}"
  gcloud logging buckets create "${AUDIT_BUCKET}" \
    --location="${LOG_LOCATION}" \
    --retention-days="${AUDIT_RETENTION_DAYS}" \
    --description="Book audit stream (logType=audit) — 3-month retention (P16)" \
    --project "${PROJECT_ID}"
else
  # Converge retention on an existing bucket (an update to the same value is a no-op),
  # so re-running actually applies a changed P16 horizon rather than silently skipping.
  echo "==> Converging retention on ${AUDIT_BUCKET} → ${AUDIT_RETENTION_DAYS}d"
  gcloud logging buckets update "${AUDIT_BUCKET}" \
    --location="${LOG_LOCATION}" \
    --retention-days="${AUDIT_RETENTION_DAYS}" \
    --project "${PROJECT_ID}"
fi

# 2. The sink: route the audit stream into that bucket. Filter is the same label the
#    app writes (audit-log.ts) plus a resource guard so only THIS service's audit
#    lines match. A same-project log-bucket destination needs NO writer-identity IAM
#    grant (that is only for GCS/BigQuery/Pub-Sub/cross-project sinks), so there is
#    nothing to bind after creation.
#
#    NOTE (deliberate, not a bug): the built-in `_Default` sink still ALSO routes
#    these entries into `_Default`, so audit lines are BOTH long-retained here and
#    visible in the ordinary Logs Explorer (which reads `_Default`) — the small
#    double-storage is negligible at Book's volume and keeps audit lines from
#    vanishing out of the default view. We intentionally add NO `_Default` exclusion.
AUDIT_FILTER="jsonPayload.logType=\"audit\" AND resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\""
BUCKET_DEST="logging.googleapis.com/projects/${PROJECT_ID}/locations/${LOG_LOCATION}/buckets/${AUDIT_BUCKET}"
if ! gcloud logging sinks describe "${AUDIT_SINK}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating sink ${AUDIT_SINK} → ${AUDIT_BUCKET}"
  gcloud logging sinks create "${AUDIT_SINK}" "${BUCKET_DEST}" \
    --log-filter="${AUDIT_FILTER}" \
    --description="Route logType=audit to the ${AUDIT_BUCKET} retention bucket (OFC-300)" \
    --project "${PROJECT_ID}"
else
  echo "==> Converging sink ${AUDIT_SINK} filter/destination"
  gcloud logging sinks update "${AUDIT_SINK}" "${BUCKET_DEST}" \
    --log-filter="${AUDIT_FILTER}" --project "${PROJECT_ID}"
fi

# 3. Log-based counter metrics on the security-relevant audit events. Each counts
#    log entries matching its filter; the Monitoring metric type is
#    logging.googleapis.com/user/<name>. The metrics read the live stream, so they
#    work whether or not step 2's bucket exists.
create_or_update_metric() {
  local name="$1" desc="$2" filter="$3"
  if ! gcloud logging metrics describe "${name}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    echo "==> Creating log-based metric ${name}"
    gcloud logging metrics create "${name}" \
      --description="${desc}" --log-filter="${filter}" --project "${PROJECT_ID}"
  else
    echo "==> Converging log-based metric ${name}"
    gcloud logging metrics update "${name}" \
      --description="${desc}" --log-filter="${filter}" --project "${PROJECT_ID}"
  fi
}
# A sign-in DENIAL (auth.signin outcome=denied) — the forged/rotated-away-`kid`
# burst lands here too (N126), so this is the metric the burst alert watches.
create_or_update_metric "${METRIC_DENIED}" \
  "Book: auth.signin denials (7a-3c burst-alert source)" \
  "jsonPayload.logType=\"audit\" AND jsonPayload.action=\"auth.signin\" AND jsonPayload.outcome=\"denied\" AND resource.labels.service_name=\"${SERVICE}\""
# A JWKS transport fault (auth.jwks) — a Ghost-side availability problem, kept OUT of
# the denial metric on purpose. Metric now; its alert is deferred (no synthesizable
# signal on staging — see the DEFERRED note).
create_or_update_metric "${METRIC_JWKS}" \
  "Book: auth.jwks endpoint failures (Ghost JWKS availability)" \
  "jsonPayload.logType=\"audit\" AND jsonPayload.action=\"auth.jwks\" AND resource.labels.service_name=\"${SERVICE}\""

# 4. The keyless log-reader service account (D58/§5.2 pattern; D91 constraint).
#    - It is a dedicated identity with NO key ever created — consumers impersonate it
#      (`--impersonate-service-account`) or reach it via WIF, exactly as the Linter's
#      off-Ghost-path SA does. A key would be a long-lived secret in a PUBLIC repo's
#      blast radius.
#    - Its read scope is the AUDIT BUCKET ONLY, not project-wide logs. We grant
#      roles/logging.viewAccessor at the project with an IAM CONDITION pinning it to
#      the audit bucket's `_AllLogs` view (which, because only the audit sink targets
#      this bucket, contains audit entries and nothing else). This is true "viewer
#      over the audit stream" least-privilege — project-wide roles/logging.viewer
#      would also expose the diagnostic stream, which D91's spirit argues against.
#    - D91: this script PROVISIONS the SA and STOPS. It does NOT connect it to any
#      cloud LLM. The planned log-reader agent is first-party / on-premise / local
#      model only; no audit content egresses to an external LLM. Wiring a cloud LLM
#      to this SA would violate D91 and must be a separate, explicit decision.
if ! gcloud iam service-accounts describe "${READER_SA_EMAIL}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  echo "==> Creating log-reader service account ${READER_SA_EMAIL}"
  gcloud iam service-accounts create "${READER_SA_NAME}" \
    --display-name="Book audit-log reader (keyless; D91 local-model only)" \
    --project "${PROJECT_ID}"
fi
AUDIT_VIEW="projects/${PROJECT_ID}/locations/${LOG_LOCATION}/buckets/${AUDIT_BUCKET}/views/_AllLogs"
echo "==> Granting ${READER_SA_NAME} view-scoped read on the audit bucket (viewAccessor, conditioned)"
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${READER_SA_EMAIL}" \
  --role="roles/logging.viewAccessor" \
  --condition="expression=resource.name==\"${AUDIT_VIEW}\",title=audit-view-only,description=Read only the Book audit stream (OFC-300/D91)" \
  >/dev/null

# 5. The email notification channel (Cloud Monitoring, beta track). Idempotent by
#    lookup: a create with no dedupe would mint a duplicate channel every run, so we
#    find an existing email channel for this address first and reuse it.
echo "==> Ensuring email notification channel for ${ALERT_EMAIL}"
CHANNEL_NAME="$(gcloud beta monitoring channels list \
  --project "${PROJECT_ID}" \
  --filter="type=email AND labels.email_address=${ALERT_EMAIL}" \
  --format="value(name)" | head -n1 || true)"
if [[ -z "${CHANNEL_NAME}" ]]; then
  echo "    creating channel ${ALERT_CHANNEL_NAME}"
  CHANNEL_NAME="$(gcloud beta monitoring channels create \
    --project "${PROJECT_ID}" \
    --display-name="${ALERT_CHANNEL_NAME}" \
    --description="7a-3c alert delivery (OFC-300)" \
    --type=email \
    --channel-labels="email_address=${ALERT_EMAIL}" \
    --format="value(name)")"
fi
echo "    channel: ${CHANNEL_NAME}"

# 6. The sign-in-denial burst alert policy (Cloud Monitoring, GA track). Threshold on
#    the denial metric: more than DENIAL_BURST_THRESHOLD denials summed over a rolling
#    5-minute window trips it. Idempotent by displayName lookup. Written to a temp
#    YAML (like provision-staging.sh's lifecycle file) and created --policy-from-file.
EXISTING_POLICY="$(gcloud monitoring policies list \
  --project "${PROJECT_ID}" \
  --filter="displayName=\"${DENIAL_POLICY_NAME}\"" \
  --format="value(name)" | head -n1 || true)"
if [[ -z "${EXISTING_POLICY}" ]]; then
  echo "==> Creating alert policy: ${DENIAL_POLICY_NAME} (>${DENIAL_BURST_THRESHOLD}/5min)"
  POLICY_FILE="$(mktemp)"
  cat >"${POLICY_FILE}" <<YAML
displayName: "${DENIAL_POLICY_NAME}"
combiner: OR
conditions:
  - displayName: "auth.signin denials exceed ${DENIAL_BURST_THRESHOLD} in 5 min"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/${METRIC_DENIED}" AND resource.type="cloud_run_revision"'
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_DELTA
          crossSeriesReducer: REDUCE_SUM
      comparison: COMPARISON_GT
      thresholdValue: ${DENIAL_BURST_THRESHOLD}
      duration: 0s
      trigger:
        count: 1
alertStrategy:
  autoClose: 1800s
YAML
  gcloud monitoring policies create \
    --project "${PROJECT_ID}" \
    --policy-from-file="${POLICY_FILE}" \
    --notification-channels="${CHANNEL_NAME}"
  rm -f "${POLICY_FILE}"
else
  echo "==> Alert policy already exists (${EXISTING_POLICY}); leaving as-is."
  echo "    (To change the threshold, edit it in the console or delete + re-run — this"
  echo "     script does not overwrite an existing policy's tuned settings.)"
fi

echo
echo "==> Done. Provisioned:"
echo "    audit bucket : ${AUDIT_BUCKET} (${LOG_LOCATION}, ${AUDIT_RETENTION_DAYS}d retention)"
echo "    sink         : ${AUDIT_SINK}  [filter: logType=audit, ${SERVICE}]"
echo "    metrics      : ${METRIC_DENIED}, ${METRIC_JWKS}"
echo "    log-reader SA: ${READER_SA_EMAIL}  (keyless; view-scoped; D91 local-model only)"
echo "    alert        : \"${DENIAL_POLICY_NAME}\" → ${ALERT_EMAIL}"
echo
echo "    LIVE TEST (fire synthetic denials, watch the alert trip) — see infra/README.md,"
echo "    section \"Verifying observability (7a-3c)\"."
