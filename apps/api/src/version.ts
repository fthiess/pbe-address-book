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
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    // Match the SPA's dev fallback (vite.config.ts) exactly — including the
    // `-dirty` suffix — so a local dev build doesn't show a false web/API skew.
    const dirty =
      execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "dev";
  }
}
