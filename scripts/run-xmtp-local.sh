#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${E2E_XMTP_LOCAL:-1}" != "1" ]; then
  echo "[XMTP local] E2E_XMTP_LOCAL!=1, skipping local node bootstrap"
  while true; do sleep 3600; done
fi

if [ ! -d "$ROOT_DIR/xmtp-local-node" ]; then
  echo "[XMTP local] missing xmtp-local-node directory; run 'git submodule update --init xmtp-local-node'" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[XMTP local] docker CLI not found; install Docker Desktop or set E2E_XMTP_LOCAL=0" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[XMTP local] docker daemon unavailable; start Docker Desktop or set E2E_XMTP_LOCAL=0" >&2
  exit 1
fi

compose_cmd() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    docker compose "$@"
  else
    docker-compose "$@"
  fi
}

cleanup() {
  (cd "$ROOT_DIR/xmtp-local-node" && compose_cmd -f docker-compose.yml -p xmtp-local-node down) || true
}
trap cleanup EXIT INT TERM

(cd "$ROOT_DIR/xmtp-local-node" && compose_cmd -f docker-compose.yml -p xmtp-local-node pull)
(cd "$ROOT_DIR/xmtp-local-node" && compose_cmd -f docker-compose.yml -p xmtp-local-node up -d --wait)

# keep the process alive so Playwright can track it
while true; do sleep 3600; done
