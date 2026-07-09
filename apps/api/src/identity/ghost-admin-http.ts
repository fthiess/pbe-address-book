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
   */
  async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.signToken();
    const response = await this.fetchImpl(`${this.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Ghost ${token}`,
        "Accept-Version": this.acceptVersion,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`Ghost ${method} ${path} → ${response.status}: ${await safeError(response)}`);
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
    let page = 1;
    // ~1000 pages × 100 = 100k rows — far above Book's ~2k members, so this only
    // ever trips on a pathological/looping cursor, never in normal operation.
    const MAX_PAGES = 1000;
    for (; page <= MAX_PAGES; page += 1) {
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
