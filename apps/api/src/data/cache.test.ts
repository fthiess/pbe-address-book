import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { ProfileCache } from "./cache.js";

interface DecodedBody {
  profiles: Array<{ constitutionId: number }>;
  majors: unknown[];
}

const parse = (json: string): DecodedBody => JSON.parse(json) as DecodedBody;

describe("ProfileCache", () => {
  it("throws if the payload is requested before hydration", () => {
    const cache = new ProfileCache();
    expect(() => cache.brotherPayload()).toThrow(/not been hydrated/);
  });

  it("builds a brother payload whose br/gzip/json all decode to the same body", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ constitutionId: 5001 }),
      makeProfile({ constitutionId: 5002 }),
    ]);

    const payload = cache.brotherPayload();
    const fromBr = zlib.brotliDecompressSync(payload.br).toString("utf-8");
    const fromGzip = zlib.gunzipSync(payload.gzip).toString("utf-8");

    expect(fromBr).toBe(payload.json);
    expect(fromGzip).toBe(payload.json);

    const body = parse(payload.json);
    expect(body.profiles).toHaveLength(2);
    expect(body.majors).toEqual([]);
  });

  it("applies the projection — unlisted records are absent from the payload", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ constitutionId: 5001, unlisted: false }),
      makeProfile({ constitutionId: 5002, unlisted: true }),
      makeProfile({ constitutionId: 5003, unlisted: false }),
    ]);

    const body = parse(cache.brotherPayload().json);
    expect(body.profiles.map((p) => p.constitutionId)).toEqual([5001, 5003]);
    // size counts source profiles loaded, not projected ones.
    expect(cache.size).toBe(3);
  });

  it("compresses the bulk payload well (repeated keys at scale)", async () => {
    const profiles = Array.from({ length: 500 }, (_, i) =>
      makeProfile({ constitutionId: 5001 + i }),
    );
    const cache = new ProfileCache();
    await cache.load(profiles);

    const payload = cache.brotherPayload();
    const rawBytes = Buffer.byteLength(payload.json, "utf-8");
    // A sanity floor, not a tuning target: structured records with repeated keys
    // should brotli to a small fraction of their JSON size (D75/D84).
    expect(payload.br.length).toBeLessThan(rawBytes * 0.5);
  });
});
