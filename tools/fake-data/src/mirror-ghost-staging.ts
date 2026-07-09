/**
 * Mirror the freshly-seeded fake STAGING profiles into ghost-staging as real Ghost
 * members, so the Book→Ghost write path (Phase 5b-1) can be exercised end-to-end
 * against a real Ghost (D72 — ghost-staging only, never production).
 *
 * It is a **delta reconcile**, not a load: it brings ghost-staging's seed-owned
 * members into correspondence with the current fake profiles (create missing,
 * update drifted, delete orphans), then writes each member's real `ghostMemberId`
 * back into its Firestore profile. Re-running it is therefore the "reset" after a
 * testing session mutated Ghost, and it only does work proportional to what
 * changed — the one-time cost is the initial ~1k creates. The reconcile is pure
 * (`ghost-reconcile.ts`); this file is its I/O shell.
 *
 * SAFETY: it only ever lists / updates / **deletes** Ghost members whose email is a
 * fake `@example.test` address — the fake-data domain (generate.ts). Real accounts —
 * the tester-linked profile (`link-staging-tester.ts`), your own, the linter's — have
 * real emails and are never touched. This domain scope (rather than a label) also
 * catches members the real write path created during testing, so the reset actually
 * cleans them up rather than orphaning them.
 *
 * Guarded like the other staging tools: refuses unless the project id ends
 * `-staging` and refuses if pointed at the emulator.
 *
 * Usage (after `seed:staging`; env carries the Ghost Admin config):
 *   GOOGLE_CLOUD_PROJECT=pbe-book-staging \
 *   GHOST_ADMIN_API_URL=https://staging.pbe400.org/ghost/api/admin \
 *   GHOST_ADMIN_API_KEY=<id>:<secret> GHOST_NEWSLETTER_ID=<id> \
 *   npm run mirror:ghost-staging --workspace tools/fake-data [-- --dry-run]
 */
import { type Profile, formatCanonicalName, normalizeEmail } from "@pbe/shared";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SignJWT } from "jose";
import { type DesiredMember, type ExistingMember, planReconcile } from "./ghost-reconcile.js";

/**
 * Fake profiles use this email domain (generate.ts). It is the mirror's scope on
 * BOTH sides: the desired set (staging profiles with such an email) and the managed
 * Ghost members it may create/update/**delete**. Real accounts — the operator's, the
 * linter's, the tester-linked profile — have real emails and are never touched.
 *
 * Scoping on the email domain rather than a `book-seed` label is deliberate: members
 * the real write path creates during testing (a de-brother reversal, a future
 * new-brother create) carry NO test-only label, so a label-scoped reconcile could
 * never see or clean them up — they'd orphan on every reset. The email domain
 * catches them.
 */
const FAKE_EMAIL_SUFFIX = "@example.test";
/** Bound concurrent Ghost calls so the first-run create burst can't overwhelm ghost-staging. */
const CONCURRENCY = 8;

function printHelp(): void {
  console.log(
    [
      "mirror:ghost-staging — delta-reconcile ghost-staging's seed members to the",
      "                       seeded fake profiles, for Book→Ghost write-path UAT (D72).",
      "",
      "Usage:",
      "  GOOGLE_CLOUD_PROJECT=<project>-staging GHOST_ADMIN_API_URL=… \\",
      "  GHOST_ADMIN_API_KEY=<id>:<secret> GHOST_NEWSLETTER_ID=… \\",
      "    npm run mirror:ghost-staging --workspace tools/fake-data [-- --dry-run]",
      "",
      "Options:",
      "  --dry-run   Report the create/update/delete plan; make NO Ghost or Firestore changes.",
      "  --help,-h   Show this help and exit.",
      "",
      "Only ever touches Ghost members with @example.test emails (fake data); never real accounts.",
    ].join("\n"),
  );
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
const DRY_RUN = args.includes("--dry-run");

const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT;
const apiUrl = process.env.GHOST_ADMIN_API_URL?.replace(/\/$/, "");
const adminKey = process.env.GHOST_ADMIN_API_KEY;
const newsletterId = process.env.GHOST_NEWSLETTER_ID;

if (!projectId) {
  fail("set GOOGLE_CLOUD_PROJECT to the staging project id.");
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  fail("FIRESTORE_EMULATOR_HOST is set (that targets the emulator).");
}
if (!projectId.endsWith("-staging")) {
  fail(`project "${projectId}" does not end with "-staging"; this tool only writes staging (D72).`);
}
if (!apiUrl || !adminKey || !newsletterId) {
  fail("set GHOST_ADMIN_API_URL, GHOST_ADMIN_API_KEY, and GHOST_NEWSLETTER_ID.");
}

function fail(message: string): never {
  console.error(`Refusing: ${message}`);
  process.exit(1);
}

// --- Ghost Admin client (paginating) ----------------------------------------

const [keyId, keySecret] = adminKey.split(":");
if (!keyId || !keySecret) {
  fail("GHOST_ADMIN_API_KEY must be `{id}:{secret}`.");
}
const secretBytes = Buffer.from(keySecret, "hex");

/**
 * Mint a short-lived Ghost Admin JWT (HS256 over the hex secret, `kid`=key id,
 * `aud=/admin/`). Signed via `jose` (the same library the app's `GhostAdminLifecycle`
 * uses) rather than a hand-rolled `crypto.createHmac`, keeping one JWT path and
 * avoiding the misfire where a static analyzer reads "secret → createHmac" as
 * insecure password hashing (it is neither — this is standard HS256 signing).
 */
async function adminToken(): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256", kid: keyId })
    .setIssuedAt()
    .setExpirationTime("5m")
    .setAudience("/admin/")
    .sign(secretBytes);
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
    throw new Error(`Ghost ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : undefined;
}

function newsletters(subscribed: boolean): { id: string }[] {
  return subscribed ? [{ id: newsletterId as string }] : [];
}

/**
 * List every managed member — those with a fake `@example.test` email — across all
 * pages. Includes members the real write path created during testing (they carry no
 * label), so the reconcile can clean them up as orphans. Real accounts are skipped
 * by the email-domain filter.
 */
async function listManagedMembers(): Promise<ExistingMember[]> {
  const out: ExistingMember[] = [];
  let page = 1;
  for (;;) {
    const body = (await ghost("GET", `/members/?limit=100&page=${page}`)) as {
      members?: { id: string; email: string; name?: string; subscribed?: boolean }[];
      meta?: { pagination?: { pages?: number } };
    };
    for (const m of body.members ?? []) {
      if (m.email?.toLowerCase().endsWith(FAKE_EMAIL_SUFFIX)) {
        out.push({
          id: m.id,
          email: m.email,
          name: m.name ?? "",
          subscribed: m.subscribed === true,
        });
      }
    }
    const pages = body.meta?.pagination?.pages ?? 1;
    if (page >= pages) {
      break;
    }
    page += 1;
  }
  return out;
}

async function createMember(m: DesiredMember): Promise<string> {
  const body = (await ghost("POST", "/members/?send_email=false", {
    members: [{ email: m.email, name: m.name, newsletters: newsletters(m.subscribed) }],
  })) as { members?: { id?: string }[] };
  const id = body.members?.[0]?.id;
  if (!id) {
    throw new Error(`Ghost create for ${m.email} returned no id`);
  }
  return id;
}

async function updateMember(id: string, m: DesiredMember): Promise<void> {
  await ghost("PUT", `/members/${encodeURIComponent(id)}/`, {
    members: [{ name: m.name, newsletters: newsletters(m.subscribed) }],
  });
}

async function deleteMember(id: string): Promise<void> {
  await ghost("DELETE", `/members/${encodeURIComponent(id)}/`);
}

/** Run `worker` over `items` with a bounded concurrency; collect results in order. */
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

// --- Reconcile --------------------------------------------------------------

initializeApp({ projectId });
const db = getFirestore();

const snapshot = await db.collection("profiles").get();
const desired: DesiredMember[] = [];
for (const doc of snapshot.docs) {
  const p = doc.data() as Profile;
  // Manage only fake-email profiles: never the tester-linked real email, never a
  // deceased/no-email record (which has no Ghost member and skips the push anyway).
  if (typeof p.email !== "string" || !normalizeEmail(p.email).endsWith(FAKE_EMAIL_SUFFIX)) {
    continue;
  }
  desired.push({
    profileId: p.id,
    email: p.email,
    name: formatCanonicalName(p, false),
    subscribed: p.allowNewsletterEmail === true,
  });
}

const existing = await listManagedMembers();
const plan = planReconcile(desired, existing);

console.log(
  `Ghost mirror plan for ${projectId}: ${desired.length} managed profiles; ${existing.length} existing @example.test members → create ${plan.toCreate.length}, update ${plan.toUpdate.length}, delete ${plan.toDelete.length}.`,
);

if (DRY_RUN) {
  console.log("[dry-run] No Ghost or Firestore changes were made.");
  process.exit(0);
}

const links: { profileId: number; ghostMemberId: string }[] = [...plan.matchedLinks];

const created = await pool(plan.toCreate, async (m) => {
  const id = await createMember(m);
  return { profileId: m.profileId, ghostMemberId: id };
});
links.push(...created);
await pool(plan.toUpdate, (u) => updateMember(u.id, u.desired));
await pool(plan.toDelete, (id) => deleteMember(id));

// Write the real ids back into Firestore (chunked; batch cap is 500).
for (let i = 0; i < links.length; i += 400) {
  const batch = db.batch();
  for (const link of links.slice(i, i + 400)) {
    batch.update(db.collection("profiles").doc(String(link.profileId)), {
      ghostMemberId: link.ghostMemberId,
    });
  }
  await batch.commit();
}

console.log(
  `Ghost mirror done: created ${created.length}, updated ${plan.toUpdate.length}, deleted ${plan.toDelete.length}, linked ${links.length} profiles → real ghostMemberId. Let the staging API cold-start (or redeploy) so it hydrates the ids.`,
);
process.exit(0);
