import { Link } from "react-router-dom";

import { APP_VERSION } from "../lib/version.js";

/**
 * The persistent privacy-notice footer (D116). It is shown on every page, a
 * standing reminder that the Address Book is members-only and that what a
 * brother sees is governed by each member's own privacy settings. Intentionally
 * calm and brief.
 *
 * It also carries a **discreet build id** (the deployed commit SHA), so an operator
 * can read the running version straight off any page — handy for support and for
 * spotting a stale cached tab (it is the same id the OFC-63 update toast compares).
 *
 * `withAboutLink` adds a link to the fuller privacy statement on the About page
 * (OFC-281). It is **opt-in rather than always on** because this footer renders
 * in three places and `/about` lives inside the session gate: the signed-in shell
 * can link there, but the sign-in page and the maintenance/outage page cannot —
 * a link either would bounce off the gate or dead-end in a degraded app. Only
 * `AppShell` passes it.
 */
export function PrivacyFooter({ withAboutLink = false }: { withAboutLink?: boolean }) {
  return (
    <footer className="border-t border-border bg-card px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">
      <p className="mx-auto max-w-2xl">
        This is a private directory for brothers of Phi Beta Epsilon. Contact details are shown only
        to fellow brothers and only as each member has chosen to share them. Please keep what you
        find here within the brotherhood.
      </p>
      {withAboutLink && (
        <p className="mt-2">
          <Link
            to="/about#privacy"
            className="underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            How we handle your information
          </Link>
        </p>
      )}
      <p className="mt-2">Version {APP_VERSION}</p>
    </footer>
  );
}
