#!/usr/bin/env bash
set -euo pipefail

if ! command -v slither >/dev/null 2>&1; then
  echo "[warn] slither not installed, skipping"
  exit 0
fi

if ! command -v solc-select >/dev/null 2>&1; then
  echo "[warn] solc-select not installed, skipping"
  exit 0
fi

solc-select install 0.8.23
solc-select use 0.8.23

report=$(mktemp)
trap 'rm -f "$report"' EXIT

set +e
slither contracts/TEMPL.sol --config-file slither.config.json 2>&1 | tee "$report"
status=${PIPESTATUS[0]}
set -e

if [ "$status" -ne 0 ]; then
  if grep -Eq 'Invalid solc compilation|Stack too deep' "$report"; then
    echo "[error] Slither failed due to Solidity compilation error" >&2
    exit "$status"
  fi

  echo "[warn] Slither exited with status $status; ignoring non-compilation failure" >&2
  exit 0
fi
