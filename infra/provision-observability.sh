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
# WHO may assume the keyless reader (keyless impersonation). A full IAM member
# string — e.g. `user:you@example.com` or
# `serviceAccount:agent@proj.iam.gserviceaccount.com`. UNSET by default: no consumer
# exists yet (the D91 local-model log-reader agent is unbuilt, OFC-214), so no
# principal is wired to impersonate it. Set it to grant a real assumer (e.g. an
# operator who runs the synthetic-denial test's log queries). Pairing SA creation
# with an assume-grant mirrors how setup-wif.sh pairs the deployer SA with its
# workloadIdentityUser binding — an SA nobody can assume is only half-provisioned.
LOG_READER_PRINCIPAL="${LOG_READER_PRINCIPAL:-}"

# Log-based metric names (their Monitoring metric type becomes
# logging.googleapis.com/user/<name>). Kept distinct on purpose (N126): a Ghost-side
# JWKS outage must never inflate the sign-in-denial metric, and a forged-token burst
# (a no-matching-`kid`, classified a *denial*, not `auth.jwks`) must never hide in
# the JWKS metric.
METRIC_DENIED="${METRIC_DENIED:-book_auth_signin_denied}"
METRIC_JWKS="${METRIC_JWKS:-book_auth_jwks_failure}"
# The nightly backup's signals (D63/D102; 7b-2).
#   - book_backup_stale   Book's own PRE-FLIGHT staleness line: the job ran, read
#                         the bucket, and found the newest snapshot older than its
#                         threshold. Emitted before the export, so it survives a
#                         run that is about to be killed (the whole reason the
#                         check is pre-flight rather than post-hoc).
#   - book_backup_failed  the job ran and produced no snapshot.
#   - book_backup_ok      successful runs. Powers dashboards, and is the series
#                         the metric-ABSENCE policy watches (D149) — the ONLY
#                         detector that can see a job which never ran at all.
METRIC_BACKUP_STALE="${METRIC_BACKUP_STALE:-book_backup_stale}"
METRIC_BACKUP_FAILED="${METRIC_BACKUP_FAILED:-book_backup_failed}"
METRIC_BACKUP_OK="${METRIC_BACKUP_OK:-book_backup_ok}"

# Alerting. The notification channel is an email channel Cloud Monitoring delivers
# itself. DENIAL_BURST_THRESHOLD is the count of denials per 5-minute window above
# which the alert trips — a deliberately conservative starting point to TUNE against
# the real denial baseline once the metric has history (staging has ~none).
# ALERT_EMAIL is the ONE place the recipient lives: `environments/staging.env`
# (the OFC-84 single-source-of-truth this script sources above). No personal
# address is hardcoded as a fallback here — empty means "not configured", and the
# channel step below aborts with a clear message rather than inventing a recipient.
ALERT_EMAIL="${ALERT_EMAIL:-}"
ALERT_CHANNEL_NAME="${ALERT_CHANNEL_NAME:-Book staging alerts (email)}"
DENIAL_POLICY_NAME="${DENIAL_POLICY_NAME:-Book — sign-in denial burst (staging)}"
DENIAL_BURST_THRESHOLD="${DENIAL_BURST_THRESHOLD:-10}"
# One policy, two conditions (OR): the backup is stale, or a run failed outright.
# Both are counts of Book's own log lines, so they fire on presence — no
# missing-data semantics involved.
BACKUP_POLICY_NAME="${BACKUP_POLICY_NAME:-Book — nightly backup problem (staging)}"
# The separate ABSENCE policy (D149) — the only detector for a job that never ran.
# Its window must sit ABOVE the 12h gap between healthy twice-daily runs and BELOW
# Cloud Monitoring's hard 23.5h ceiling; 20h means one missed run, matching the
# in-app pre-flight threshold (BACKUP_STALE_AFTER_MS) so the two agree on
# "overdue". Raising the cadence back to daily would make this UNUSABLE, not just
# less sensitive — 24h between healthy points exceeds any window Monitoring allows.
BACKUP_ABSENT_POLICY_NAME="${BACKUP_ABSENT_POLICY_NAME:-Book — no successful backup (staging)}"
BACKUP_ABSENT_SECONDS="${BACKUP_ABSENT_SECONDS:-72000}"   # 20h; hard ceiling 84600 (23.5h)

# A freshly-created service account is not immediately visible to the IAM policy
# system, so a binding that references it can fail with "does not exist" for several
# seconds after creation (eventual consistency). retry_iam re-runs such a command,
# pausing for propagation. Observed live on the very first cold provision: the
# view-CONDITIONED project binding below consistently loses this race on a cold
# create (the sibling provision-staging.sh's unconditioned binding usually wins it,
# but the race is the same). The command's noisy stdout (the whole IAM policy dump)
# is suppressed; stderr (real errors) and this helper's own progress stay visible.
retry_iam() {
  local attempt=1 max=8
  until "$@" >/dev/null; do
    if (( attempt >= max )); then
      echo "!! IAM command still failing after ${max} attempts: $*" >&2
      return 1
    fi
    echo "    (attempt ${attempt}/${max} failed — waiting 8s for IAM propagation…)" >&2
    sleep 8
    attempt=$(( attempt + 1 ))
  done
}

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
# The nightly backup (7b-2). The staleness line is on the DIAGNOSTIC stream (it is
# an operational fault, not a mutation), matched on its constant `message` — the
# constant is exported from `routes/backup-job.ts` as BACKUP_STALE_MESSAGE, so if
# it is ever reworded, reword it here in the same change or this metric silently
# counts nothing. The other two are audit-stream outcomes of `backup.auto`.
create_or_update_metric "${METRIC_BACKUP_STALE}" \
  "Book: nightly backup pre-flight found the history stale (D63/D102)" \
  "jsonPayload.logType=\"diagnostic\" AND jsonPayload.message=\"backup staleness threshold exceeded\" AND resource.labels.service_name=\"${SERVICE}\""
create_or_update_metric "${METRIC_BACKUP_FAILED}" \
  "Book: a nightly backup run produced no snapshot (D63/D102)" \
  "jsonPayload.logType=\"audit\" AND jsonPayload.action=\"backup.auto\" AND jsonPayload.outcome=\"error\" AND resource.labels.service_name=\"${SERVICE}\""
create_or_update_metric "${METRIC_BACKUP_OK}" \
  "Book: a nightly backup run wrote a snapshot (D63/D102)" \
  "jsonPayload.logType=\"audit\" AND jsonPayload.action=\"backup.auto\" AND jsonPayload.outcome=\"ok\" AND resource.labels.service_name=\"${SERVICE}\""
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
retry_iam gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member="serviceAccount:${READER_SA_EMAIL}" \
  --role="roles/logging.viewAccessor" \
  --condition="expression=resource.name==\"${AUDIT_VIEW}\",title=audit-view-only,description=Read only the Book audit stream (OFC-300/D91)"

#    Pair the SA with an ASSUMER, so it is actually usable (keyless impersonation),
#    the way setup-wif.sh grants workloadIdentityUser on the deployer SA. Optional
#    and OFF by default: no consumer is built yet (OFC-214), so absent a
#    LOG_READER_PRINCIPAL nobody can impersonate the reader — a deliberately-deferred,
#    announced gap, not a silent one. Granting a human/local principal impersonation
#    does NOT touch D91 (that forbids wiring a *cloud LLM*, not provisioning access).
if [[ -n "${LOG_READER_PRINCIPAL}" ]]; then
  echo "==> Granting ${LOG_READER_PRINCIPAL} impersonation of ${READER_SA_NAME} (serviceAccountTokenCreator)"
  retry_iam gcloud iam service-accounts add-iam-policy-binding "${READER_SA_EMAIL}" \
    --member="${LOG_READER_PRINCIPAL}" \
    --role="roles/iam.serviceAccountTokenCreator" --project "${PROJECT_ID}"
else
  echo "    (note: LOG_READER_PRINCIPAL unset — the reader SA has no assumer yet; set it"
  echo "     to a member string to grant keyless impersonation. Deferred to OFC-214.)"
fi

# 5. The email notification channel (Cloud Monitoring, beta track). Idempotent by
#    lookup: a create with no dedupe would mint a duplicate channel every run, so we
#    find an existing email channel for this address first and reuse it. The list and
#    the `head` are split across two substitutions on purpose: piping gcloud into
#    `head` under `set -o pipefail` and papering over it with `|| true` would mask a
#    REAL list failure (a transient error, or the Monitoring API not yet propagated
#    after step 0 enabled it) as "none found" — and then create a DUPLICATE. Split, a
#    gcloud failure aborts loudly; only a genuinely empty result falls through to create.
if [[ -z "${ALERT_EMAIL}" ]]; then
  echo "!! ALERT_EMAIL is empty. Set it (environments/staging.env carries it) so the" >&2
  echo "   alert has a recipient — aborting rather than creating a channel with none." >&2
  exit 1
fi
echo "==> Ensuring email notification channel for ${ALERT_EMAIL}"
CHANNEL_MATCHES="$(gcloud beta monitoring channels list \
  --project "${PROJECT_ID}" \
  --filter="type=email AND labels.email_address=${ALERT_EMAIL}" \
  --format="value(name)")"
CHANNEL_NAME="$(printf '%s\n' "${CHANNEL_MATCHES}" | head -n1)"
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
#    5-minute window trips it. Written to a temp YAML (like provision-staging.sh's
#    lifecycle file). CONVERGES on re-run, like the bucket/sink/metrics above and per
#    the OFC-72 lesson (a create-only guard silently ignores edited config): the file
#    is the source of truth, so an edited DENIAL_BURST_THRESHOLD *and* a changed
#    ALERT_EMAIL (a freshly-created channel) are APPLIED to the existing policy —
#    threshold via --policy-from-file, recipient via --set-notification-channels — not
#    skipped. A threshold tuned only in the console is therefore overwritten on the
#    next run; tune it HERE, in DENIAL_BURST_THRESHOLD, not the console. The list/head
#    are split (not `| head || true`) for the same reason as the channel step above:
#    so a transient list failure aborts rather than masquerading as "no policy" and
#    creating a duplicate.
POLICY_MATCHES="$(gcloud monitoring policies list \
  --project "${PROJECT_ID}" \
  --filter="displayName=\"${DENIAL_POLICY_NAME}\"" \
  --format="value(name)")"
EXISTING_POLICY="$(printf '%s\n' "${POLICY_MATCHES}" | head -n1)"
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
if [[ -z "${EXISTING_POLICY}" ]]; then
  echo "==> Creating alert policy: ${DENIAL_POLICY_NAME} (>${DENIAL_BURST_THRESHOLD}/5min → ${ALERT_EMAIL})"
  gcloud monitoring policies create \
    --project "${PROJECT_ID}" \
    --policy-from-file="${POLICY_FILE}" \
    --notification-channels="${CHANNEL_NAME}"
else
  echo "==> Converging alert policy ${EXISTING_POLICY} (>${DENIAL_BURST_THRESHOLD}/5min → ${ALERT_EMAIL})"
  gcloud monitoring policies update "${EXISTING_POLICY}" \
    --project "${PROJECT_ID}" \
    --policy-from-file="${POLICY_FILE}" \
    --set-notification-channels="${CHANNEL_NAME}"
fi
rm -f "${POLICY_FILE}"

# 7. The nightly-backup alert (D63/D102; 7b-2). One policy, two OR'd conditions —
#    "the history is stale" and "a run failed" — because both mean the same thing
#    to the recipient (the backup needs a human) and two separate emails for one
#    incident is noise. Same create/converge shape as the denial policy above.
#
#    ⚠ THRESHOLD IS `> 0`, i.e. any occurrence. These are not burst signals like
#    sign-in denials; one stale night is already the RPO promise broken, and the
#    job only runs once a day, so there is no volume to average over.
#
#    ⚠ EXPECT THIS TO FIRE THE FIRST TIME A PAUSED STAGING SCHEDULE IS RESUMED.
#    Staging's job sits idle between test sessions, so its first run back legitimately
#    finds a stale history. That is the alert working, not a misconfiguration — do
#    not tune it away.
BACKUP_POLICY_MATCHES="$(gcloud monitoring policies list \
  --project "${PROJECT_ID}" \
  --filter="displayName=\"${BACKUP_POLICY_NAME}\"" \
  --format="value(name)")"
EXISTING_BACKUP_POLICY="$(printf '%s\n' "${BACKUP_POLICY_MATCHES}" | head -n1)"
BACKUP_POLICY_FILE="$(mktemp)"
cat >"${BACKUP_POLICY_FILE}" <<YAML
displayName: "${BACKUP_POLICY_NAME}"
combiner: OR
conditions:
  - displayName: "backup history is stale (pre-flight check)"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/${METRIC_BACKUP_STALE}" AND resource.type="cloud_run_revision"'
      aggregations:
        - alignmentPeriod: 3600s
          perSeriesAligner: ALIGN_DELTA
          crossSeriesReducer: REDUCE_SUM
      comparison: COMPARISON_GT
      thresholdValue: 0
      duration: 0s
      trigger:
        count: 1
  - displayName: "a backup run produced no snapshot"
    conditionThreshold:
      filter: 'metric.type="logging.googleapis.com/user/${METRIC_BACKUP_FAILED}" AND resource.type="cloud_run_revision"'
      aggregations:
        - alignmentPeriod: 3600s
          perSeriesAligner: ALIGN_DELTA
          crossSeriesReducer: REDUCE_SUM
      comparison: COMPARISON_GT
      thresholdValue: 0
      duration: 0s
      trigger:
        count: 1
alertStrategy:
  # Longer than the denial policy's 30 min: a backup incident is resolved by a
  # human doing something, and the next signal is up to a day away, so an
  # auto-close that beats the next run would hide an unresolved problem.
  autoClose: 172800s
YAML
if [[ -z "${EXISTING_BACKUP_POLICY}" ]]; then
  echo "==> Creating alert policy: ${BACKUP_POLICY_NAME} → ${ALERT_EMAIL}"
  gcloud monitoring policies create \
    --project "${PROJECT_ID}" \
    --policy-from-file="${BACKUP_POLICY_FILE}" \
    --notification-channels="${CHANNEL_NAME}"
else
  echo "==> Converging alert policy ${EXISTING_BACKUP_POLICY} → ${ALERT_EMAIL}"
  gcloud monitoring policies update "${EXISTING_BACKUP_POLICY}" \
    --project "${PROJECT_ID}" \
    --policy-from-file="${BACKUP_POLICY_FILE}" \
    --set-notification-channels="${CHANNEL_NAME}"
fi
rm -f "${BACKUP_POLICY_FILE}"

# 8. The backup ABSENCE policy (D149) — the backstop for the one failure Book
#    cannot report about itself. Every other detector here is a count of a log line
#    Book emitted, which means all of them are silent when Book never runs: a
#    paused or deleted Scheduler job, lapsed billing, a service that will not
#    start. Only the absence of successful-backup events sees that, and D102 names
#    it (R21) as the failure that matters.
#
#    ⚠ THE WINDOW IS LOAD-BEARING AND CADENCE-COUPLED. Cloud Monitoring caps a
#    metric-absence trigger at 23.5h. It must also exceed the gap between healthy
#    runs or it fires on a working system. With the twice-daily schedule that gap
#    is 12h, leaving a usable band of 12h–23.5h; 20h sits in it and means "one run
#    missed". **If the backup ever returns to a daily cadence this policy becomes
#    impossible, not merely coarse** — 24h between healthy points exceeds every
#    window Monitoring permits, which is exactly why the cadence is twice daily
#    (D148 → D149). Change one, revisit the other.
#
#    ⚠ IT ARMS ITSELF, LATE. Absence conditions need the series to produce at least
#    one point after the policy is installed, so on a fresh environment this is
#    INERT until the first successful backup. Do not read early silence as health;
#    confirm a snapshot actually landed (infra/README.md's verification steps).
ABSENT_POLICY_MATCHES="$(gcloud monitoring policies list \
  --project "${PROJECT_ID}" \
  --filter="displayName=\"${BACKUP_ABSENT_POLICY_NAME}\"" \
  --format="value(name)")"
EXISTING_ABSENT_POLICY="$(printf '%s\n' "${ABSENT_POLICY_MATCHES}" | head -n1)"
ABSENT_POLICY_FILE="$(mktemp)"
cat >"${ABSENT_POLICY_FILE}" <<YAML
displayName: "${BACKUP_ABSENT_POLICY_NAME}"
combiner: OR
conditions:
  - displayName: "no successful backup in ${BACKUP_ABSENT_SECONDS}s"
    conditionAbsent:
      filter: 'metric.type="logging.googleapis.com/user/${METRIC_BACKUP_OK}" AND resource.type="cloud_run_revision"'
      aggregations:
        - alignmentPeriod: 300s
          perSeriesAligner: ALIGN_DELTA
          crossSeriesReducer: REDUCE_SUM
      duration: ${BACKUP_ABSENT_SECONDS}s
      trigger:
        count: 1
alertStrategy:
  # Matches the sibling backup policy: a human has to act, and the next signal is
  # up to 12h away, so a short auto-close would hide an unresolved outage.
  autoClose: 172800s
YAML
if [[ -z "${EXISTING_ABSENT_POLICY}" ]]; then
  echo "==> Creating alert policy: ${BACKUP_ABSENT_POLICY_NAME} (>${BACKUP_ABSENT_SECONDS}s silent → ${ALERT_EMAIL})"
  gcloud monitoring policies create \
    --project "${PROJECT_ID}" \
    --policy-from-file="${ABSENT_POLICY_FILE}" \
    --notification-channels="${CHANNEL_NAME}"
else
  echo "==> Converging alert policy ${EXISTING_ABSENT_POLICY} (>${BACKUP_ABSENT_SECONDS}s silent → ${ALERT_EMAIL})"
  gcloud monitoring policies update "${EXISTING_ABSENT_POLICY}" \
    --project "${PROJECT_ID}" \
    --policy-from-file="${ABSENT_POLICY_FILE}" \
    --set-notification-channels="${CHANNEL_NAME}"
fi
rm -f "${ABSENT_POLICY_FILE}"

echo
echo "==> Done. Provisioned:"
echo "    audit bucket : ${AUDIT_BUCKET} (${LOG_LOCATION}, ${AUDIT_RETENTION_DAYS}d retention)"
echo "    sink         : ${AUDIT_SINK}  [filter: logType=audit, ${SERVICE}]"
echo "    metrics      : ${METRIC_DENIED}, ${METRIC_JWKS},"
echo "                   ${METRIC_BACKUP_STALE}, ${METRIC_BACKUP_FAILED}, ${METRIC_BACKUP_OK}"
echo "    log-reader SA: ${READER_SA_EMAIL}  (keyless; view-scoped; D91 local-model only)"
echo "    reader assumer: ${LOG_READER_PRINCIPAL:-<none — set LOG_READER_PRINCIPAL to grant impersonation>}"
echo "    alerts       : \"${DENIAL_POLICY_NAME}\" → ${ALERT_EMAIL}"
echo "                   \"${BACKUP_POLICY_NAME}\" → ${ALERT_EMAIL}"
echo "                   \"${BACKUP_ABSENT_POLICY_NAME}\" (>${BACKUP_ABSENT_SECONDS}s) → ${ALERT_EMAIL}"
echo
echo "    LIVE TEST (fire synthetic denials, watch the alert trip) — see infra/README.md,"
echo "    section \"Verifying observability (7a-3c)\"."
echo
echo "    NOTE: the absence policy is INERT until the first successful backup arms it"
echo "    (Monitoring needs one data point before it can call the series absent)."

# ---------------------------------------------------------------------------
# DEFERRED — signals this script deliberately does NOT alert on yet, and why.
# (Referenced from the header and from the metric definitions above.)
#
# 1. auth.jwks failures (7a-3c). The metric exists; no alert. Ghost-staging does
#    not produce a synthesizable JWKS outage, so a threshold would be guesswork.
#    Tracked in OFC-310 item 4, which is independently doable.
#
# 2. The D99 daily health-check watchdogs (OFC-310 items 1–3). Blocked on the D99
#    health-check job itself, which is unbuilt — there is no signal to alert on.
#
# 3. RESOLVED, recorded here because the constraint outlives the fix (D148 → D149,
#    OFC-328). "The nightly backup never ran at all" IS now alerted on, by the
#    absence policy in step 8 — but only because the backup cadence was changed to
#    twice daily to make it possible. **Cloud Monitoring caps a metric-absence
#    trigger window at 23.5 hours** (Monitoring docs, "Create alerting policies on
#    metric absence"), so a 24h cadence cannot be watched for absence at all: the
#    window would have to be shorter than the healthy gap between runs and would
#    fire every day on a working system. Anyone tempted to trim the cadence back to
#    daily is silently deleting this alert, not merely making it coarser.
#
# 4. "Book is down" as a user-facing availability signal. The absence policy above
#    is a genuine liveness backstop, but it is NOT an availability monitor and
#    should not be read as one: it is up to 20 hours slow, it exercises only the
#    Firestore-read + GCS-write + OIDC path rather than sign-in / projection /
#    Hosting / the SPA, and it can fire without an outage (a stale
#    BACKUP_INVOKER_SUBJECT 401s the endpoint while Book is perfectly healthy).
#    The right instrument is a Cloud Monitoring UPTIME CHECK against /api/health,
#    which polls every 1–5 minutes from multiple regions. Filed separately — it
#    deserves its own pass on what to probe and where to alert, and it may absorb
#    part of D99's unbuilt health-check job (OFC-310 items 1–3).
# ---------------------------------------------------------------------------
