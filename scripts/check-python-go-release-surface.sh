#!/usr/bin/env bash
# check-python-go-release-surface — no-dependency release checks for PyPI + Go
# (+ the npm version field), for BOTH generations of packages:
#
#   1.x  sdk/python (openwop-client 1.7.0)   go/    (github.com/openwop/openwop-sdks/go)
#   2.x  sdk/python-v2 (openwop-client 2.0.0rc1) go/v2 (github.com/openwop/openwop-sdks/go/v2, tag go/v2/v2.0.0-rc.1)
#        sdk/typescript-v2 (@openwop/openwop 2.0.0-rc.1)
#
# The 2.x packages publish from the corpus release-candidate line: the npm
# version is the SemVer pre-release form, PyPI the PEP 440 form of the SAME
# tag (2.0.0-rc.1 ⇔ 2.0.0rc1); Go takes the version from the tag alone.
#
# The v2 packages are v2-ONLY siblings (v2 charter Phase 3 SDK leg, S5); the
# 1.x assertions are unchanged.

set -euo pipefail

SPEC_ROOT="."
EXPECTED_GO_MODULE="github.com/openwop/openwop-sdks/go"
EXPECTED_GO_V2_MODULE="github.com/openwop/openwop-sdks/go/v2"
EXPECTED_V2_NPM_VERSION="2.0.0-rc.1"
EXPECTED_V2_PYPI_VERSION="2.0.0rc1"

echo "=== check-python-go-release-surface — auditing Python and Go release surfaces ==="
echo

python3 - <<'PY'
from __future__ import annotations

import ast
import pathlib
import re

root = pathlib.Path(".")
expected_version = "1.7.0"
pyproject_path = root / "sdk/python/pyproject.toml"
init_path = root / "sdk/python/src/openwop_client/__init__.py"

pyproject_text = pyproject_path.read_text()


def toml_string(key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}\s*=\s*\"([^\"]+)\"", pyproject_text, re.MULTILINE)
    return match.group(1) if match else None

init_tree = ast.parse(init_path.read_text())
init_version = None
for node in init_tree.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "__version__":
                init_version = ast.literal_eval(node.value)


def fail(message: str) -> None:
    raise SystemExit(f"  FAIL: {message}")


project_version = toml_string("version")
project_description = toml_string("description")

if project_version != expected_version:
    fail(f"{pyproject_path} version is {project_version!r}, expected {expected_version!r}")
if init_version != expected_version:
    fail(f"{init_path} __version__ is {init_version!r}, expected {expected_version!r}")
if project_description is None or "production-ready" not in project_description.lower():
    fail(f"{pyproject_path} description should say production-ready")
if '"Development Status :: 5 - Production/Stable"' not in pyproject_text:
    fail(f"{pyproject_path} must use the Production/Stable classifier")
if 'packages = ["src/openwop_client"]' not in pyproject_text:
    fail(f"{pyproject_path} wheel target must include only src/openwop_client")

for path in [
    root / "sdk/python/README.md",
    root / "sdk/python/src/openwop_client/sse.py",
    root / "go/README.md",
]:
    text = path.read_text()
    stale_markers = ["v0.1", "v0.2", "Pre-1", "scaffold only", "forthcoming"]
    found = [marker for marker in stale_markers if marker in text]
    if found:
        fail(f"{path} contains stale release markers: {', '.join(found)}")

print("  ok: Python project metadata, __version__, wheel package target, and v1.0 docs are aligned.")
PY

GO_MODULE_LINE=$(grep -E "^module " "$SPEC_ROOT/go/go.mod" || true)
if [[ "$GO_MODULE_LINE" != "module $EXPECTED_GO_MODULE" ]]; then
  echo "  FAIL: go/go.mod declares '$GO_MODULE_LINE', expected 'module $EXPECTED_GO_MODULE'." >&2
  exit 1
fi
GO_VERSION_LINE=$(grep -E "^go " "$SPEC_ROOT/go/go.mod" || true)
if [[ "$GO_VERSION_LINE" != "go 1.22" ]]; then
  echo "  FAIL: go/go.mod declares '$GO_VERSION_LINE', expected 'go 1.22'." >&2
  exit 1
fi
echo "  ok: Go module path and language version are v1.0 release-ready."

# ── v2 packages ──────────────────────────────────────────────────────────
python3 - "$EXPECTED_V2_NPM_VERSION" "$EXPECTED_V2_PYPI_VERSION" <<'PY'
from __future__ import annotations

import ast
import json
import pathlib
import re
import sys

root = pathlib.Path(".")
expected_npm_version = sys.argv[1]
expected_pypi_version = sys.argv[2]


def fail(message: str) -> None:
    raise SystemExit(f"  FAIL: {message}")


pyproject_path = root / "sdk/python-v2/pyproject.toml"
init_path = root / "sdk/python-v2/src/openwop_client/__init__.py"
pyproject_text = pyproject_path.read_text()


def toml_string(key: str) -> str | None:
    match = re.search(rf"^{re.escape(key)}\s*=\s*\"([^\"]+)\"", pyproject_text, re.MULTILINE)
    return match.group(1) if match else None


init_version = None
for node in ast.parse(init_path.read_text()).body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "__version__":
                init_version = ast.literal_eval(node.value)

if toml_string("name") != "openwop-client":
    fail(f"{pyproject_path} must keep the PyPI name openwop-client (a 2.x major of the same package)")
if toml_string("version") != expected_pypi_version:
    fail(f"{pyproject_path} version is {toml_string('version')!r}, expected {expected_pypi_version!r}")
if init_version != expected_pypi_version:
    fail(f"{init_path} __version__ is {init_version!r}, expected {expected_pypi_version!r}")
if 'packages = ["src/openwop_client"]' not in pyproject_text:
    fail(f"{pyproject_path} wheel target must include only src/openwop_client")
if not (root / "sdk/python-v2/src/openwop_client/_generated.py").exists():
    fail("sdk/python-v2 is missing the generated registry module (run scripts/generate.py)")

pkg = json.loads((root / "sdk/typescript-v2/package.json").read_text())
if pkg.get("name") != "@openwop/openwop":
    fail("sdk/typescript-v2/package.json must keep the npm name @openwop/openwop (a 2.x major of the same package)")
if pkg.get("version") != expected_npm_version:
    fail(f"sdk/typescript-v2/package.json version is {pkg.get('version')!r}, expected {expected_npm_version!r}")
# The two forms MUST name the same release (2.0.0-rc.1 ⇔ 2.0.0rc1).
if re.sub(r"[-.]", "", expected_npm_version) != re.sub(r"[-.]", "", expected_pypi_version):
    fail(f"npm {expected_npm_version} and PyPI {expected_pypi_version} name different releases")
if pkg.get("repository", {}).get("directory") != "sdk/typescript-v2":
    fail("sdk/typescript-v2/package.json repository.directory must be sdk/typescript-v2")
if "generate:check" not in pkg.get("scripts", {}):
    fail("sdk/typescript-v2/package.json must expose generate:check (the registry drift gate)")
if pkg.get("dependencies"):
    fail("sdk/typescript-v2 must have zero runtime dependencies")

for path in [root / "sdk/python-v2/README.md", root / "sdk/typescript-v2/README.md", root / "go/v2/README.md"]:
    text = path.read_text()
    for marker in ["scaffold only", "forthcoming", "TODO"]:
        if marker in text:
            fail(f"{path} contains a stale release marker: {marker}")

print(f"  ok: v2 Python ({expected_pypi_version}) + TypeScript ({expected_npm_version}) metadata are aligned (same package names, generated registries).")
PY

GO_V2_MODULE_LINE=$(grep -E "^module " "$SPEC_ROOT/go/v2/go.mod" || true)
if [[ "$GO_V2_MODULE_LINE" != "module $EXPECTED_GO_V2_MODULE" ]]; then
  echo "  FAIL: go/v2/go.mod declares '$GO_V2_MODULE_LINE', expected 'module $EXPECTED_GO_V2_MODULE' (Go major-subdirectory convention; tags go/v2/vX.Y.Z)." >&2
  exit 1
fi
GO_V2_VERSION_LINE=$(grep -E "^go " "$SPEC_ROOT/go/v2/go.mod" || true)
if [[ "$GO_V2_VERSION_LINE" != "go 1.22" ]]; then
  echo "  FAIL: go/v2/go.mod declares '$GO_V2_VERSION_LINE', expected 'go 1.22'." >&2
  exit 1
fi
if [[ ! -f "$SPEC_ROOT/go/v2/generated.go" ]]; then
  echo "  FAIL: go/v2/generated.go is missing (run go/v2/scripts/generate.py)." >&2
  exit 1
fi
if grep -rn --include='*.go' '"/v1/' "$SPEC_ROOT/go/v2" >/dev/null; then
  echo "  FAIL: go/v2 carries a /v1 path literal (RFC 0172 §A: unversioned keys on a bare origin)." >&2
  exit 1
fi
echo "  ok: Go v2 module path (go/v2 major subdirectory), language version and generated registry are release-ready."

echo
echo "=== check-python-go-release-surface OK — 1.x and 2.x Python, Go and TypeScript surfaces are release-ready ==="
