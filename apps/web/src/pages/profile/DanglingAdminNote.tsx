/**
 * The OFC-242 transition warning: one paragraph added to the three confirmations
 * that take an administrator's sign-in away — mark deceased, de-brother, remove
 * email — saying the Administrator role stays behind on a record nobody can use.
 *
 * A warning only, by Forrest's call (D191): nothing is demoted automatically, and
 * nothing new surfaces a role already stranded. The last-admin invariant already
 * ignores such an admin (D129), so this is operator clarity, not a guard.
 */
export function DanglingAdminNote({ name }: { name: string }) {
  return (
    <p className="mt-3">
      <strong>{name}</strong> is an administrator, and will keep the Administrator role without
      being able to sign in. Change the role if it should not stay.
    </p>
  );
}
