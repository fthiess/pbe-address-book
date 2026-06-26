/**
 * The persistent privacy-notice footer (D116). It is shown on every page, a
 * standing reminder that Book is members-only and that what a brother sees is
 * governed by each member's own privacy settings. Intentionally calm and brief.
 */
export function PrivacyFooter() {
  return (
    <footer className="border-t border-border bg-card px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">
      <p className="mx-auto max-w-2xl">
        This is a private directory for living brothers of Phi Beta Epsilon. Contact details are
        shown only to fellow brothers and only as each member has chosen to share them. Please keep
        what you find here within the brotherhood.
      </p>
    </footer>
  );
}
