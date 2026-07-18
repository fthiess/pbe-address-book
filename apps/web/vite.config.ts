import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";
import { compileAboutHtml } from "./src/build/aboutHtml.js";

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

const ABOUT_MD = fileURLToPath(new URL("./src/content/about.md", import.meta.url));
const ABOUT_MODULE_ID = "virtual:about-html";
// Rollup's convention for a virtual module: the resolved id is prefixed with a NUL
// so no other plugin (or the filesystem) mistakes it for a real path.
const RESOLVED_ABOUT_MODULE_ID = `\0${ABOUT_MODULE_ID}`;

/** Windows gives backslashes; Vite's hot-update paths are always forward-slashed. */
const normalizePath = (path: string) => path.replace(/\\/g, "/");

/**
 * Compile the About page's Markdown to HTML at **build time** and expose it as the
 * virtual module `virtual:about-html` (OFC-244, N116). Nothing about Markdown
 * reaches the browser: `marked` is a devDependency, and the SPA imports only the
 * finished HTML string. That matters against the 250 KB brotli bundle ceiling (D74)
 * and for the slow-connection audience — a parser shipped to every reader to render
 * one static page would be a poor trade.
 *
 * A virtual module rather than a `.md` `transform`: `.md` is not a type Vite knows
 * how to serve as JS, so a bare transform is the classic "works in build, MIME-errors
 * under `vite dev`" trap. This shape behaves identically in both.
 *
 * `compileAboutHtml` throws on unsafe or ill-formed copy, so a mistake fails the
 * build rather than reaching a reader (see apps/web/src/build/aboutHtml.ts).
 */
function aboutHtmlPlugin(): Plugin {
  return {
    name: "book-about-html",
    resolveId(id) {
      return id === ABOUT_MODULE_ID ? RESOLVED_ABOUT_MODULE_ID : undefined;
    },
    load(id) {
      if (id !== RESOLVED_ABOUT_MODULE_ID) return undefined;
      // Rebuild when the copy changes, so `vite build --watch` and the dev server
      // both notice an edit to a file that is not in any import graph.
      this.addWatchFile(ABOUT_MD);
      return `export default ${JSON.stringify(compileAboutHtml(readFileSync(ABOUT_MD, "utf8")))};`;
    },
    handleHotUpdate({ file, server, modules }) {
      if (normalizePath(file) !== normalizePath(ABOUT_MD)) return undefined;
      // The virtual module isn't in the changed file's module list, so invalidate it
      // by hand and reload — copy edits then show up without restarting the server.
      const virtualModule = server.moduleGraph.getModuleById(RESOLVED_ABOUT_MODULE_ID);
      if (virtualModule) server.moduleGraph.invalidateModule(virtualModule);
      server.ws.send({ type: "full-reload" });
      return modules;
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

// The sibling newsletter's URL, injected at build time (OFC-243/N94). A deploy sets
// `BOOK_PBE_NEWS_URL` to the environment's PBE News site (staging.env points it at
// staging.pbe400.org); it defaults to the production site, so a prod build needs no
// override and never accidentally links to staging.
const PBE_NEWS_URL = process.env.BOOK_PBE_NEWS_URL ?? "https://pbe400.org";

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __PBE_NEWS_URL__: JSON.stringify(PBE_NEWS_URL),
  },
  plugins: [react(), tailwindcss(), versionJsonPlugin(APP_VERSION), aboutHtmlPlugin()],
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
