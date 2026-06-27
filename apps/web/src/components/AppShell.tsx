import { formatCanonicalName } from "@pbe/shared";
import { type ReactNode, useRef } from "react";
import { useSession } from "../auth/SessionContext.js";
import type { Me } from "../lib/types.js";
import { useDetailsAutoClose } from "../lib/useDetailsAutoClose.js";
import { Avatar } from "./Avatar.js";
import { PrivacyFooter } from "./PrivacyFooter.js";
import { RoleBadge } from "./RoleBadge.js";
import { type Banner, SystemBanner } from "./SystemBanner.js";
import { ThemeToggle } from "./ThemeToggle.js";

/**
 * The persistent app shell (Phase 1b; PRD §5): the masthead with the crest,
 * wordmark, role badge, and avatar/sign-out menu; the always-rendered
 * system-banner slot (D117); the page body; and the persistent privacy footer
 * (D116). Built with semantic landmarks (`header`/`main`/`footer`) for the a11y
 * gate (D79).
 */
export function AppShell({ me, children }: { me: Me; children: ReactNode }) {
  const { signOut } = useSession();
  // The shell shows the signed-in brother's own name; a single record carries no
  // ambiguity context, so render the plain (non-disambiguated) Canonical Name.
  const name = me.profile ? formatCanonicalName(me.profile, false) : "Brother";

  // The /api/banner source lands in Phase 5 (D117); the slot is wired with null.
  const banner: Banner | null = null;

  const menuRef = useRef<HTMLDetailsElement>(null);
  useDetailsAutoClose(menuRef);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <img src="/crest.svg" alt="" aria-hidden="true" className="size-7" />
            <span className="text-base font-bold tracking-tight">PBE Address Book</span>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <RoleBadge role={me.role} />
            <details ref={menuRef} className="relative">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full px-1 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <Avatar name={name} seed={me.profile?.id} size={34} />
                <span className="hidden text-sm font-medium sm:inline">{name}</span>
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-44 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg">
                <p className="truncate px-3 py-2 text-xs text-muted-foreground">
                  {me.profile?.email ?? name}
                </p>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
                >
                  Sign out
                </button>
              </div>
            </details>
          </div>
        </div>
      </header>

      <SystemBanner banner={banner} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>

      <PrivacyFooter />
    </div>
  );
}
