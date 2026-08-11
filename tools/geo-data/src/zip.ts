/**
 * A minimal reader for the two source archives (Census gazetteer, GeoNames
 * postal export). Both are ordinary single-member ZIPs, so rather than take a
 * dependency for one build script this reads the central directory and inflates
 * with `node:zlib`.
 *
 * Deliberately narrow: no ZIP64, no encryption, no multi-disk, no directory
 * traversal handling. Anything it does not understand throws, because the only
 * inputs are two known URLs and a surprise there should stop the build rather
 * than half-read a table.
 */

import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;

const STORED = 0;
const DEFLATED = 8;

/** Find the End of Central Directory record, scanning back over the comment. */
function findEndOfCentralDirectory(buffer: Buffer): number {
  const earliest = Math.max(0, buffer.length - 0xffff - 22);
  for (let at = buffer.length - 22; at >= earliest; at--) {
    if (buffer.readUInt32LE(at) === END_OF_CENTRAL_DIRECTORY) {
      return at;
    }
  }
  throw new Error("not a ZIP archive: no end-of-central-directory record");
}

/** Inflate one member, checking it came out the size the directory promised. */
function decompress(entry: {
  name: string;
  method: number;
  compressed: Buffer;
  uncompressedSize: number;
}): Buffer {
  let contents: Buffer;
  if (entry.method === STORED) {
    contents = Buffer.from(entry.compressed);
  } else if (entry.method === DEFLATED) {
    contents = inflateRawSync(entry.compressed);
  } else {
    throw new Error(`unsupported ZIP compression method ${entry.method} for ${entry.name}`);
  }
  if (contents.length !== entry.uncompressedSize) {
    throw new Error(
      `corrupt ZIP: ${entry.name} inflated to ${contents.length} bytes, expected ${entry.uncompressedSize}`,
    );
  }
  return contents;
}

/**
 * Extract every member as a Buffer, keyed by its name. Both archives hold a
 * handful of small files, so reading them all is simpler than seeking to one.
 */
export function extractZipEntries(buffer: Buffer): Map<string, Buffer> {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let at = buffer.readUInt32LE(eocd + 16);

  const entries = new Map<string, Buffer>();
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(at) !== CENTRAL_FILE_HEADER) {
      throw new Error(`corrupt ZIP: bad central header for entry ${index}`);
    }
    const method = buffer.readUInt16LE(at + 10);
    const compressedSize = buffer.readUInt32LE(at + 20);
    const uncompressedSize = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extraLength = buffer.readUInt16LE(at + 30);
    const commentLength = buffer.readUInt16LE(at + 32);
    const localHeaderAt = buffer.readUInt32LE(at + 42);
    const name = buffer.toString("utf8", at + 46, at + 46 + nameLength);

    if (buffer.readUInt32LE(localHeaderAt) !== LOCAL_FILE_HEADER) {
      throw new Error(`corrupt ZIP: bad local header for ${name}`);
    }
    // The local header repeats the name and extra fields, and its extra-field
    // length routinely differs from the central directory's — read it here or
    // the data offset lands inside the padding.
    const localNameLength = buffer.readUInt16LE(localHeaderAt + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderAt + 28);
    const dataAt = localHeaderAt + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataAt, dataAt + compressedSize);

    if (!name.endsWith("/")) {
      entries.set(name, decompress({ name, method, compressed, uncompressedSize }));
    }

    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The single member matching `pattern`; throws if absent or ambiguous. */
export function zipEntry(entries: ReadonlyMap<string, Buffer>, pattern: RegExp): Buffer {
  const matches = [...entries.keys()].filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one archive member matching ${pattern}, found ${matches.length}: ` +
        `${[...entries.keys()].join(", ")}`,
    );
  }
  // Non-null: the name came from this map's own key list.
  return entries.get(matches[0] as string) as Buffer;
}
