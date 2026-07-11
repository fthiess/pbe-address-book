import { execSync } from "node:child_process";
import { URL, fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

/**
 * Emit a tiny, un-hashed `version.json` carrying the build id (OFC-63). Because the
 * filename is not content-hashed, Firebase Hosting serves it `no-cache,
 * must-revalidate` (N25) — the freshness the long-lived-tab version poll relies on.
 * The same document is served under the dev server so `npm run dev` behaves like a
 * deploy for the toast.
 */
function versionJsonPlugin(version: string): Plugin {
  const body = JSON.stringify({ version });
  return {
    name: "book-version-json",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: body });
    },
    configureServer(server) {
      server.middlewares.use("/version.json", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(body);
      });
    },
  };
}

/**
 * The local git commit as a fallback build id, so even a dev build reports a real
 * version (for spotting a stale cached SPA) rather than "dev". Deploys set
 * BOOK_APP_VERSION explicitly (the commit SHA), so this only runs locally, where
 * git is present; if git is unavailable it degrades to "dev".
 */
function gitVersion(): string {
  try {
    const sha = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    const dirty =
      execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim().length > 0;
    return dirty ? `${sha}-dirty` : sha;
  } catch {
    return "dev";
  }
}

// The local dev API (apps/api `index.dev.ts`) listens on 8787; proxy the API and
// image prefixes to it so the SPA dev server is one origin (mirroring Firebase
// Hosting's `/api`+`/img`→Cloud Run rewrites in deployed environments, D126). The
// app always calls *relative* URLs, so the same code works in dev and prod.
const DEV_API = process.env.BOOK_API_ORIGIN ?? "http://127.0.0.1:8787";

// The SPA build identifier captured with a bug report (DATABASE-SCHEMA §6.4
// `clientContext.webVersion`) so an admin can tell which build a report came from
// (and spot a stale cached SPA). A deploy sets `BOOK_APP_VERSION` (the commit
// SHA); locally it falls back to the git commit.
const APP_VERSION = process.env.BOOK_APP_VERSION ?? gitVersion();

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [react(), tailwindcss(), versionJsonPlugin(APP_VERSION)],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: {
      "/api": { target: DEV_API, changeOrigin: false },
      "/img": { target: DEV_API, changeOrigin: false },
    },
  },
});
