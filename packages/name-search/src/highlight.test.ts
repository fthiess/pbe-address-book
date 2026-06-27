import { describe, expect, it } from "vitest";
import { highlightRanges } from "./highlight.js";

const slice = (text: string, ranges: { start: number; end: number }[]) =>
  ranges.map((r) => text.slice(r.start, r.end));

describe("highlightRanges (D35)", () => {
  it("marks a substring/prefix hit at the character level (no worker needed)", () => {
    const text = "William Smyth '84";
    expect(slice(text, highlightRanges(text, "will"))).toEqual(["Will"]);
  });

  it("marks the whole word when the worker matched it (nickname): 'bill' → William", () => {
    const text = "William Smyth '84";
    // The worker reports that this brother's "william" token matched the query.
    expect(slice(text, highlightRanges(text, "bill", new Set(["william"])))).toEqual(["William"]);
  });

  it("marks a phonetic match the main thread can't recompute: 'smith' → Smyth", () => {
    const text = "William Smyth '84";
    expect(slice(text, highlightRanges(text, "smith", new Set(["smyth"])))).toEqual(["Smyth"]);
  });

  it("marks a match in another field's display (full name), diacritics and all", () => {
    const text = "Robert Khalíd Smyth Jr.";
    // 'khalid' matched the brother (via the full-name field); fold-compare marks it.
    expect(slice(text, highlightRanges(text, "khalid", new Set(["khalid"])))).toEqual(["Khalíd"]);
  });

  it("does NOT whole-word-mark without a worker match (pre-ready: substring only)", () => {
    // 'bill' is not a substring of 'William', and no matchedTokens were supplied.
    expect(highlightRanges("William Smyth '84", "bill")).toEqual([]);
  });

  it("highlights each matched word of a multi-word query", () => {
    const text = "William Webster '88";
    expect(slice(text, highlightRanges(text, "will webster"))).toEqual(["Will", "Webster"]);
  });

  it("returns no ranges for an empty query", () => {
    expect(highlightRanges("William Smyth '84", "")).toEqual([]);
  });

  it("merges overlapping ranges into one mark", () => {
    const text = "William";
    // 'will' (prefix) and 'william' (full substring) overlap → a single range.
    expect(highlightRanges(text, "will william")).toEqual([{ start: 0, end: 7 }]);
  });
});
