import type { Role } from "@pbe/shared";

const LABEL: Record<Role, string> = {
  brother: "Brother",
  manager: "Manager",
  admin: "Admin",
};

/**
 * The caller's role, shown in the app shell (ENGINEERING-DESIGN §2.4). Brother
 * is the quiet default; manager/admin are emphasized so an elevated session is
 * always visible to the person holding it.
 */
export function RoleBadge({ role }: { role: Role }) {
  const emphasized = role !== "brother";
  return (
    <span
      className={
        emphasized
          ? "rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground"
          : "rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
      }
    >
      {LABEL[role]}
    </span>
  );
}
