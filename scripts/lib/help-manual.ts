/**
 * The pure rendering half of the USER-MANUAL §10 generator (N118) — no file I/O,
 * no side effects, so the unit tests import it directly and the CLI
 * (`../generate-help-manual.ts`) can run its `main()` unconditionally.
 *
 * That split is deliberate. The CLI previously guarded `main()` behind an
 * "am I the entry point?" path comparison so the tests could import it; if that
 * comparison ever missed, the script exited 0 having done nothing — meaning
 * `assert:help-manual` would report success without checking anything. A gate
 * check that fails *open* is worse than no check, so the guard is gone.
 */
import type { HelpContent, HelpEntry } from "../../packages/help-content/src/types.js";

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
      `[help-manual] These registry keys match no manual group, so they would be omitted:\n${listed}\nAdd a group for the new key prefix in scripts/lib/help-manual.ts.`,
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
