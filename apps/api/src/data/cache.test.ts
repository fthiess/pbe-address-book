import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { makeProfile } from "../test-support/make-profile.js";
import { ProfileCache } from "./cache.js";

interface DecodedBody {
  profiles: Array<{ id: number }>;
  majors: unknown[];
}

const parse = (json: string): DecodedBody => JSON.parse(json) as DecodedBody;

describe("ProfileCache", () => {
  it("throws if the payload is requested before hydration", () => {
    const cache = new ProfileCache();
    expect(() => cache.brotherPayload()).toThrow(/not been hydrated/);
  });

  it("counts admins across the loaded dataset for the last-admin invariant (adminCount, OFC-139)", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, role: "admin" }),
      makeProfile({ id: 5002, role: "manager" }),
      makeProfile({ id: 5003, role: "brother" }),
      makeProfile({ id: 5004, role: "admin" }),
    ]);
    expect(cache.adminCount()).toBe(2);
  });

  it("builds a brother payload whose br/gzip/json all decode to the same body", async () => {
    const cache = new ProfileCache();
    await cache.load([makeProfile({ id: 5001 }), makeProfile({ id: 5002 })]);

    const payload = cache.brotherPayload();
    const fromBr = zlib.brotliDecompressSync(payload.br).toString("utf-8");
    const fromGzip = zlib.gunzipSync(payload.gzip).toString("utf-8");

    expect(fromBr).toBe(payload.json);
    expect(fromGzip).toBe(payload.json);

    const body = parse(payload.json);
    expect(body.profiles).toHaveLength(2);
    expect(body.majors).toEqual([]);
  });

  it("applies the projection — unlisted and de-brothered records are absent", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, unlisted: false }),
      makeProfile({ id: 5002, unlisted: true }),
      makeProfile({ id: 5003, debrothered: { isDebrothered: true } }),
      makeProfile({ id: 5004, unlisted: false }),
    ]);

    const body = parse(cache.brotherPayload().json);
    expect(body.profiles.map((p) => p.id)).toEqual([5001, 5004]);
    // size counts source profiles loaded, not projected ones.
    expect(cache.size).toBe(4);
  });

  it("indexes records by id and by normalized email for resolution", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, email: "Jane.Doe@Example.test" }),
      makeProfile({ id: 5002, email: undefined }),
    ]);

    expect(cache.getById(5001)?.id).toBe(5001);
    expect(cache.getById(9999)).toBeNull();

    // Resolution normalizes the query (D97): different case still hits.
    expect(cache.resolveByEmail("  JANE.DOE@example.TEST ")).toEqual({
      kind: "found",
      profile: expect.objectContaining({ id: 5001 }),
    });
    expect(cache.resolveByEmail("nobody@example.test")).toEqual({ kind: "none" });
  });

  it("resolves an alternateEmail in the same namespace as the primary (§5.1/D97)", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, email: "primary@example.test", alternateEmail: "alt@example.test" }),
    ]);
    expect(cache.resolveByEmail("alt@example.test")).toEqual({
      kind: "found",
      profile: expect.objectContaining({ id: 5001 }),
    });
  });

  it("marks an email claimed by two profiles as ambiguous (fail closed), naming the claimants", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, email: "dup@example.test" }),
      makeProfile({ id: 5002, email: "DUP@example.test" }),
    ]);
    expect(cache.resolveByEmail("dup@example.test")).toEqual({
      kind: "ambiguous",
      claimantIds: [5001, 5002],
    });
  });

  it("marks one profile's primary clashing with another's alternate as ambiguous", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, email: "shared@example.test" }),
      makeProfile({ id: 5002, email: "other@example.test", alternateEmail: "shared@example.test" }),
    ]);
    expect(cache.resolveByEmail("shared@example.test")).toEqual({
      kind: "ambiguous",
      claimantIds: [5001, 5002],
    });
  });

  it("does NOT self-ambiguate one record whose primary and alternate are the same address (OFC-88)", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, email: "same@example.test", alternateEmail: "SAME@example.test" }),
    ]);
    // One profile claiming an address via both fields resolves to itself, not ambiguous.
    expect(cache.resolveByEmail("same@example.test")).toEqual({
      kind: "found",
      profile: expect.objectContaining({ id: 5001 }),
    });
  });

  it("skips empty/whitespace-only email keys so two blank records do not collide (OFC-88)", async () => {
    const cache = new ProfileCache();
    await cache.load([
      makeProfile({ id: 5001, email: "" }),
      makeProfile({ id: 5002, email: "   " }),
    ]);
    // A shared "" key would otherwise flip both to ambiguous and lock them out.
    expect(cache.resolveByEmail("")).toEqual({ kind: "none" });
    expect(cache.getById(5001)?.id).toBe(5001);
  });

  it("compresses the bulk payload well (repeated keys at scale)", async () => {
    const profiles = Array.from({ length: 500 }, (_, i) => makeProfile({ id: 5001 + i }));
    const cache = new ProfileCache();
    await cache.load(profiles);

    const payload = cache.brotherPayload();
    const rawBytes = Buffer.byteLength(payload.json, "utf-8");
    // A sanity floor, not a tuning target: structured records with repeated keys
    // should brotli to a small fraction of their JSON size (D75/D84).
    expect(payload.br.length).toBeLessThan(rawBytes * 0.5);
  });
});
