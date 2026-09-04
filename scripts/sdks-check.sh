#!/usr/bin/env bash
# sdks-check — standalone gate for the openwop-sdks repo.
#
# Mirrors the SDK steps that used to live in the spec corpus's openwop:check
# (steps 1/3/4 + the SDK-parity + python/go release-surface sub-checks). Run
# before pushing to skip the CI round-trip. Exits non-zero on any failure.
#
# Two generations of packages are gated (v2 charter Phase 3 SDK leg, S5):
#
#   1.x  sdk/typescript · sdk/python · go/      (steps 1–3, unchanged)
#   2.x  sdk/typescript-v2 · sdk/python-v2 · go/v2  (steps 4–6: generated
#        registries `--check`, strict typecheck, ruff, vet/test/gofmt)
#
# then SDK parity for both operation sets (step 7) and the release-surface
# metadata for both (step 8).
#
# api/openapi.yaml, api/v2/*.yaml, schemas/**, spec/v2/*.json are vendored
# copies of the canonical spec-corpus files at CORPUS_TAG (the source of truth
# lives in openwop/openwop; `npm run check:vendored` guards drift).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NPM_CACHE="${NPM_CONFIG_CACHE:-/tmp/openwop-npm-cache}"
cd "$ROOT"

echo "=== sdks:check — validating $ROOT ==="

PY=$(command -v python3.13 || command -v python3.12 || command -v python3.11 || command -v python3 || true)
# ruff: on PATH, or via uvx (dev machines with uv) — the Python 2.x leg
# requires it; the 1.x leg never did and still does not.
RUFF=""
if command -v ruff >/dev/null 2>&1; then
  RUFF="ruff"
elif command -v uvx >/dev/null 2>&1; then
  RUFF="uvx ruff@0.6.9"
fi

echo "[1/8] TypeScript SDK 1.x (build + emit dist/)..."
(
  cd "$ROOT/sdk/typescript"
  [[ -d node_modules ]] || npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  npm run build >/dev/null
)

echo "[2/8] Python SDK 1.x (syntax + import smoke)..."
(
  cd "$ROOT/sdk/python"
  if [[ -z "$PY" ]]; then
    echo "  WARN: no python3 found; skipping Python SDK smoke."
  else
    for f in src/openwop_client/*.py; do "$PY" -c "import ast; ast.parse(open('$f').read())" || exit 1; done
    "$PY" -c "import sys; sys.path.insert(0, 'src'); import openwop_client; print('  openwop_client', openwop_client.__version__, 'imports clean')"
    [[ -d tests ]] && PYTHONPATH=src "$PY" -m unittest discover -s tests
  fi
)

echo "[3/8] Go SDK v1 (go vet + tests)..."
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

echo "[4/8] TypeScript SDK 2.x (generated registries --check + strict typecheck + build)..."
(
  cd "$ROOT/sdk/typescript-v2"
  [[ -d node_modules ]] || npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  node scripts/generate.mjs --check
  npx tsc --noEmit
  npm run build >/dev/null
  # (tests may assert the literal's ABSENCE, so only the shipped sources are scanned)
  if grep -rn --include='*.ts' --exclude-dir=__tests__ '/v1' src >/dev/null; then
    echo "  FAIL: sdk/typescript-v2/src carries a /v1 literal (v2-ONLY package)." >&2
    exit 1
  fi
  echo "  ok: @openwop/openwop 2.x typechecks strict (exactOptionalPropertyTypes), zero /v1 literals"
)

echo "[5/8] Python SDK 2.x (generated registries --check + ruff + unit tests)..."
(
  cd "$ROOT/sdk/python-v2"
  if [[ -z "$PY" ]]; then
    echo "  WARN: no python3 found; skipping Python 2.x SDK checks."
  else
    "$PY" scripts/generate.py --check
    for f in src/openwop_client/*.py; do "$PY" -c "import ast; ast.parse(open('$f').read())" || exit 1; done
    "$PY" -c "import sys; sys.path.insert(0, 'src'); import openwop_client; print('  openwop_client', openwop_client.__version__, 'imports clean')"
    if [[ -n "$RUFF" ]]; then
      $RUFF check . >/dev/null && echo "  ok: ruff clean"
    else
      echo "  WARN: ruff not found (install ruff or uv); skipping the lint gate for sdk/python-v2."
    fi
    PYTHONPATH=src "$PY" -m unittest discover -s tests
    if grep -rn --include='*.py' '/v1' src >/dev/null; then
      echo "  FAIL: sdk/python-v2/src carries a /v1 literal (v2-ONLY package)." >&2
      exit 1
    fi
  fi
)

echo "[6/8] Go SDK v2 (generated registry --check + go vet + tests + gofmt)..."
(
  cd "$ROOT/go/v2"
  [[ -n "$PY" ]] && "$PY" scripts/generate.py --check
  if grep -rn --include='*.go' '"/v1/' . >/dev/null; then
    echo "  FAIL: go/v2 carries a /v1 path literal (v2-ONLY module)." >&2
    exit 1
  fi
  if ! command -v go >/dev/null 2>&1; then
    echo "  WARN: go binary not found; skipping Go v2 vet/tests/gofmt."
  else
    export GOCACHE="${GOCACHE:-/tmp/openwop-go-build-cache}"
    go vet ./...
    go test ./...
    unformatted=$(gofmt -l .)
    if [[ -n "$unformatted" ]]; then
      echo "  FAIL: gofmt -l reports:" >&2
      echo "$unformatted" >&2
      exit 1
    fi
    echo "  ok: go vet + go test + gofmt clean"
  fi
)

echo "[7/8] SDK parity (1.x: OpenAPI operations; 2.x: spec/v2/path-manifest.json — one method per operation)..."
node "$ROOT/scripts/check-sdk-parity.mjs"
node "$ROOT/scripts/check-sdk-parity.mjs" --manifest spec/v2/path-manifest.json --expectations sdk/parity-expectations-v2.json

echo "[8/8] Python + Go (+ TS 2.x) release-surface metadata..."
bash "$ROOT/scripts/check-python-go-release-surface.sh"

echo "=== sdks:check OK ==="
