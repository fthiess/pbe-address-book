#!/usr/bin/env tsx
/**
 * ghost-seed — the Ghost pull-and-seed (OFC-340 / D183): link every stored
 * profile to its Ghost member by writing `ghostMemberId`, and carry over the two
 * things only Ghost knows — the member note (→ `adminNote`) and the real
 * newsletter-subscription state (→ `allowNewsletterEmail`).
 *
 * WHY. The genesis load (D180) wrote no `ghostMemberId`. Until every brother who
 * has a Ghost member is linked to it, (a) a name or newsletter edit in Book never
 * reaches Ghost, (b) every Ghost opt-out reads as unresolvable newsletter drift,
 * because the load stamped a placeholder `true` on everyone, and (c) a brother who
 * changes his PRIMARY EMAIL gets a second Ghost member minted at the new address
 * and is locked out, because sign-in still carries the old one (OFC-451). The
 * rules for who is linked to what, and what a link writes, are in
 * `ghost-seed-plan.ts`; the write order and its guarantees in
 * `ghost-seed-executor.ts`.
 *
 * TWO STEPS, ON PURPOSE (Forrest's call).
 *   --plan   Reads live profiles and live Ghost, writes a plan file, changes
 *            nothing. The plan file is the thing a human reviews.
 *   --apply  Carries out exactly the reviewed plan file — it does not re-plan.
 *            Each Book write is conditional on the profile's `updateTime` as the
 *            plan saw it, so a record edited since is skipped and reported.
 *            Re-run --plan to pick those up; the tool is idempotent.
 *
 * ⚠ IT WRITES TO GHOST AS WELL AS BOOK. A brother whose only Ghost member sits at
 * his ALTERNATE address has that member's email moved to his primary (so the
 * newsletter follows the Book primary). The tool never deletes a Ghost member:
 * second members and unaccounted-for members are listed for a human.
 *
 * ⚠ INVISIBLE UNTIL A COLD START, AND EDITS CONFLICT UNTIL THEN — the same model
 * as `backfill-full-name.ts` (D181), which see. Run --apply when Book is quiet,
 * then IMMEDIATELY force a new revision (infra/README.md "Force a cold start").
 *
 * ⚠ THE PLAN FILE AND THE RUN ARTIFACT ARE REAL MEMBER PII (emails, notes). They
 * go to `restore-artifacts/`, which is gitignored; this repo is public.
 *
 * UNDO. --apply writes `ghost-seed-run-<timestamp>.json` BEFORE the first write,
 * holding every intended action with the values it replaces, and rewrites it with
 * the outcome. Reverting a link is: delete `ghostMemberId` (and an `adminNote` the
 * run set), restore the recorded prior consent, and move a pushed Ghost email back.
 *
 * The Ghost Admin key is read from the GHOST_ADMIN_API_KEY environment variable —
 * never an argument, so it stays out of shell history and process listings.
 *
 * Usage (from the repo root, after `gcloud auth application-default login`):
 *   npm run ghost:seed --workspace apps/api -- --project <id> --ghost-url <admin-api-url> --plan
 *   npm run ghost:seed --workspace apps/api -- --project <id> --ghost-url <admin-api-url> \
 *     --apply restore-artifacts/ghost-seed-plan-<timestamp>.json --confirm <id>
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";
import { initializeApp } from "firebase-admin/app";
import { type Timestamp, getFirestore } from "firebase-admin/firestore";
import { encodeToken } from "../data/profiles.js";
import { GhostAdminHttp, GhostHttpError } from "../identity/ghost-admin-http.js";
import {
  type SeedGhostClient,
  emptySeedOutcome,
  executeGhostSeed,
  seedPlanProblems,
} from "./ghost-seed-executor.js";
import {
  type GhostSeedPlan,
  type SeedAction,
  type SeedMember,
  type SeedProfileSource,
  planGhostSeed,
} from "./ghost-seed-plan.js";

const DEFAULT_OUT_DIR = "restore-artifacts";
const PLAN_KIND = "ghost-seed-plan";
/**
 * The wait budget for each Ghost request. The Admin transport waits indefinitely
 * unless told otherwise (OFC-294); an operator tool paging through the whole
 * member list should fail loudly on a hung connection instead.
 */
const GHOST_TIMEOUT_MS = 30_000;

function printHelp(): void {
  console.log(
    [
      "ghost-seed — link every profile to its Ghost member (ghostMemberId, adminNote, newsletter state).",
      "",
      "Usage:",
      "  npm run ghost:seed --workspace apps/api -- --project <id> --ghost-url <url> --plan",
      "  npm run ghost:seed --workspace apps/api -- --project <id> --ghost-url <url> --apply <plan.json> --confirm <id>",
      "",
      "Options:",
      "  --project <id>      Target GCP project.",
      "  --ghost-url <url>   Ghost Admin API base (GHOST_ADMIN_API_URL in infra/environments/<env>.env).",
      "  --plan              Read Book and Ghost, write a plan file; change nothing.",
      "  --dry-run           Same as --plan.",
      "  --apply <file>      Carry out a reviewed plan file. Writes to Ghost and to Book.",
      "  --confirm <id>      Must equal --project. Required with --apply.",
      "  --out <dir>         Where the plan and run files go (default restore-artifacts/).",
      "  --help, -h          Show this help and exit.",
      "",
      "Environment:",
      "  GHOST_ADMIN_API_KEY The Ghost Admin API key ({id}:{secret}). Never pass it as an argument.",
      "",
      "⚠ The plan and run files hold real member emails — never commit them.",
      "⚠ Force a cold start of the API right after --apply (infra/README.md).",
    ].join("\n"),
  );
}

function fail(message: string): never {
  console.error(`ghost-seed: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  printHelp();
  process.exit(0);
}
const values: Record<string, string> = {};
let planMode = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i] as string;
  if (arg === "--plan" || arg === "--dry-run") {
    planMode = true;
    continue;
  }
  if (!["--project", "--ghost-url", "--apply", "--confirm", "--out"].includes(arg)) {
    fail(`unknown argument ${arg} (see --help).`);
  }
  const value = args[++i];
  if (value === undefined || value.startsWith("--")) {
    fail(`${arg} needs a value.`);
  }
  values[arg.slice(2)] = value;
}
if (!values.project) {
  fail("--project is required.");
}
if (!values["ghost-url"]) {
  fail("--ghost-url is required.");
}
if (planMode === (values.apply !== undefined)) {
  fail("pass exactly one of --plan and --apply <plan.json>.");
}
const adminApiKey = process.env.GHOST_ADMIN_API_KEY;
if (!adminApiKey) {
  fail("GHOST_ADMIN_API_KEY is not set in the environment.");
}
const projectId = values.project as string;
const ghostUrl = (values["ghost-url"] as string).replace(/\/$/u, "");
if (!planMode && values.confirm !== projectId) {
  fail(`refusing to write: pass --confirm ${projectId}.`);
}

const http = new GhostAdminHttp({ apiUrl: ghostUrl, adminApiKey });
const bounded = { timeoutMs: GHOST_TIMEOUT_MS };
const outDir = resolve(values.out ?? DEFAULT_OUT_DIR);
const stamp = new Date().toISOString().replace(/[:.]/gu, "-");

initializeApp({ projectId });
const db = getFirestore();

/** The plan file: the reviewed artifact `--apply` carries out verbatim. */
interface PlanFile extends GhostSeedPlan<string> {
  kind: typeof PLAN_KIND;
  projectId: string;
  ghostUrl: string;
  plannedAt: string;
  profileCount: number;
  memberCount: number;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function listMembers(): Promise<SeedMember[]> {
  const rows = await http.getAll("/members/", "members", { include: "newsletters" }, bounded);
  const members: SeedMember[] = [];
  for (const row of rows) {
    const m = row as Record<string, unknown>;
    if (typeof m.id !== "string" || typeof m.email !== "string") {
      continue;
    }
    members.push({
      id: m.id,
      email: m.email,
      // The `newsletters` relation is authoritative in Ghost v5 (see ghost-reader.ts).
      subscribed: Array.isArray(m.newsletters)
        ? m.newsletters.length > 0
        : typeof m.subscribed === "boolean" && m.subscribed,
      note: str(m.note),
      createdAt: str(m.created_at),
      updatedAt: str(m.updated_at),
    });
  }
  return members;
}

/**
 * The time of one member's latest newsletter subscribe/unsubscribe event, or
 * `undefined` if Ghost records none. Fetched per member (only the handful whose
 * consent the plan overwrites), so the whole append-only event feed is never read.
 * `data.member_id` and `type` are both on Ghost's `/members/events` filter
 * allowlist (OFC-275); verified against the live site 2026-10-01.
 */
async function latestNewsletterEventAt(memberId: string): Promise<string | undefined> {
  const rows = await http.getAll(
    "/members/events/",
    "events",
    { filter: `type:newsletter_event+data.member_id:'${memberId}'` },
    bounded,
  );
  let latest: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const event = row as Record<string, unknown>;
    const data = event.data as Record<string, unknown> | undefined;
    // `data.created_at`, then the event-level `created_at` — the same defensive
    // order as ghost-reader.ts, so a shape shift does not silently drop the event
    // and leave the fallback (`updated_at`, which an unsubscribe does not move).
    const at = str(data?.created_at) || str(event.created_at);
    const ms = Date.parse(at);
    // An unparseable timestamp never wins (mirrors ghost-audit.ts).
    if (!Number.isNaN(ms) && ms > latestMs) {
      latest = at;
      latestMs = ms;
    }
  }
  return latest;
}

function summarize(plan: GhostSeedPlan<string>): void {
  const pushes = plan.seeds.filter((s) => s.ghostEmailPush);
  const consents = plan.seeds.filter((s) => s.consent);
  const notes = plan.seeds.filter((s) => s.adminNote !== undefined);
  console.log(
    [
      `  to link:                     ${plan.seeds.length}`,
      `    …matched on the alternate:  ${pushes.length} (Ghost email moves to the primary)`,
      `    …newsletter state from Ghost: ${consents.length}`,
      `    …note from Ghost:           ${notes.length}`,
      `  already linked:              ${plan.alreadyLinked.length}`,
      `  no Ghost member, has email:  ${plan.ghostlessWithEmail.length}`,
      `  no Ghost member, no email:   ${plan.ghostlessNoEmail}`,
      `  deceased / de-brothered:     ${plan.exempt}`,
      `  leftover Ghost members:      ${plan.leftovers.length}`,
      `  unmatched Ghost members:     ${plan.unmatched.length}`,
      `  conflicts (reported, not resolved): ${plan.conflicts.length}`,
      `  genesis consent stamp:       ${plan.genesisConsentStamp.value} on ${plan.genesisConsentStamp.count} profile(s)`,
    ].join("\n"),
  );
  for (const s of pushes) {
    console.log(`  move  #${s.docId}: ${s.ghostEmailPush?.from} → ${s.ghostEmailPush?.to}`);
  }
  for (const s of consents) {
    console.log(
      `  consent #${s.docId}: → ${s.consent?.allowNewsletterEmail} as of ${s.consent?.changedAt} (${s.consent?.source})`,
    );
  }
  for (const l of plan.leftovers) {
    console.log(
      `  leftover #${l.docId}: ${l.email} (${l.memberId}, ${l.subscribed ? "subscribed" : "unsubscribed"}${l.subscriptionDiffers ? ", DIFFERS from the kept member" : ""}) — ${l.reason}`,
    );
  }
  for (const m of plan.unmatched) {
    console.log(`  unmatched: ${m.email} (${m.id}, created ${m.createdAt.slice(0, 10)})`);
  }
  for (const c of plan.conflicts) {
    // The one conflict kind that still links the profile: only its consent is held back.
    const note =
      c.kind === "book-consent-changed-since-launch"
        ? " — linked; consent left as Book has it"
        : " — not linked";
    console.log(`  conflict #${c.docId}: ${c.kind}${c.memberId ? ` (${c.memberId})` : ""}${note}`);
  }
  for (const id of plan.ghostlessWithEmail) {
    console.log(`  no member #${id}: has an email, no Ghost member at any of his addresses`);
  }
}

if (planMode) {
  const [snapshot, members] = await Promise.all([db.collection("profiles").get(), listMembers()]);
  const docs = snapshot.docs.map((doc) => ({
    id: doc.id,
    data: doc.data() as SeedProfileSource,
    token: encodeToken(doc.updateTime as Timestamp),
  }));
  // Two passes: the first finds whose consent Ghost will overwrite, so only those
  // members' newsletter events are fetched; the second stamps them.
  const first = planGhostSeed(docs, members);
  const consentEventAt = new Map<string, string>();
  for (const seed of first.seeds) {
    if (seed.consent) {
      const at = await latestNewsletterEventAt(seed.ghostMemberId);
      if (at !== undefined) {
        consentEventAt.set(seed.ghostMemberId, at);
      }
    }
  }
  const plan = planGhostSeed(docs, members, consentEventAt);

  console.log(
    `==> ${snapshot.size} profile(s) in ${projectId}, ${members.length} Ghost member(s) at ${ghostUrl}:`,
  );
  summarize(plan);

  await mkdir(outDir, { recursive: true });
  const file = resolve(outDir, `${PLAN_KIND}-${stamp}.json`);
  const planFile: PlanFile = {
    kind: PLAN_KIND,
    projectId,
    ghostUrl,
    plannedAt: new Date().toISOString(),
    profileCount: snapshot.size,
    memberCount: members.length,
    ...plan,
  };
  await writeFile(file, `${JSON.stringify(planFile, null, 2)}\n`);
  console.log(
    `==> Plan written to ${file} — wrote nothing to Book or Ghost. Review it, then --apply.`,
  );
  process.exit(0);
}

// --apply: carry out the reviewed file exactly.
const planPath = resolve(values.apply as string);
let planFile: PlanFile;
try {
  planFile = JSON.parse(await readFile(planPath, "utf8")) as PlanFile;
} catch (error) {
  // npm runs the tool with its working directory at apps/api/, so a relative
  // path is resolved from there — the path --plan printed is the one to pass.
  fail(
    `cannot read the plan file ${planPath} (${error instanceof Error ? error.message : String(error)}). Relative paths resolve from apps/api/.`,
  );
}
if (planFile?.kind !== PLAN_KIND || !Array.isArray(planFile.seeds)) {
  fail(`${planPath} is not a ghost-seed plan file.`);
}
if (planFile.projectId !== projectId || planFile.ghostUrl !== ghostUrl) {
  fail(
    `the plan was made for ${planFile.projectId} / ${planFile.ghostUrl}, not ${projectId} / ${ghostUrl}.`,
  );
}
const seeds: SeedAction<string>[] = planFile.seeds;
console.log(
  `==> Applying ${planPath} (planned ${planFile.plannedAt}): ${seeds.length} link(s), ${seeds.filter((s) => s.ghostEmailPush).length} Ghost email move(s).`,
);
if (seeds.length === 0) {
  console.log("==> Nothing to do.");
  process.exit(0);
}
// Validate the whole file before the first side effect (the executor re-checks).
const problems = seedPlanProblems(seeds);
if (problems.length > 0) {
  fail(`the plan file is malformed; nothing was written:\n  ${problems.join("\n  ")}`);
}

// The undo record goes down BEFORE the first write, as the intended set with the
// values each action replaces; it is rewritten below with the actual outcome.
await mkdir(outDir, { recursive: true });
const artifact = resolve(outDir, `ghost-seed-run-${stamp}.json`);
await writeFile(
  artifact,
  `${JSON.stringify({ projectId, ghostUrl, plan: planPath, status: "in-progress", intended: seeds }, null, 2)}\n`,
);
console.log(`==> Undo record (intended actions) written to ${artifact}`);

const ghost: SeedGhostClient = {
  async memberEmail(memberId) {
    try {
      const body = (await http.request(
        "GET",
        `/members/${encodeURIComponent(memberId)}/`,
        undefined,
        bounded,
      )) as { members?: { email?: unknown }[] } | undefined;
      const email = body?.members?.[0]?.email;
      return typeof email === "string" ? email : null;
    } catch (error) {
      if (error instanceof GhostHttpError && error.status === 404) {
        return null;
      }
      throw error;
    }
  },
  async setMemberEmail(memberId, email) {
    await http.request(
      "PUT",
      `/members/${encodeURIComponent(memberId)}/`,
      { members: [{ email }] },
      bounded,
    );
  },
};
// Filled in as the run proceeds, so a crash part-way still records what happened.
const outcome = emptySeedOutcome();
try {
  await executeGhostSeed(db, ghost, seeds, outcome);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await writeFile(
    artifact,
    `${JSON.stringify(
      {
        projectId,
        ghostUrl,
        plan: planPath,
        status: "crashed",
        error: message,
        intended: seeds,
        ...outcome,
      },
      null,
      2,
    )}\n`,
  );
  fail(`the run died part-way: ${message}. What was done so far is recorded in ${artifact}`);
}

await writeFile(
  artifact,
  `${JSON.stringify(
    {
      projectId,
      ghostUrl,
      plan: planPath,
      status: "done",
      appliedAt: new Date().toISOString(),
      intended: seeds,
      ...outcome,
    },
    null,
    2,
  )}\n`,
);
for (const id of outcome.skipped) {
  console.log(`  skipped #${id}: edited since the plan; left as is (re-run --plan).`);
}
for (const problem of outcome.ghostFailed) {
  console.error(`  GHOST #${problem} — profile not linked.`);
}
for (const problem of outcome.failed) {
  console.error(`  ERROR #${problem}`);
}
console.log(
  `==> Linked ${outcome.written.length} profile(s); moved ${outcome.ghostPushed.length} Ghost email(s); ${outcome.skipped.length} skipped (edited since the plan); ${outcome.ghostFailed.length} Ghost failure(s); ${outcome.failed.length} failed. Outcome recorded in ${artifact}`,
);
console.log(
  "==> NOW force a cold start of pbe-book-api (infra/README.md) — until then the change is invisible and edits to these records get 412.",
);
if (outcome.failed.length > 0 || outcome.ghostFailed.length > 0) {
  process.exit(1);
}
