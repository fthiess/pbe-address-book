import { SignJWT } from "jose";

/**
 * The shared low-level Ghost Admin-API transport used by both the write client
 * ({@link import('./ghost-admin.js').GhostAdminLifecycle}, Phase 5b-1) and the
 * read client ({@link import('./ghost-reader.js').GhostAdminReader}, Phase 5b-2).
 * It owns the two concerns those two share and nothing else:
 *
 *  - **Auth (D99).** A per-request short-lived JWT minted from the integration's
 *    `{id}:{secret}` Admin API key: HS256, `kid` = the key id, `aud` = `/admin/`,
 *    ~5-minute expiry, signed with the **hex-decoded** secret. The token rides
 *    `Authorization: Ghost <jwt>`; `Accept-Version` pins the API version.
 *  - **Transport.** One request that **throws on any non-2xx** (so a write caller
 *    aborts clean and a read caller surfaces the failure), plus cursor-style
 *    pagination over Ghost's `meta.pagination.next` for the list endpoints the
 *    audit and bounce report read.
 *
 * Extracting this keeps the auth logic in exactly one place — a mass write path
 * and a read path must never drift on how they authenticate to the same Ghost.
 */

/**
 * Thrown by {@link GhostAdminHttp.request} on any non-2xx response, carrying the
 * HTTP `status` so a caller can branch on it — e.g. `createMember` distinguishing a
 * `422` duplicate-email rejection (a permanent collision) from a `5xx` outage (a
 * transient failure). The `message` is Ghost's error text, for the server log only.
 */
export class GhostHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GhostHttpError";
  }
}

/** Split and validate a Ghost Admin API key `{id}:{secret}` (secret is hex). */
export function parseAdminKey(adminApiKey: string): { keyId: string; secret: Buffer } {
  const [keyId, secret] = adminApiKey.split(":");
  if (!keyId || !secret) {
    throw new Error("GHOST_ADMIN_API_KEY must be in `{id}:{secret}` form");
  }
  return { keyId, secret: Buffer.from(secret, "hex") };
}

export interface GhostAdminHttpConfig {
  /** Admin API base, e.g. `https://staging.pbe400.org/ghost/api/admin` (trailing slash tolerated). */
  apiUrl: string;
  /** The integration Admin API key `{id}:{secret}` (secret is hex). Secret Manager only. */
  adminApiKey: string;
  /** The pinned Ghost Admin-API version header (D99); defaults to `v5.0`. */
  acceptVersion?: string;
  /** Injectable `fetch` for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
  /** Page size for {@link GhostAdminHttp.getAll}; defaults to 100 (matches export-bounces.js). */
  pageSize?: number;
}

/** One page of a Ghost list response: the item array plus the pagination cursor. */
interface GhostPage {
  meta?: { pagination?: { next?: number | null; pages?: number | null } };
  [key: string]: unknown;
}

export class GhostAdminHttp {
  private readonly apiUrl: string;
  private readonly keyId: string;
  private readonly secret: Buffer;
  private readonly acceptVersion: string;
  private readonly fetchImpl: typeof fetch;
  private readonly pageSize: number;

  constructor(config: GhostAdminHttpConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, "");
    const { keyId, secret } = parseAdminKey(config.adminApiKey);
    this.keyId = keyId;
    this.secret = secret;
    this.acceptVersion = config.acceptVersion ?? "v5.0";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.pageSize = config.pageSize ?? 100;
  }

  private async signToken(): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256", kid: this.keyId })
      .setIssuedAt()
      .setExpirationTime("5m")
      .setAudience("/admin/")
      .sign(this.secret);
  }

  /**
   * Issue one authenticated Admin-API request, returning the parsed JSON body (or
   * `undefined` for an empty response, e.g. a `DELETE`). Any non-2xx **throws**
   * with Ghost's error message when present; the message is for the server log
   * only — endpoints surface a generic error to the client.
   *
   * `timeoutMs` bounds the wait and is **opt-in** (OFC-287): the admin report
   * surfaces have always waited indefinitely and keep doing so, because a slow
   * report is merely slow and a human is watching it. The sign-in uuid lookup
   * cannot afford that — a half-open connection to Ghost would hang the magic-link
   * callback until Cloud Run's request timeout, turning D137's "fail soft" into a
   * blocked sign-in — so it passes a bound. Whether the report surfaces should
   * adopt one too is OFC-294.
   */
  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<unknown> {
    const token = await this.signToken();
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Ghost ${token}`,
        "Accept-Version": this.acceptVersion,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...(options.timeoutMs !== undefined
        ? { signal: AbortSignal.timeout(options.timeoutMs) }
        : {}),
    });
    if (!response.ok) {
      throw new GhostHttpError(
        response.status,
        `Ghost ${method} ${path} → ${response.status}: ${await safeError(response)}`,
      );
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : undefined;
  }

  /**
   * Fetch every page of a Ghost list resource and return the flattened array of
   * `body[itemKey]` (e.g. `members`, `events`, `posts`). Follows
   * `meta.pagination.next` until exhausted; `params` are extra query fields
   * (e.g. `include`, `filter`). A bounded page cap guards against a malformed
   * `next` cursor looping forever.
   */
  async getAll(
    path: string,
    itemKey: string,
    params: Record<string, string> = {},
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    // ~1000 pages × 100 = 100k rows — far above Book's ~2k members. If a fetch ever
    // exhausts this, it **throws** rather than returning a partial list: a silent
    // truncation would make an audit/bounce report quietly *undercount* (miss the
    // tail) while looking complete, defeating its purpose. A loud failure surfaces as
    // `502 ghost_read_failed` and forces the fix (bounding the fetch, OFC-231).
    const MAX_PAGES = 1000;
    for (let page = 1; ; page += 1) {
      if (page > MAX_PAGES) {
        throw new Error(`Ghost ${path}: exceeded ${MAX_PAGES} pages — refusing a partial result`);
      }
      const query = new URLSearchParams({
        limit: String(this.pageSize),
        page: String(page),
        ...params,
      });
      const body = (await this.request("GET", `${path}?${query.toString()}`)) as GhostPage;
      const batch = body?.[itemKey];
      if (Array.isArray(batch)) {
        items.push(...batch);
      }
      const next = body?.meta?.pagination?.next;
      if (next === null || next === undefined) {
        break;
      }
    }
    return items;
  }
}

/** Best-effort extraction of Ghost's error message for the thrown (server-only) log. */
async function safeError(response: Response): Promise<string> {
  try {
    const text = await response.text();
    const json = JSON.parse(text) as { errors?: { message?: string }[] };
    return json.errors?.[0]?.message ?? text.slice(0, 200);
  } catch {
    return response.statusText;
  }
}
