import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { RosterUnavailableError, type RosterVerifier } from "../identity/google-oidc.js";
import { ROSTER_CONTRACT_VERSION, registerRosterRoutes } from "./roster.js";

const acceptAll: RosterVerifier = { verify: async () => {} };
const rejectAll: RosterVerifier = {
  verify: async () => {
    throw new Error("nope");
  },
};
const unavailable: RosterVerifier = {
  verify: async () => {
    throw new RosterUnavailableError("jwks unreachable");
  },
};

async function build(verifier?: RosterVerifier): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerRosterRoutes(app, { verifier });
  await app.ready();
  return app;
}

describe("GET /api/roster (Linter stub, D58/D78/D112)", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("fails closed with 503 when no verifier is configured", async () => {
    app = await build(undefined);
    const res = await app.inject({ method: "GET", url: "/api/roster" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "roster_unavailable" });
  });

  it("401s a request with no bearer token", async () => {
    app = await build(acceptAll);
    const res = await app.inject({ method: "GET", url: "/api/roster" });
    expect(res.statusCode).toBe(401);
  });

  it("401s an invalid token", async () => {
    app = await build(rejectAll);
    const res = await app.inject({
      method: "GET",
      url: "/api/roster",
      headers: { authorization: "Bearer bogus" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns the stub envelope + X-Contract-Version for a valid token", async () => {
    app = await build(acceptAll);
    const res = await app.inject({
      method: "GET",
      url: "/api/roster",
      headers: { authorization: "Bearer good" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-contract-version"]).toBe(String(ROSTER_CONTRACT_VERSION));
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.json()).toEqual({ contractVersion: ROSTER_CONTRACT_VERSION, roster: [] });
  });

  it("accepts a case-insensitive bearer scheme per RFC 6750/7235 (OFC-224)", async () => {
    app = await build(acceptAll);
    for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
      const res = await app.inject({
        method: "GET",
        url: "/api/roster",
        headers: { authorization: `${scheme} good` },
      });
      expect(res.statusCode, `scheme ${scheme}`).toBe(200);
    }
  });

  it("maps a transient key-resolution failure to a retryable 503, not a 401 (OFC-223)", async () => {
    app = await build(unavailable);
    const res = await app.inject({
      method: "GET",
      url: "/api/roster",
      headers: { authorization: "Bearer valid-but-jwks-down" },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "verification_unavailable" });
  });
});
