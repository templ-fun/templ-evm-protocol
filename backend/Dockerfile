# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base

# Install build tooling for native modules (better-sqlite3)
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pre-copy package manifests to leverage Docker layer caching
COPY backend/package.json backend/package-lock.json ./backend/

# Install backend production dependencies
RUN npm --prefix backend ci --omit=dev

# Copy shared utilities and backend source
COPY shared ./shared
COPY backend ./backend

ENV NODE_ENV=production \
    SQLITE_DB_PATH=/var/lib/templ/templ.db

# Prepare writable directory for SQLite persistence
RUN mkdir -p /var/lib/templ \
  && chown -R node:node /var/lib/templ backend shared

USER node
EXPOSE 3001

CMD ["npm", "--prefix", "backend", "start"]
