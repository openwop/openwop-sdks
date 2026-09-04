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
// canonical ref is the published corpus tag recorded in ./CORPUS_TAG, never
// `main`. Two tag grammars are accepted: the suite-only
// `openwop-conformance/vX.Y.Z` form and the corpus release form
// `vX.Y.Z[-rc.N]` (RFC 0172 §D — the one release identity the v2 SDKs derive
// from). A guard that followed `main` would compare vendored copies against a
// moving target (or pass a sync that ships v2 into a 1.x package — the H34
// drift class). Bump CORPUS_TAG deliberately, in a PR that re-vendors from
// that tag.
//
// Vendored set (v2 charter Phase 3 SDK leg, S0): the v1 tree (`schemas/*.json`,
// `api/openapi.yaml`) that the 1.x SDKs mirror, plus the v2 tree the 2.0.0
// SDKs mirror — `schemas/v2/**/*.json`, `api/v2/{openapi,asyncapi}.yaml`,
// `spec/v2/path-manifest.json` (the SDK-parity operation set) and
// `spec/v2/errors.json` (the generated `ErrorCode` union source).
//
// OPENWOP_SPEC_RAW_BASE still overrides the base: an `http(s)://` raw-file
// base (e.g. a mirror) or an absolute local directory (a checkout of the
// corpus at the tag — lets the guard run before the tag is pushed). The
// default is derived from CORPUS_TAG and the script refuses to run without it.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG_FILE = join(ROOT, 'CORPUS_TAG');
const TAG = existsSync(TAG_FILE) ? readFileSync(TAG_FILE, 'utf8').trim() : '';
const TAG_RE = /^(openwop-conformance\/v\d+\.\d+\.\d+|v\d+\.\d+\.\d+(-rc\.\d+)?)$/;
if (!process.env.OPENWOP_SPEC_RAW_BASE && !TAG_RE.test(TAG)) {
  console.error(`check-vendored-sync: CORPUS_TAG must name a published corpus tag (openwop-conformance/vX.Y.Z or vX.Y.Z[-rc.N]); got "${TAG}" — the guard never follows main`);
  process.exit(2);
}
const BASE = process.env.OPENWOP_SPEC_RAW_BASE
  ?? `https://raw.githubusercontent.com/openwop/openwop/${TAG}`;
console.log(`check-vendored-sync: canonical ref = ${process.env.OPENWOP_SPEC_RAW_BASE ? 'OPENWOP_SPEC_RAW_BASE' : TAG}`);

// Vendored paths to verify, relative to repo root. These mirror the canonical
// layout exactly (schemas/<name>.schema.json, schemas/v2/<name>.schema.json,
// api/openapi.yaml, api/v2/openapi.yaml, spec/v2/<registry>.json), so the
// relative path doubles as the canonical path.
const vendored = [];
const walkJson = (dir) => {
  if (!existsSync(join(ROOT, dir))) return;
  for (const f of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${f.name}`;
    if (f.isDirectory()) walkJson(rel);
    else if (f.name.endsWith('.json')) vendored.push(rel);
  }
};
walkJson('schemas');
for (const extra of [
  'api/openapi.yaml',
  'api/asyncapi.yaml',
  'api/v2/openapi.yaml',
  'api/v2/asyncapi.yaml',
  'spec/v2/path-manifest.json',
  'spec/v2/errors.json',
]) {
  if (existsSync(join(ROOT, extra))) vendored.push(extra);
}
vendored.sort();

// A local directory base reads the canonical file from disk (a checkout at the
// tag); anything else is fetched as `${BASE}/${rel}`.
const LOCAL_BASE = BASE.startsWith('/') ? BASE : null;
async function fetchCanonical(rel) {
  if (LOCAL_BASE) {
    const p = join(LOCAL_BASE, rel);
    if (!existsSync(p)) return { status: 404, ok: false, text: async () => '' };
    return { status: 200, ok: true, text: async () => readFileSync(p, 'utf8') };
  }
  return fetch(`${BASE}/${rel}`);
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
  const res = await fetchCanonical(rel);
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
