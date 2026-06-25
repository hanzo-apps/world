# world.hanzo.ai — Vite SPA served by hanzoai/static, NOT nginx.
#
# Replaces the off-pattern nginx image (world:2.8.0 served Server: nginx/1.29.8,
# a platform-rule violation: "no nginx — use hanzoai/ingress + hanzoai/static
# only"). Multi-stage: produce the Vite static build, then bake it into the
# scratch-based hanzoai/static image and serve it as a SPA.
#
# Built on Hanzo's own hardware (platform.hanzo.ai -> arcd / in-cluster
# BuildKit), never on GitHub builders.
#
# Build (BuildKit, on-cluster):
#   --opt=context=https://github.com/hanzoai/world.git#<sha>
#   --opt=filename=Dockerfile
#   --output=type=image,name=ghcr.io/hanzoai/world:<tag>,push=true
#
# The dynamic data/MCP API is a SEPARATE service (world-gw); this image is the
# static frontend only (world.hanzo.ai + the tech/finance/etc. variant hosts).

# ---- build stage: Vite static build (-> ./dist) --------------------------
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# vite.config.ts: default base '/', default outDir 'dist'. VITE_VARIANT
# defaults to the full layer set; no build-time secrets are required (the
# runtime API base resolves to world-gw at request time).
RUN npm run build

# ---- serve stage: hanzoai/static (scratch + single Go binary) ------------
FROM ghcr.io/hanzoai/static:0.4.1
COPY --from=build /app/dist /srv
EXPOSE 3000
ENTRYPOINT ["/static", "--root=/srv", "--spa", "--port=3000"]
