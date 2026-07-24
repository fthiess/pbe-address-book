import { type Role, formatCanonicalName, impersonatableRoles } from "@pbe/shared";
import { ExternalLink } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import { useBanner } from "../auth/BannerContext.js";
import { useSession } from "../auth/SessionContext.js";
import {
  trackMastheadLogoClicked,
  trackPbeNewsLinkClicked,
  trackViewAsEnded,
  trackViewAsStarted,
} from "../lib/analytics.js";
import { PBE_NEWS_URL } from "../lib/externalLinks.js";
import type { Me } from "../lib/types.js";
import { useDetailsAutoClose } from "../lib/useDetailsAutoClose.js";
import { AvatarThumbnail } from "./AvatarThumbnail.js";
import { FontSizeToggle } from "./FontSizeToggle.js";
import { PrivacyFooter } from "./PrivacyFooter.js";
import { ReportBug } from "./ReportBug.js";
import { RoleBadge } from "./RoleBadge.js";
import { SystemBanner } from "./SystemBanner.js";
import { ThemeToggle } from "./ThemeToggle.js";
import { VersionToast } from "./VersionToast.js";

const ROLE_LABEL: Record<Role, string> = {
  brother: "Brother",
  manager: "Manager",
  admin: "Admin",
};

/**
 * Shared classes for the avatar menu's interactive rows. `min-h-11` (44px) keeps
 * every stacked target comfortably above the WCAG 2.2 AA 2.5.8 minimum (24px) with
 * room to spare for the 60+ audience ([[project-audience-slow-connections]]).
 */
const MENU_ITEM =
  "flex w-full min-h-11 items-center rounded-lg px-3 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none";

/**
 * The persistent app shell (Phase 1b; PRD §5): the masthead with the crest,
 * wordmark, the PBE News link (OFC-243), role badge, and avatar menu; the
 * always-rendered system-banner slot (D117); the page body; and the persistent
 * privacy footer (D116). Built with semantic landmarks (`header`/`main`/`footer`)
 * for the a11y gate (D79). The font-size and theme toggles live inside the avatar
 * menu (D131), keeping the bar short enough to fit a phone without cutoff.
 *
 * The avatar menu also carries the "Profile" shortcut to one's own record and the
 * "View as" impersonation controls (N31): a step-**down** role switch an
 * admin/manager uses to test lower projections. The controls are computed from the
 * **real** role (`impersonatableRoles`), so they survive a lowered effective role —
 * the way back is always present — and a brother sees no impersonation UI at all.
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const { signOut, viewAs, stopViewingAs } = useSession();
  const { banner } = useBanner();
  // The Directory is the index route ("/"), regardless of its search/sort/filter
  // query string. When the admin opens Admin Tools *from* the Directory, mark the
  // navigation so the Admin page's "← Directory" can pop back to it (preserving
  // scroll + filters) rather than push a fresh one — mirroring the Profile page.
  const fromDirectory = useLocation().pathname === "/";
  // The shell shows the signed-in brother's own name; a single record carries no
  // ambiguity context, so render the plain (non-disambiguated) Canonical Name.
  const name = me.profile ? formatCanonicalName(me.profile, false) : "Brother";
  // The step-down targets are a function of the *real* role only, so the menu is
  // identical whether or not a view-as is currently active.
  const viewAsTargets = impersonatableRoles(me.realRole);
  // The Admin link gates on the **effective** role (N31): an admin "viewing as" a
  // lower role has genuinely lost admin powers (the server would 403 the admin
  // endpoints), so the link hides — matching the rest of the projection-gated UI.
  const isAdmin = me.role === "admin";

  const menuRef = useRef<HTMLDetailsElement>(null);
  useDetailsAutoClose(menuRef);
  // The Profile link is an in-SPA navigation (no reload), so the menu won't be
  // dismissed by the outside-click handler — close it explicitly on follow.
  const closeMenu = () => {
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  };

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* When a banner shows, it provides the separation from the masthead, so the
          header drops its own bottom rule — otherwise the info banner would carry a
          neutral header line above and its gold rule below (asymmetric). */}
      <header className={banner ? "bg-card" : "border-b border-border bg-card"}>
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          {/* The masthead crest + wordmark is the conventional "home" affordance:
              it always returns to a **clean** Directory landing view (a fresh
              navigation, not a history pop), available on every page. The `reset`
              intent tells the Directory this is a clean slate — clearing not just the
              URL-held view (search/filters/sort/deceased, gone with the bare "/") but
              also the History-held "Starred only" flag and the persisted row
              selection (OFC-194/OFC-196). The "← Directory" back-links carry no such
              intent, so they restore the working view. In edit mode the dirty-form
              blocker still intercepts it, so unsaved edits stay protected. */}
          <Link
            to="/"
            state={{ reset: true }}
            onClick={() => trackMastheadLogoClicked()}
            className="flex min-w-0 items-center gap-2.5 rounded-[var(--radius-md)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img src="/crest.svg" alt="" aria-hidden="true" className="size-7 shrink-0" />
            {/* `truncate` (with the link's `min-w-0`) lets the wordmark shorten under
                pressure rather than shoving the controls off a narrow screen — the
                root of the OFC-210 masthead cutoff. */}
            <span className="min-w-0 truncate text-base font-bold tracking-tight">
              PBE Address Book
            </span>
          </Link>
          {/* `shrink-0` keeps the control cluster at full size; the wordmark yields
              first. The font-size and theme toggles used to sit here but now live in
              the avatar menu (D131) — a simpler bar that fits the phone. */}
          <div className="flex shrink-0 items-center gap-3">
            {/* The single top-bar entry point to the sibling newsletter (ASSETS.md;
                OFC-243). The URL is environment-specific (N94) — staging vs prod PBE
                News — injected at build time. Opens in a new tab, mirroring ReportBug. */}
            <a
              href={PBE_NEWS_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackPbeNewsLinkClicked()}
              aria-label="PBE News (opens in a new tab)"
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              PBE News
              <ExternalLinkIcon />
            </a>
            <ReportBug />
            {me.impersonating ? (
              // A distinct outline pill (vs. the solid RoleBadge) so an admin can
              // never forget they are looking at a lower projection (N31).
              <span className="rounded-full border border-primary px-2.5 py-0.5 text-xs font-semibold text-primary">
                Viewing as {ROLE_LABEL[me.role]}
              </span>
            ) : (
              <RoleBadge role={me.role} />
            )}
            <details ref={menuRef} className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <AvatarThumbnail profile={me.profile} name={name} size={34} />
                {/* `sr-only` (not `hidden`) keeps the name in the accessibility tree
                    on a phone, where it's visually collapsed — so the avatar menu
                    summary always has a discernible name (WCAG 4.1.2). It becomes a
                    visible inline label from `sm` up. */}
                <span className="sr-only text-sm font-medium sm:not-sr-only">{name}</span>
              </summary>
              {/* z-30 to clear the Directory's sticky header cells (z-21), matching
                  the Columns dropdown precedent — a lower z draws under the grid. */}
              <div className="absolute right-0 z-30 mt-2 w-56 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                <p className="truncate px-3 py-2 text-xs text-muted-foreground">
                  {me.profile?.email ?? name}
                </p>
                <Link to={`/brother/${me.profileId}`} onClick={closeMenu} className={MENU_ITEM}>
                  My profile
                </Link>
                {/* Open to every brother, so it sits with "My profile" above the
                    role-gated Admin link rather than below it (OFC-244). */}
                <Link to="/about" onClick={closeMenu} className={MENU_ITEM}>
                  About
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    state={{ fromDirectory }}
                    onClick={closeMenu}
                    className={MENU_ITEM}
                  >
                    Admin Tools
                  </Link>
                )}

                {viewAsTargets.length > 0 && (
                  <div className="mt-1 border-border border-t pt-1">
                    <p className="px-3 py-1 text-xs font-medium text-muted-foreground">View as</p>
                    {viewAsTargets.map((role) => {
                      const isCurrent = me.impersonating && me.role === role;
                      return (
                        <button
                          key={role}
                          type="button"
                          disabled={isCurrent}
                          aria-current={isCurrent ? "true" : undefined}
                          // Explicit name so the control is unambiguous to a screen
                          // reader even read out of its visual "View as" grouping.
                          aria-label={`View as ${ROLE_LABEL[role]}`}
                          onClick={() => {
                            trackViewAsStarted(role);
                            void viewAs(role);
                          }}
                          className={`${MENU_ITEM} justify-between disabled:cursor-default disabled:opacity-100`}
                        >
                          <span>{ROLE_LABEL[role]}</span>
                          {isCurrent && (
                            <span aria-hidden="true" className="text-primary">
                              ✓
                            </span>
                          )}
                        </button>
                      );
                    })}
                    {me.impersonating && (
                      <button
                        type="button"
                        onClick={() => {
                          trackViewAsEnded(me.role);
                          void stopViewingAs();
                        }}
                        className={`${MENU_ITEM} font-medium text-primary`}
                      >
                        Stop viewing as {ROLE_LABEL[me.role]}
                      </button>
                    )}
                  </div>
                )}

                {/* Display settings (D131): the font-size and theme toggles moved
                    here from the inline masthead — a set-once control belongs in the
                    menu, and the leaner bar no longer overflows on a phone (OFC-210).
                    Clicking a toggle keeps the menu open (the auto-close ignores
                    clicks inside it). */}
                <div className="mt-1 border-border border-t pt-2">
                  {/* The visible labels are `aria-hidden`: each toggle is a `fieldset`
                      with its own sr-only `<legend>` of the same words, so exposing
                      the span too would make a screen reader announce it twice. */}
                  <div className="flex items-center justify-between gap-2 px-3 py-1">
                    <span aria-hidden="true" className="text-xs font-medium text-muted-foreground">
                      Text size
                    </span>
                    <FontSizeToggle />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-1">
                    <span aria-hidden="true" className="text-xs font-medium text-muted-foreground">
                      Theme
                    </span>
                    <ThemeToggle />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => void signOut()}
                  className={`${MENU_ITEM} mt-1 border-border border-t pt-2`}
                >
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <SystemBanner banner={banner} />

      {/* Full-bleed by design: the Directory grid spans the whole viewport so the
          widest column sets are visible without horizontal scroll. Reading-oriented
          pages (sign-in, the future Profile page, the cards below) constrain their
          own measure rather than relying on a shell-wide cap. */}
      <main className="w-full flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>

      <PrivacyFooter withAboutLink />

      {/* The long-lived-tab "new version available" toast (OFC-63) — only runs for a
          signed-in tab, so it never polls on the sign-in screen. */}
      <VersionToast />
    </div>
  );
}

/** The outbound-link glyph on the PBE News masthead link (opens a new tab). */
function ExternalLinkIcon() {
  return <ExternalLink size={13} aria-hidden="true" />;
}
