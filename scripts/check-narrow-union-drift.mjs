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
      // `type: 'string'` is NOT required. Requiring it made 239 of the corpus's
      // 532 string enums invisible to this checker — 45% — including
      // `a2ui-surface-delta-frame`'s `op`, which is written as a bare `enum`
      // with a description and no `type`. Both spellings are valid JSON Schema
      // and mean the same closed set; a checker that only sees one of them is
      // reporting coverage it does not have.
      if (
        v && typeof v === 'object' && !Array.isArray(v) &&
        Array.isArray(v.enum) && v.enum.length > 0 && v.enum.every((x) => typeof x === 'string')
      ) {
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
  e.doc = doc;
  perFile.set(f, e);
  for (const [prop, members] of e.flat) {
    if (!byProp.has(prop)) byProp.set(prop, new Map());
    byProp.get(prop).set(JSON.stringify([...members].sort()), f);
  }
}

const kebab = (n) => n.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase();
const src = readFileSync(TYPES, 'utf8');
/**
 * Interface bodies are extracted by COUNTING BRACES, not by a regex.
 *
 * The regex this replaces was `((?:[^{}]|\{[^{}]*\})*)` — one level of
 * nesting. `EffectSeamManifest` nests two (`host: { build: { … } }`), so the
 * whole interface failed to match and EVERY union inside it was invisible:
 * `build.kind` and `seams[].kind`, plus `InterruptByTokenInspection.kind`.
 * Three of 42.
 *
 * The gate's VERDICT was right on the 39 it saw. Its COVERAGE was not, and the
 * output is indistinguishable between the two — which is exactly the shape the
 * tier-2 host reported in an era-3 guard covering 22 of 28 appended types on
 * the same day. A right verdict on partial coverage re-runs clean forever.
 */
function interfaceBlocks(text) {
  const out = [];
  const head = /(\/\*\*(?:[^*]|\*(?!\/))*\*\/\s*)?export interface (\w+)[^{]*\{/g;
  let m;
  while ((m = head.exec(text)) !== null) {
    let depth = 1;
    let i = head.lastIndex;
    for (; i < text.length && depth > 0; i += 1) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
    }
    out.push([m[0], m[1], m[2], text.slice(head.lastIndex, i - 1)]);
    head.lastIndex = i;
  }
  return out;
}
const blocks = interfaceBlocks(src);

/**
 * SELF-TEST, run on every invocation.
 *
 * "The sweep found N unions" proves the LOOP ran. It does not prove the
 * extractor can still see a union — which is the claim the whole gate rests on,
 * and the one that rots silently when someone reformats types.ts. Three of 42
 * unions were invisible here until today for exactly that reason: two behind
 * a brace-depth limit, one behind a comment between alternatives.
 *
 * So the extractor is exercised against a known-good fixture that contains both
 * traps. If it cannot find them, the gate refuses to report on the real file.
 * Distinction owed to the tier-2 host: "there was data to compare" and "the
 * comparison can fail" are different claims, and only the second is worth
 * asserting.
 */
const SELFTEST = [
  '/** doc */',
  'export interface __SelfTestNested {',
  '  outer: {',
  '    inner: { deep: \'a\' | \'b\'; id: string };',
  '  };',
  '  listed: readonly {',
  '    tagged: \'x\' | \'y\';',
  '  }[];',
  '  commented:',
  '    | \'one\'',
  '    // a comment between alternatives',
  '    | \'two\';',
  '}',
].join('\n');
{
  const found = [];
  for (const [, , , rawBody] of interfaceBlocks(SELFTEST)) {
    const b = rawBody.replace(/^[ \t]*\/\/.*$/gm, '');
    for (const m of b.matchAll(/(\w+)\??:\s*\|?\s*('[^']+'(?:\s*\|\s*'[^']+')+)\s*;/g)) found.push(m[1]);
  }
  const want = ['deep', 'tagged', 'commented'];
  const missing = want.filter((w) => !found.includes(w));
  if (missing.length) {
    console.error(`✗ check-narrow-union-drift self-test: the extractor did not find ${missing.join(', ')} (found: ${found.join(', ') || 'nothing'}).`);
    console.error('  The sweep cannot see a union it is supposed to see, so a green run on the real file would mean nothing.');
    process.exit(1);
  }
}
// Multi-line unions count. The first cut of this was single-line and therefore
// did not match `AgentRef.modelClass` — the ONE defect this checker exists
// because of, which prettier had wrapped across ten lines. It reported OK over
// a deliberately broken copy of that exact field. A guard that covers the
// formatting someone happened to look at is the same shape as a guard covering
// the paths where a bug was found rather than every path that has it.
const NARROW = /(\w+)\??:\s*\|?\s*('[^']+'(?:\s*\|\s*'[^']+')+)\s*;/g;

const mismatches = [];
const unresolved = [];
const attributed = [];
let checked = 0;

for (const [, doc, iface, rawBody] of blocks) {
  // Strip WHOLE-LINE `//` comments before matching. A union may be documented
  // between its alternatives —
  //     kind:
  //       | 'custom'
  //       // Phase 4 — multi-turn user interjections.
  //       | 'conversation.start'
  // — and the alternation regex admits only whitespace between members, so one
  // interleaved comment made `InterruptByTokenInspection.kind` (8 values)
  // invisible. Only full-line comments are removed, so a `//` inside a string
  // literal survives.
  const body = rawBody.replace(/^[ \t]*\/\/.*$/gm, '');
  // Three declaration forms, because the nine unions this gate could not
  // resolve were not nine of the same thing. Telling all of them "add a Mirror
  // of line" was advice that is wrong for five of them.
  //
  //   Mirror of    — the union equals a closed schema enum.
  //   Narrowing of — the union is a deliberate SUBSET of one (a cancel response
  //                  can only answer with two of run-snapshot's ten statuses).
  //                  Checked as ⊆: a value the schema does not have is still a
  //                  failure, so drift in the narrowed direction is caught.
  //   Authority    — the closed set's authority is not in schemas/v2 at all.
  //                  `HttpRequestNodeConfig.method` is declared by the registry
  //                  node type; `refusalMode` exists only as v1 prose in
  //                  ai-envelope.md and has never had a JSON Schema in either
  //                  major. Naming the authority is not a check, and is not
  //                  pretending to be one — it converts "nobody knows" into a
  //                  written claim someone can falsify.
  // Per-PROPERTY form, needed once an interface carries the same property name
  // at two different paths. `EffectSeamManifest` has `host.build.kind` and
  // `seams[].kind` — different enums, one interface — so a single file-level
  // declaration cannot say which is which.
  //   Mirror of `kind` at `schemas/v2/x.schema.json#/properties/a/properties/kind`
  // A prop may be declared MORE THAN ONCE: `EffectSeamManifest` carries
  // `host.build.kind` and `seams[].kind`, different enums under one name. Each
  // declaration is a pointer; the interface's unions for that name must pair
  // with them one-to-one, so the check is a multiset match rather than a lookup.
  const perProp = new Map();
  if (doc) {
    for (const m of doc.matchAll(/Mirror of `(\w+)` at `schemas\/([^`]+)`/g)) {
      if (!perProp.has(m[1])) perProp.set(m[1], []);
      perProp.get(m[1]).push(m[2]);
    }
  }
  const multiDeclared = new Set([...perProp].filter(([, v]) => v.length > 1).map(([k]) => k));
  const declared = doc && /Mirror of `schemas\/([^`]+)`/.exec(doc)?.[1];
  const narrowed = doc && /Narrowing of `schemas\/([^`]+)`/.exec(doc)?.[1];
  const authority = doc && /Authority `([^`]+)`/.exec(doc)?.[1]?.replace(/\s*\n\s*\*\s*/g, ' ');
  for (const m of [...body.matchAll(NARROW)]) {
    const prop = m[1];
    const members = new Set([...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    let expected = null;
    let via = null;
    let subsetOnly = false;
    if (authority) { attributed.push([iface, prop, authority]); continue; }
    // A `$defs.<Interface>` node is a more precise address than the file, and
    // is tried first wherever a file is named — see enumsOf's docblock for the
    // schema that made this necessary.
    const atPointer = (docRoot, pointer) => {
      let node = docRoot;
      for (const raw of pointer.replace(/^#/, '').split('/').filter(Boolean)) {
        const seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        node = Array.isArray(node) ? node[Number(seg)] : node?.[seg];
        if (node === undefined) return null;
      }
      return Array.isArray(node?.enum) ? new Set(node.enum) : null;
    };
    const pick = (file, pointer) => {
      const e = perFile.get(file);
      if (!e) return null;
      // A pointer that is not the `#/$defs/Name` shorthand is resolved literally
      // against the document, so an enum living at
      // `#/properties/replay/properties/modes/items` is addressable.
      if (pointer && !/^#\/\$defs\/[^/]+$/.test(pointer)) {
        const hit = atPointer(e.doc, pointer);
        return hit ? [hit, `${file}${pointer}`] : null;
      }
      const defName = pointer?.replace(/^#\/\$defs\//, '') ?? iface;
      if (e.defs.get(defName)?.has(prop)) return [e.defs.get(defName).get(prop), `${file}#/$defs/${defName}`];
      if (!pointer && e.flat.has(prop)) return [e.flat.get(prop), file];
      return null;
    };
    const decls = perProp.get(prop) ?? [];
    if (multiDeclared.has(prop)) {
      // Pair by CONTENT: this union must equal one of the declared enums, and
      // each declared enum must be claimed by exactly one union. Pairing by
      // order would make the check depend on source layout.
      const cands = decls
        .map((d) => { const [f, ptr] = d.split('#'); return pick(f.split('/').pop(), ptr ? `#${ptr}` : undefined); })
        .filter(Boolean);
      const eq = cands.find(([en]) => en.size === members.size && [...en].every((v) => members.has(v)));
      if (eq) { checked += 1; continue; }                       // paired and equal
      // No exact pair. Report against the CLOSEST declared enum by symmetric
      // difference, not the first one: with two `kind` pointers on this
      // interface, `cands[0]` named `build.kind`'s values for a drift in
      // `seams[].kind` — a failure message that sends the reader to the wrong
      // enum is worse than a vague one.
      if (cands.length) {
        const dist = ([en]) => [...en].filter((v) => !members.has(v)).length + [...members].filter((v) => !en.has(v)).length;
        const best = cands.reduce((a, b) => (dist(b) < dist(a) ? b : a));
        [expected, via] = [best[0], `Mirror of ${best[1]} (closest of ${decls.length} declared pointers)`];
      }
    } else if (decls.length === 1) {
      const [pp, ppointer] = decls[0].split('#');
      const hit = pick(pp.split('/').pop(), ppointer ? `#${ppointer}` : undefined);
      if (hit) { [expected, via] = [hit[0], `Mirror of ${hit[1]}`]; }
    }
    const [declaredPath, declaredPointer] = (declared ?? '').split('#');
    const declaredFile = declaredPath ? declaredPath.split('/').pop() : null;
    if (!expected && declaredFile) {
      const hit = pick(declaredFile, declaredPointer ? `#${declaredPointer}` : undefined);
      if (hit) { [expected, via] = [hit[0], `Mirror of ${hit[1]}`]; }
    }
    if (!expected && narrowed) {
      const [np, npointer] = narrowed.split('#');
      const hit = pick(np.split('/').pop(), npointer ? `#${npointer}` : undefined);
      if (hit) { [expected, via, subsetOnly] = [hit[0], `Narrowing of ${hit[1]}`, true]; }
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
    const missing = subsetOnly ? [] : [...expected].filter((v) => !members.has(v)).sort();
    const extra = [...members].filter((v) => !expected.has(v)).sort();
    if (missing.length || extra.length) mismatches.push([iface, prop, via, missing, extra]);
  }
}

if (checked === 0) { console.error('✗ check-narrow-union-drift: resolved 0 unions — the sweep is broken, not the types'); process.exit(1); }

if (unresolved.length) {
  console.error(`\u2717 check-narrow-union-drift \u2014 ${unresolved.length} narrow union(s) declare no authority:`);
  for (const [iface, prop, why] of unresolved) console.error(`   \u2013 ${iface}.${prop}: ${why}`);
  console.error('');
  console.error('  A union nobody can resolve is a union nobody checks, and a list that is only');
  console.error('  printed gets rediscovered instead of shrinking. Add ONE line to the interface');
  console.error('  docblock saying where the closed set comes from:');
  console.error('');
  console.error('    Mirror of `schemas/v2/<file>.schema.json`          \u2014 equals that enum');
  console.error('    Mirror of `schemas/v2/<file>.schema.json#/a/b`     \u2014 ... at a JSON pointer');
  console.error('    Narrowing of `schemas/v2/<file>.schema.json#/a/b`  \u2014 a deliberate subset of it');
  console.error('    Authority `<where the set is actually defined>`    \u2014 not in schemas/v2 at all');
  console.error('');
  console.error('  Pick by what is TRUE, not by what makes this pass: a wrong `Mirror of` turns a');
  console.error('  real subset into a false failure, and a lazy `Authority` hides real drift.');
  process.exit(1);
}

if (attributed.length) {
  console.log(`check-narrow-union-drift: ${attributed.length} union(s) attributed to an authority outside schemas/v2 \u2014 recorded, not machine-checked:`);
  for (const [iface, prop, who] of attributed) console.log(`   \u2013 ${iface}.${prop}: ${who}`);
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

console.log(`=== check-narrow-union-drift OK \u2014 ${checked} narrow union(s) checked against a schema enum, ${attributed.length} attributed to a named non-schema authority, 0 unresolved ===`);
