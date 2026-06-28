#!/usr/bin/env node
/**
 * CI/CD timing inspector — a per-step duration breakdown for our GitHub Actions
 * workflows, plus a trend view across recent runs so creeping regressions in the
 * pipeline are easy to spot ("Cloud Run deploy: 150 → 163 → 198s") before they
 * become the norm. GitHub already records `started_at`/`completed_at` for every
 * step; this just reads the Actions API (via `gh`) and lays it out.
 *
 * Two modes:
 *   • Single-run (default, or with --run <id>, or --runs 1): every step of the
 *     latest run of each workflow, sorted longest-first, with the job total.
 *   • Trend (--runs N>1): each step's duration lined up across the last N runs,
 *     with the latest flagged when it exceeds the prior runs' median by
 *     --threshold percent — the actual "is this slower than it should be?" check.
 *
 * No dependencies beyond the GitHub CLI (`gh`, authenticated). The repo is
 * inferred from the working directory via gh's {owner}/{repo} placeholders, so
 * this works in any clone. Run via `npm run ci:timing -- [options]`.
 *
 * Examples:
 *   npm run ci:timing                         # latest CI + Deploy staging, by step
 *   npm run ci:timing -- --runs 10            # 10-run trend for both workflows
 *   npm run ci:timing -- --workflow "Deploy staging" --runs 8
 *   npm run ci:timing -- --run 28331215228    # one specific run
 *   npm run ci:timing -- --json --runs 5      # machine-readable
 */
import { execFileSync } from "node:child_process";

/** The project's workflows, inspected by default (override with --workflow). */
const DEFAULT_WORKFLOWS = ["CI", "Deploy staging"];
const DEFAULT_BRANCH = "main";
const DEFAULT_THRESHOLD = 50; // percent over the prior-runs median to flag a step
const MIN_FLAG_SECONDS = 5; // never flag sub-5s wobble as a regression
const NAME_WIDTH = 40; // step-name column width in the table output

const HELP = `ci-timing — per-step GitHub Actions timing + trend

Usage: node scripts/ci-timing.mjs [options]
       npm run ci:timing -- [options]

Options:
  --workflow <name>   Workflow to inspect (repeatable). Default: ${DEFAULT_WORKFLOWS.map((w) => `"${w}"`).join(", ")}
  --runs <N>          Inspect the last N runs. N=1 → per-step breakdown (default);
                      N>1 → trend table across runs.
  --run <id>          Inspect one specific run id (single-run breakdown).
  --branch <name>     Branch filter for run selection. Default: ${DEFAULT_BRANCH}
  --threshold <pct>   In trend mode, flag a step whose latest run exceeds the
                      median of the earlier runs by this percent. Default: ${DEFAULT_THRESHOLD}
  --json              Emit raw JSON instead of formatted tables.
  -h, --help          Show this help.

Requires the GitHub CLI (gh), authenticated. The repo is inferred from the cwd.`;

/** Parse argv into options; throws a friendly Error on bad input. */
function parseArgs(argv) {
  const opts = {
    workflows: [],
    runs: 1,
    runId: null,
    branch: DEFAULT_BRANCH,
    threshold: DEFAULT_THRESHOLD,
    json: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      return value;
    };
    switch (arg) {
      case "-h":
      case "--help":
        opts.help = true;
        break;
      case "--workflow":
        opts.workflows.push(next());
        break;
      case "--runs":
        opts.runs = Number.parseInt(next(), 10);
        if (!Number.isInteger(opts.runs) || opts.runs < 1) {
          throw new Error("--runs must be a positive integer");
        }
        break;
      case "--run":
        opts.runId = next();
        break;
      case "--branch":
        opts.branch = next();
        break;
      case "--threshold":
        opts.threshold = Number.parseFloat(next());
        if (!Number.isFinite(opts.threshold) || opts.threshold < 0) {
          throw new Error("--threshold must be a non-negative number");
        }
        break;
      case "--json":
        opts.json = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (opts.workflows.length === 0) {
    opts.workflows = [...DEFAULT_WORKFLOWS];
  }
  return opts;
}

/** Run `gh` and return stdout; map a missing/unauthenticated CLI to a clear error. */
function gh(args) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error("the GitHub CLI (gh) is not installed or not on PATH.");
    }
    const detail = (err.stderr || err.stdout || err.message || "").toString().trim();
    throw new Error(`gh ${args.join(" ")}\n  ${detail}`);
  }
}

/** `gh api` against the current repo, parsed as JSON. */
function ghApi(path) {
  return JSON.parse(gh(["api", `repos/{owner}/{repo}/${path}`, "--cache", "60s"]));
}

/** Whole seconds between two ISO timestamps, or null if either is absent (skipped/running). */
function durationSeconds(startedAt, completedAt) {
  if (!startedAt || !completedAt) {
    return null;
  }
  return Math.max(0, Math.round((Date.parse(completedAt) - Date.parse(startedAt)) / 1000));
}

/** The most recent run ids for a workflow on a branch (newest first). */
function recentRuns(workflow, branch, limit) {
  const out = gh([
    "run",
    "list",
    "--workflow",
    workflow,
    "--branch",
    branch,
    "--limit",
    String(limit),
    "--json",
    "databaseId,createdAt,conclusion,status,displayTitle",
  ]);
  return JSON.parse(out);
}

/**
 * Flatten one run's jobs into an ordered list of timed steps. With a single job
 * (our case) the step name is the key; with several, the job name is prefixed.
 * Repeated names within a run are disambiguated with a #n suffix so they don't
 * collide in the trend table.
 */
function runSteps(runId) {
  const { jobs } = ghApi(`actions/runs/${runId}/jobs?per_page=100`);
  const multiJob = jobs.length > 1;
  const steps = [];
  const seen = new Map();
  for (const job of jobs) {
    for (const step of job.steps ?? []) {
      let name = multiJob ? `${job.name}: ${step.name}` : step.name;
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      if (count > 1) {
        name = `${name} #${count}`;
      }
      steps.push({
        name,
        seconds: durationSeconds(step.started_at, step.completed_at),
        conclusion: step.conclusion,
      });
    }
  }
  return steps;
}

/** Sum of step seconds (nulls treated as 0). */
function totalSeconds(steps) {
  return steps.reduce((sum, step) => sum + (step.seconds ?? 0), 0);
}

/** "123s" or "—" for an unmeasured (skipped/running) step. */
function fmt(seconds) {
  return seconds === null || seconds === undefined ? "—" : `${seconds}s`;
}

/** Local "YYYY-MM-DD HH:MM" for a run's createdAt. */
function fmtWhen(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Truncate/pad a label to a fixed width for column alignment. */
function pad(label, width) {
  if (label.length > width) {
    return `${label.slice(0, width - 1)}…`;
  }
  return label.padEnd(width);
}

/** The median of a numeric array (0 for an empty array). */
function median(values) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Single-run breakdown: steps longest-first, with the run header and job total. */
function printBreakdown(workflow, run, steps) {
  const status = run.conclusion ?? run.status ?? "?";
  console.log(
    `\n[ci-timing] ${workflow} — run ${run.databaseId} (${status}, "${run.displayTitle}", ${fmtWhen(run.createdAt)})`,
  );
  console.log(`  total: ${totalSeconds(steps)}s across ${steps.length} steps`);
  const ordered = [...steps].sort((a, b) => (b.seconds ?? 0) - (a.seconds ?? 0));
  for (const step of ordered) {
    const flag = step.conclusion && step.conclusion !== "success" ? `  (${step.conclusion})` : "";
    console.log(`  ${fmt(step.seconds).padStart(6)}  ${step.name}${flag}`);
  }
}

/**
 * Trend table: rows are steps (ordered by the latest run), columns are the runs
 * oldest → newest, then the prior-runs median and the latest run's delta vs that
 * median. A step over --threshold (and at least MIN_FLAG_SECONDS slower) is ⚠'d.
 */
function printTrend(workflow, runs, perRunSteps, threshold) {
  // runs/perRunSteps arrive newest-first; show oldest → newest.
  const ordered = [...runs].reverse();
  const orderedSteps = [...perRunSteps].reverse();
  const latest = orderedSteps[orderedSteps.length - 1] ?? [];

  // Step order = latest run's order, then any names only seen in earlier runs.
  const names = [];
  const seen = new Set();
  for (const step of latest) {
    names.push(step.name);
    seen.add(step.name);
  }
  for (const stepList of orderedSteps) {
    for (const step of stepList) {
      if (!seen.has(step.name)) {
        names.push(step.name);
        seen.add(step.name);
      }
    }
  }

  // name → [seconds per run, oldest → newest] (null when the step is absent).
  const byName = new Map(names.map((name) => [name, []]));
  for (const stepList of orderedSteps) {
    const lookup = new Map(stepList.map((step) => [step.name, step.seconds]));
    for (const name of names) {
      byName.get(name).push(lookup.has(name) ? lookup.get(name) : null);
    }
  }

  const runLabels = ordered.map((_, i) => `r${i + 1}`);
  console.log(`\n[ci-timing] ${workflow} — last ${ordered.length} runs (oldest → newest)`);
  console.log(
    ordered
      .map(
        (run, i) =>
          `  ${runLabels[i]} = run ${run.databaseId} (${run.conclusion ?? run.status}, ${fmtWhen(run.createdAt)})`,
      )
      .join("\n"),
  );

  const header = `  ${pad("step", NAME_WIDTH)} ${runLabels.map((l) => l.padStart(6)).join("")} ${"median".padStart(7)} ${"Δlatest".padStart(9)}`;
  console.log(`\n${header}`);
  console.log(`  ${"-".repeat(header.length - 2)}`);

  for (const name of names) {
    const series = byName.get(name);
    const cells = series.map((s) => fmt(s).padStart(6)).join("");
    const known = series.filter((s) => s !== null);
    const latestVal = series[series.length - 1];
    const prior = series.slice(0, -1).filter((s) => s !== null);
    const med = median(prior.length ? prior : known);
    let delta = "";
    let warn = "";
    if (latestVal !== null && prior.length > 0 && med > 0) {
      const pct = Math.round(((latestVal - med) / med) * 100);
      delta = `${pct >= 0 ? "+" : ""}${pct}%`;
      if (pct >= threshold && latestVal - med >= MIN_FLAG_SECONDS) {
        warn = "  ⚠";
      }
    }
    console.log(
      `  ${pad(name, NAME_WIDTH)} ${cells} ${fmt(Math.round(med)).padStart(7)} ${delta.padStart(9)}${warn}`,
    );
  }

  // Totals row.
  const totals = orderedSteps.map((steps) => totalSeconds(steps));
  const totalCells = totals.map((t) => `${t}s`.padStart(6)).join("");
  const totalMed = median(totals.slice(0, -1).length ? totals.slice(0, -1) : totals);
  const totalPct =
    totals.length > 1 && totalMed > 0
      ? `${totals[totals.length - 1] - totalMed >= 0 ? "+" : ""}${Math.round(((totals[totals.length - 1] - totalMed) / totalMed) * 100)}%`
      : "";
  console.log(`  ${"-".repeat(header.length - 2)}`);
  console.log(
    `  ${pad("TOTAL", NAME_WIDTH)} ${totalCells} ${`${Math.round(totalMed)}s`.padStart(7)} ${totalPct.padStart(9)}`,
  );
  console.log(
    `\n  median = median of the EARLIER runs (the Δlatest baseline); Δlatest = latest vs that median;\n  ⚠ = latest is ≥${threshold}% and ≥${MIN_FLAG_SECONDS}s slower than that baseline.`,
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(HELP);
    return;
  }

  // A specific run id: one breakdown, workflow name resolved from the run.
  if (opts.runId) {
    const run = ghApi(`actions/runs/${opts.runId}`);
    const meta = {
      databaseId: run.id,
      createdAt: run.created_at,
      conclusion: run.conclusion,
      status: run.status,
      displayTitle: run.display_title,
    };
    const steps = runSteps(opts.runId);
    if (opts.json) {
      console.log(JSON.stringify({ workflow: run.name, run: meta, steps }, null, 2));
    } else {
      printBreakdown(run.name, meta, steps);
    }
    return;
  }

  const report = [];
  for (const workflow of opts.workflows) {
    const runs = recentRuns(workflow, opts.branch, opts.runs);
    if (runs.length === 0) {
      console.error(`[ci-timing] no runs found for "${workflow}" on ${opts.branch}.`);
      continue;
    }
    const perRunSteps = runs.map((run) => runSteps(run.databaseId));
    report.push({ workflow, runs, perRunSteps });
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  for (const { workflow, runs, perRunSteps } of report) {
    if (opts.runs === 1) {
      printBreakdown(workflow, runs[0], perRunSteps[0]);
    } else {
      printTrend(workflow, runs, perRunSteps, opts.threshold);
    }
  }
}

main().catch((err) => {
  console.error(`[ci-timing] FAIL: ${err.message}`);
  process.exit(1);
});
