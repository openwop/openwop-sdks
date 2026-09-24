// generate-payloads.mjs — emits src/generated-payloads.ts from the vendored v2 corpus.
//
// Sources (vendored at CORPUS_TAG by scripts/check-vendored-sync.mjs):
//   spec/v2/event-codemap.json              → which payload definition each v2 event type carries
//   schemas/v2/run-event-payloads.schema.json + the schemas it $refs → the definitions themselves
//
// `RunEventDoc.payload` stays `unknown` and `type` stays `string` in types.ts
// (COMPATIBILITY.md §2.1 — a consumer must keep type-checking on an event type
// it has never seen). This file adds the OPT-IN narrowing: `RunEventPayloads`
// maps every codemap v2 name to its payload type, and `narrowRunEvent()` hands
// back a discriminated `KnownRunEvent` only for a type the corpus names. A
// vendor-org type is never in the map. The RFC 0185 hatch
// (`^(openwop-|x-|vendor\.)`) is an index signature on every hatched definition.
//
// Dependency-free JSON Schema → TypeScript for the subset the corpus uses:
// object/properties/required/additionalProperties/patternProperties, string,
// integer, number, boolean, null, array/items, enum, const, oneOf/anyOf (union),
// allOf (intersection), local and cross-file $ref. Anything else is `unknown`,
// and `--check` fails when the committed file drifts from the registries.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = join(HERE, '..');
const REPO = join(PKG, '..', '..');
const OUT = join(PKG, 'src', 'generated-payloads.ts');
const SCHEMAS = join(REPO, 'schemas', 'v2');
const CANON = 'https://openwop.dev/spec/v2/';
const HATCH = '^(openwop-|x-|vendor\\.)';

const codemap = JSON.parse(readFileSync(join(REPO, 'spec', 'v2', 'event-codemap.json'), 'utf8'));
const docs = new Map();
function loadDoc(file) {
  if (!docs.has(file)) {
    const p = join(SCHEMAS, file);
    if (!existsSync(p)) throw new Error(`generate-payloads: ${file} is referenced but not vendored`);
    docs.set(file, JSON.parse(readFileSync(p, 'utf8')));
  }
  return docs.get(file);
}
const ROOT_FILE = 'run-event-payloads.schema.json';
const root = loadDoc(ROOT_FILE);

const pascal = (s) => s.replace(/^_+/, '').replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase());
const fileBase = (file) => pascal(basename(file).replace('.schema.json', ''));
// A description is carried verbatim unless it names the 1.x path space, which
// the v2-ONLY package gate (sdks-check step 4) forbids anywhere in src/ — such
// a description is dropped, not rewritten, so the generated text never says
// something the schema did not.
const V1_PATH = ['/v', '1'].join('');
const oneLine = (s) => String(s).replace(/\*\//g, '* /').replace(/\s+/g, ' ').trim();
const carryDesc = (s) => (s && !String(s).includes(V1_PATH) ? oneLine(s) : '');

const emitted = new Map(); // name → text (null while in progress)
const order = [];
function nameFor(file, def) {
  // Local definitions are `<Def>Payload`; a cross-file root is `<File>Schema` and
  // its definitions `<File>Schema_<Def>` — distinct namespaces, so a payload def
  // that aliases a whole sibling schema (channelPresence → channel-presence-payload)
  // cannot collide with it and reference itself.
  if (file === ROOT_FILE) return def ? `${pascal(def)}Payload` : 'RunEventPayloadsRoot';
  return def ? `${fileBase(file)}Schema_${pascal(def)}` : `${fileBase(file)}Schema`;
}
function resolveRef(ref, ctxFile) {
  const [filePart, frag] = ref.split('#');
  let file = ctxFile;
  if (filePart) {
    // Absolute `$id` URLs and sibling-relative file refs both name a file under schemas/v2/.
    const rel = filePart.startsWith(CANON) ? filePart.slice(CANON.length) : filePart.replace(/^\.\//, '');
    if (/^[A-Za-z0-9._-]+\.schema\.json$/.test(rel)) file = rel;
    else throw new Error(`generate-payloads: unexpected $ref base ${filePart}`);
  }
  const def = frag ? frag.replace(/^\/\$defs\//, '') : null;
  if (frag && !frag.startsWith('/$defs/')) throw new Error(`generate-payloads: unsupported fragment ${frag}`);
  return { file, def };
}
function ensure(file, def) {
  const name = nameFor(file, def);
  if (!emitted.has(name)) {
    emitted.set(name, null);
    const doc = loadDoc(file);
    const node = def ? doc.$defs?.[def] : doc;
    if (!node) throw new Error(`generate-payloads: ${file}#/$defs/${def} not found`);
    const desc = carryDesc(node.description) ? `/** ${carryDesc(node.description)} */\n` : '';
    emitted.set(name, `${desc}export type ${name} = ${toTs(node, file, 1)};`);
    order.push(name);
  }
  return name;
}
function toTs(node, file, depth) {
  if (typeof node !== 'object' || node === null) return 'unknown';
  if (node.$ref) { const { file: f, def } = resolveRef(node.$ref, file); return ensure(f, def); }
  if (Array.isArray(node.enum)) return node.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (node.const !== undefined) return JSON.stringify(node.const);
  const alts = node.oneOf ?? node.anyOf;
  if (Array.isArray(alts)) return `(${alts.map((n) => toTs(n, file, depth)).join(' | ')})`;
  if (Array.isArray(node.allOf)) {
    // A JSON-Schema conditional (`if`/`then`) carries no type of its own, so a
    // member-wise intersection typed each one `unknown` — and dropped the
    // node's OWN `properties` entirely. That is what collapsed
    // `InterruptRequestedPayload` to `unknown` once suspend-request.schema.json
    // bound `data` to `kind` with one `if: { kind: const } then: { data: $ref }`
    // per kind (corpus 2.36.0, MCP/A2A review P3-H7). A block of such
    // conditionals over ONE const discriminant is a discriminated union: one
    // branch per `if`, the base object with the discriminant narrowed to that
    // const and the `then` properties overlaid.
    const conds = node.allOf.filter((m) => m && typeof m === 'object' && m.if && m.then);
    const rest = node.allOf.filter((m) => !conds.includes(m));
    const { allOf: _drop, ...base } = node;
    const hasOwn = base.properties || base.type;
    const disc = (m) => {
      const ps = Object.entries(m.if.properties ?? {}).filter(([, v]) => v && v.const !== undefined);
      return ps.length === 1 ? ps[0] : null;
    };
    const parts = [];
    if (hasOwn && conds.length > 0 && conds.every((m) => disc(m) !== null && !m.else)) {
      const branches = conds.map((m) => {
        const [key, cv] = disc(m);
        return toTs({
          ...base,
          properties: { ...(base.properties ?? {}), [key]: { const: cv.const }, ...(m.then.properties ?? {}) },
          required: [...new Set([...(base.required ?? []), key, ...(m.then.required ?? [])])],
        }, file, depth);
      });
      parts.push(`(${branches.join(' | ')})`);
    } else if (hasOwn) {
      parts.push(toTs(base, file, depth));
    }
    for (const m of (hasOwn && parts.length > 0 && conds.length > 0 && conds.every((c) => disc(c) !== null && !c.else) ? rest : node.allOf.filter((x) => !(hasOwn && conds.includes(x))))) parts.push(toTs(m, file, depth));
    return parts.length === 1 ? parts[0] : `(${parts.join(' & ')})`;
  }
  const types = Array.isArray(node.type) ? node.type : node.type ? [node.type] : (node.properties || node.patternProperties ? ['object'] : null);
  if (!types) return 'unknown';
  const pad = '  '.repeat(depth);
  const parts = types.map((t) => {
    switch (t) {
      case 'string': return 'string';
      case 'integer': case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'null': return 'null';
      case 'array': return `Array<${node.items ? toTs(node.items, file, depth) : 'unknown'}>`;
      case 'object': {
        const props = node.properties ?? {};
        const req = new Set(node.required ?? []);
        const lines = [];
        for (const [k, v] of Object.entries(props)) {
          const d = v && carryDesc(v.description) ? `/** ${carryDesc(v.description)} */ ` : '';
          lines.push(`${pad}${d}${JSON.stringify(k)}${req.has(k) ? '' : '?'}: ${toTs(v, file, depth + 1)};`);
        }
        for (const [pat, v] of Object.entries(node.patternProperties ?? {})) {
          if (pat === HATCH) lines.push(`${pad}/** RFC 0185 §B hatch — a vendor-prefixed property the host carried rather than dropped. */ [key: \`openwop-\${string}\` | \`x-\${string}\` | \`vendor.\${string}\`]: unknown;`);
          else lines.push(`${pad}/** patternProperties ${oneLine(pat)} */ [key: string]: ${toTs(v, file, depth + 1)};`);
        }
        const ap = node.additionalProperties;
        if (ap === true || (ap && typeof ap === 'object')) lines.push(`${pad}[key: string]: ${ap === true ? 'unknown' : toTs(ap, file, depth + 1)};`);
        if (lines.length === 0) return 'Record<string, never>';
        return `{\n${lines.join('\n')}\n${'  '.repeat(depth - 1)}}`;
      }
      default: return 'unknown';
    }
  });
  return parts.join(' | ');
}

// The map: every codemap row's v2 name → its payload definition.
const rows = [...codemap.rows].sort((a, b) => a.v2.localeCompare(b.v2));
const seen = new Set();
const mapLines = [];
for (const r of rows) {
  if (seen.has(r.v2)) throw new Error(`generate-payloads: duplicate v2 name ${r.v2} in the codemap`);
  seen.add(r.v2);
  if (!r.payloadDef) throw new Error(`generate-payloads: ${r.v2} has no payloadDef`);
  mapLines.push(`  ${JSON.stringify(r.v2)}: ${ensure(ROOT_FILE, r.payloadDef)};`);
}
const header = `// GENERATED by scripts/generate-payloads.mjs — do not edit.
//
// Sources: spec/v2/event-codemap.json (${rows.length} v2 event types, updated ${codemap.updated ?? '?'}) and
// schemas/v2/run-event-payloads.schema.json (${Object.keys(root.$defs ?? {}).length} definitions) plus the schemas it
// references, all vendored at CORPUS_TAG.
// \`npm run generate\` rewrites this file; \`npm run generate:check\` fails on drift.
//
// Forward-compat (COMPATIBILITY.md §2.1): RunEventDoc keeps \`type: string\` and
// \`payload: unknown\`. This file is the OPT-IN narrowing for the types the corpus
// names; a vendor-org event type is never in the map.

import type { RunEventDoc } from './types.js';

/** Every v2 event type the codemap names, mapped to its payload type. */
export interface RunEventPayloads {
${mapLines.join('\n')}
}

/** The event types \`RunEventPayloads\` names. */
export type KnownRunEventType = keyof RunEventPayloads;

/** The same set as a runtime array, sorted. */
export const KNOWN_RUN_EVENT_TYPES = [
${rows.map((r) => `  ${JSON.stringify(r.v2)},`).join('\n')}
] as const;

const KNOWN = new Set<string>(KNOWN_RUN_EVENT_TYPES);

/** True when \`type\` is one the corpus names. A vendor-org type is false, and that is not an error. */
export function isKnownRunEventType(type: string): type is KnownRunEventType {
  return KNOWN.has(type);
}

/** A run event whose \`type\` and \`payload\` are narrowed together. */
export type KnownRunEvent = {
  [K in KnownRunEventType]: Omit<RunEventDoc, 'type' | 'payload'> & { type: K; payload: RunEventPayloads[K] };
}[KnownRunEventType];

/**
 * Narrow a run event to its known shape, or \`undefined\` for a type the corpus
 * does not name (a vendor-org event, or a type from a newer corpus than this
 * SDK). Callers keep the untyped doc in that branch — never refuse it.
 */
export function narrowRunEvent(doc: RunEventDoc): KnownRunEvent | undefined {
  return isKnownRunEventType(doc.type) ? (doc as KnownRunEvent) : undefined;
}

`;
const body = order.map((n) => emitted.get(n)).join('\n\n') + '\n';
const render = header + body;
if (process.argv.includes('--write') || !process.argv.includes('--check')) {
  writeFileSync(OUT, render);
  console.log(`wrote src/generated-payloads.ts (${rows.length} event types, ${order.length} definitions)`);
} else if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== render) {
  console.error('generate-payloads: stale — run `npm run generate`');
  process.exit(1);
} else {
  console.log(`generate-payloads: current (${rows.length} event types, ${order.length} definitions)`);
}
