# world.hanzo.ai — Vite SPA + same-origin /api/* data backend, one Go binary.
#
# The SPA fetches SAME-ORIGIN /api/* (runtime.ts resolves to the current origin),
# so world.hanzo.ai (and every *.hanzo.app fork) must serve /api/* itself. The
# old static-only image (hanzoai/static) had no /api, so every data + live-video
# request fell through to the SPA index.html — the app showed no data and no
# video. This image fixes that: cmd/world serves BOTH the static build (with SPA
# fallback for client routes) AND the ~48 /api/* endpoints (internal/world),
# each a faithful Go port of the original edge function.
#
# Built on Hanzo's own hardware (platform.hanzo.ai -> arcd / in-cluster
# BuildKit), never on GitHub builders.
#
# Build (BuildKit, on-cluster):
#   --opt=context=https://github.com/hanzoai/world.git#<sha>
#   --opt=filename=Dockerfile
#   --output=type=image,name=ghcr.io/hanzoai/world:<tag>,push=true
#
# Data-source API keys (all optional; a missing key degrades that endpoint to a
# clean empty payload, never a 5xx) are fetched from KMS at boot — nothing is
# baked in here. WHICH keys is declared in exactly one place: worldSecretKeys
# (internal/world/kms.go). This comment used to mirror that list and drifted,
# which is how X / TikTok / LinkedIn shipped unfetchable; a name listed in a
# comment is not a name world asks KMS for.

# ---- web stage: Vite static build (-> /app/dist) -------------------------
# node:22 — package.json pins `packageManager: pnpm@11.17.0`, and corepack
# activates exactly that. pnpm 11 uses Node builtins absent from Node 20, so
# `corepack enable && pnpm install` died with ERR_UNKNOWN_BUILTIN_MODULE.
# Same class as the golang base in hanzoai/search-fts5: the image has to be
# new enough for the toolchain the repo declares.
FROM node:22-bookworm-slim AS web
WORKDIR /app
# pnpm-lock.yaml, not package-lock.json: the very next line runs
# `pnpm install --frozen-lockfile`, and this repo ships a pnpm lockfile —
# there is no package-lock.json, so the COPY failed with
#   failed to calculate checksum of ref ...: "/package-lock.json": not found
# pnpm-workspace.yaml is REQUIRED here, not optional: pnpm 11 reads
# onlyBuiltDependencies from it, and without the file the install fails on
# ERR_PNPM_IGNORED_BUILDS even though the setting is committed.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
# vite.config.ts: default base '/', default outDir 'dist'. VITE_VARIANT defaults
# to the full layer set; no build-time secrets are required (the runtime API base
# is same-origin, resolved in the browser).
ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
# Publishable ingest key for anonymous telemetry. Same KMS name as the rest of the
# fleet (hanzo/deploy/PUBLISHABLE_KEY); VITE_ is what makes Vite inline it and is a
# property of THIS build, so it is applied here and the store keeps one plain name.
# Signed-in visitors are still attributed by their own bearer — telemetry.ts passes
# this as the fallback, never as the config `ingestKey`, which would statically
# override the user.
ARG PUBLISHABLE_KEY
ENV VITE_PUBLISHABLE_KEY=$PUBLISHABLE_KEY
# Fail CLOSED, and gate here because this is the one path every builder passes
# through — a guard in one workflow protects that lane only, and this repo has
# two. An empty key builds, serves, and looks correct while every anonymous
# pageview and error is refused 401 at the door, which is exactly what 2.9.55
# shipped: the ARG existed, no lane supplied it, and nothing said so.
RUN case "$PUBLISHABLE_KEY" in \
      pk-*) : ;; \
      '')   echo "PUBLISHABLE_KEY is empty - pass --build-arg PUBLISHABLE_KEY=<pk-...> (KMS deploy/PUBLISHABLE_KEY, env prod)" >&2; exit 1 ;; \
      *)    echo "PUBLISHABLE_KEY is not a publishable key (expected a pk- prefix)" >&2; exit 1 ;; \
    esac
# The version the builder is CUTTING, so the bundle self-reports the tag it ships
# under. release.yml is the one place a release number is decided; package.json is
# only the local-dev fallback (see the __APP_VERSION__ note in vite.config.ts).
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION
RUN pnpm build
# The @hanzo/gui (Tamagui) React rewrite, built to /app/dist-react as the opt-in
# canary surface. Served only to sessions that pass ?react (see cmd/world:
# canaryHandler); the vanilla dist above stays the default.
RUN pnpm build:react

# ---- go stage: build the static server binary (CGO-free) -----------------
# go 1.26: go.mod requires >= 1.26.4 (github.com/hanzoai/sqlite drop-in). The
# binary stays CGO-free — with CGO_ENABLED=0, hanzoai/sqlite selects its vendored
# pure-Go engine (zero modernc.org/* in the module graph). That engine gates FTS5
# behind the `sqlite_fts5` build tag, which the store's items_fts virtual table
# needs — so the build below MUST carry `-tags sqlite_fts5` or Open degrades.
FROM golang:1.26.5-alpine AS gobuild
WORKDIR /src
# Every module in this graph, github.com/hanzoai/csqlite included, is public:
# the module proxy serves it and the checksum database records it. `go mod
# download` therefore needs no credential and no git binary, and go.sum stays
# authoritative for every dependency.
#
# Deps: hanzo-kv client (go-redis) + embedded SQLite (modernc). Download once for
# a cached layer before the source is copied.
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -tags sqlite_fts5 -trimpath -ldflags="-s -w" -o /out/world ./cmd/world

# ---- final stage: minimal image running the Go binary --------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
  && adduser -D -H -u 10001 world
COPY --from=gobuild /out/world /usr/local/bin/world
COPY --from=web /app/dist /srv
COPY --from=web /app/dist-react /srv-react
USER world
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/world", "--root=/srv", "--react-root=/srv-react", "--addr=:3000"]
