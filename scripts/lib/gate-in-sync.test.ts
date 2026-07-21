import { describe, expect, it } from "vitest";

import {
  GateSyncError,
  compareStepSequences,
  parseGateSteps,
  parseWorkflowSteps,
} from "./gate-in-sync.js";

describe("parseGateSteps", () => {
  it("extracts the ordered step names from an && chain", () => {
    expect(parseGateSteps("npm run check && npm run build && npm run test")).toEqual([
      "check",
      "build",
      "test",
    ]);
  });

  it("tolerates uneven whitespace around the separators", () => {
    expect(parseGateSteps("npm run check &&  npm run test  ")).toEqual(["check", "test"]);
  });

  it("rejects a segment that is not a bare npm run", () => {
    expect(() => parseGateSteps("npm run check && node scripts/foo.mjs")).toThrow(GateSyncError);
  });

  it("rejects a segment with extra arguments — equivalence would be unverifiable", () => {
    expect(() => parseGateSteps("npm run check && npm run test -- --shard 1/2")).toThrow(
      GateSyncError,
    );
  });
});

describe("parseWorkflowSteps", () => {
  const workflow = `
jobs:
  verify:
    steps:
      - name: Checkout
        uses: actions/checkout@v7
      - name: Install dependencies
        run: npm ci
      - name: Install Playwright browser
        run: npx playwright install --with-deps chromium
      - name: Format + lint (Biome)
        run: npm run check
      - name: Unit tests
        run: npm run test
`;

  it("extracts npm-run steps in order, ignoring setup commands", () => {
    expect(parseWorkflowSteps(workflow)).toEqual(["check", "test"]);
  });

  it("rejects an npm-run step that carries extra arguments", () => {
    expect(() => parseWorkflowSteps("      - run: npm run test -- --grep foo\n")).toThrow(
      GateSyncError,
    );
  });

  it("fails loudly when it finds no npm-run steps at all — the parser must not silently go blind", () => {
    expect(() => parseWorkflowSteps("jobs:\n  verify:\n    steps: []\n")).toThrow(GateSyncError);
  });
});

describe("compareStepSequences", () => {
  it("returns null for identical sequences", () => {
    expect(compareStepSequences(["check", "build"], ["check", "build"])).toBeNull();
  });

  it("names a step missing from CI — the 7a-2 failure mode", () => {
    const drift = compareStepSequences(
      ["check", "assert:no-session-replay", "test"],
      ["check", "test"],
    );
    expect(drift).toContain("missing from ci.yml");
    expect(drift).toContain("assert:no-session-replay");
  });

  it("names a step missing from verify:gate", () => {
    const drift = compareStepSequences(["check"], ["check", "e2e"]);
    expect(drift).toContain("missing from verify:gate");
    expect(drift).toContain("e2e");
  });

  it("flags a reorder even when the step sets match", () => {
    const drift = compareStepSequences(
      ["build", "assert:csp-hashes"],
      ["assert:csp-hashes", "build"],
    );
    expect(drift).toContain("different order");
  });
});
