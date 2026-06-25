import { formatConstitutionId } from "@pbe/shared";

/**
 * Phase 0 placeholder. Its only jobs are to prove the rails work end to end:
 * the SPA builds and mounts, the shared package is importable in the client,
 * and the design token layer (styles/tokens.css) is wired so this screen
 * already wears the final brand palette in light and dark. The real app shell,
 * routing, and identity land in Phase 1.
 */
export function App() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-4 py-12 text-foreground">
      <section
        aria-labelledby="phase0-heading"
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-card-foreground shadow-sm"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          PBE Address Book
        </p>
        <h1 id="phase0-heading" className="mt-2 text-2xl font-bold tracking-tight">
          Phase&nbsp;0 — Scaffolding
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The project is wired and the toolchain is green. Product features begin with the walking
          skeleton in Phase&nbsp;1.
        </p>
        <p className="mt-6 text-sm">
          <span className="text-muted-foreground">Example brother:</span>{" "}
          <span className="font-medium">James Smyth&nbsp;’84</span>{" "}
          <span className="font-mono text-muted-foreground">({formatConstitutionId(5247)})</span>
        </p>
      </section>
    </main>
  );
}
