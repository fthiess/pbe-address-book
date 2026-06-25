# syntax=docker/dockerfile:1

# Container image for the Book API (apps/api) on Cloud Run.
#
# It is a TypeScript monorepo workspace that imports @pbe/shared, so it is built
# from the repo root (npm workspaces) rather than from apps/api alone. The image
# is built remotely by Cloud Build via `gcloud run deploy --source .` — no local
# Docker is required.
#
# Two stages: the build stage installs everything and compiles the shared libs
# and the esbuild bundle; the runtime stage carries only the bundle, the pruned
# production dependencies (fastify + firebase-admin), and the built @pbe/shared
# the workspace symlink points at. The esbuild bundle keeps node_modules deps
# external (apps/api `build` script), which is why the pruned node_modules ships.

# ---- build stage ----
FROM node:24-slim AS build
WORKDIR /app

# Install against the committed lockfile, then build libs + the API bundle.
COPY . .
RUN npm ci
RUN npm run build:libs
RUN npm run build:api

# Drop devDependencies (esbuild, typescript, vitest, …) so only the API's
# runtime deps — fastify, firebase-admin, and the @pbe/shared workspace link —
# remain in node_modules.
RUN npm prune --omit=dev

# ---- runtime stage ----
FROM node:24-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Pruned production node_modules (includes the @pbe/shared -> packages/shared
# workspace symlink), the built shared package that symlink resolves to, the
# API's package.json (its "type":"module" makes Node load the bundle as ESM),
# and the bundle itself.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist

# Cloud Run injects PORT (default 8080); index.ts binds it on 0.0.0.0 and
# hydrates the in-memory cache from Firestore before listening.
CMD ["node", "apps/api/dist/server.js"]
