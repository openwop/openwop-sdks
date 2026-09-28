/**
 * Tenant-bound id wire form (`spec/v2/core/identity.md` §5 "Wire form").
 *
 * A tenant-bound id (`runId`, `interruptId`, `subscriptionId`, `deliveryId`,
 * `effectId`) is `<tenant>/<opaque>` in bodies but travels as ONE path
 * segment, projected: every UTF-8 byte outside `[A-Za-z0-9._-]` becomes `~`
 * plus two uppercase hex digits — `acme/r-9f3c` → `acme~2Fr-9f3c`. A host
 * emits the projected form in links and accepts both it and the legacy
 * percent-encoded `acme%2Fr-9f3c`.
 */

const PASSTHROUGH = /^[A-Za-z0-9._-]$/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Decode a wire-form id to its bound form, accepting both the projected
 * (`~2F`) and the percent-encoded (`%2F`) escape. Characters that are not
 * part of an escape pass through as their UTF-8 bytes.
 */
export function unprojectId(wire: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < wire.length; ) {
    const ch = wire[i]!;
    const pair = wire.slice(i + 1, i + 3);
    if ((ch === '~' || ch === '%') && HEX_PAIR.test(pair)) {
      bytes.push(parseInt(pair, 16));
      i += 3;
      continue;
    }
    const cp = wire.codePointAt(i)!;
    const s = String.fromCodePoint(cp);
    for (const b of encoder.encode(s)) bytes.push(b);
    i += s.length;
  }
  return decoder.decode(new Uint8Array(bytes));
}

/**
 * Project a tenant-bound id to its one-segment wire form. An id that is
 * already a wire form (no `/`, but an escaped `/` in either form) is decoded
 * first, so passing a link's segment back in never double-escapes it.
 */
export function projectId(id: string): string {
  const bound = !id.includes('/') && /[~%]2F/i.test(id) ? unprojectId(id) : id;
  let out = '';
  for (const b of encoder.encode(bound)) {
    const c = String.fromCharCode(b);
    out += PASSTHROUGH.test(c) ? c : `~${b.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}
