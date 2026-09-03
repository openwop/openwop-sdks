#!/usr/bin/env node
// check-vendored-sync — drift guard for vendored copies of canonical spec artifacts.
//
// schemas/ (and, where present, api/openapi.yaml) in this repo are VENDORED copies
// of normative artifacts whose single source of truth is the openwop/openwop spec
// corpus. This script fetches each canonical file from that repo AT THE PINNED TAG and
// fails if a vendored copy has drifted. Run in CI (scheduled + on PRs that touch
// the vendored paths) so a downstream gate can never validate against a stale
// contract.
//
// PINNED (2026-09-03, RFC 0176 §E.1 / G3 — v2 charter Phase 3, P3-0). The
// canonical ref is the published corpus tag recorded in ./CORPUS_TAG
// (`openwop-conformance/vX.Y.Z`), never `main`: the corpus is about to grow
// `schemas/v2/` and `api/v2/`, and a guard that follows `main` would start
// comparing these v1 copies against v2 canonicals (or, worse, pass a sync that
// ships v2 into a 1.x package — the H34 drift class). Bump CORPUS_TAG
// deliberately, in a PR that re-vendors from that tag.
//
// OPENWOP_SPEC_RAW_BASE still overrides the base (e.g. for a local mirror), but
// the default is derived from CORPUS_TAG and the script refuses to run without it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG_FILE = join(ROOT, 'CORPUS_TAG');
const TAG = existsSync(TAG_FILE) ? readFileSync(TAG_FILE, 'utf8').trim() : '';
if (!process.env.OPENWOP_SPEC_RAW_BASE && !/^openwop-conformance\/v\d+\.\d+\.\d+$/.test(TAG)) {
  console.error(`check-vendored-sync: CORPUS_TAG must name a published corpus tag (openwop-conformance/vX.Y.Z); got "${TAG}" — the guard never follows main`);
  process.exit(2);
}
const BASE = process.env.OPENWOP_SPEC_RAW_BASE
  ?? `https://raw.githubusercontent.com/openwop/openwop/${TAG}`;
console.log(`check-vendored-sync: canonical ref = ${process.env.OPENWOP_SPEC_RAW_BASE ? 'OPENWOP_SPEC_RAW_BASE' : TAG}`);

// Vendored paths to verify, relative to repo root. These mirror the canonical
// layout exactly (schemas/<name>.schema.json, api/openapi.yaml), so the relative
// path doubles as the canonical path.
const vendored = [];
const schemasDir = join(ROOT, 'schemas');
if (existsSync(schemasDir)) {
  for (const f of readdirSync(schemasDir)) {
    if (f.endsWith('.json')) vendored.push(`schemas/${f}`);
  }
}
for (const extra of ['api/openapi.yaml', 'api/asyncapi.yaml']) {
  if (existsSync(join(ROOT, extra))) vendored.push(extra);
}

if (vendored.length === 0) {
  console.log('check-vendored-sync: no vendored artifacts found — nothing to verify.');
  process.exit(0);
}

const drift = [];
const missing = [];
let checked = 0;

for (const rel of vendored) {
  const local = readFileSync(join(ROOT, rel), 'utf8');
  const res = await fetch(`${BASE}/${rel}`);
  if (res.status === 404) {
    missing.push(rel);
    continue;
  }
  if (!res.ok) {
    console.error(`  FAIL: could not fetch canonical ${rel} (HTTP ${res.status})`);
    process.exit(2);
  }
  const canonical = await res.text();
  // Normalize trailing-newline differences only; any real content delta is drift.
  if (local.replace(/\s+$/, '') !== canonical.replace(/\s+$/, '')) {
    drift.push(rel);
  }
  checked++;
}

if (missing.length) {
  console.error(`  FAIL: ${missing.length} vendored file(s) no longer exist in the canonical corpus (renamed/removed upstream):`);
  for (const m of missing) console.error(`    - ${m}`);
}
if (drift.length) {
  console.error(`  FAIL: ${drift.length} vendored file(s) have drifted from openwop/openwop:`);
  for (const d of drift) console.error(`    - ${d}  (refresh from ${BASE}/${d})`);
}
if (missing.length || drift.length) {
  console.error('\n  Vendored spec artifacts are out of sync with the canonical corpus. Re-vendor them.');
  process.exit(1);
}

console.log(`  ok: all ${checked} vendored spec artifact(s) match openwop/openwop canonical.`);
