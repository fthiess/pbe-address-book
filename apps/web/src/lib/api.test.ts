import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, fetchProfile, patchProfile, setUnauthorizedHandler } from "./api.js";

/**
 * The app-wide 401 interceptor (OFC-193). A gated call that comes back 401 means
 * the session lapsed under an open tab (D22), so the fetch layer notifies the
 * session layer once — which flips the whole app to signed-out — while the call
 * itself still rejects with {@link ApiError} for the caller. A 403 (an in-session
 * authorization decision) and every other status must NOT trigger it.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe("api unauthorized interceptor (OFC-193)", () => {
  it("fires the handler on a 401 and still rejects with ApiError", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" })),
    );

    await expect(fetchProfile(5001)).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("does not fire on a 403 — an in-session authorization decision, not a sign-out", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403, { error: "forbidden" })));

    await expect(fetchProfile(5001)).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire on a 404", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(404, { error: "not_found" })));

    await expect(fetchProfile(5001)).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not fire on a 401 from the edit-form Save path (opted out for D109)", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" })),
    );

    // patchProfile is the Profile edit Save; a mid-edit 401 must stay local so the
    // editor keeps the form (D109), not bounce the whole app.
    await expect(patchProfile(5001, { firstName: "X" }, 'W/"v1"')).rejects.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it("tolerates a missing handler (none registered) on a 401", async () => {
    setUnauthorizedHandler(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" })),
    );

    await expect(fetchProfile(5001)).rejects.toBeInstanceOf(ApiError);
  });
});
