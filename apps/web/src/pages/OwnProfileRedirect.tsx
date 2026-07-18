import { Navigate } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";

/**
 * `/brother/me` (and `/brother/me/edit`) — a stable, identity-free URL for one's
 * own record, which resolves to the real `/brother/<constitutionId>` (N116).
 *
 * The point is callers that **cannot know** a brother's Constitution ID: the About
 * page's copy, which is static Markdown compiled at build time and has no session,
 * and (Phase 7.6) the Ghost theme's account links, where the newsletter side knows
 * a member's email but nothing about Book's ids. The avatar menu deliberately does
 * **not** route through here — it already holds the id, so the redirect hop would
 * buy nothing.
 *
 * It **redirects** rather than rendering the profile in place, so a record keeps
 * exactly one canonical URL: prev/next (D4d), the back-stack, and link-sharing all
 * behave as they always did, and `ProfileContainer` needs no knowledge of this at
 * all. `replace` keeps the alias out of history, so Back doesn't land on it and
 * bounce forward again.
 *
 * These are **static** sibling routes registered above the dynamic `brother/:id`,
 * the same shape as `brother/new` — otherwise the router matches `:id === "me"` and
 * the page tries to load a brother whose Constitution ID is "me" (the exact bug the
 * `brother/new` comment in App.tsx records).
 */
export function OwnProfileRedirect({ edit = false }: { edit?: boolean }) {
  const { state } = useSession();

  // Unreachable in practice: these routes live inside GateLayout, which renders the
  // sign-in screen until the session is authenticated, and `profileId` is a required
  // field on `Me`. Handled rather than asserted so a future routing change can't turn
  // it into a blank screen.
  if (state.status !== "authenticated") return null;

  const target = `/brother/${state.me.profileId}`;
  return <Navigate to={edit ? `${target}/edit` : target} replace />;
}
