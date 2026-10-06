import { describe, expect, it } from "vitest";
import { type LiveObject, orphanReason, planSweep } from "./image-sweep-plan.js";

const NOW = new Date("2026-10-06T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const OLD = "2026-09-01T00:00:00.000Z";

const obj = (key: string, created = OLD, generation = "1"): LiveObject => ({
  key,
  generation,
  created,
});

// #5001 shows v2; #5002 has no headshot; #5003 does not exist (moved or deleted).
const pointers = new Map<number, string | null>([
  [5001, "v2"],
  [5002, null],
]);

describe("orphanReason", () => {
  it("is null for a profile's current photo", () => {
    expect(orphanReason("headshots/5001/v2.webp", pointers)).toBeNull();
    expect(orphanReason("thumbnails/5001/v2.webp", pointers)).toBeNull();
  });

  it("flags a superseded version and a photo of a brother with none", () => {
    expect(orphanReason("headshots/5001/v1.webp", pointers)).toBe("not-current");
    expect(orphanReason("headshots/5002/v9.webp", pointers)).toBe("not-current");
  });

  it("flags an object at an id no profile holds — e.g. one left behind by the renumber", () => {
    expect(orphanReason("thumbnails/5003/v2.webp", pointers)).toBe("no-profile");
  });

  it("never judges a key that is not a well-formed image key", () => {
    expect(orphanReason("headshots/5001/notes.txt", pointers)).toBeNull();
  });
});

describe("planSweep", () => {
  it("separates referenced, orphaned, too-new, unrecognized and missing", () => {
    const plan = planSweep(
      [
        obj("headshots/5001/v2.webp"),
        obj("thumbnails/5001/v2.webp"),
        obj("headshots/5001/v1.webp", OLD, "77"),
        obj("headshots/5003/v2.webp"),
        obj("thumbnails/5003/v2.webp", new Date(NOW.getTime() - 5 * 60 * 1000).toISOString()),
        obj("headshots/README"),
      ],
      new Map([...pointers, [5004, "v4"]]),
      NOW,
      HOUR,
    );
    expect(plan.referenced).toBe(2);
    expect(plan.orphans).toEqual([
      { key: "headshots/5001/v1.webp", generation: "77", reason: "not-current" },
      { key: "headshots/5003/v2.webp", generation: "1", reason: "no-profile" },
    ]);
    // Written five minutes ago: an upload may be between its objects and its pointer (D98).
    expect(plan.tooNew).toEqual(["thumbnails/5003/v2.webp"]);
    expect(plan.unrecognized).toEqual(["headshots/README"]);
    expect(plan.missing).toEqual(["headshots/5004/v4.webp", "thumbnails/5004/v4.webp"]);
  });

  it("fails safe: an object with no known age or generation is never planned", () => {
    const plan = planSweep(
      [obj("headshots/5003/a.webp", ""), obj("headshots/5003/b.webp", OLD, "")],
      pointers,
      NOW,
      HOUR,
    );
    expect(plan.orphans).toEqual([]);
    expect(plan.tooNew).toEqual(["headshots/5003/a.webp", "headshots/5003/b.webp"]);
  });

  it("plans nothing for a clean bucket", () => {
    const plan = planSweep(
      [obj("headshots/5001/v2.webp"), obj("thumbnails/5001/v2.webp")],
      pointers,
      NOW,
      HOUR,
    );
    expect(plan.orphans).toEqual([]);
    expect(plan.missing).toEqual([]);
  });
});
