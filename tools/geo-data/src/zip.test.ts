import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { extractZipEntries, zipEntry } from "./zip.js";

/**
 * Build a ZIP archive in memory. Deliberately hand-rolled rather than produced
 * by a library, because the point is to control the two things the reader gets
 * wrong if it is careless: the compression method, and **an extra-field length
 * on the local header that differs from the central directory's**. Real
 * archives do that routinely (the local header carries an extended-timestamp
 * field the central directory abbreviates), and a reader that computes the data
 * offset from the central directory's number lands inside the padding.
 */
function buildZip(
  entries: ReadonlyArray<{ name: string; body: Buffer; store?: boolean; localExtra?: number }>,
): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const stored = entry.store === true;
    const payload = stored ? entry.body : deflateRawSync(entry.body);
    const localExtra = Buffer.alloc(entry.localExtra ?? 0);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(stored ? 0 : 8, 8); // method
    local.writeUInt32LE(0, 14); // crc — not checked by the reader
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.body.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    locals.push(local, name, localExtra, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(stored ? 0 : 8, 10);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.body.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // central extra length — deliberately 0
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += 30 + name.length + localExtra.length + payload.length;
  }

  const localBlock = Buffer.concat(locals);
  const centralBlock = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBlock.length, 12);
  end.writeUInt32LE(localBlock.length, 16);
  return Buffer.concat([localBlock, centralBlock, end]);
}

describe("extractZipEntries", () => {
  it("inflates a deflated member", () => {
    const body = Buffer.from("GEOID\tINTPTLAT\n02139\t42.36\n".repeat(50), "utf8");
    const entries = extractZipEntries(buildZip([{ name: "2020_Gaz_zcta_national.txt", body }]));
    expect(entries.get("2020_Gaz_zcta_national.txt")?.toString("utf8")).toBe(body.toString("utf8"));
  });

  it("copies a stored member", () => {
    const body = Buffer.from("stored, not deflated", "utf8");
    const entries = extractZipEntries(buildZip([{ name: "US.txt", body, store: true }]));
    expect(entries.get("US.txt")?.toString("utf8")).toBe("stored, not deflated");
  });

  /**
   * ⚠ The trap the reader's own comment names. If the data offset were computed
   * from the central directory's extra-field length (0 here) rather than the
   * local header's (16), it would start 16 bytes early, inside the padding, and
   * inflation would fail or return garbage.
   */
  it("reads the data offset from the local header, not the central directory", () => {
    const body = Buffer.from("the local extra field is longer than the central one", "utf8");
    const entries = extractZipEntries(buildZip([{ name: "US.txt", body, localExtra: 16 }]));
    expect(entries.get("US.txt")?.toString("utf8")).toBe(body.toString("utf8"));
  });

  it("reads several members and skips directory entries", () => {
    const entries = extractZipEntries(
      buildZip([
        { name: "readme.txt", body: Buffer.from("notes", "utf8") },
        { name: "nested/", body: Buffer.alloc(0), store: true },
        { name: "US.txt", body: Buffer.from("data", "utf8") },
      ]),
    );
    expect([...entries.keys()].sort()).toEqual(["US.txt", "readme.txt"]);
  });

  it("rejects something that is not a ZIP", () => {
    expect(() => extractZipEntries(Buffer.from("not a zip at all", "utf8"))).toThrow(
      /not a ZIP archive/,
    );
  });

  it("rejects a member whose inflated size disagrees with the directory", () => {
    const archive = buildZip([
      { name: "US.txt", body: Buffer.from("twenty characters!!!", "utf8") },
    ]);
    // Corrupt the *central* directory's uncompressed size only, so the reader's
    // post-inflation length check is the thing that has to notice.
    const centralAt = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt32LE(999, centralAt + 24);
    expect(() => extractZipEntries(archive)).toThrow(/inflated to 20 bytes, expected 999/);
  });

  it("rejects an unsupported compression method", () => {
    const archive = buildZip([{ name: "US.txt", body: Buffer.from("data", "utf8") }]);
    const centralAt = archive.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    archive.writeUInt16LE(14, centralAt + 10); // LZMA — not supported
    expect(() => extractZipEntries(archive)).toThrow(/unsupported ZIP compression method 14/);
  });
});

describe("zipEntry", () => {
  const entries = extractZipEntries(
    buildZip([
      { name: "readme.txt", body: Buffer.from("notes", "utf8") },
      { name: "US.txt", body: Buffer.from("data", "utf8") },
    ]),
  );

  it("returns the single match", () => {
    expect(zipEntry(entries, /^US\.txt$/i).toString("utf8")).toBe("data");
  });

  it("throws when no member matches", () => {
    expect(() => zipEntry(entries, /nothing/)).toThrow(/found 0/);
  });

  // Better to stop than to guess which of two files the build meant.
  it("throws when the pattern is ambiguous", () => {
    expect(() => zipEntry(entries, /\.txt$/)).toThrow(/found 2/);
  });
});
