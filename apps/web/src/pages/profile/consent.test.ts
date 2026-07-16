import { describe, expect, it } from "vitest";
import { SWITCH_KEYS, activeConsequence, counterfactual, switchCopy } from "./consent.js";

/**
 * The switch copy now lives in the shared help-content registry (Phase 6b / D53);
 * these guard the resolver and the active/counterfactual math, and assert the
 * registry actually carries `whenOn`/`whenOff` for every switch (a drift check).
 */
describe("switch help copy (registry-backed)", () => {
  it("resolves every switch key to non-empty on/off consequences", () => {
    for (const key of Object.values(SWITCH_KEYS)) {
      const copy = switchCopy(key);
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.whenOn.length).toBeGreaterThan(0);
      expect(copy.whenOff.length).toBeGreaterThan(0);
    }
  });

  it("throws on an unknown id or a non-switch entry (no whenOn/whenOff)", () => {
    // A real field entry exists but carries no switch copy — a resolver misuse.
    expect(() => switchCopy("profile.fullLegalName")).toThrow();
    expect(() => switchCopy("nope.not.a.key")).toThrow();
  });

  it("picks the active side inline and the opposite side as the counterfactual", () => {
    const copy = switchCopy(SWITCH_KEYS.shareEmail);
    expect(activeConsequence(copy, true)).toBe(copy.whenOn);
    expect(activeConsequence(copy, false)).toBe(copy.whenOff);
    expect(counterfactual(copy, true)).toBe(copy.whenOff);
    expect(counterfactual(copy, false)).toBe(copy.whenOn);
  });

  it("carries the richer context only where authored (MITAA and Listed)", () => {
    expect(switchCopy(SWITCH_KEYS.allowShareWithMITAA).toggleTip).toBeTruthy();
    expect(switchCopy(SWITCH_KEYS.listed).toggleTip).toBeTruthy();
    expect(switchCopy(SWITCH_KEYS.shareEmail).toggleTip).toBeUndefined();
  });
});
