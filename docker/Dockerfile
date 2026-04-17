# syntax=docker/dockerfile:1.7

# Multi-stage build for the Hanzo World web app (frontend only).

# Stage 1: Build the frontend with TypeScript + Vite.
FROM node:22-alpine AS builder

WORKDIR /app

# Install deps first (cache layer).
COPY package.json package-lock.json ./
RUN npm install --ignore-scripts

# Copy source.
COPY . .

# Build-time configuration. Pass via --build-arg. Other VITE_* vars (e.g. VITE_PMTILES_URL)
# can be added here or via --build-arg for custom builds; see .env.example for the full list.
ARG VITE_VARIANT=full
ARG VITE_WS_API_URL=https://api.world.hanzo.ai

ENV VITE_VARIANT=${VITE_VARIANT}
ENV VITE_WS_API_URL=${VITE_WS_API_URL}

# tsc + vite build (skip blog — blog-site deps not installed in Docker)
RUN npx tsc && npx vite build


# Stage 2: Serve the built assets from nginx.
FROM nginx:alpine AS runtime

WORKDIR /usr/share/nginx/html

ENV API_UPSTREAM=https://api.world.hanzo.ai

# Copy built assets, nginx template (API_UPSTREAM substituted at startup), and entrypoint.
COPY --from=builder /app/dist/ ./
COPY docker/nginx.conf.template /etc/nginx/nginx.conf.template
COPY docker/nginx-security-headers.conf /etc/nginx/security_headers.conf
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80

CMD ["/docker-entrypoint.sh"]


