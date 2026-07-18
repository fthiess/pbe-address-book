#!/usr/bin/env tsx
/**
 * Assembles USER-MANUAL §10 — the per-control help reference — from the help
 * registry, which is the single source for both the in-page help and the manual
 * (D53). The manual promises in §11 that the two "cannot drift apart"; this
 * script plus the `assert:help-manual` gate check is what makes that promise
 * enforceable rather than aspirational (N118).
 *
 * The generated block is written **in place**, between the two marker comments,
 * so the manual stays one reviewable file (Forrest's call at the 6c-2 plan gate).
 *
 *   npm run docs:help            regenerate §10 in place
 *   npm run assert:help-manual   fail if regenerating would change the file
 *
 * It reads the registry's TypeScript source directly (via tsx), so it needs no
 * prior build and can run before `build:libs` in the gate.
 *
 * The pure rendering functions are exported and unit-tested
 * (`generate-help-manual.test.ts`); only the file I/O runs as a CLI.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

import { helpContent } from "../packages/help-content/src/registry.js";
import type { HelpContent, HelpEntry } from "../packages/help-content/src/types.js";

export const MANUAL = "docs/initial-build/USER-MANUAL.md";
export const BEGIN = "<!-- BEGIN GENERATED: help-reference (npm run docs:help) -->";
export const END = "<!-- END GENERATED: help-reference -->";

/**
 * The manual's grouping, derived from the key prefix so the order is mechanical
 * rather than curated. Within a group, entries keep their registry order — the
 * registry is authored in the order the controls appear on the page, which is
 * also the order a reader meets them.
 */
export const GROUPS: ReadonlyArray<{ title: string; match: (key: string) => boolean }> = [
  { title: "Directory", match: (k) => k.startsWith("directory.") },
  {
    title: "Your profile",
    match: (k) =>
      k.startsWith("profile.") &&
      !k.startsWith("profile.privacy.") &&
      !k.startsWith("profile.consent."),
  },
  {
    title: "Privacy and consent switches",
    match: (k) => k.startsWith("profile.privacy.") || k.startsWith("profile.consent."),
  },
  { title: "Administration", match: (k) => k.startsWith("admin.") },
];

/**
 * Render one entry. The field names describe where each string surfaces in the
 * running app, so a reader of the manual can map the reference back to what he
 * sees on the page. A switch's `whenOn`/`whenOff` are the inline consequence of
 * its *current* position; since N103 the `?` carries only the static toggle-tip,
 * never the counterfactual.
 */
export function renderEntry(entry: HelpEntry): string {
  const lines = [`#### ${entry.label}`, ""];
  const field = (name: string, value: string | undefined) => {
    if (value) lines.push(`- **${name}:** ${value}`);
  };

  field("Helper text", entry.helperText);
  field("Placeholder", entry.placeholder);
  field("Shows when on", entry.whenOn);
  field("Shows when off", entry.whenOff);
  field("Behind the “?”", entry.toggleTip);

  return lines.join("\n");
}

/** Render the whole §10 body from a registry. Throws if any key matches no group. */
export function renderReference(content: HelpContent): string {
  const entries = Object.values(content);

  // A key that matches no group would be silently dropped from the manual — the
  // exact drift this script exists to prevent — so fail loudly instead.
  const orphans = entries.filter((e) => !GROUPS.some((g) => g.match(e.key)));
  if (orphans.length > 0) {
    const listed = orphans.map((e) => `  - ${e.key}`).join("\n");
    throw new Error(
      `[help-manual] These registry keys match no manual group, so they would be omitted:\n${listed}\nAdd a group for the new key prefix in scripts/generate-help-manual.ts.`,
    );
  }

  const blocks: string[] = [];
  for (const group of GROUPS) {
    const inGroup = entries.filter((e) => group.match(e.key));
    if (inGroup.length === 0) continue;
    blocks.push(`### ${group.title}`);
    blocks.push(...inGroup.map(renderEntry));
  }

  return blocks.join("\n\n");
}

/**
 * Splice a rendered reference into the manual between the markers. Returns the
 * new file text; throws if the markers are missing or inverted.
 */
export function spliceIntoManual(manual: string, reference: string): string {
  const beginAt = manual.indexOf(BEGIN);
  const endAt = manual.indexOf(END);

  if (beginAt === -1 || endAt === -1 || endAt < beginAt) {
    throw new Error(
      `[help-manual] Could not find the generated-block markers in ${MANUAL}.\n` +
        `Expected, on their own lines:\n  ${BEGIN}\n  ${END}`,
    );
  }

  return `${manual.slice(0, beginAt + BEGIN.length)}\n\n${reference}\n\n${manual.slice(endAt)}`;
}

function main(): void {
  const manual = readFileSync(MANUAL, "utf8");
  const next = spliceIntoManual(manual, renderReference(helpContent));

  if (argv.includes("--check")) {
    if (next !== manual) {
      console.error(
        `\n[help-manual] FAIL: ${MANUAL} §10 is out of step with the help registry.\nRegenerate it and commit the result:\n  npm run docs:help\n`,
      );
      process.exit(1);
    }
    console.log("[help-manual] OK: the manual's §10 reference matches the help registry.");
    return;
  }

  writeFileSync(MANUAL, next);
  console.log(`[help-manual] Wrote the §10 reference into ${MANUAL} from the help registry.`);
}

// Run only as a CLI, so the unit tests can import the pure functions above.
// Compared as resolved filesystem paths rather than URL strings: on Windows the
// two spellings differ (drive letter case, backslashes) even for the same file.
if (argv[1] && fileURLToPath(import.meta.url) === resolve(argv[1])) {
  main();
}
