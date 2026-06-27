import { describe, expect, it } from "vitest";
import { highlightRanges } from "./highlight.js";
import type { SearchConfig } from "./types.js";

const NICK: SearchConfig = { phonetic: "none", nicknames: true };
const PHON: SearchConfig = { phonetic: "double-metaphone", nicknames: false };
const slice = (text: string, ranges: { start: number; end: number }[]) =>
  ranges.map((r) => text.slice(r.start, r.end));

describe("highlightRanges (D35)", () => {
  it("marks a substring/prefix hit at the character level", () => {
    const text = "William Smyth '84";
    const ranges = highlightRanges(text, "will", NICK);
    expect(slice(text, ranges)).toEqual(["Will"]);
  });

  it("marks the whole word for a nickname hit (word-level)", () => {
    const text = "William Smyth '84";
    expect(slice(text, highlightRanges(text, "bill", NICK))).toEqual(["William"]);
  });

  it("folds diacritics and reports the range against the accented original", () => {
    const text = "José García '02";
    // 'garcia' folds to match 'García'; the range must point at the accented word.
    expect(slice(text, highlightRanges(text, "garcia", PHON))).toEqual(["García"]);
  });

  it("marks a near-typo at the word level (Smyth ↔ Smith)", () => {
    const text = "Smyth";
    expect(slice(text, highlightRanges(text, "smith", PHON))).toEqual(["Smyth"]);
  });

  it("highlights each matched word of a multi-word query", () => {
    const text = "William Smyth '84";
    const ranges = highlightRanges(text, "will smyth", NICK);
    expect(slice(text, ranges)).toEqual(["Will", "Smyth"]);
  });

  it("returns no ranges for an empty query or no match", () => {
    expect(highlightRanges("William Smyth '84", "", NICK)).toEqual([]);
    expect(highlightRanges("William Smyth '84", "nobody", PHON)).toEqual([]);
  });

  it("merges overlapping ranges into one mark", () => {
    // 'will' (prefix) and 'william' (nickname/whole) overlap → a single range.
    const text = "William";
    const ranges = highlightRanges(text, "will william", NICK);
    expect(ranges).toEqual([{ start: 0, end: 7 }]);
  });
});
