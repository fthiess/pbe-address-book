import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DevIdentityProvider } from "./dev-provider.js";

// A clean, non-production env to construct the provider in tests.
const DEV_ENV: NodeJS.ProcessEnv = { NODE_ENV: "development" };

// The env gate logs a security alert to stderr on refusal (D108 layer 4);
// silence it here so the intentional failures don't clutter the test output.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DevIdentityProvider", () => {
  it("defaults to the brother role", async () => {
    const provider = new DevIdentityProvider(DEV_ENV);
    const session = await provider.createSession({});
    expect(session.identity.role).toBe("brother");
  });

  it("mints a session for each requested role (role-switchable)", async () => {
    const provider = new DevIdentityProvider(DEV_ENV);
    for (const role of ["brother", "manager", "admin"] as const) {
      const session = await provider.createSession({ role });
      expect(session.identity.role).toBe(role);
      expect(session.identity.subject).toBe(`dev-${role}`);
    }
  });

  it("sets an absolute 4-hour expiry", async () => {
    const provider = new DevIdentityProvider(DEV_ENV);
    const before = Date.now();
    const session = await provider.createSession({ role: "admin" });
    const fourHours = 4 * 60 * 60 * 1000;
    expect(session.expiresAt).toBeGreaterThanOrEqual(before + fourHours);
    expect(session.expiresAt).toBeLessThanOrEqual(Date.now() + fourHours);
  });

  // D108 layer 2: the env gate must refuse construction under a prod-like config.
  it("refuses to construct under NODE_ENV=production", () => {
    expect(() => new DevIdentityProvider({ NODE_ENV: "production" })).toThrow(/SECURITY ALERT/);
  });

  it("refuses to construct under BOOK_ENV=prod", () => {
    expect(() => new DevIdentityProvider({ BOOK_ENV: "prod" })).toThrow(/SECURITY ALERT/);
  });
});
