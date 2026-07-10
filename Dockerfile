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
# clean empty payload, never a 5xx) are injected as env at deploy time from KMS:
#   YOUTUBE_API_KEY (live-video reliability; scrape fallback needs no key),
#   FRED_API_KEY, FINNHUB_API_KEY, NASA_FIRMS_API_KEY, EIA_API_KEY,
#   ACLED_ACCESS_TOKEN, CLOUDFLARE_API_TOKEN, WINGBITS_API_KEY, WS_RELAY_URL,
#   HANZO_AI_KEY (+ HANZO_AI_BASE / HANZO_AI_MODEL) for the AI endpoints.

# ---- web stage: Vite static build (-> /app/dist) -------------------------
FROM node:20-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# vite.config.ts: default base '/', default outDir 'dist'. VITE_VARIANT defaults
# to the full layer set; no build-time secrets are required (the runtime API base
# is same-origin, resolved in the browser).
ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
RUN npm run build

# ---- go stage: build the static server binary (CGO-free) -----------------
# go 1.25: the embedded datastore (modernc.org/sqlite, pure Go) needs it. The
# binary stays CGO-free — modernc's SQLite is pure Go, so no C toolchain is added.
FROM golang:1.25-alpine AS gobuild
WORKDIR /src
# Deps: hanzo-kv client (go-redis) + embedded SQLite (modernc). Download once for
# a cached layer before the source is copied.
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/world ./cmd/world

# ---- final stage: minimal image running the Go binary --------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata \
  && adduser -D -H -u 10001 world
COPY --from=gobuild /out/world /usr/local/bin/world
COPY --from=web /app/dist /srv
USER world
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/world", "--root=/srv", "--addr=:3000"]
