# Infrastructure — provisioning playbook

How Book's cloud environment is built, as a reproducible playbook. This is the
interim, imperative form; the fuller ephemeral setup/teardown automation (and
the Terraform-vs-scripts decision) is Phase 7 work (DECISIONS **D102**). For now
this folder is both the **runbook** (read it) and the **provisioner** (run it).

Each environment is its own GCP project (`pbe-book-staging`, later
`pbe-book-prod`) — the project is the isolation boundary; nothing is shared but
the billing account. Resource names are identical across environments except the
GCS bucket, whose name is globally unique (so it carries the environment).

## What's automated

[`provision-staging.sh`](provision-staging.sh) builds an environment from
scratch: project → billing → APIs → Firestore (native, regional) → private image
bucket → least-privilege runtime service account → Cloud Run deploy. It is
parameterized and idempotent where cheap to be, so it can recreate or converge an
environment.

```bash
# from the repo root, authenticated as an owner of the billing account
PROJECT_ID=pbe-book-staging REGION=us-central1 \
BILLING_ACCOUNT=00839F-755E1F-BA1FA4 \
bash infra/provision-staging.sh
```

To build production later: rerun with `PROJECT_ID=pbe-book-prod` (and a
prod-appropriate bucket/region). The custom domain + managed TLS for
`book.pbe400.org` is a cutover step, not part of this script (CODING-PROJECT-PLAN §9).

## What's interactive / not in the script (and why)

These need a human in a browser or are environment-policy choices, so they're
documented rather than scripted:

- **`gcloud auth login`** — authenticate the CLI as an owner. One-time per machine.
- **`gcloud auth application-default login`** — sets ADC so local tools (the
  staging seeder) can reach the project. On the consent screen, **tick "See,
  edit, configure, and delete your Google Cloud data"** (the `cloud-platform`
  scope) or it fails.
- **Seeding fake data** (staging only — D72), after ADC:
  ```bash
  GOOGLE_CLOUD_PROJECT=pbe-book-staging npm run seed:staging --workspace tools/fake-data
  ```
  There is no write path yet, so after seeding force a fresh Cloud Run revision so
  the in-memory cache re-hydrates (Phase 2 adds write-driven refresh):
  ```bash
  gcloud run services update pbe-book-api --region us-central1 \
    --update-env-vars SEEDED_AT=$(date +%s)
  ```

## Keyless CI deploys (Workload Identity Federation)

[`setup-wif.sh`](setup-wif.sh) wires up deploy-on-merge: GitHub Actions deploys
the API (Cloud Run), the SPA (Firebase Hosting), and the Firestore security rules
with **no service-account key anywhere**. A key would be a long-lived secret in a
*public* repo's secret store;
instead GitHub mints a short-lived OIDC token that Google trusts **only for this
one repository** (`fthiess/pbe-address-book`), enforced by an attribute condition
on the OIDC provider. That condition is the load-bearing security control.

```bash
# once per environment, authenticated as a project owner
PROJECT_ID=pbe-book-staging GITHUB_REPO=fthiess/pbe-address-book \
bash infra/setup-wif.sh
```

It creates a workload identity pool + provider, a dedicated `github-deployer`
service account (deploy-only least privilege: `run.admin`,
`cloudbuild.builds.editor`, `artifactregistry.writer`, `storage.admin`,
`firebasehosting.admin`, `firebaserules.admin`,
`serviceusage.serviceUsageConsumer` (the firestore-rules deploy preflight reads
whether the Firestore API is enabled), plus `iam.serviceAccountUser` scoped to the
runtime `book-api` SA and the Cloud Build SA), and the `workloadIdentityUser`
binding that lets the repo impersonate it. It prints the provider resource name + SA email —
the two non-secret values that go in
[`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml).

That workflow triggers on the **push to `main` directly** (D143). A red `main` is
still never deployed, but the guarantee is carried by **branch protection**, not by
a post-merge test run: `main` requires a pull request whose `Verify gate` check
passed `strict` (branches up to date before merging), and admin bypass is off — so
a commit can only reach `main` already-green. The workflow previously waited on a
CI `workflow_run`; that post-merge re-run was removed because it replayed the
PR run against an identical tree.

**Node-version landmine (don't "fix" it):** the Firebase deploy step pins the
Firebase CLI to **Node 20**, even though the rest of the repo is on Node 24. Under
Node 24, `google-auth-library`'s STS token exchange (how the CLI redeems the WIF
credential) dies with `Premature close` (an undici failure) and the deploy fails
with a misleading "have you run firebase login?". `gcloud` is unaffected (its STS
client is not Node). Keep the Node-20 override until firebase-tools ships a fixed
auth library — this will apply to prod too.

For production later, tighten `storage.admin` to `objectAdmin` on the
`run-sources-*` bucket and give Cloud Build a dedicated minimal SA rather than
reusing the Compute Engine default.

## Observability — audit retention, metrics, alerting, log-reader SA (7a-3c)

[`provision-observability.sh`](provision-observability.sh) makes Book's three log
streams (audit / diagnostic / access — ENGINEERING-DESIGN §6.1) actually *observed*.
The streams already emit distinguishable structured JSON (`logType`, `severity`,
`action`); until this script runs, nothing routes, retains, measures, or alerts on
them — `audit-log.ts`'s claim that `logType:"audit"` "routes this stream to its
longer-retention bucket" is aspirational until then. Like the other two scripts it
is **Forrest-run** (it makes live IAM / sink / alert changes) and idempotent.

```bash
# from the repo root, authenticated as a project owner, with the beta components.
# ALERT_EMAIL is read from environments/staging.env (its single home); override here
# only to redirect. Optionally set LOG_READER_PRINCIPAL to grant an assumer (below).
PROJECT_ID=pbe-book-staging REGION=us-central1 \
bash infra/provision-observability.sh
```

It spans **two** project-native GCP products — no new Book dependency:

- **Cloud Logging** — a user-defined **audit bucket** with **90-day retention**
  (P16, aligned with the backup/headshot windows); a **sink** routing
  `jsonPayload.logType="audit"` (from this service) into it; two **log-based
  counter metrics** (`book_auth_signin_denied`, `book_auth_jwks_failure` — kept
  distinct so a Ghost JWKS outage can't inflate the denial metric and a forged-token
  burst can't hide in the JWKS one, N126); and the keyless **log-reader SA**.
- **Cloud Monitoring** — an **email notification channel** and a **sign-in-denial
  burst alert policy**. Cloud Monitoring's own infrastructure sends the email; Book
  has no mail wiring and is not involved.

Two design points worth keeping in view:

- **Least-privilege read (not project-wide `logging.viewer`).** The log-reader SA
  gets `roles/logging.viewAccessor` **conditioned to the audit bucket's `_AllLogs`
  view** — true "viewer over the audit stream" only. Because only the audit sink
  targets that bucket, the view contains audit entries and nothing else; the SA
  cannot read the diagnostic stream or any other logs. It is **keyless** — consumers
  impersonate it (the Linter's D58/§5.2 off-Ghost-path pattern), never a downloaded
  key in this public repo's blast radius. **Who may assume it is a separate grant:**
  set `LOG_READER_PRINCIPAL` (a full IAM member string, e.g. `user:you@example.com`)
  to grant `roles/iam.serviceAccountTokenCreator` on the SA — paired with SA creation
  the way `setup-wif.sh` pairs the deployer SA with its `workloadIdentityUser`
  binding. It is **unset by default**: no consumer is built yet (the D91 local-model
  agent, OFC-214), so the SA has no assumer until one is named — an announced gap,
  not a silent one.
- **Idempotent, and it *converges*.** Re-running reconciles every resource to the
  script's declared values — including the alert policy (edited `DENIAL_BURST_THRESHOLD`
  or a changed `ALERT_EMAIL` is applied to the existing policy, not skipped). The
  file/`staging.env` is the source of truth, so a threshold tuned only in the console
  is overwritten on the next run — tune it in `DENIAL_BURST_THRESHOLD`, not the console.
- **D91 stops at the SA.** The script provisions the reader identity and **does
  not** connect it to any cloud LLM. The planned log-reader agent is first-party /
  on-premise / **local-model** only — no audit content egresses to an external LLM.
  Wiring a cloud model to this SA would violate D91 and must be a separate, explicit
  decision (this is the crux any future alerting-to-Slack/Claude flow, OFC-214, must
  reconcile).

For production later, rerun with the prod project/region and a prod `ALERT_EMAIL`;
the retention horizon and least-privilege posture carry over unchanged.

### Verifying observability (7a-3c) — the synthetic-denial live test

The alert has a synthesizable signal today: a burst of denied sign-ins. After the
API is deployed and has served at least one request (so the audit stream exists):

1. **Fire a burst of denials.** Each `POST /api/auth/session` with a bogus
   token/state is a denied sign-in (`401`) and emits one `auth.signin` `denied`
   audit line. Fire more than the threshold (default **10 per 5-minute window**):
   ```bash
   for i in $(seq 1 15); do \
     curl -s -o /dev/null -X POST https://pbe-book-staging.web.app/api/auth/session \
       -H 'content-type: application/json' -d '{"token":"x","state":"y"}'; \
   done
   ```
2. **Confirm the audit lines landed** (and are routed) in Logs Explorer or the CLI:
   ```bash
   gcloud logging read \
     'jsonPayload.logType="audit" AND jsonPayload.action="auth.signin" AND jsonPayload.outcome="denied"' \
     --project pbe-book-staging --freshness=10m --limit=20
   ```
3. **Watch the metric climb, then the alert trip.** Cloud Monitoring evaluates the
   `book_auth_signin_denied` metric over the 5-minute window; when the summed count
   crosses the threshold the policy fires and Cloud Monitoring emails `ALERT_EMAIL`.
   (Metric ingestion + evaluation lags a couple of minutes — this is not instant.)
4. **Confirm retention routing.** The same denial lines should appear when reading
   the audit bucket's view, proving the sink routes `logType=audit` there:
   ```bash
   gcloud logging read 'jsonPayload.logType="audit"' \
     --project pbe-book-staging --bucket=audit-logs --location=us-central1 \
     --view=_AllLogs --limit=5
   ```

The **JWKS** metric (`book_auth_jwks_failure`) has no synthesizable staging signal
(it needs Ghost's JWKS endpoint to actually fault), so it is provisioned as a metric
without an alert for now — see the deferred watchdogs (OFC tickets) filed with 7a-3c.

## Architecture invariants the playbook encodes

- Cloud Run: `--max-instances=1 --min-instances=0` — single authoritative
  instance, scale-to-zero cost floor (D83).
- **No Cloud CDN and no external load balancer** — member images are app-served
  from the private bucket (D126).
- Cloud Run: `--memory 1Gi` — the headshot pipeline decodes uploaded images with
  sharp in-process (4c-1), and the single instance also holds the whole profile
  cache, so a decode spike is a whole-app OOM risk at the default 512 MiB; the
  upload route also serializes decodes through an in-process concurrency-1
  semaphore (N42). **This applies to prod too.**
- The private image bucket has **object versioning** on and a **90-day
  noncurrent-age Delete lifecycle rule** (D94/N42): the headshot pipeline deletes
  each superseded object on replace/remove, which — with versioning — only
  archives it, so a mistake is recoverable for 90 days before the rule purges it.
- The **runtime** service account (`book-api@…`) holds `storage.objectAdmin` on
  the image bucket (not just `objectViewer`): the 4c-1 pipeline creates and deletes
  headshot/thumbnail objects, not only reads them.
- The **deploy workflow reconciles the image bucket** (that `objectAdmin` grant +
  versioning + lifecycle) on every run, so these can't drift from this script on an
  already-provisioned environment (DECISIONS N48) — the gap that once left staging's
  runtime SA read-only and 500'd the first upload. Keep the same step in any prod
  deploy workflow.
- `--allow-unauthenticated` is intentional: the endpoint is reachable, but
  authentication is enforced by the app's session layer (D126); staging is fake
  data only (D72).

## Testing the Book→Ghost write path against ghost-staging (Phase 5b-1)

The write path (create/update/delete a Ghost member) only runs when the Cloud Run
service has a Ghost Admin key; without it the app uses the succeed-and-log stub and
edits never reach Ghost. Testing it against ghost-staging (never production — D72)
is opt-in, in three parts:

**One-time: the Admin key in Secret Manager.** The key is `{id}:{secret}` from
ghost-staging's custom integration. It is **never** in the repo:

```bash
# create the secret (printf, not echo — no trailing newline in the value)
printf '%s' '<ID>:<SECRET>' | gcloud secrets create ghost-admin-api-key \
  --project=pbe-book-staging --replication-policy=automatic --data-file=-
# the Cloud Run runtime SA reads it at request time…
gcloud secrets add-iam-policy-binding ghost-admin-api-key --project=pbe-book-staging \
  --member=serviceAccount:book-api@pbe-book-staging.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
# …and the deploy SA reads it for the seed-mirror step (below)
gcloud secrets add-iam-policy-binding ghost-admin-api-key --project=pbe-book-staging \
  --member=serviceAccount:github-deployer@pbe-book-staging.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor
```

The deploy wires `--set-secrets GHOST_ADMIN_API_KEY=ghost-admin-api-key:latest`
plus the non-secret `GHOST_ADMIN_API_URL` / `GHOST_NEWSLETTER_ID` (in
`environments/staging.env`). To rotate the key, add a new version
(`gcloud secrets versions add ghost-admin-api-key --data-file=-`) — `:latest`
follows it on the next deploy.

**Per testing session: the mirror.** ghost-staging needs real members matching the
fake profiles. Set the repo variable `STAGING_GHOST_MIRROR=true`; the next deploy's
seed step runs `mirror:ghost-staging`, a **delta reconcile** that creates/updates/
deletes only Ghost members with a fake `@example.test` email to match the fake
profiles and writes each real `ghostMemberId` back into Firestore. Re-running it (another
deploy, or the script by hand) is the **reset** after a session mutated Ghost — it
only fixes what changed, so it is cheap after the initial ~1k-member build. The fake
generator no longer mints ids, so with the flag off every profile cleanly skips the
push (no stale-id `502`); the mirror is the sole source of real ids.

Run it by hand (e.g. to reset mid-session without a deploy):

```bash
GOOGLE_CLOUD_PROJECT=pbe-book-staging \
GHOST_ADMIN_API_URL=https://staging.pbe400.org/ghost/api/admin \
GHOST_NEWSLETTER_ID=6a3ebdd8415f8e0001858cb0 \
GHOST_ADMIN_API_KEY="$(gcloud secrets versions access latest --secret=ghost-admin-api-key --project=pbe-book-staging)" \
  npm run mirror:ghost-staging --workspace tools/fake-data   # add `-- --dry-run` to preview
```

When done testing, set `STAGING_GHOST_MIRROR=false` (or unset it) so ordinary
deploys neither touch nor depend on ghost-staging. The `@example.test` email scope
means the mirror can never touch your own account or the linter member on
ghost-staging (real emails), and it cleans up members the real write path creates
during a session (which carry no distinguishing label).

## Teardown

To remove an environment entirely, delete the project (reclaims everything;
the id stays reserved):

```bash
gcloud projects delete pbe-book-staging
```
