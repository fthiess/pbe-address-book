/**
 * D141's drift guard: `verify:gate` and `ci.yml` must list the same steps.
 *
 * The two gate lists are hand-maintained on purpose — CI keeps per-step naming
 * so failures attribute cleanly and `ci-timing.mjs` can trend per-step
 * durations — but that split let `assert:no-session-replay` run locally for a
 * while without ever gating a merge (N125/OFC-297). This assertion fails
 * either pipeline the moment the lists disagree: a step present on one side
 * only, an extra step, or a reorder.
 *
 * The guard closes its own bootstrap hole by being a step in *both* lists:
 * remove it from ci.yml and the local gate fails; remove it from verify:gate
 * and CI fails. Only deleting it from both at once escapes, and that is a
 * visible two-file diff, not silent drift.
 *
 * Run via `npm run assert:gate-in-sync` (first step of the gate — it needs no
 * build). Logic and unit tests live in scripts/lib/gate-in-sync.ts.
 */
import { readFileSync } from "node:fs";
import { exit } from "node:process";

import {
  GateSyncError,
  compareStepSequences,
  parseGateSteps,
  parseWorkflowSteps,
} from "./lib/gate-in-sync.js";

const WORKFLOW_PATH = ".github/workflows/ci.yml";

function fail(message: string): never {
  console.error(`\n[D141] FAIL: ${message}\n`);
  exit(1);
}

let verifyGateScript: unknown;
let workflowYaml: string;
try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
    scripts?: Record<string, string>;
  };
  verifyGateScript = pkg.scripts?.["verify:gate"];
  workflowYaml = readFileSync(WORKFLOW_PATH, "utf8");
} catch (err) {
  fail(`could not read the gate lists: ${err instanceof Error ? err.message : String(err)}`);
}
if (typeof verifyGateScript !== "string") {
  fail(`package.json has no "verify:gate" script — the local gate list is gone.`);
}

try {
  const gateSteps = parseGateSteps(verifyGateScript);
  const ciSteps = parseWorkflowSteps(workflowYaml);
  const drift = compareStepSequences(gateSteps, ciSteps);
  if (drift !== null) {
    fail(
      `verify:gate (package.json) and ${WORKFLOW_PATH} disagree.\n` +
        `A step added to one list must be added to the other (DECISIONS D141, OFC-297).\n${drift}`,
    );
  }
  console.log(
    `[D141] OK: verify:gate and ${WORKFLOW_PATH} agree on the same ${gateSteps.length} steps, in the same order.`,
  );
} catch (err) {
  if (err instanceof GateSyncError) {
    fail(err.message);
  }
  throw err;
}
