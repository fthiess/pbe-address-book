import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_KEYS } from "./grid-model.js";
import { parseLens, serializeLens } from "./useColumnLens.js";

/**
 * Pure `cols` codec tests (the hook's stateful behaviour is covered e2e by
 * Playwright). Focus: the pinned-width-only fallback (OFC-100).
 */
describe("parseLens / serializeLens", () => {
  it("round-trips a normal lens (data columns, with a width override)", () => {
    const lens = { order: ["email", "classYear"] as const, widths: { email: 200 } };
    const back = parseLens(
      serializeLens({ order: [...lens.order], widths: lens.widths }),
      "brother",
    );
    expect(back).toEqual({ order: ["email", "classYear"], widths: { email: 200 } });
  });

  it("falls back to the default lens for a pinned-width-only `cols` (OFC-100)", () => {
    // Resizing only the frozen Name column serialises to `name:300`; re-parsing it
    // must restore the default data columns, NOT collapse to the identity block.
    const cols = serializeLens({ order: [], widths: { name: 300 } });
    expect(cols).toBe("name:300");
    expect(parseLens(cols, "brother")).toEqual({ order: [...DEFAULT_DATA_KEYS], widths: {} });
  });

  it("also falls back for an empty `cols` string", () => {
    expect(parseLens("", "brother")).toEqual({ order: [...DEFAULT_DATA_KEYS], widths: {} });
  });

  it("keeps a pinned width when data columns are present", () => {
    const cols = serializeLens({ order: ["email"], widths: { name: 300, email: 200 } });
    expect(parseLens(cols, "brother")).toEqual({
      order: ["email"],
      widths: { name: 300, email: 200 },
    });
  });
});
