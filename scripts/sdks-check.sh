#!/usr/bin/env bash
# sdks-check — standalone gate for the openwop-sdks repo.
#
# Mirrors the SDK steps that used to live in the spec corpus's openwop:check
# (steps 1/3/4 + the SDK-parity + python/go release-surface sub-checks). Run
# before pushing to skip the CI round-trip. Exits non-zero on any failure.
#
# Only the 2.x packages are gated: sdk/typescript-v2 · sdk/python-v2 · go/v2
# (steps 1–3: generated registries `--check`, strict typecheck, ruff,
# vet/test/gofmt), then SDK parity over spec/v2/path-manifest.json (step 4)
# and the release-surface metadata (step 5).
#
# The 1.x line (sdk/typescript · sdk/python · go/) is retired — deprecated,
# installable until about 2027-09-05, frozen in this repo and no longer built,
# tested or published here (docs/RETIRE-1X.md).
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
# requires it.
RUFF=""
if command -v ruff >/dev/null 2>&1; then
  RUFF="ruff"
elif command -v uvx >/dev/null 2>&1; then
  RUFF="uvx ruff@0.16.3"
fi

echo "[1/5] TypeScript SDK 2.x (generated registries --check + strict typecheck + build)..."
(
  cd "$ROOT/sdk/typescript-v2"
  [[ -d node_modules ]] || npm_config_cache="$NPM_CACHE" npm install --no-audit --no-fund --prefer-offline >/dev/null
  node scripts/generate.mjs --check
  node scripts/generate-payloads.mjs --check
  npx tsc --noEmit
  npm run build >/dev/null
  # (tests may assert the literal's ABSENCE, so only the shipped sources are scanned)
  if grep -rn --include='*.ts' --exclude-dir=__tests__ '/v1' src >/dev/null; then
    echo "  FAIL: sdk/typescript-v2/src carries a /v1 literal (v2-ONLY package)." >&2
    exit 1
  fi
  echo "  ok: @openwop/openwop 2.x typechecks strict (exactOptionalPropertyTypes), zero /v1 literals"
)

echo "[2/5] Python SDK 2.x (generated registries --check + ruff + unit tests)..."
(
  cd "$ROOT/sdk/python-v2"
  if [[ -z "$PY" ]]; then
    echo "  WARN: no python3 found; skipping Python 2.x SDK checks."
  else
    "$PY" scripts/generate.py --check
    for f in src/openwop_client/*.py; do "$PY" -c "import ast; ast.parse(open('$f').read())" || exit 1; done
    "$PY" -c "import sys; sys.path.insert(0, 'src'); import openwop_client; print('  openwop_client', openwop_client.__version__, 'imports clean')"
    if [[ -n "$RUFF" ]]; then
      # Bare commands, not `cmd && echo ok`: set -e ignores a failure on the left of &&.
      $RUFF check .
      echo "  ok: ruff clean"
      $RUFF format --check .
      echo "  ok: ruff format clean"
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

echo "[3/5] Go SDK v2 (generated registry --check + go vet + tests + gofmt)..."
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

echo "[4/5] SDK parity (2.x: spec/v2/path-manifest.json — one method per operation)..."
node "$ROOT/scripts/check-sdk-parity.mjs" --manifest spec/v2/path-manifest.json --expectations sdk/parity-expectations-v2.json

echo "[5/5] Python + Go + TS 2.x release-surface metadata..."
bash "$ROOT/scripts/check-python-go-release-surface.sh"

echo "[sdks] narrow unions equal the closed enums they mirror..."
node "$(dirname "$0")/check-narrow-union-drift.mjs"
echo "=== sdks:check OK ==="
