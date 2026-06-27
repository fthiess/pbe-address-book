import { Link, useParams } from "react-router-dom";

/**
 * A placeholder for the Profile page (`/brother/:id`), which is built in Phase 4.
 * It exists now so the Directory's row anchors navigate to a real route and the
 * **scroll-restoration on Back** path (D31) can be exercised end-to-end in
 * Phase 3a. The full view/edit Profile replaces this wholesale.
 */
export function BrotherPlaceholder() {
  const { id } = useParams();
  return (
    <section aria-labelledby="brother-heading" className="max-w-prose">
      <h1 id="brother-heading" className="text-xl font-bold tracking-tight">
        Brother #{id}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        The full profile page arrives in Phase 4. For now this confirms the Directory's row
        navigation.
      </p>
      <Link
        to="/"
        className="mt-4 inline-block rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        ← Back to the Directory
      </Link>
    </section>
  );
}
