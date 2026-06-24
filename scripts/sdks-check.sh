#!/usr/bin/env bash
# sdks-check — standalone gate for the openwop-sdks repo.
#
# Mirrors the SDK steps that used to live in the spec corpus's openwop:check
# (steps 1/3/4 + the SDK-parity + python/go release-surface sub-checks). Run
# before pushing to skip the CI round-trip. Exits non-zero on any failure.
#
# api/openapi.yaml is a vendored copy of the canonical spec-corpus file (the
# source of truth lives in openwop/openwop); refresh it on an OpenAPI change.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NPM_CACHE="${NPM_CONFIG_CACHE:-/tmp/openwop-npm-cache}"
cd "$ROOT"

echo "=== sdks:check — validating $ROOT ==="

echo "[1/5] TypeScript SDK (build + emit dist/)..."
(
  cd "$ROOT/sdk/typescript"
  [[ -d node_modules ]] || npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  npm run build >/dev/null
)

echo "[2/5] Python SDK (syntax + import smoke)..."
(
  cd "$ROOT/sdk/python"
  PY=$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3)
  if [[ -z "$PY" ]]; then
    echo "  WARN: no python3 found; skipping Python SDK smoke."
  else
    for f in src/openwop_client/*.py; do "$PY" -c "import ast; ast.parse(open('$f').read())" || exit 1; done
    "$PY" -c "import sys; sys.path.insert(0, 'src'); import openwop_client; print('  openwop_client', openwop_client.__version__, 'imports clean')"
    [[ -d tests ]] && PYTHONPATH=src "$PY" -m unittest discover -s tests
  fi
)

echo "[3/5] Go SDK (go vet + tests)..."
(
  cd "$ROOT/go"
  if ! command -v go >/dev/null 2>&1; then
    echo "  WARN: go binary not found; skipping Go SDK vet/tests."
  else
    export GOCACHE="${GOCACHE:-/tmp/openwop-go-build-cache}"
    go vet ./...
    go test ./...
  fi
)

echo "[4/5] SDK parity (OpenAPI operations <-> per-SDK typed helpers)..."
node "$ROOT/scripts/check-sdk-parity.mjs"

echo "[5/5] Python + Go release-surface metadata..."
bash "$ROOT/scripts/check-python-go-release-surface.sh"

echo "=== sdks:check OK ==="
