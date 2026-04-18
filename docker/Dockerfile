# syntax=docker/dockerfile:1.7

# Hanzo World — optimized multi-stage build (~3 min on native runners)

# Stage 1: Install deps + build frontend
FROM node:22-alpine AS builder
LABEL org.opencontainers.image.source="https://github.com/hanzoai/world"

WORKDIR /app

# Deps layer — cached unless package*.json changes
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --prefer-offline 2>/dev/null || npm install --ignore-scripts

# Source (.dockerignore excludes node_modules, .git, tests, src-tauri, etc.)
COPY . .

ARG VITE_VARIANT=full
ENV VITE_VARIANT=${VITE_VARIANT}

# Skip tsc — CI typechecks separately. Vite build only.
RUN npx vite build

# Stage 2: Serve from nginx (~25MB final image)
FROM nginx:alpine

WORKDIR /usr/share/nginx/html

ENV API_UPSTREAM=https://worldmonitor.app

COPY --from=builder /app/dist/ ./
COPY docker/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/nginx-security-headers.conf /etc/nginx/security_headers.conf
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80
CMD ["/docker-entrypoint.sh"]
