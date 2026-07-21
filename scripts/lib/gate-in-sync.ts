/**
 * The parse-and-compare logic behind `assert:gate-in-sync` (D141/OFC-297).
 *
 * `package.json`'s `verify:gate` and `.github/workflows/ci.yml` enumerate the
 * same gate steps twice — locally as one `&&` chain, in CI as named workflow
 * steps (kept separate for per-step timing and failure attribution, which
 * `ci-timing.mjs` depends on). Nothing structural kept them in sync, and the
 * drift bit for real in 7a-2: `assert:no-session-replay` ran locally but never
 * on the pipeline that gates merges (N125). These functions extract the
 * `npm run <script>` sequence from each side so the guard can assert they are
 * exactly equal, order included — order is semantic (the CSP/bundle/replay
 * asserts must follow `build`).
 *
 * Strictness, precisely: a `verify:gate` segment that isn't a bare
 * `npm run <script>`, an npm-run command carrying extra arguments, a
 * block-scalar `run: |` / `run: >` command, or a workflow yielding zero steps
 * is each an error, not a skip. Non-npm-run workflow commands (checkout,
 * `npm ci`, the Playwright install) are environment setup and deliberately
 * ignored. The workflow scan is whole-file, not scoped to the verify job —
 * safe because an unexpected npm-run step anywhere fails the equality check
 * loudly; the scan errs toward false alarm, never silence.
 */

/** A parse failure — either list's shape has drifted beyond what the guard understands. */
export class GateSyncError extends Error {}

/** A bare `npm run <script>` command, nothing prepended or appended. */
const NPM_RUN_RE = /^npm run (\S+)$/;

/**
 * The ordered `npm run` step names of the local gate, from the `verify:gate`
 * script's `&&` chain. Every segment must be a bare `npm run <script>` — the
 * guard cannot attest equivalence for anything else.
 */
export function parseGateSteps(verifyGateScript: string): string[] {
  return verifyGateScript.split("&&").map((raw) => {
    const segment = raw.trim();
    const name = NPM_RUN_RE.exec(segment)?.[1];
    if (name === undefined) {
      throw new GateSyncError(
        `verify:gate segment "${segment}" is not a bare "npm run <script>" — the guard compares npm-run step names and cannot attest anything else. Wrap the command in a named script, or extend scripts/lib/gate-in-sync.ts.`,
      );
    }
    return name;
  });
}

/**
 * The ordered `npm run` step names of the CI gate, from the workflow's
 * `run:` lines — both the `run:` key on its own line and the `- run:`
 * list-dash shorthand, with one layer of surrounding quotes tolerated.
 * Non-`npm run` commands (checkout, `npm ci`, the Playwright install) are
 * environment setup, not gate steps, and are ignored. Two shapes are errors,
 * not skips: an `npm run` with extra arguments (equivalence unverifiable) and
 * a block-scalar `run: |` / `run: >` (its commands sit on continuation lines
 * this line scan cannot see, so accepting it would silently blind the guard).
 */
export function parseWorkflowSteps(workflowYaml: string): string[] {
  const steps: string[] = [];
  for (const line of workflowYaml.split("\n")) {
    const rawCommand = /^\s*(?:-\s+)?run:\s*(.+?)\s*$/.exec(line)?.[1];
    if (rawCommand === undefined) {
      continue;
    }
    if (/^[|>]/.test(rawCommand)) {
      throw new GateSyncError(
        `ci.yml uses a block-scalar run command ("run: ${rawCommand}") — its lines are invisible to this guard's line scan. Write gate steps as single-line "run: npm run <script>", or extend scripts/lib/gate-in-sync.ts to walk block scalars.`,
      );
    }
    const command = /^(["'])(.*)\1$/.exec(rawCommand)?.[2] ?? rawCommand;
    const name = NPM_RUN_RE.exec(command)?.[1];
    if (name !== undefined) {
      steps.push(name);
    } else if (command.startsWith("npm run ")) {
      throw new GateSyncError(
        `ci.yml run command "${command}" carries more than a bare "npm run <script>" — the guard cannot attest it matches the local step. Move the arguments into the npm script so both sides run the same thing.`,
      );
    }
  }
  if (steps.length === 0) {
    throw new GateSyncError(
      `found no "run: npm run <script>" steps in the workflow — ` +
        `ci.yml's shape has drifted beyond what scripts/lib/gate-in-sync.ts parses.`,
    );
  }
  return steps;
}

/**
 * Null when the two sequences are identical (same steps, same order);
 * otherwise a multi-line explanation naming exactly what drifted.
 */
export function compareStepSequences(gateSteps: string[], ciSteps: string[]): string | null {
  if (gateSteps.length === ciSteps.length && gateSteps.every((step, i) => step === ciSteps[i])) {
    return null;
  }
  const lines: string[] = [];
  const missingFromCi = gateSteps.filter((step) => !ciSteps.includes(step));
  const missingFromGate = ciSteps.filter((step) => !gateSteps.includes(step));
  if (missingFromCi.length > 0) {
    lines.push(
      `in verify:gate but missing from ci.yml — these would silently never gate a merge: ${missingFromCi.join(", ")}`,
    );
  }
  if (missingFromGate.length > 0) {
    lines.push(
      `in ci.yml but missing from verify:gate — these would never run locally: ${missingFromGate.join(", ")}`,
    );
  }
  if (lines.length === 0) {
    lines.push(
      "same steps, different order — order is semantic (the post-build asserts must follow build).",
    );
  }
  lines.push(`  verify:gate: ${gateSteps.join(" → ")}`);
  lines.push(`  ci.yml:      ${ciSteps.join(" → ")}`);
  return lines.join("\n");
}
