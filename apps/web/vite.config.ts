import { URL, fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The local dev API (apps/api `index.dev.ts`) listens on 8787; proxy the API and
// image prefixes to it so the SPA dev server is one origin (mirroring Firebase
// Hosting's `/api`+`/img`→Cloud Run rewrites in deployed environments, D126). The
// app always calls *relative* URLs, so the same code works in dev and prod.
const DEV_API = process.env.BOOK_API_ORIGIN ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
