/**
 * Take Book down for maintenance, and bring it back (D118 → D187; OFC-334, OFC-449).
 * Run through `infra/maintenance-begin.sh` / `infra/maintenance-end.sh`, which
 * select the environment from `ENV_FILE` like every other infra script.
 *
 *   begin — record the live release, deploy `firebase.maintenance.json` (only the
 *           static page; every path rewrites to it) tagged with a release message,
 *           then confirm `/` and `/api/health` both serve the page.
 *   end   — re-release the version that was live before `begin`, via the Hosting
 *           API, refusing if a deploy has already ended maintenance. Then confirm
 *           `/` serves Book again.
 *
 * The decisions are pure and unit-tested in `lib/maintenance.ts`; this file only
 * talks to gcloud, the Firebase CLI and the Hosting REST API.
 */
import { execSync, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import {
  type HostingRelease,
  MAINTENANCE_RELEASE_MESSAGE,
  isMaintenancePage,
  newestFirst,
  planBegin,
  planEnd,
  versionId,
} from "./lib/maintenance.js";

const USAGE = `Usage: tsx scripts/maintenance.ts <begin|end> --project <id> [--origin <url>] [--dry-run]

Normally run via infra/maintenance-begin.sh / infra/maintenance-end.sh (ENV_FILE selects
the environment). The Hosting site is the project's default site, looked up through the API.

  --project <id>  GCP/Firebase project (required)
  --origin <url>  Origin probed afterwards (default https://<default site>.web.app)
  --dry-run       Read the release history and say what WOULD happen; change nothing.
  --help          Show this help.`;

const HOSTING_API = "https://firebasehosting.googleapis.com/v1beta1";
const PROBE_ATTEMPTS = 12;
const PROBE_INTERVAL_MS = 5_000;

/** A refusal or failure the operator must read; reported without a stack trace. */
class OperatorError extends Error {}

// Thrown, never `process.exit()` — exiting with a fetch socket still open trips a
// libuv assertion on Windows (exit 127 instead of 1).
function fail(message: string): never {
  throw new OperatorError(message);
}

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: "string" },
    origin: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
// Usage errors happen before any network I/O, so exiting directly is safe here.
const usageError = (message: string): never => {
  console.error(`!! ${message}\n${USAGE}`);
  process.exit(2);
};
const command = positionals[0];
if (command !== "begin" && command !== "end") usageError(`expected "begin" or "end".`);
const project = values.project ?? usageError("--project is required.");
const dryRun = values["dry-run"];
// Both resolved in run(): the site from the API, the origin from the site.
let site = "";
let origin = "";

let cachedToken: string | undefined;
const accessToken = (): string => {
  if (cachedToken) return cachedToken;
  try {
    cachedToken = execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
    return cachedToken;
  } catch {
    return fail("could not get a gcloud access token — run `gcloud auth login` first.");
  }
};

async function hostingApi(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${HOSTING_API}/${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      // User credentials need a quota project for this API.
      "x-goog-user-project": project,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = await response.text();
  if (!response.ok)
    fail(`Hosting API ${init.method ?? "GET"} ${path} → ${response.status}: ${body}`);
  return JSON.parse(body) as unknown;
}

/**
 * The project's DEFAULT Hosting site — the one `firebase deploy --only hosting`
 * targets when the config names no site. Looked up rather than assumed equal to the
 * project id: staging also holds a second site (`pbe-netcheck`), and reading one site
 * while deploying to another would strand Book in maintenance.
 */
const defaultSite = async (): Promise<string> => {
  const body = (await hostingApi(`projects/${project}/sites`)) as {
    sites?: { name: string; type?: string }[];
  };
  const found = body.sites?.find((s) => s.type === "DEFAULT_SITE");
  if (!found) return fail(`project ${project} has no default Hosting site.`);
  return found.name.slice(found.name.lastIndexOf("/") + 1);
};

// ⚠ Assumes the API lists releases newest first (observed; not documented). The
// sort in planBegin/planEnd guards ordering within this page only — which is all the
// decisions read (the newest two).
const liveReleases = async (): Promise<HostingRelease[]> => {
  const body = (await hostingApi(`sites/${site}/channels/live/releases?pageSize=20`)) as {
    releases?: HostingRelease[];
  };
  return body.releases ?? [];
};

/** The SPA shell's mount point (`apps/web/index.html`) — proof the real app is served. */
const SPA_MARKER = '<div id="root">';

/**
 * Poll `path` until it serves the maintenance page (`want: "maintenance"`) or the
 * real app (`want: "app"`, a 2xx carrying the SPA shell — not merely "anything but
 * the maintenance page", which an error page would also be). Hosting's edge takes a
 * moment to switch.
 */
async function waitFor(path: string, want: "maintenance" | "app"): Promise<boolean> {
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${origin}${path}`, { redirect: "follow", cache: "no-store" });
      const body = await response.text();
      const served =
        want === "maintenance"
          ? isMaintenancePage(body)
          : response.ok && !isMaintenancePage(body) && body.includes(SPA_MARKER);
      if (served) return true;
    } catch {
      // A transient network failure is retried like a not-yet-propagated edge.
    }
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS));
  }
  return false;
}

async function begin(): Promise<void> {
  const decision = planBegin(await liveReleases());
  if (!decision.ok) return fail(`refusing to begin maintenance on ${site}: ${decision.reason}`);
  console.log(
    `==> ${site} is serving version ${versionId(decision.liveVersion)} (released ${decision.liveReleasedAt}).`,
  );
  console.log("    maintenance-end.sh will put exactly this version back.");
  const deploy = [
    "npx firebase deploy --only hosting --config firebase.maintenance.json",
    `--project ${project} --message ${MAINTENANCE_RELEASE_MESSAGE} --non-interactive`,
  ].join(" ");
  if (dryRun) {
    console.log(`[dry-run] would run: ${deploy}`);
    console.log("[dry-run] every path would then serve the maintenance page. No changes made.");
    return;
  }

  console.log(`==> Deploying the maintenance page to ${site}`);
  const result = spawnSync(deploy, { stdio: "inherit", shell: true });
  if (result.status !== 0) {
    fail(
      "the maintenance deploy reported failure. Check the live release history (Firebase console → Hosting) " +
        "before assuming either state: a failure after the release step leaves Book IN maintenance.",
    );
  }

  const [newest] = newestFirst(await liveReleases());
  if (newest?.message !== MAINTENANCE_RELEASE_MESSAGE) {
    fail(
      `the newest live release is not the maintenance one (it is ${newest?.type ?? "?"} at ${newest?.releaseTime ?? "?"}, "${newest?.message ?? ""}"). Something deployed on top — most likely a staging merge, which has already put Book back up. Check the site before acting.`,
    );
  }
  for (const path of ["/", "/api/health"]) {
    const ok = await waitFor(path, "maintenance");
    console.log(
      `    ${origin}${path}: ${ok ? "maintenance page ✓" : "NOT the maintenance page ✗"}`,
    );
    if (!ok)
      fail(
        `${origin}${path} is not serving the maintenance page — investigate before relying on it.`,
      );
  }
  console.log("==> Book is DOWN FOR MAINTENANCE. Every path serves the static page.");
  console.log(
    "    Cloud Run is untouched. After any out-of-band Firestore write, force a cold start",
  );
  console.log("    BEFORE maintenance-end.sh (D181), or the first visitors see stale data.");
}

async function end(): Promise<void> {
  const decision = planEnd(await liveReleases());
  if (!decision.ok) return fail(`refusing to end maintenance on ${site}: ${decision.reason}`);
  const restore = versionId(decision.restoreVersion);
  console.log(
    `==> ${site} is in maintenance; the version before it was ${restore} (released ${decision.restoreReleasedAt}).`,
  );
  console.log(
    "    Reminder (D181): if Firestore was written out of band, the forced cold start comes FIRST.",
  );
  if (dryRun) {
    console.log(
      `[dry-run] would re-release version ${restore} to ${site}'s live channel. No changes made.`,
    );
    return;
  }

  // Re-check immediately before writing: a deploy that landed since planEnd read the
  // history has already ended maintenance, and the POST below would roll it back.
  // (A residual window of about one round trip remains; the Hosting API offers no
  // conditional release to close it.)
  const recheck = planEnd(await liveReleases());
  if (!recheck.ok || recheck.restoreVersion !== decision.restoreVersion) {
    return fail(
      `the release history changed while ending maintenance — nothing was changed. ${recheck.ok ? "" : recheck.reason}`,
    );
  }

  console.log(`==> Re-releasing version ${restore}`);
  await hostingApi(
    `sites/${site}/channels/live/releases?versionName=${encodeURIComponent(decision.restoreVersion)}`,
    {
      method: "POST",
      body: JSON.stringify({ message: `book-maintenance-end: restored ${restore}` }),
    },
  );
  const ok = await waitFor("/", "app");
  console.log(`    ${origin}/: ${ok ? "Book ✓" : "NOT serving Book ✗"}`);
  if (!ok)
    fail(
      `${origin}/ is not serving Book (still the maintenance page, or an error) — check the Firebase console's release history.`,
    );
  console.log("==> Book is back online, on the version it was running before maintenance.");
}

try {
  site = await defaultSite();
  origin = (values.origin ?? `https://${site}.web.app`).replace(/\/+$/, "");
  await (command === "begin" ? begin() : end());
} catch (error) {
  if (!(error instanceof OperatorError)) throw error;
  console.error(`!! ${error.message}`);
  process.exitCode = 1;
}
