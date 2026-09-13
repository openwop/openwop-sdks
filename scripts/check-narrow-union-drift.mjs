#!/usr/bin/env node
/**
 * check-narrow-union-drift — a hand-authored narrow union must equal the closed
 * enum it mirrors.
 *
 * `sdk/typescript-v2/src/types.ts` is hand-authored on purpose (see its header)
 * and uses `string` for values that may grow, reserving a narrow union for an
 * enum the corpus has actually closed. A narrow union is therefore a CLAIM
 * about a schema — and until 2026-09-13 nothing checked it. `AgentRef.modelClass`
 * listed three of the nine members of the closed enum in
 * `agent-ref.schema.json`, so every strict consumer refused six values the spec
 * allows, and it was found only because a tier-1 host bumped the SDK and read
 * the resulting type errors instead of casting them away (openwop-sdks#39).
 *
 * WHY RESOLUTION IS THREE STRATEGIES AND NOT ONE. The first audit I wrote
 * matched unions to schema enums BY PROPERTY NAME, which unions 7 distinct
 * `status` enums across 7 schemas and reported 20 confident "mismatches" that
 * were name collisions. A checker that cannot say WHICH schema a union mirrors
 * is not measuring drift, it is generating noise. So:
 *
 *   1. an explicit `Mirror of \`schemas/<file>.schema.json\`` in the docblock,
 *   2. else the schema named by the interface (`ToolDescriptor` →
 *      `tool-descriptor.schema.json`), when that file defines the property,
 *   3. else the property name IF exactly one closed enum set carries it
 *      corpus-wide — unambiguous by construction.
 *
 * Anything none of those resolves is reported as UNRESOLVED, never as a pass
 * and never as a failure: an unresolved union is a union nobody can check, and
 * the remedy is one `Mirror of` line. Printing them is how that list shrinks
 * instead of being rediscovered.
 *
 * Usage: node scripts/check-narrow-union-drift.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = join(ROOT, 'sdk', 'typescript-v2', 'src', 'types.ts');
const SCHEMAS = join(ROOT, 'schemas', 'v2');

if (!existsSync(TYPES)) { console.error(`✗ ${TYPES} not found`); process.exit(1); }
if (!existsSync(SCHEMAS)) { console.error(`✗ ${SCHEMAS} not found — the vendored schema tree is what this checks against`); process.exit(1); }

const files = readdirSync(SCHEMAS).filter((f) => f.endsWith('.json'));
if (files.length === 0) { console.error('✗ no vendored v2 schemas — nothing to check against is not a pass'); process.exit(1); }

/**
 * Every closed string enum in a schema, by property name — and separately the
 * ones under `$defs.<Name>`, which is what makes a file-level mirror safe.
 *
 * The first cut of this returned only the flat map and took the FIRST
 * occurrence of a property name it walked. `prompt-template.schema.json`
 * defines `source` twice — `$.properties.meta.properties.source` is
 * `host|pack|user` and `$.$defs.PromptVariable.properties.source` is
 * `input|variable|secret|context` — so it resolved `PromptVariable.source` to
 * the wrong one and reported a mismatch against a CORRECT type. The checker
 * accused the thing it exists to protect.
 *
 * A file name is therefore not a sufficient address when a schema names the
 * same property twice. `$defs.<InterfaceName>` is tried first because the
 * interface usually carries the `$defs` key's own name, and a `Mirror of
 * `…schema.json#/$defs/Name`` pointer settles anything that does not.
 */
function enumsOf(doc) {
  const flat = new Map();
  const defs = new Map(); // "$defs.Name" -> Map(prop -> Set)
  const collect = (node, into) => {
    if (Array.isArray(node)) return node.forEach((n) => collect(n, into));
    if (!node || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && v.type === 'string' && Array.isArray(v.enum)) {
        if (!into.has(k)) into.set(k, new Set(v.enum));
      }
      collect(v, into);
    }
  };
  for (const [name, sub] of Object.entries(doc?.$defs ?? {})) {
    const m = new Map();
    collect(sub, m);
    defs.set(name, m);
  }
  collect(doc, flat);
  return { flat, defs };
}

const perFile = new Map();
const byProp = new Map(); // property -> Set of JSON-serialised member sets
for (const f of files) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(SCHEMAS, f), 'utf8')); } catch { continue; }
  const e = enumsOf(doc);
  perFile.set(f, e);
  for (const [prop, members] of e.flat) {
    if (!byProp.has(prop)) byProp.set(prop, new Map());
    byProp.get(prop).set(JSON.stringify([...members].sort()), f);
  }
}

const kebab = (n) => n.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase();
const src = readFileSync(TYPES, 'utf8');
const blocks = [...src.matchAll(/(\/\*\*(?:[^*]|\*(?!\/))*\*\/\s*)?export interface (\w+) \{((?:[^{}]|\{[^{}]*\})*)\}/g)];
// Multi-line unions count. The first cut of this was single-line and therefore
// did not match `AgentRef.modelClass` — the ONE defect this checker exists
// because of, which prettier had wrapped across ten lines. It reported OK over
// a deliberately broken copy of that exact field. A guard that covers the
// formatting someone happened to look at is the same shape as a guard covering
// the paths where a bug was found rather than every path that has it.
const NARROW = /(\w+)\??:\s*\|?\s*('[^']+'(?:\s*\|\s*'[^']+')+)\s*;/g;

const mismatches = [];
const unresolved = [];
let checked = 0;

for (const [, doc, iface, body] of blocks) {
  const declared = doc && /Mirror of `schemas\/([^`]+\.schema\.json)`/.exec(doc)?.[1];
  for (const m of [...body.matchAll(NARROW)]) {
    const prop = m[1];
    const members = new Set([...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    let expected = null;
    let via = null;
    // A `$defs.<Interface>` node is a more precise address than the file, and
    // is tried first wherever a file is named — see enumsOf's docblock for the
    // schema that made this necessary.
    const pick = (file, pointer) => {
      const e = perFile.get(file);
      if (!e) return null;
      const defName = pointer?.replace(/^#\/\$defs\//, '') ?? iface;
      if (e.defs.get(defName)?.has(prop)) return [e.defs.get(defName).get(prop), `${file}#/$defs/${defName}`];
      if (!pointer && e.flat.has(prop)) return [e.flat.get(prop), file];
      return null;
    };
    const [declaredPath, declaredPointer] = (declared ?? '').split('#');
    const declaredFile = declaredPath ? declaredPath.split('/').pop() : null;
    if (declaredFile) {
      const hit = pick(declaredFile, declaredPointer ? `#${declaredPointer}` : undefined);
      if (hit) { [expected, via] = [hit[0], `Mirror of ${hit[1]}`]; }
    }
    if (!expected) {
      const named = `${kebab(iface)}.schema.json`;
      const hit = pick(named);
      if (hit) { [expected, via] = [hit[0], `named ${hit[1]}`]; }
    }
    if (!expected) {
      const cand = byProp.get(prop);
      if (cand && cand.size === 1) { const [json, f] = [...cand.entries()][0]; expected = new Set(JSON.parse(json)); via = `unique corpus-wide (${f})`; }
    }
    if (!expected) { unresolved.push([iface, prop, byProp.has(prop) ? `${byProp.get(prop).size} distinct enum sets carry "${prop}"` : `no v2 schema enum named "${prop}"`]); continue; }
    checked += 1;
    const missing = [...expected].filter((v) => !members.has(v)).sort();
    const extra = [...members].filter((v) => !expected.has(v)).sort();
    if (missing.length || extra.length) mismatches.push([iface, prop, via, missing, extra]);
  }
}

if (checked === 0) { console.error('✗ check-narrow-union-drift: resolved 0 unions — the sweep is broken, not the types'); process.exit(1); }

if (unresolved.length) {
  console.log(`check-narrow-union-drift: ${unresolved.length} union(s) cannot be resolved to a schema and are NOT checked.`);
  console.log('  Each is one `Mirror of `schemas/<file>.schema.json`` line in the interface docblock away from being checked:');
  for (const [iface, prop, why] of unresolved) console.log(`   – ${iface}.${prop}: ${why}`);
  console.log('');
}

if (mismatches.length) {
  console.error(`✗ check-narrow-union-drift — ${mismatches.length} narrow union(s) do not equal the closed enum they mirror:`);
  for (const [iface, prop, via, missing, extra] of mismatches) {
    console.error(`   – ${iface}.${prop} [${via}]`);
    if (missing.length) console.error(`       missing from the SDK: ${missing.join(', ')}`);
    if (extra.length) console.error(`       not in the schema:    ${extra.join(', ')}`);
  }
  console.error('   A strict consumer refuses every value the SDK omits. Widen the union to the closed enum, or use `string` if the set is not closed.');
  process.exit(1);
}

console.log(`OK: ${checked} narrow union(s) resolved to a schema enum and equal it${unresolved.length ? `; ${unresolved.length} unresolved and reported above` : ''}`);
