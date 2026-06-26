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
`firebasehosting.admin`, `firebaserules.admin`, plus `iam.serviceAccountUser`
scoped to the runtime `book-api` SA and the Cloud Build SA), and the
`workloadIdentityUser` binding that lets the repo impersonate it. It prints the provider resource name + SA email —
the two non-secret values that go in
[`.github/workflows/deploy-staging.yml`](../.github/workflows/deploy-staging.yml).

That workflow is **gated on the CI gate**: it triggers via `workflow_run` only
after the CI workflow succeeds on `main`, so a red `main` is never deployed.

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

## Architecture invariants the playbook encodes

- Cloud Run: `--max-instances=1 --min-instances=0` — single authoritative
  instance, scale-to-zero cost floor (D83).
- **No Cloud CDN and no external load balancer** — member images are app-served
  from the private bucket (D126).
- `--allow-unauthenticated` is intentional: the endpoint is reachable, but
  authentication is enforced by the app's session layer (D126); staging is fake
  data only (D72).

## Teardown

To remove an environment entirely, delete the project (reclaims everything;
the id stays reserved):

```bash
gcloud projects delete pbe-book-staging
```
