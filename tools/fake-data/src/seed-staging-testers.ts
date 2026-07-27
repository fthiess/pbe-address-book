/**
 * Provision the UAT tester cohort on STAGING from a roster CSV (D156; OFC-248) —
 * Book profiles plus their matching ghost-staging members, so each tester can sign
 * in through the real Ghost bridge under their real name.
 *
 * It **subsumes** the single-tester `link-staging-tester.ts`, which is retired in
 * the same change: Forrest's admin account is simply the roster's first row.
 *
 * THE MODEL. Testers get their **own** id block from `TESTER_ID_FLOOR` (#9001+)
 * rather than overwriting generated records. `generateProfiles()` never emits an id
 * that high, so the two populations cannot collide, and three things follow for
 * free: every deliberate generated fixture survives (the Canonical Name collision
 * pair at #5001/#5002, the nominal and usable admins at #5003/#5004, the six
 * managers), the image seeder needs no roster awareness because testers carry no
 * `hasHeadshot`, and **removing a tester needs no delete path at all** — `seed:staging`
 * wipes `profiles` before this runs, so a row that is no longer in the CSV simply
 * never comes back. Editing the CSV and reseeding is the whole management story.
 *
 * ⚠ THE ROSTER IS REAL PII. Real brothers' names and email addresses. It lives as a
 * private GCS object in a bucket the Book runtime service account cannot read, and
 * must never enter this PUBLIC repo, a log line, or a PR description. This tool
 * prints counts and ids, never names or addresses.
 *
 * PROFILE SHAPE (D132, Forrest's call): each tester gets identity, contact and role
 * — and **nothing else**. Address, professional fields, links, Big Brother and the
 * rest are deliberately absent, because "fill in your profile" is the testers' first
 * assigned task, which turns account setup into end-to-end coverage of the edit
 * path — the highest-value flow to watch real users attempt.
 *
 * GHOST. Roster emails are reconciled into ghost-staging by the same pure planner
 * the fake-data mirror uses (`ghost-reconcile.ts`). **Matching is by email; deleting
 * is by label** — two different scopes, and `selectReconcileScope` exists to keep
 * them apart. Email, because that is the key Ghost enforces uniqueness on, globally
 * and regardless of labels; the label `book-uat-tester`, because it is this tool's
 * own mark and it may only ever delete what it created. A member that is neither in
 * the roster nor labelled is invisible to the reconcile and can never be touched.
 * The label scope is what makes removal work end-to-end: drop a row, reseed, and the
 * orphaned Ghost member goes with it.
 *
 * ⚠ A pre-existing member holding a roster email is **adopted**: matched, updated,
 * and labelled. That is deliberate — the roster owns its addresses — but it has a
 * consequence worth knowing. Once adopted, that member is inside the delete scope,
 * so removing its row from the roster and reseeding will delete it. In practice the
 * only such account is the operator's own, which is roster row 1 and never removed.
 *
 * ⚠ `send_email=false` on create is load-bearing. Since D154, ghost-staging sends
 * real mail through a verified Mailgun domain — the sandbox's "cannot reach a real
 * person" guarantee is gone, and these are real addresses. Never remove that flag.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging \
 *   UAT_ROSTER_URI=gs://pbe-book-staging-uat/roster/uat-testers.csv \
 *   GHOST_ADMIN_API_URL=https://staging.pbe400.org/ghost/api/admin \
 *   GHOST_ADMIN_API_KEY=<id>:<secret> GHOST_NEWSLETTER_ID=<id> \
 *     npm run seed:staging-testers --workspace tools/fake-data [-- --dry-run]
 *
 * The Ghost half is skipped (with a notice) when the Ghost env is absent, so the
 * Book half still works locally without credentials.
 *
 * NOTE: the API builds its email index at cold-start hydration, so let the staging
 * instance cold-start (or redeploy) after running this, or it will not yet resolve
 * the testers' emails at sign-in.
 */
import { readFile } from "node:fs/promises";
import { type Profile, type Role, formatCanonicalName, normalizeEmail } from "@pbe/shared";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { SignJWT } from "jose";
import {
  type DesiredMember,
  type LabelledMember,
  membersNeedingLabel,
  planReconcile,
  selectReconcileScope,
} from "./ghost-reconcile.js";
import { type RosterEntry, RosterError, parseRoster } from "./roster.js";

/**
 * The Ghost label this tool owns. Every member it creates carries it, and the
 * reconcile's delete branch is scoped to it — so the tool can only ever remove
 * members it put there itself.
 */
const TESTER_LABEL = "book-uat-tester";
/** Bound concurrent Ghost calls, as the fake-data mirror does. */
const CONCURRENCY = 4;

function printHelp(): void {
  console.log(
    [
      "seed:staging-testers — provision the UAT tester cohort on STAGING from a roster",
      "                       CSV: Book profiles + matching ghost-staging members.",
      "",
      "Usage:",
      "  GOOGLE_CLOUD_PROJECT=<project>-staging UAT_ROSTER_URI=<gs://…|path> \\",
      "  [GHOST_ADMIN_API_URL=… GHOST_ADMIN_API_KEY=<id>:<secret> GHOST_NEWSLETTER_ID=…] \\",
      "    npm run seed:staging-testers --workspace tools/fake-data [-- --dry-run]",
      "",
      "Options:",
      "  --dry-run                   Report the plan; make NO Firestore or Ghost changes.",
      "  --allow-fixture-overwrite   Permit a roster row to claim an id inside the",
      "                              generated block, overwriting a test fixture.",
      "  --help,-h                   Show this help and exit.",
      "",
      "Roster CSV columns: profileId, firstName, lastName, classYear, email, role.",
      "Only firstName, lastName and email are required. A blank profileId is assigned",
      "sequentially from the tester id floor; the FIRST data row defaults to admin and",
      "the rest to brother, and an explicit role overrides either.",
      "",
      "The roster holds REAL names and addresses: keep it in private GCS, never in the",
      "repo. This tool prints counts and ids only.",
      "Refuses to run unless the project id ends `-staging`, or if the emulator is set.",
    ].join("\n"),
  );
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
const DRY_RUN = args.includes("--dry-run");
const ALLOW_FIXTURE_OVERWRITE = args.includes("--allow-fixture-overwrite");

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
const rosterUri = process.env.UAT_ROSTER_URI;

function fail(message: string): never {
  console.error(`Refusing: ${message}`);
  process.exit(1);
}

if (!projectId) {
  fail("set GOOGLE_CLOUD_PROJECT to the staging project id.");
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  fail("FIRESTORE_EMULATOR_HOST is set (that targets the emulator).");
}
if (!projectId.endsWith("-staging")) {
  fail(
    `project "${projectId}" does not end with "-staging". This tool only ever writes to a staging project (D72); it must never touch production.`,
  );
}
if (!rosterUri) {
  fail("set UAT_ROSTER_URI to the roster CSV (a gs:// URL or a local path).");
}

initializeApp({ projectId });
const db = getFirestore();

// --- Roster ------------------------------------------------------------------

/** Read the roster from GCS or the local filesystem, whichever the URI names. */
async function readRoster(uri: string): Promise<string> {
  if (!uri.startsWith("gs://")) {
    return readFile(uri, "utf8");
  }
  const withoutScheme = uri.slice("gs://".length);
  const slash = withoutScheme.indexOf("/");
  if (slash === -1) {
    fail(`UAT_ROSTER_URI "${uri}" names a bucket but no object.`);
  }
  const [bucketName, objectKey] = [withoutScheme.slice(0, slash), withoutScheme.slice(slash + 1)];
  const [bytes] = await getStorage().bucket(bucketName).file(objectKey).download();
  return bytes.toString("utf8");
}

let roster: RosterEntry[];
try {
  roster = parseRoster(await readRoster(rosterUri), {
    allowFixtureOverwrite: ALLOW_FIXTURE_OVERWRITE,
  });
} catch (error) {
  if (error instanceof RosterError) {
    fail(`roster is invalid — ${error.message}`);
  }
  throw error;
}

if (roster.length === 0) {
  console.log("Roster holds no tester rows; nothing to provision.");
  process.exit(0);
}

// Ids and roles only — never names or addresses. This output reaches CI logs, which
// are world-readable on a public repo.
console.log(
  `Roster: ${roster.length} tester(s) → ids ${roster.map((e) => `#${e.profileId}`).join(", ")} ` +
    `(roles: ${roster.map((e) => e.role).join(", ")}).`,
);

// --- Book profiles -----------------------------------------------------------

/**
 * Build the tester's profile: identity, contact and role, and nothing more.
 *
 * The omissions are the design (D132). `unlisted: false`, a living `deceased` block
 * and `privacy.shareEmail: true` make the record visible and contactable so the
 * cohort can find each other; every other privacy toggle is left at its documented
 * default rather than opened up, so a tester's first look at their own privacy
 * settings shows the same starting point a real brother would get.
 */
function buildTesterProfile(entry: RosterEntry, now: string): Profile {
  return {
    id: entry.profileId,
    firstName: entry.firstName,
    lastName: entry.lastName,
    classYear: entry.classYear,
    email: normalizeEmail(entry.email),
    role: entry.role as Role,
    deceased: { isDeceased: false },
    debrothered: { isDebrothered: false },
    hasHeadshot: false,
    privacy: {
      shareEmail: true,
      sharePhone: true,
      shareAddress: true,
      shareEmergency: false,
      shareSpousePartner: false,
    },
    unlisted: false,
    allowNewsletterEmail: true,
    allowShareWithMITAA: false,
    lastModified: now,
    newsletterConsentChangedAt: now,
  };
}

const now = new Date().toISOString();
const profiles = roster.map((entry) => buildTesterProfile(entry, now));

if (DRY_RUN) {
  console.log(`[dry-run] Target project: ${projectId}`);
  console.log(
    `[dry-run] Would write ${profiles.length} tester profile(s) at ids ${profiles.map((p) => `#${p.id}`).join(", ")}, each with identity/contact/role only (D132).`,
  );
} else {
  const batch = db.batch();
  for (const profile of profiles) {
    // `set` without merge: a clean replace, so a re-run cannot leave a field from a
    // previous roster edit stranded on the record (a renamed tester keeping their
    // old address, say). The roster is the whole truth for these documents.
    batch.set(db.collection("profiles").doc(String(profile.id)), profile);
  }
  await batch.commit();
  console.log(`Wrote ${profiles.length} tester profile(s) into ${projectId}.`);
}

// --- ghost-staging ------------------------------------------------------------

const apiUrl = process.env.GHOST_ADMIN_API_URL?.replace(/\/$/, "");
const adminKey = process.env.GHOST_ADMIN_API_KEY;
const newsletterId = process.env.GHOST_NEWSLETTER_ID;

if (!apiUrl || !adminKey || !newsletterId) {
  console.log(
    "Ghost env not set (GHOST_ADMIN_API_URL / GHOST_ADMIN_API_KEY / GHOST_NEWSLETTER_ID) — " +
      "skipping the ghost-staging reconcile. Book profiles are provisioned; testers cannot sign in until Ghost members exist.",
  );
  process.exit(0);
}

const [keyId, keySecret] = adminKey.split(":");
if (!keyId || !keySecret) {
  fail("GHOST_ADMIN_API_KEY must be `{id}:{secret}`.");
}
const secretBytes = Buffer.from(keySecret, "hex");

/** Mint a short-lived Ghost Admin JWT — same shape as the fake-data mirror's. */
async function adminToken(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", kid: keyId })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("/admin/")
    .sign(secretBytes);
}

/**
 * Mask anything email-shaped in a string.
 *
 * Ghost's error bodies are echoed into exceptions for diagnosis, and this tool's
 * requests carry **real brothers' addresses** — so an error body may contain one.
 * (The duplicate-email `422` observed in live testing does not, but that is one
 * error shape out of many, and the failure mode here is silent and permanent: a
 * public Actions log.) `mirror-ghost-staging.ts` echoes bodies unmasked and is
 * right to, because every address it handles is a fake `@example.test` one; copying
 * that pattern into a tool that handles real addresses changes the risk, which is
 * the whole reason this exists.
 */
function maskEmails(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email redacted>");
}

async function ghost(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      Authorization: `Ghost ${await adminToken()}`,
      "Accept-Version": "v5.0",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ghost ${method} ${path} → ${res.status}: ${maskEmails(text.slice(0, 300))}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

/**
 * Ensure the tester label exists BEFORE any concurrent member creation.
 *
 * ⚠ **This guard is not optional, and the history says so.** Attaching a label by
 * name on member creation makes Ghost auto-create it — and a burst of concurrent
 * creates then races to auto-create the same label, which this project has already
 * hit once: the `book-seed` label in `mirror-ghost-staging.ts` produced
 * `500 UPDATE_RELATION "Unable to update nested relation"` on the first mirrored
 * deploy (fixed in PR #38, refined in PR #39 when attaching by *id* turned out to
 * 500 differently — Ghost derives the label slug from `label.name`). That machinery
 * later vanished from the repo when PR #40 dropped label-scoping from the mirror
 * entirely, which is why nothing resembling it survives to copy.
 *
 * So: create the label once, up front, single-threaded; then attach **by name** on
 * each create, which is the shape PR #39 landed on. An existing label makes this a
 * no-op. Found by the code review's git-history pass, not by reasoning — the live
 * run happened not to trip the race, which is exactly how a race behaves.
 */
async function ensureTesterLabel(): Promise<void> {
  const found = (await ghost(
    "GET",
    `/labels/?filter=${encodeURIComponent(`slug:${TESTER_LABEL}`)}&limit=1`,
  )) as { labels?: { id?: string }[] };
  if (found.labels && found.labels.length > 0) {
    return;
  }
  await ghost("POST", "/labels/", { labels: [{ name: TESTER_LABEL }] });
  console.log(`Created the "${TESTER_LABEL}" Ghost label (it did not exist yet).`);
}

interface GhostMember {
  id: string;
  email: string;
  name?: string;
  subscribed?: boolean;
  labels?: { name?: string; slug?: string }[];
}

/**
 * List every ghost-staging member, paginated. The scoping decision — which of them
 * the reconcile may act on — is made by `selectReconcileScope`, not here.
 *
 * Deliberately not Ghost's `filter` query parameter: its label syntax is not covered
 * by the published Admin API reference, and a filter expression that silently
 * matched nothing would make the reconcile see zero existing members and try to
 * re-create everyone — a failure that looks like success right up to the 422.
 * Reading the list and deciding in code is slower and completely legible. A few
 * pages against a ~1,200-member instance is a trivial cost for that.
 */
async function listAllMembers(): Promise<LabelledMember[]> {
  const out: LabelledMember[] = [];
  let page = 1;
  for (;;) {
    const body = (await ghost("GET", `/members/?limit=100&page=${page}`)) as {
      members?: GhostMember[];
      meta?: { pagination?: { pages?: number } };
    };
    for (const m of body.members ?? []) {
      out.push({
        id: m.id,
        email: m.email,
        name: m.name ?? "",
        subscribed: m.subscribed === true,
        labels: m.labels ?? [],
      });
    }
    const pages = body.meta?.pagination?.pages ?? 1;
    if (page >= pages) {
      break;
    }
    page += 1;
  }
  return out;
}

function newsletters(subscribed: boolean): { id: string }[] {
  return subscribed ? [{ id: newsletterId as string }] : [];
}

async function createMember(m: DesiredMember): Promise<string> {
  // ⚠ send_email=false: ghost-staging sends REAL mail since D154 and these are real
  // brothers' addresses. A member must never learn they exist from this tool.
  const body = (await ghost("POST", "/members/?send_email=false", {
    members: [
      {
        email: m.email,
        name: m.name,
        labels: [{ name: TESTER_LABEL }],
        newsletters: newsletters(m.subscribed),
      },
    ],
  })) as { members?: { id?: string }[] };
  const id = body.members?.[0]?.id;
  if (!id) {
    throw new Error("Ghost create returned no member id");
  }
  return id;
}

async function updateMember(id: string, m: DesiredMember): Promise<void> {
  // The label is re-sent on every update: Ghost replaces the label set wholesale, so
  // omitting it here would strip the very marker the delete scope depends on and
  // orphan the member beyond this tool's reach.
  await ghost("PUT", `/members/${encodeURIComponent(id)}/`, {
    members: [
      { name: m.name, labels: [{ name: TESTER_LABEL }], newsletters: newsletters(m.subscribed) },
    ],
  });
}

async function deleteMember(id: string): Promise<void> {
  await ghost("DELETE", `/members/${encodeURIComponent(id)}/`);
}

async function pool<T, R>(items: readonly T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await worker(items[i] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
  return results;
}

const desired: DesiredMember[] = roster.map((entry, i) => ({
  profileId: entry.profileId,
  email: normalizeEmail(entry.email),
  name: formatCanonicalName(profiles[i] as Profile, false),
  subscribed: true,
}));

const allMembers = await listAllMembers();
const rosterEmails = desired.map((d) => d.email);
const existing = selectReconcileScope(allMembers, rosterEmails, TESTER_LABEL);
const needsLabel = membersNeedingLabel(allMembers, rosterEmails, TESTER_LABEL);
const plan = planReconcile(desired, existing);

console.log(
  `Ghost plan (label "${TESTER_LABEL}"): ${desired.length} roster member(s); ${allMembers.length} member(s) on the instance, ${existing.length} in scope → ` +
    `create ${plan.toCreate.length}, update ${plan.toUpdate.length}, delete ${plan.toDelete.length}.`,
);
if (plan.toDelete.length > 0) {
  // Named because it is the only destructive branch. Ids, not emails — the ids are
  // opaque, and this line reaches CI logs on a public repo.
  console.log(
    `  Deleting ${plan.toDelete.length} labelled member(s) no longer in the roster: ${plan.toDelete.join(", ")}.`,
  );
}

if (DRY_RUN) {
  console.log("[dry-run] No Ghost or Firestore changes were made.");
  process.exit(0);
}

// The label must exist before the concurrent create burst — see ensureTesterLabel.
if (plan.toCreate.length > 0) {
  await ensureTesterLabel();
}

const links: { profileId: number; ghostMemberId: string }[] = [...plan.matchedLinks];
const created = await pool(plan.toCreate, async (m) => ({
  profileId: m.profileId,
  ghostMemberId: await createMember(m),
}));
links.push(...created);

// Adopted members — in the roster, matched by email, but not yet carrying the label
// — must be updated even when `planReconcile` found no name/subscription drift,
// because the update is what attaches the label. Without this they stay unlabelled
// and, once their row leaves the roster, become invisible to BOTH scopes and are
// never cleaned up (see `membersNeedingLabel`).
const desiredByMemberId = new Map(
  plan.matchedLinks.map((link) => [
    link.ghostMemberId,
    desired.find((d) => d.profileId === link.profileId) as DesiredMember,
  ]),
);
const alreadyUpdating = new Set(plan.toUpdate.map((u) => u.id));
const labelOnly = [...needsLabel]
  .filter((id) => !alreadyUpdating.has(id) && desiredByMemberId.has(id))
  .map((id) => ({ id, desired: desiredByMemberId.get(id) as DesiredMember }));
if (labelOnly.length > 0) {
  console.log(
    `  Labelling ${labelOnly.length} adopted member(s) that matched by email but carried no label.`,
  );
}

await pool([...plan.toUpdate, ...labelOnly], (u) => updateMember(u.id, u.desired));
await pool(plan.toDelete, (id) => deleteMember(id));

if (links.length > 0) {
  const batch = db.batch();
  for (const link of links) {
    batch.update(db.collection("profiles").doc(String(link.profileId)), {
      ghostMemberId: link.ghostMemberId,
    });
  }
  await batch.commit();
}

console.log(
  `Ghost reconcile done: created ${created.length}, updated ${plan.toUpdate.length}, deleted ${plan.toDelete.length}, linked ${links.length} profile(s). Let the staging API cold-start (or redeploy) so it re-indexes the testers' emails.`,
);
process.exit(0);
