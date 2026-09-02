/**
 * Webhook header families and signature-value parsing (RFC 0165 §C.3).
 * Pure — no Node builtin — so both the server module (`webhook-helpers.ts`)
 * and the browser stub re-export it. Verification itself stays server-only.
 */

/** Accepted signature-value prefixes, spec form first. */
const SIGNATURE_VALUE_PREFIXES = ['sha256=', 'v1='] as const;

/** `sha256=<hex>` or `v1=<hex>` → `<hex>`; anything else → null. */
export function parseSignatureValue(value: string): string | null {
  for (const p of SIGNATURE_VALUE_PREFIXES) {
    if (value.startsWith(p)) {
      const hex = value.slice(p.length);
      return /^[0-9a-f]+$/i.test(hex) ? hex : null;
    }
  }
  return null;
}

/**
 * Header-name families a delivery may carry, in the order a receiver SHOULD
 * prefer them (RFC 0165 §C.1): the v2-bound `OpenWOP-*` family, the v1
 * canonical `X-openwop-*` family, then the legacy names this SDK used to
 * document. Lookups are case-insensitive.
 */
export const WEBHOOK_HEADER_FAMILIES: ReadonlyArray<{ readonly signature: string; readonly timestamp: string; readonly algorithm?: string }> = [
  { signature: 'OpenWOP-Signature', timestamp: 'OpenWOP-Timestamp', algorithm: 'OpenWOP-Signature-Algorithm' },
  { signature: 'X-openwop-Signature', timestamp: 'X-openwop-Timestamp', algorithm: 'X-openwop-Signature-Algorithm' },
  { signature: 'openwop-Webhook-Signature', timestamp: 'openwop-Webhook-Timestamp' },
];

export interface WebhookHeaderRead {
  readonly signatureHeader: string;
  readonly timestampHeader: string;
  /** Which family was read: `openwop`, `x-openwop`, or `legacy`. */
  readonly family: 'openwop' | 'x-openwop' | 'legacy';
}

/**
 * Pick the signature + timestamp values out of a delivery's headers, first
 * present family wins. Returns null when no family is complete. Pass a plain
 * object (any casing) or a `Headers`-like with a `get` method.
 */
export function readWebhookHeaders(
  headers: Record<string, string | string[] | undefined> | { get(name: string): string | null },
): WebhookHeaderRead | null {
  const get = (name: string): string | undefined => {
    if (typeof (headers as { get?: unknown }).get === 'function') {
      const v = (headers as { get(name: string): string | null }).get(name);
      return v === null ? undefined : v;
    }
    const rec = headers as Record<string, string | string[] | undefined>;
    const key = Object.keys(rec).find((k) => k.toLowerCase() === name.toLowerCase());
    const v = key === undefined ? undefined : rec[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const families = ['openwop', 'x-openwop', 'legacy'] as const;
  for (let i = 0; i < WEBHOOK_HEADER_FAMILIES.length; i++) {
    const f = WEBHOOK_HEADER_FAMILIES[i]!;
    const sig = get(f.signature);
    const ts = get(f.timestamp);
    if (sig !== undefined && ts !== undefined) return { signatureHeader: sig, timestampHeader: ts, family: families[i]! };
  }
  return null;
}
