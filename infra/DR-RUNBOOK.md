# Book — Disaster-Recovery Runbook

> **This is the runbook for when something has gone badly wrong with Book's data
> or its environment:** the directory's data is lost, corrupted or wrongly
> changed; the production project is damaged or gone; or the backup-integrity job
> has reported that a backup would not restore.
>
> **For everything else, use the other runbook.** Taking Book down for
> maintenance, forcing a cold start, releasing or rolling back a release, a
> locked-out administrator, a failed sign-in, staging and UAT chores: all of
> those are in **[`RUNBOOK.md`](RUNBOOK.md)**. A bad *release* is not a
> disaster: roll it back from that runbook's "Releasing to production" section.
> Building an environment's infrastructure from its scripts is in
> [`README.md`](README.md).

Each procedure below is written for **production** (`pbe-book-prod`,
`ENV_FILE=infra/environments/prod.env`). On staging, swap the project and env
file. Staging's data is fake and is reseeded by every deploy.

## Which situation are you in?

| What happened | Go to |
|---|---|
| Book's data is wrong, lost or corrupted, but the project and its backups are intact | [Restore in place](#restore-in-place) |
| The production project is unusable or has been deleted | [Stand Book up from nothing](#stand-book-up-from-nothing) |
| An email says the backup-integrity check failed | [When the integrity job fails](#when-the-integrity-job-fails) |
| Book is down or broken after a release, and the data is fine | Not a disaster: roll back (`RUNBOOK.md`, "Releasing to production", §4) |

Before anything destructive: **Book can be down for hours without real harm.**
D102's posture is an RTO of hours for a directory nobody's life or business
depends on. Read each step before running it. Speed matters less than not making
it worse.

## Restore in place

*Decisions D101/D150; first exercised for real in 7b-3 (N138).*

The most destructive operation in Book. It **replaces** `profiles`, `users` and
`config` with the snapshot's contents and deletes anything the snapshot does not
name (D63: "be exactly this snapshot"). Images are not restored, because the
snapshot's manifest pins image objects that the bucket keeps. Read D150 and N137
before running it in anger.

**Preview first. Always.** A dry run validates the snapshot, computes the exact
plan the real run would execute, and reports how the admin roster would change,
without writing anything anywhere:

```bash
# from the repo root, after `gcloud auth application-default login`
npm run restore --workspace apps/api -- \
  --object latest --project pbe-book-prod --dry-run
```

If structural validation fails, **stop**: the snapshot is corrupt or tampered
with. Every issue is printed at once, so one pass tells you everything wrong with
it. Try an older snapshot: list them with `gcloud storage ls gs://pbe-book-prod-backups/backups/`,
then pass `--object backups/<name>.json`. To restore to a point *before* a bad
change, pick the newest snapshot taken before it. Snapshots land twice daily
(03:10 and 15:10 UTC) and are kept 90 days.

Then the real thing, in order:

1. **Take Book down** (D187; the procedure is in `RUNBOOK.md`, "Maintenance mode"):
   ```bash
   ENV_FILE=infra/environments/prod.env bash infra/maintenance-begin.sh
   ```
   The restore refuses to run until this is in place. Its `--force` flag skips
   that check. It is for a target with no Hosting site to probe, which in
   practice means only the integrity job's throwaway database. It is never for a
   live recovery.

   ⚠ **If `firebase login` has never been run on this machine**, the script fails
   with "No authorized accounts". The Firebase CLI also accepts **ADC**, which
   `gcloud auth application-default login` has already set up:
   ```bash
   GOOGLE_APPLICATION_CREDENTIALS="$APPDATA/gcloud/application_default_credentials.json" \
     ENV_FILE=infra/environments/prod.env bash infra/maintenance-begin.sh
   ```

2. **Restore.** `--confirm` must repeat the project id. It is the typed
   acknowledgment, and there is no other way to write:
   ```bash
   npm run restore --workspace apps/api -- \
     --object latest --project pbe-book-prod --confirm pbe-book-prod
   ```
   Before its first delete the tool writes a **safety snapshot** of the current
   data into `apps/api/restore-artifacts/`. That file is the undo, and it is the
   only place the pre-restore admin roster survives. `--no-safety-snapshot`
   forfeits both.

3. **Force a cold start.** ⚠ **The restore is invisible until you do this.** The
   cache hydrates only on cold start (there is no Firestore listener), so until
   the instance is replaced Book serves the old data, and would write against
   data that is no longer there. Same image, new revision:
   ```bash
   gcloud run services describe pbe-book-api --region us-central1 \
     --project pbe-book-prod --format='value(spec.template.spec.containers[0].image)'
   gcloud run deploy pbe-book-api --image <that-image> \
     --region us-central1 --project pbe-book-prod
   ```
   Confirm the `N profiles cached` line in the new revision's startup log.

   ⚠ **If the snapshot was taken before 2026-10-01 21:15 UTC, re-run the Ghost
   seed now** (`RUNBOOK.md`, "Linking profiles to Ghost members"). Such a snapshot
   predates D183 and has no `ghostMemberId`s. Until they are back, a primary-email
   edit mints a duplicate Ghost member and locks the brother out (N180).

4. **Bring Book back up**, only after step 3's cold start:
   ```bash
   ENV_FILE=infra/environments/prod.env bash infra/maintenance-end.sh
   ```

5. **Work the Ghost discrepancy report.** The tool ran the reconciliation (D99)
   straight away and wrote `*-ghost-audit.json` into the artifacts directory. A
   rollback can leave Ghost *ahead* of Book. Repair each row by **re-saving that
   brother in Book**, which pushes the fix to Ghost synchronously (D96) and is
   audited like any other edit. There is deliberately no bulk re-push (D150;
   OFC-332).

6. **Check the forensic entry landed in the retained bucket, not just somewhere.**
   The restore's privileged-roster entry (D101) goes to its own Cloud Logging log.
   Two separate things can go wrong, so check both:
   ```bash
   # (a) the entry exists at all
   gcloud logging read 'logName="projects/pbe-book-prod/logs/book-restore"' \
     --project pbe-book-prod --freshness=1h --limit=5

   # (b) the SINK ROUTED IT to the 3-month audit bucket. This catches a stale
   #     AUDIT_FILTER; (a) passes whether or not it did.
   gcloud logging read 'jsonPayload.action="restore"' --project pbe-book-prod \
     --bucket=audit-logs --location=us-central1 --view=_AllLogs --limit=5
   ```
   If (a) is empty, delivery failed. The run said so, and the entry is in the
   artifacts; the restore itself still succeeded, so deliver the entry by hand. If
   (a) has it and (b) does not, the sink filter is stale: re-run
   `ENV_FILE=infra/environments/prod.env bash infra/provision-observability.sh`
   (it converges, so it is safe at any time). ⚠ The log name is load-bearing:
   `RESTORE_LOG_NAME` in `apps/api/src/tools/restore.ts` and the second clause of
   `AUDIT_FILTER` in `provision-observability.sh` must agree.

7. **Delete the artifacts once the restore is confirmed good.** ⚠ They are the
   whole member directory in plaintext: safety snapshot, restore report, Ghost
   report. `restore-artifacts/` is gitignored (this repo is public), but keep the
   files off shared storage.

**What the 7b-3 rehearsal proved.** The whole loop was run against staging for
real on 2026-07-25, by manufacturing a disaster and undoing it. Fifty profiles
were deleted, one record was corrupted, a usable admin was demoted, and a document
the snapshot does not contain was added. The restore brought all 1,200 profiles
back, un-corrupted the record, re-promoted the admin, deleted the interloper as
the run's single "stale" removal, recorded the re-promotion in the forensic entry,
and logged `1200 profiles cached` on the forced cold start. Re-running it twice
more changed nothing (0 deletes, empty delta), which is the idempotence a
partially failed restore depends on. That first real run also found four defects
every offline test had missed (N138). ⚠ On staging, a deploy undoes a restore,
because every deploy wipe-reseeds `profiles` and `users`.

## Stand Book up from nothing

*D102's "stand Book up from nothing". The full bring-up was done for real exactly
once, at the production cutover (`docs/initial-build/CUTOVER-PLAN.md` §3–§6, as
run in N179). That document is the detailed precedent; this section is the order
and the traps.*

**First, check whether the project can simply come back.** A deleted GCP project
is recoverable for 30 days, with every resource in it, including the Firestore
database and both buckets:

```bash
gcloud projects list --filter="lifecycleState=DELETE_REQUESTED"
gcloud projects undelete pbe-book-prod
```

If that works, you are in "Restore in place" at most, and probably not even that.

⚠ **Know where the backups are before you need them.** Production's backups are
in `gs://pbe-book-prod-backups`, which is **inside the production project**. A
project that is gone for good (past the 30-day window) takes its backups and its
images with it. The off-platform copies are the admin's own "Download backup"
archives (collections JSON only, with the admin as custodian, D101) and whatever
`apps/api/restore-artifacts/` copies exist on an operator's machine. Whether to
keep a copy outside the project is an open question (OFC-461).

**If the project must be rebuilt**, a GCP project id can never be reused, so the
new environment needs a **new project id**, and every value in `prod.env` that
names it changes with it. In order:

1. **A new env file.** Copy `infra/environments/prod.env`, change `PROJECT_ID`
   and every value derived from it (`RUNTIME_SA`, `IMAGE_BUCKET`, `DEPLOYER_SA`,
   `WIF_PROVIDER`, `BACKUP_BUCKET`, `BACKUP_AUDIENCE`). Leave
   `BACKUP_INVOKER_SUBJECT` blank for now. Commit it through a PR, because the
   production deploy reads the env file from the tagged tree.
2. **Start the custom domain first.** In the Firebase console, add
   `book.pbe400.org` to the new project's Hosting and update the Namecheap DNS
   records. The managed certificate is the one step nobody controls, so it should
   be waiting for you, not the other way round. Keeping the same origin means the
   Ghost bridge's callback allowlist (two repos) and Ghost's `book_url` setting
   need no change.
3. **Build the environment** (`README.md`, "What's automated"), as an owner of
   the billing account. This needs `firebase projects:addfirebase <project>` first
   (or the console's "Add Firebase"), and the Ghost Admin key stored as Secret
   Manager `ghost-admin-api-key` in the new project:
   ```bash
   ENV_FILE=<new env> BILLING_ACCOUNT=<id> bash infra/provision-staging.sh
   ENV_FILE=<new env> bash infra/setup-wif.sh
   ENV_FILE=<new env> bash infra/provision-observability.sh
   ```
   Paste the printed `book-backup-scheduler` uniqueId into `BACKUP_INVOKER_SUBJECT`
   and merge that change before the next step.
4. **Deploy** by release tag, as for any release (`RUNBOOK.md`, "Releasing to
   production"). The WIF condition requires the `production` GitHub Environment,
   so Forrest approves the deploy as usual.
5. **Load the data, with Book down.** Step 4 left Book live and serving an
   empty directory, so this is a restore in place, and it runs exactly like one,
   without `--force`. Take Book down with `maintenance-begin.sh`, restore,
   force a cold start, then bring Book back up with `maintenance-end.sh` (Restore
   in place, steps 1–4). The only differences: give `--file <snapshot.json>`
   instead of `--object` if the snapshot is on disk, and `--skip-ghost-audit` is
   reasonable on a first load. Copy the image objects across first if the old
   bucket is still readable
   (`gcloud storage cp -r gs://<old>-images/* gs://<new>-images/`). Otherwise
   brothers' photos fall back to placeholders until re-uploaded; the profiles
   still restore. Re-run the Ghost seed if the snapshot predates 2026-10-01
   21:15 UTC. (The 2026-09-16 genesis load used `--force` on a site nobody had
   been told about yet; a recovery has members waiting, so it uses maintenance.)
6. **Verify on loaded data** (D163): sign in, check the Directory count against
   the snapshot's profile count, open a deceased brother and a brother with a
   photo.
7. **Re-point the integrity job** at the new environment:
   `ENV_FILE=<new env> bash infra/provision-verify-project.sh`, then run it once by
   hand (below).

**What automation does and does not rehearse.** The scheduled integrity job
proves, every cycle, that the newest backup is readable, structurally valid,
restorable into a fresh Firestore database, complete to the byte, hydrates
through Book's real cache, and that every photo it names exists. It deliberately
does **not** rehearse anything else on this list (D151 (3)):
- the new project, billing, APIs and Firebase enablement;
- the custom domain and certificate;
- WIF and the secret;
- the Cloud Run and Hosting deploy;
- the Ghost seed;
- the image copy.

Those were done for real once, at cutover, and N179 records what bit. Expect the
same classes of surprise: console-only steps, ADC scopes, the env file read from
the tagged tree.

## When the integrity job fails

The alert email names `book-backup-verify-failed-prod`. Its two conditions mean
different things:

- **"run reported FAIL"**: a build ran and a check failed, or the run could not
  complete.
- **"schedule could not start a build"**: Cloud Scheduler's call to Cloud Build
  failed. That is a permissions or API problem in `pbe-book-verify`, not a backup
  problem; read the Scheduler job's log in that project.

For a FAIL, open the build in the `pbe-book-verify` project's Cloud Build history.
The log holds no member data by design: progress lines, the counts-and-booleans
`VERDICT {…}` line, and the `BOOK-VERIFY-RESULT` marker. The verdict says which
check failed:

| Check | What `false` means | First move |
|---|---|---|
| `snapshotFresh` | The newest backup is over 20h old, or future-dated | The backup pipeline has stalled: the backup alerts in `pbe-book-prod` should agree. `README.md`, "Verifying the backup" |
| `snapshotValid` | The snapshot fails D101's structural rules | Rarely seen here: the restore runs the same rules first and refuses, so a structurally bad snapshot usually ends the run with **no VERDICT line** (below). Treat that backup as untrustworthy |
| `profilesRestored` / `usersRestored` / `configRestored` | The restored data differs from the snapshot | A restore defect, not a backup one: re-run by hand |
| `hydratesAndCounts` | Book's real cache would not load it to the same counts | Re-run by hand; this is the check closest to "Book would not start" |
| `imagesPresent` | Its counts say which: `missingHeadshots` / `missingThumbnails` above 0 means photos the profiles name are missing from the bucket; `envelopeAgrees: 0` means the backup's own image list disagrees with the one derived from its profiles | Missing photos: lost or never written, and versioning keeps 90 days of history to recover from. A disagreeing list: a defect in the backup writer (D147), not in the photos |

If there is no `VERDICT` line, the run did not reach the checks. Usually the
restore refused the snapshot. The restore's output is deliberately withheld from
the build log (it can name brothers), so **re-run by hand to see it**. From the
repo root, with ADC:

```bash
ENV_FILE=infra/environments/prod.env bash infra/verify-backup.sh
```

Run by hand, the restore's output is shown and its artifacts are kept under
`apps/api/restore-artifacts/verify-<timestamp>/` (⚠ real member data; delete when
done). The throwaway database is still deleted at exit.

**Every run fails at the restore with a duplicate email.** D97 tolerates two
profiles sharing an address in live data (those brothers' sign-ins fail closed
until an admin fixes it), but the restore refuses such a snapshot unless waived.
The real fix is to de-duplicate the two profiles in Book; the next backup is then
clean. Until then, set `VERIFY_ALLOW_DUPLICATE_EMAILS=true` in `prod.env`, merge
it, and **cut a release**, because the job reads the env file from the release.
That passes the waiver to both tools, as N190 (5) requires. Remove it once the
duplicate is gone.

**A database left behind.** A run killed by Cloud Build's timeout never runs its
teardown. The bootstrap deletes that run's database after its own time limit, and
every later run
deletes any `verify-*` database older than 3 hours, so nothing waits longer than a
cycle. To check or clean up by hand:

```bash
gcloud firestore databases list --project pbe-book-verify
gcloud firestore databases delete --database=verify-<id> --project pbe-book-verify
```

## The integrity job itself

*D102 → D151 (shape) → D192 (forensic entry) → N190 (the check) → D193 (the job as
built).*

Weekly for its first four weeks and monthly after that (`VERIFY_CADENCE` in
`prod.env`), Cloud Scheduler in the separate `pbe-book-verify` project starts a
one-step Cloud Build. The build:
1. downloads the source of the **latest GitHub Release**, which is the code
   production runs, so the checker matches the code that wrote the backup;
2. runs `infra/verify-backup.sh --in-cloud-build`, which restores production's
   newest backup into a throwaway named database, runs `backup:verify` against
   it, and deletes the database from an EXIT trap;
3. prints `BOOK-VERIFY-RESULT=PASS` or `FAIL`.

A FAIL, or a Scheduler attempt that errors, emails `ALERT_EMAIL`. The job reads
production's backup and image buckets and writes nothing outside
`pbe-book-verify`. Its restores never write a forensic entry (D192).

⚠ **Detection is presence-based only** (D151, D148). A job that is paused,
deleted or never scheduled sends nothing, ever. Every few months, glance at the
build history and see that runs exist.

**Provisioning** (Forrest's to run: it creates a project and grants read on
production's buckets):

```bash
ENV_FILE=infra/environments/prod.env BILLING_ACCOUNT=<id> bash infra/provision-verify-project.sh
```

It creates the Scheduler job **paused**, and re-running it never changes that
state.

⚠ **The job runs the latest release's code** (D193), so nothing below can pass
until a release contains `infra/verify-backup.sh` (it arrived after
`v2026.10.04`). Release first, then:

1. **Run it once and watch it** (D151: the first run is confirmed by eye).
   Scheduler refuses to run a paused job (`Job.state must be ENABLED`), so resume
   it, run it, and pause it again in one line. `run` has handed the build to Cloud
   Build by the time it returns, so the pause cancels nothing, and the schedule
   fires only on Mondays:
   ```bash
   gcloud scheduler jobs resume book-backup-verify --location=us-central1 --project=pbe-book-verify && gcloud scheduler jobs run book-backup-verify --location=us-central1 --project=pbe-book-verify && gcloud scheduler jobs pause book-backup-verify --location=us-central1 --project=pbe-book-verify
   ```
   ⚠ A hand run of `verify-backup.sh` is **not** a rehearsal of this step: the
   bootstrap that fetches the release runs only inside Cloud Build, in the step
   image, and the first scheduled run failed there on a tool the workstation has
   (N197). In the Cloud Build history, confirm that the source is the expected release,
   that the source buckets are production's, that the `VERDICT` line is all
   `true`, that the log ends with `BOOK-VERIFY-RESULT=PASS`, and that
   `gcloud firestore databases list --project pbe-book-verify` shows no `verify-*`
   database afterwards.
2. **Prove the alert fires.** Submit the one-step build that prints the FAIL
   marker and nothing else (`infra/verify-alert-test.cloudbuild.yaml`):
   ```bash
   gcloud builds submit --no-source --project=pbe-book-verify --region=us-central1 \
     --service-account=projects/pbe-book-verify/serviceAccounts/book-verify@pbe-book-verify.iam.gserviceaccount.com \
     --config=infra/verify-alert-test.cloudbuild.yaml
   ```
   The email should arrive within a few minutes, and the incident closes itself.
3. **Arm it:**
   ```bash
   gcloud scheduler jobs resume book-backup-verify --location=us-central1 --project=pbe-book-verify
   ```

**Changing the cadence.** Edit `VERIFY_CADENCE` (`weekly` | `monthly`) in
`prod.env`, merge, and re-run the provisioner.

**Running it against staging** (a rehearsal with fake data, by hand):
`ENV_FILE=infra/environments/staging.env bash infra/verify-backup.sh`. Your own
ADC needs read on staging's buckets and Firestore admin in `pbe-book-verify`.
