#!/usr/bin/env bash
set -euo pipefail

# Provide sensible defaults for required env vars so CI/dev runs do not fail
export BACKEND_SERVER_ID="${BACKEND_SERVER_ID:=templ-dev}"

phase() { echo; echo "[test:all] === $* ==="; }

runp() {
  # run in parallel, capture exit codes
  pids=()
  names=()
  for cmd in "$@"; do
    echo "[test:all] -> $cmd";
    bash -lc "$cmd" &
    pids+=("$!")
    names+=("$cmd")
  done
  rc=0
  for i in "${!pids[@]}"; do
    pid=${pids[$i]}
    if ! wait "$pid"; then
      echo "[test:all] FAILED: ${names[$i]}"
      rc=1
    else
      echo "[test:all] OK: ${names[$i]}"
    fi
  done
  return $rc
}

START_TS=$(date +%s)
rm -rf frontend/.vite-cache
phase "Phase 0: cloudflare deploy smoke (--skip-worker)"
WRANGLER_BIN=./scripts/__mocks__/wrangler-success.js \
  CLOUDFLARE_API_TOKEN=test-token \
  CLOUDFLARE_ACCOUNT_ID=test-account \
  APP_BASE_URL=https://templ.example \
  TRUSTED_FACTORY_ADDRESS=0x0000000000000000000000000000000000000001 \
  VITE_BACKEND_URL=https://api.templ.example \
  node scripts/deploy-cloudflare.js --skip-worker --skip-pages
rm -f backend/wrangler.deployment.toml
phase "Phase 1: contracts + slither + typechecks in parallel"
runp \
  "npm test" \
  "npm run slither:ci" \
  "npm --prefix backend run typecheck" \
  "npm --prefix frontend run typecheck"

phase "Phase 2: backend test + lint in parallel"
runp \
  "npm --prefix backend test" \
  "npm --prefix backend run lint"

phase "Phase 3: frontend unit tests + lint in parallel"
rm -rf frontend/.vite-cache
runp \
  "VITEST_FORCE_CLEAN_EXIT=1 npm --prefix frontend test" \
  "npm --prefix frontend run lint"

phase "Phase 4: frontend e2e"
rm -rf frontend/.vite-cache
if [ "${PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD:-}" != "1" ]; then
  echo "[test:all] ensuring Playwright Chromium browser is installed"
  npm --prefix frontend exec -- playwright install --with-deps chromium
  echo "[test:all] ensuring Playwright system dependencies are present"
  npm --prefix frontend exec -- playwright install-deps chromium
fi
npm --prefix frontend run test:e2e

echo "[test:all] Completed in $(( $(date +%s) - START_TS ))s"
