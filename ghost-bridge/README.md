# Ghost auth bridge — relay (reference copy)

Book has no password store of its own; it authenticates members against the
Ghost membership through a redirect bridge (`docs/initial-build/ENGINEERING-DESIGN.md`
§2.1; decisions D20/D104). That bridge has two halves:

- **Backend half** — `apps/api/src/identity/ghost-provider.ts` verifies the
  Ghost-issued JWT (and `ghost-jwks.ts` fetches Ghost's keys), and
  `routes/auth.ts` issues Book's session.
- **Ghost half (this folder)** — `book.hbs`, a Handlebars template served at
  `/book/`, which hands a logged-in member's Ghost token to Book.

## These files are a reference mirror — the deployment home is the theme repo

The relay deploys as a **Ghost theme template**, so its authoritative, deployed
copy lives in the Ghost theme repo, **[`fthiess/pbe-news-ghost-theme`](https://github.com/fthiess/pbe-news-ghost-theme)**
(`book.hbs` + `book-bridge/`). The copies here exist only so the *whole* auth
flow is visible alongside the backend that pairs with it.

**Keep them in sync.** If you change the relay, change it in **both** repos. The
copies are kept byte-identical so a plain diff verifies they match:

```bash
diff ghost-bridge/book.hbs            ../pbe-news-ghost-theme/book.hbs
diff ghost-bridge/routes-snippet.yaml ../pbe-news-ghost-theme/book-bridge/routes-snippet.yaml
```

Deployment steps (Ghost admin: upload theme + add the route) live in the theme
repo's `book-bridge/README.md`.

## How the relay works

1. Book's SPA sends a member to `<ghost-host>/book/?state=<nonce>&target=<env>`
   (the backend builds this URL from `GHOST_BRIDGE_URL` + `GHOST_BRIDGE_TARGET`).
2. `book.hbs` fetches the member's short-lived Ghost JWT from the same-origin
   `/members/api/session` (200 + token when signed in; 204 when not).
3. **Signed in** → it redirects to Book's `/auth/callback` with the token and
   `state` in the URL **fragment** (so the token never hits logs, history, or the
   `Referer` header — D20). The callback destination is chosen from a **hardcoded
   allowlist keyed by `target`** (`staging` / `prod`), never from the query
   string, so it can't become an open redirect (D104).
4. **Not signed in** → it shows the Ghost Portal sign-in button; after the
   magic-link sign-in the member returns and the relay re-runs.

## Notes from the live bring-up

- Ghost signs member JWTs **RS512 over a 1024-bit key**; the backend verifies
  with Node `crypto`, not jose (decision N1).
- Book's session cookie must be named **`__session`** to survive Firebase
  Hosting (decision N5).

See `docs/initial-build/DECISIONS.md` (D20, D72, D104, N1–N5) for the full
rationale.
