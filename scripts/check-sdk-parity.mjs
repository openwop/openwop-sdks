#!/usr/bin/env node
// check-sdk-parity.mjs — SDK parity gate (openwop:check step 4b).
//
// Enforces that every operation has a *declared* parity status for each
// reference SDK (TypeScript / Python / Go), and that any operation declared
// `typed` is actually wired in that SDK's source.
//
// Two operation sets, two expectations files:
//
//   default (v1)   operations come from api/openapi.yaml (a line regex, the
//                  same extraction generate-protocol-status.mjs uses) and the
//                  expectations are sdk/parity-expectations.json — the 1.x
//                  SDKs (sdk/typescript, sdk/python, go).
//
//   --manifest <spec/v2/path-manifest.json> --expectations <sdk/parity-expectations-v2.json>
//                  operations come from the generated v2 path manifest (RFC
//                  0172 §C.2: the canonical unversioned operation set, no seam
//                  or test-mode operation) and the expectations file names the
//                  2.0.0 SDK source trees in its `sdks` block. In manifest mode
//                  every entry MUST be `typed` in every SDK and MUST declare a
//                  `symbols` map for all three — a v2 SDK has exactly one
//                  method per operation (RFC 0168 §D), so "excluded" and
//                  fragment-only anchoring are not accepted.
//
// Source of truth: the expectations file — one entry per operation with
// `{operationId, method, path, ts, py, go, symbols?, note?}`, each status
// either `"typed"` (a first-class helper exists) or `"excluded"`
// (intentionally not in the SDK — requires a `note`).
//
// Three failure modes are caught:
//   1. Coverage drift — a new operation with no expectations entry.
//   2. Orphan drift — an expectations entry whose operationId no longer exists.
//   3. Regression — an operation declared `typed` whose symbol (or, for v1
//      entries without one, whose most-distinctive static path fragment) is no
//      longer present in that SDK's source.
//
// Dependency-free (runs under bare `node` in CI, no node_modules at root).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// ── CLI ──
const argv = process.argv.slice(2);
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (!v) {
    console.error(`  FAIL: ${flag} needs a value`);
    process.exit(2);
  }
  return v;
};
const MANIFEST = argValue('--manifest');
const EXPECTATIONS = argValue('--expectations') ?? 'sdk/parity-expectations.json';
const MANIFEST_MODE = MANIFEST !== null;

const DEFAULT_SDK_SOURCES = {
  ts: { label: 'TypeScript', dir: 'sdk/typescript/src', exts: ['.ts'], skip: /\.test\.|__tests__/ },
  py: { label: 'Python', dir: 'sdk/python/src/openwop_client', exts: ['.py'], skip: /(^|\/)test/ },
  go: { label: 'Go', dir: 'go', exts: ['.go'], skip: /_test\.go$|(^|\/)go\/v2(\/|$)/ },
};

function fail(msg, items) {
  console.error(`  FAIL: ${msg}`);
  for (const i of items) console.error(`    - ${i}`);
  process.exit(1);
}

// ── Operation set (operationId → {method, path}) ──
// Walk the `paths:` block of the OpenAPI document so each operationId is
// attached to its path.
function parseOpenApiOps() {
  const text = read('api/openapi.yaml');
  const lines = text.split('\n');
  const ops = new Map(); // operationId -> {method, path}
  let curPath = null;
  let curMethod = null;
  for (const line of lines) {
    const pathM = line.match(/^ {2}(\/\S*):\s*$/); // 2-space indent under paths:
    if (pathM) { curPath = pathM[1]; curMethod = null; continue; }
    const methodM = line.match(/^ {4}(get|post|put|delete|patch):\s*$/);
    if (methodM) { curMethod = methodM[1].toUpperCase(); continue; }
    const opM = line.match(/^ {6}operationId:\s*([A-Za-z0-9_]+)/);
    if (opM && curPath && curMethod) ops.set(opM[1], { method: curMethod, path: curPath });
  }
  return ops;
}

// The generated v2 path manifest carries the operation set directly.
function parseManifestOps(rel) {
  const doc = JSON.parse(read(rel));
  const ops = new Map();
  for (const op of doc.operations ?? []) {
    if (!op.operationId || !op.method || !op.path) fail(`${rel}: malformed operation entry`, [JSON.stringify(op)]);
    if (ops.has(op.operationId)) fail(`${rel}: duplicate operationId`, [op.operationId]);
    ops.set(op.operationId, { method: op.method.toUpperCase(), path: op.path });
  }
  if (doc.counts?.operations !== undefined && doc.counts.operations !== ops.size) {
    fail(`${rel}: counts.operations=${doc.counts.operations} but ${ops.size} operations listed`, []);
  }
  return ops;
}

// Most-distinctive static fragment of a path: the longest run of literal
// (non-`{param}`) characters, trailing slash trimmed. Used as a regression
// anchor — a typed method that calls this path necessarily contains this
// substring verbatim, regardless of how params are interpolated.
function distinctiveFragment(path) {
  const fragments = path.split(/\{[^}]*\}/).map((f) => f.replace(/\/+$/, ''));
  let best = '';
  for (const f of fragments) {
    const alnum = f.replace(/[^A-Za-z0-9]/g, '');
    if (alnum.length > best.replace(/[^A-Za-z0-9]/g, '').length) best = f;
  }
  return best;
}

function collectSource({ dir, exts, skip }) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(join(ROOT, d))) {
      const rel = join(d, name);
      if (skip.test(rel)) continue;
      const st = statSync(join(ROOT, rel));
      if (st.isDirectory()) walk(rel);
      else if (exts.some((e) => name.endsWith(e)) && !skip.test(name)) out.push(read(rel));
    }
  };
  walk(dir);
  return out.join('\n');
}

// ── Load expectations ──
const expDoc = JSON.parse(read(EXPECTATIONS));
const expectations = expDoc.operations;
const expById = new Map(expectations.map((e) => [e.operationId, e]));

// The expectations file may name its own SDK source trees (the v2 file does);
// the regexes are given as strings there.
const SDK_SOURCES = expDoc.sdks
  ? Object.fromEntries(
      Object.entries(expDoc.sdks).map(([k, v]) => [k, { label: v.label, dir: v.dir, exts: v.exts, skip: new RegExp(v.skip) }]),
    )
  : DEFAULT_SDK_SOURCES;
for (const lang of ['ts', 'py', 'go']) {
  if (!SDK_SOURCES[lang]) fail(`${EXPECTATIONS}: sdks block must name ts, py and go`, [lang]);
}

const ops = MANIFEST_MODE ? parseManifestOps(MANIFEST) : parseOpenApiOps();
const OPS_LABEL = MANIFEST_MODE ? MANIFEST : 'api/openapi.yaml';

// 1. Coverage: every operation is declared.
const undeclared = [...ops.keys()].filter((id) => !expById.has(id));
if (undeclared.length) {
  fail(
    `${OPS_LABEL} operations with no ${EXPECTATIONS} entry (declare ts/py/go status${MANIFEST_MODE ? ' + symbols' : ', or mark excluded with a note'}):`,
    undeclared.map((id) => `${id} (${ops.get(id).method} ${ops.get(id).path})`),
  );
}

// 2. Orphans: every declared op still exists.
const orphans = expectations.filter((e) => !ops.has(e.operationId)).map((e) => e.operationId);
if (orphans.length) {
  fail(`${EXPECTATIONS} entries for operationIds not present in ${OPS_LABEL} (stale — remove or rename):`, orphans);
}

// 3. Status validity + path agreement (+ manifest-mode mandatory symbols).
const STATUS = new Set(['typed', 'excluded']);
const invalid = [];
for (const e of expectations) {
  for (const lang of ['ts', 'py', 'go']) {
    if (!STATUS.has(e[lang])) invalid.push(`${e.operationId}.${lang}="${e[lang]}" (must be "typed" or "excluded")`);
    if (MANIFEST_MODE && e[lang] !== 'typed') invalid.push(`${e.operationId}.${lang} is "${e[lang]}" — a v2 SDK has one method per manifest operation`);
    if (MANIFEST_MODE && !e.symbols?.[lang]) invalid.push(`${e.operationId} must declare symbols.${lang} (mandatory in manifest mode)`);
  }
  if ((e.ts === 'excluded' || e.py === 'excluded' || e.go === 'excluded') && !e.note) {
    invalid.push(`${e.operationId} marks a SDK "excluded" but has no "note" explaining why`);
  }
  const live = ops.get(e.operationId);
  if (live && e.path !== live.path) {
    invalid.push(`${e.operationId} path drift: expectations="${e.path}" ${OPS_LABEL}="${live.path}"`);
  }
  if (live && e.method && e.method.toUpperCase() !== live.method) {
    invalid.push(`${e.operationId} method drift: expectations="${e.method}" ${OPS_LABEL}="${live.method}"`);
  }
}
if (invalid.length) fail(`Invalid ${EXPECTATIONS} entries:`, invalid);

// 4. Regression: every `typed` op's symbol (or path fragment) is present in
//    that SDK's source.
const sources = Object.fromEntries(Object.entries(SDK_SOURCES).map(([k, v]) => [k, collectSource(v)]));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Per-language definition-site matchers. A whole-identifier match — so a
// `symbols.go` of `GetAgent` does NOT spuriously match `GetAgentRosterEntry`,
// nor `agents_get` match `agents_get_org_chart` — and, where the language
// makes it cheap, anchored on the definition rather than any use:
//   go  `func (c *OpenwopClient) Name(`
//   py  `def name(`
//   ts  `namespace.method` — `readonly namespace = {` plus a `method:` key
//       (the client's methods are namespaced object properties)
function hasSymbol(lang, src, sym) {
  if (lang === 'go') return new RegExp(`^func \\(c \\*OpenwopClient\\) ${escapeRe(sym)}\\(`, 'm').test(src);
  if (lang === 'py') return new RegExp(`^\\s+def ${escapeRe(sym)}\\(`, 'm').test(src);
  if (lang === 'ts') {
    const [ns, method] = sym.split('.');
    if (!ns || !method) return new RegExp(`\\b${escapeRe(sym)}\\b`).test(src);
    return (
      new RegExp(`^\\s+readonly ${escapeRe(ns)} = \\{`, 'm').test(src) &&
      new RegExp(`^\\s+${escapeRe(method)}\\s*:`, 'm').test(src)
    );
  }
  return new RegExp(`\\b${escapeRe(sym)}\\b`).test(src);
}

const missing = [];
for (const e of expectations) {
  const frag = distinctiveFragment(e.path);
  for (const lang of ['ts', 'py', 'go']) {
    if (e[lang] !== 'typed') continue;
    const sym = e.symbols?.[lang];
    if (sym) {
      if (!hasSymbol(lang, sources[lang], sym)) {
        missing.push(`${e.operationId} declared typed in ${SDK_SOURCES[lang].label} but its method "${sym}" is not defined in ${SDK_SOURCES[lang].dir}`);
      }
      // In manifest mode the path anchor is checked too: the method exists
      // AND the SDK still calls the operation's path (unversioned).
      if (!MANIFEST_MODE) continue;
    }
    if (!frag || frag.replace(/[^A-Za-z0-9]/g, '').length < 4) continue; // fragment too generic to anchor on
    if (!sources[lang].includes(frag)) {
      missing.push(`${e.operationId} declared typed in ${SDK_SOURCES[lang].label} but "${frag}" is not referenced in ${SDK_SOURCES[lang].dir}`);
    }
  }
}
if (missing.length) {
  fail('SDK parity regressions (declared typed but the method/path is no longer wired):', missing);
}

// 5. Manifest mode: a v2 SDK must not carry a versioned path literal.
if (MANIFEST_MODE) {
  const versioned = [];
  for (const [lang, src] of Object.entries(sources)) {
    const hits = src.match(/["'`]\/v1\/[^"'`]*["'`]/g);
    if (hits) versioned.push(`${SDK_SOURCES[lang].label}: ${[...new Set(hits)].slice(0, 5).join(', ')}`);
  }
  if (versioned.length) fail('v2 SDK sources still carry /v1 path literals (RFC 0172 §A: unversioned keys on a bare origin):', versioned);
}

const typed = expectations.filter((e) => e.ts === 'typed' && e.py === 'typed' && e.go === 'typed').length;
const excluded = expectations.filter((e) => e.ts === 'excluded').length;
console.log(`  ok: SDK parity — ${ops.size} ${OPS_LABEL} operations declared; ${typed} fully typed across TS/Python/Go, ${excluded} intentionally excluded`);
