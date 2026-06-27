import { describe, expect, it } from "vitest";
import { buildIndex, recordTokens, substringMatch } from "./index-build.js";
import type { NameRecord, SearchConfig } from "./types.js";

const RECORDS: NameRecord[] = [
  { id: 1, firstName: "William", lastName: "Smyth", canonicalName: "William Smyth '84" },
  {
    id: 2,
    firstName: "Thomas",
    lastName: "Williamson",
    mugName: "Hilbert Space Pilot",
    canonicalName: "Thomas Williamson '90",
  },
  {
    id: 3,
    firstName: "Robert",
    middleName: "James",
    lastName: "Smith-Jones",
    canonicalName: "Robert Smith-Jones '77",
  },
  { id: 4, firstName: "José", lastName: "García", canonicalName: "José García '02" },
];

const CONFIG: SearchConfig = { phonetic: "double-metaphone", nicknames: true };
const ids = (set: Set<number> | null) => [...(set ?? new Set<number>())].sort((a, b) => a - b);

describe("recordTokens", () => {
  it("collects distinct folded tokens across all name fields, dropping the year", () => {
    expect(recordTokens(RECORDS[0] as NameRecord).sort()).toEqual(["smyth", "william"]);
    expect(recordTokens(RECORDS[1] as NameRecord)).toEqual(
      expect.arrayContaining(["hilbert", "space", "pilot", "williamson", "thomas"]),
    );
  });
});

describe("buildIndex search", () => {
  const index = buildIndex(RECORDS, CONFIG);

  it("returns null for an empty query (no filter)", () => {
    expect(index.search("")).toBeNull();
    expect(index.search("   ")).toBeNull();
  });

  it("matches a common nickname bidirectionally (D123): 'bill' → William", () => {
    expect(ids(index.search("bill"))).toContain(1);
  });

  it("matches a phonetic sound-alike (D35): 'smith' → Smyth", () => {
    expect(ids(index.search("smith"))).toContain(1);
  });

  it("matches a hyphenated surname by either part", () => {
    expect(ids(index.search("jones"))).toEqual([3]);
  });

  it("finds a multi-word mug name by any of its words", () => {
    expect(ids(index.search("hilbert"))).toEqual([2]);
    expect(ids(index.search("pilot"))).toEqual([2]);
  });

  it("ANDs across query tokens — both must match the same brother", () => {
    expect(ids(index.search("hilbert pilot"))).toEqual([2]);
    expect(ids(index.search("hilbert jones"))).toEqual([]); // no brother has both
  });

  it("folds diacritics so 'garcia' finds 'García'", () => {
    expect(ids(index.search("garcia"))).toEqual([4]);
  });

  it("returns an empty set (not null) when a real query matches no one", () => {
    expect(index.search("zzzznobody")).toEqual(new Set());
  });

  it("still matches exactly with phonetics off (Fuse typo tolerance remains)", () => {
    const noPhon = buildIndex(RECORDS, { phonetic: "none", nicknames: true });
    // 'smyth' still finds Smyth (#1) exactly and Smith-Jones (#3) as a 1-edit typo.
    expect(ids(noPhon.search("smyth"))).toContain(1);
  });

  it("phonetics only adds recall — it never drops a brother the others matched", () => {
    const on = buildIndex(RECORDS, { phonetic: "beider-morse", nicknames: true });
    const off = buildIndex(RECORDS, { phonetic: "none", nicknames: true });
    for (const q of ["smith", "garcia", "bill", "williamson"]) {
      const offIds = ids(off.search(q));
      const onIds = new Set(ids(on.search(q)));
      for (const id of offIds) {
        expect(onIds.has(id)).toBe(true);
      }
    }
  });
});

describe("searchDetailed — matched tokens for highlighting", () => {
  const index = buildIndex(RECORDS, CONFIG);

  it("returns null for an empty query", () => {
    expect(index.searchDetailed("")).toBeNull();
  });

  it("reports the brother's own token that matched a phonetic query", () => {
    // 'smith' matched Smyth (#1) phonetically — the matched token is 'smyth'.
    const detail = index.searchDetailed("smith");
    expect(detail?.tokens.get(1)).toEqual(new Set(["smyth"]));
  });

  it("reports the matched token for a nickname query (D123)", () => {
    // 'bill' matched William (#1) via the nickname group — token 'william'.
    expect(index.searchDetailed("bill")?.tokens.get(1)).toContain("william");
  });

  it("reports a match that came from a non-name-column field (mug name)", () => {
    // 'pilot' matched #2 only via the mug name 'Hilbert Space Pilot'.
    const detail = index.searchDetailed("pilot");
    expect(detail?.ids).toEqual(new Set([2]));
    expect(detail?.tokens.get(2)).toEqual(new Set(["pilot"]));
  });

  it("ids agree with search()", () => {
    for (const q of ["smith", "bill", "jones", "garcia", "hilbert pilot"]) {
      expect(index.searchDetailed(q)?.ids).toEqual(index.search(q));
    }
  });
});

describe("substringMatch (main-thread fallback)", () => {
  it("matches substrings of name tokens, ANDed across query words", () => {
    expect(ids(substringMatch(RECORDS, "will"))).toEqual([1, 2]); // William, Williamson
    expect(ids(substringMatch(RECORDS, "space pilot"))).toEqual([2]);
  });

  it("does NOT do nickname or phonetic matching (that waits for the worker)", () => {
    expect(ids(substringMatch(RECORDS, "bill"))).toEqual([]); // 'bill' is not a substring of 'william'
  });

  it("returns null for an empty query", () => {
    expect(substringMatch(RECORDS, "")).toBeNull();
  });
});
