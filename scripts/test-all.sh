#!/usr/bin/env bash
set -euo pipefail

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
runp \
  "VITEST_FORCE_CLEAN_EXIT=1 npm --prefix frontend test" \
  "npm --prefix frontend run lint"

phase "Phase 4: frontend e2e"
npm --prefix frontend run test:e2e

echo "[test:all] Completed in $(( $(date +%s) - START_TS ))s"
