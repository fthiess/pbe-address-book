import { type Role, formatCanonicalName, impersonatableRoles } from "@pbe/shared";
import { type ReactNode, useRef } from "react";
import { Link } from "react-router-dom";
import { useSession } from "../auth/SessionContext.js";
import type { Me } from "../lib/types.js";
import { useDetailsAutoClose } from "../lib/useDetailsAutoClose.js";
import { Avatar } from "./Avatar.js";
import { FontSizeToggle } from "./FontSizeToggle.js";
import { PrivacyFooter } from "./PrivacyFooter.js";
import { RoleBadge } from "./RoleBadge.js";
import { type Banner, SystemBanner } from "./SystemBanner.js";
import { ThemeToggle } from "./ThemeToggle.js";

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
 * wordmark, role badge, and avatar menu; the always-rendered system-banner slot
 * (D117); the page body; and the persistent privacy footer (D116). Built with
 * semantic landmarks (`header`/`main`/`footer`) for the a11y gate (D79).
 *
 * The avatar menu also carries the "Profile" shortcut to one's own record and the
 * "View as" impersonation controls (N31): a step-**down** role switch an
 * admin/manager uses to test lower projections. The controls are computed from the
 * **real** role (`impersonatableRoles`), so they survive a lowered effective role —
 * the way back is always present — and a brother sees no impersonation UI at all.
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const { signOut, viewAs, stopViewingAs } = useSession();
  // The shell shows the signed-in brother's own name; a single record carries no
  // ambiguity context, so render the plain (non-disambiguated) Canonical Name.
  const name = me.profile ? formatCanonicalName(me.profile, false) : "Brother";
  // The step-down targets are a function of the *real* role only, so the menu is
  // identical whether or not a view-as is currently active.
  const viewAsTargets = impersonatableRoles(me.realRole);

  // The /api/banner source lands in Phase 5 (D117); the slot is wired with null.
  const banner: Banner | null = null;

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
      <header className="border-b border-border bg-card">
        <div className="flex w-full items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <img src="/crest.svg" alt="" aria-hidden="true" className="size-7" />
            <span className="text-base font-bold tracking-tight">PBE Address Book</span>
          </div>
          <div className="flex items-center gap-3">
            <FontSizeToggle />
            <ThemeToggle />
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
                <Avatar name={name} seed={me.profile?.id} size={34} />
                <span className="hidden text-sm font-medium sm:inline">{name}</span>
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
                          onClick={() => void viewAs(role)}
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
                        onClick={() => void stopViewingAs()}
                        className={`${MENU_ITEM} font-medium text-primary`}
                      >
                        Stop viewing as {ROLE_LABEL[me.role]}
                      </button>
                    )}
                  </div>
                )}

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

      <PrivacyFooter />
    </div>
  );
}
