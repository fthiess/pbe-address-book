import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  fetchProfile,
  fetchProfiles,
  patchProfile,
  putDebrothered,
  setReauthHandler,
  setUnauthorizedHandler,
} from "./api.js";

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
  setReauthHandler(null);
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

/**
 * The D109 non-destructive re-auth-and-retry seam (OFC-236). A mid-session 401 on a
 * recovery-participating call asks the session layer to re-auth (a child window, tested
 * end-to-end in Playwright); on success the call is retried **once** with the restored
 * cookie, re-sending the original `If-Match` so a genuine concurrent edit still 412s
 * (D25). On a failed re-auth the write keeps its form (no app-wide bounce) while a read
 * bounces (nothing to preserve). The DOM half — the popup, the dedupe to one window,
 * the auth-status gate — lives in the SessionProvider and is covered by e2e.
 */
describe("api re-auth-and-retry seam (OFC-236 / D109)", () => {
  function okResponse(body: unknown, etag = 'W/"v2"'): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json", ETag: etag },
    });
  }

  it("retries the Save once after a successful re-auth, re-sending the original If-Match", async () => {
    const reauth = vi.fn().mockResolvedValue(true);
    setReauthHandler(reauth);
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthenticated" }))
      .mockResolvedValueOnce(okResponse({ id: 5001, firstName: "X" }));
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await patchProfile(5001, { firstName: "X" }, 'W/"v1"');

    expect(outcome).toEqual({
      status: "ok",
      profile: { id: 5001, firstName: "X" },
      etag: 'W/"v2"',
    });
    expect(reauth).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Both the original attempt and the resumed one carry the SAME If-Match — the
    // resume must not weaken concurrency (D25).
    const firstInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const secondInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect((firstInit.headers as Record<string, string>)["If-Match"]).toBe('W/"v1"');
    expect((secondInit.headers as Record<string, string>)["If-Match"]).toBe('W/"v1"');
    // The re-auth was silent — the app was never bounced to sign-in.
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("resuming into a concurrent edit still surfaces 412 as a reconcile (D25)", async () => {
    setReauthHandler(vi.fn().mockResolvedValue(true));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthenticated" }))
      .mockResolvedValueOnce(jsonResponse(412, { error: "stale" }));
    vi.stubGlobal("fetch", fetchMock);

    // The record changed under the user during the lapse: the resumed PATCH echoes the
    // now-stale If-Match and 412s, driving the reconcile UX rather than clobbering.
    await expect(patchProfile(5001, { firstName: "X" }, 'W/"v1"')).resolves.toEqual({
      status: "stale",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a Save when re-auth fails, and keeps the form (no bounce)", async () => {
    const reauth = vi.fn().mockResolvedValue(false);
    setReauthHandler(reauth);
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));
    vi.stubGlobal("fetch", fetchMock);

    // A failed re-auth (popup blocked/dismissed) surfaces the 401 as a caught ApiError
    // the editor turns into the "expired" banner — the app is NOT bounced (D109).
    await expect(patchProfile(5001, { firstName: "X" }, 'W/"v1"')).rejects.toBeInstanceOf(ApiError);
    expect(reauth).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("re-fetches the directory in place after a successful re-auth (OFC-153)", async () => {
    setReauthHandler(vi.fn().mockResolvedValue(true));
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthenticated" }))
      .mockResolvedValueOnce(jsonResponse(200, { profiles: [{ id: 5001 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchProfiles();

    expect(response.profiles).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Seamless — no full reload, so the app must not have bounced to sign-in.
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it("bounces a read when re-auth fails — nothing to preserve (OFC-153)", async () => {
    setReauthHandler(vi.fn().mockResolvedValue(false));
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" })),
    );

    await expect(fetchProfiles()).rejects.toBeInstanceOf(ApiError);
    // The read is non-silent, so a still-401 after a failed re-auth flips the app to
    // signed-out (the calm bounce) rather than stranding a stale directory.
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it("with no re-auth handler registered, a read 401 bounces unchanged", async () => {
    setReauthHandler(null);
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProfiles()).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(unauthorized).toHaveBeenCalledOnce();
  });
});

/**
 * Reinstate re-creates the Ghost member, so it can 422 on a duplicate-email collision
 * with an unlinked Ghost account (the Book↔Ghost drift, OFC-316). The de-brother path
 * must surface that as the `invalid` outcome — the way the deceased path already does —
 * rather than letting it fall through to a thrown ApiError the control can't render. A
 * transient Ghost outage stays `ghost_failed` (retryable), keeping the two distinct.
 */
describe("putDebrothered duplicate-email collision (OFC-316)", () => {
  it("maps a 422 to `invalid` carrying the reconcile issues, not a thrown error", async () => {
    const issues = [
      { field: "email", message: "This email address already exists in PBE News (Ghost)…" },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(422, { error: "validation_failed", issues })),
    );

    await expect(putDebrothered(5136, false)).resolves.toEqual({ status: "invalid", issues });
  });

  it("still maps a 502 to `ghost_failed` — a transient outage, distinct from the collision", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(502, { error: "ghost_create_failed" })),
    );

    await expect(putDebrothered(5136, false)).resolves.toEqual({ status: "ghost_failed" });
  });
});
