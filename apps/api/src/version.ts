import { execSync } from "node:child_process";

/**
 * The API build identifier (commit SHA), stamped onto bug reports so an admin can
 * see the server's version alongside the SPA's `webVersion` — a mismatch means a
 * stale cached SPA or a web/API skew (D121, N61 follow-up). A deploy sets
 * `BOOK_API_VERSION` as a Cloud Run env var; locally it falls back to the git
 * commit. In the container (no git, env set) it never shells out. If neither is
 * available it degrades to "dev".
 */
export function resolveApiVersion(): string {
  const fromEnv = process.env.BOOK_API_VERSION;
  if (fromEnv && fromEnv.trim() !== "") {
    return fromEnv.trim();
  }
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "dev";
  }
}
