/**
 * Webhook header families and signature-value parsing (webhooks.md §Headers;
 * RFC 0165 §C.1, RFC 0176 §D.2). Pure — no Node builtin — so both the server
 * module (`webhook-helpers.ts`) and the browser stub re-export it.
 * Verification itself stays server-only.
 */

/** The one accepted signature-value form: `sha256=<hex>`. The SDK-only `v1=` form was removed in v2 (headers.md §Removed). */
const SIGNATURE_VALUE_PREFIX = 'sha256=';

/** The one signature scheme (`OpenWOP-Signature-Algorithm`): HMAC-SHA256 with the subscription secret. */
export const WEBHOOK_SIGNATURE_ALGORITHMS = ['v1'] as const;
export type WebhookSignatureAlgorithm = (typeof WEBHOOK_SIGNATURE_ALGORITHMS)[number];

/** `sha256=<hex>` → `<hex>`; anything else → null. */
export function parseSignatureValue(value: string): string | null {
  if (!value.startsWith(SIGNATURE_VALUE_PREFIX)) return null;
  const hex = value.slice(SIGNATURE_VALUE_PREFIX.length);
  return /^[0-9a-f]+$/i.test(hex) ? hex : null;
}

/**
 * Header-name families a delivery may carry, in the order a receiver SHOULD
 * prefer them: the v2 `OpenWOP-*` family, then the v1 `X-openwop-*` family a
 * dual-major host emits beside it through the overlap (webhooks.md §Dual
 * emission — a v2 receiver MUST accept a delivery carrying only that family).
 * Lookups are case-insensitive.
 */
export const WEBHOOK_HEADER_FAMILIES: ReadonlyArray<{
  readonly family: 'openwop' | 'x-openwop';
  readonly signature: string;
  readonly timestamp: string;
  readonly algorithm: string;
}> = [
  { family: 'openwop', signature: 'OpenWOP-Signature', timestamp: 'OpenWOP-Timestamp', algorithm: 'OpenWOP-Signature-Algorithm' },
  { family: 'x-openwop', signature: 'X-openwop-Signature', timestamp: 'X-openwop-Timestamp', algorithm: 'X-openwop-Signature-Algorithm' },
];

export interface WebhookHeaderRead {
  readonly signatureHeader: string;
  readonly timestampHeader: string;
  /** The `*-Signature-Algorithm` value when the delivery carried one. */
  readonly algorithmHeader?: string;
  /** Which family was read. */
  readonly family: 'openwop' | 'x-openwop';
}

/**
 * Pick the signature + timestamp (+ algorithm) values out of a delivery's
 * headers, first present family wins. Returns null when no family is
 * complete. Pass a plain object (any casing) or a `Headers`-like with a `get`
 * method.
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
  for (const f of WEBHOOK_HEADER_FAMILIES) {
    const sig = get(f.signature);
    const ts = get(f.timestamp);
    if (sig !== undefined && ts !== undefined) {
      const alg = get(f.algorithm);
      return alg === undefined
        ? { signatureHeader: sig, timestampHeader: ts, family: f.family }
        : { signatureHeader: sig, timestampHeader: ts, algorithmHeader: alg, family: f.family };
    }
  }
  return null;
}
