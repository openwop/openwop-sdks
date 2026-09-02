/**
 * Webhook delivery-verification helpers per `spec/v1/webhooks.md`
 * §"Signature recipe". Receivers MUST verify both the HMAC AND the
 * timestamp freshness before accepting a delivery — verifying HMAC
 * alone leaves the receiver open to replay attacks.
 *
 * The canonical signing recipe (`webhooks.md` §"Headers"):
 *
 *     hmac = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *     header `X-openwop-Signature: sha256=<hmac-hex>`        (v1 canonical)
 *     header `OpenWOP-Signature: sha256=<hmac-hex>`          (RFC 0165 §C.1, dual-emitted)
 *     header `X-openwop-Timestamp` / `OpenWOP-Timestamp: <unix-seconds>`
 *
 * History (RFC 0165 §C.3): until 1.9.0 this helper read a header named
 * `openwop-Webhook-Signature` carrying `v1=<hex>` — a name and value shape
 * that appear in no spec file. A spec-conformant `sha256=` delivery failed
 * verification outright. The helper now accepts BOTH value forms, and
 * `readWebhookHeaders` picks the first present header family in spec order
 * (`OpenWOP-*`, then `X-openwop-*`, then the legacy `openwop-Webhook-*`).
 *
 * Verification:
 *
 *   1. Parse the `sha256=<hex>` (or legacy `v1=<hex>`) value from the signature header.
 *   2. Recompute `expected = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)`.
 *   3. Compare using **constant-time** equality (timing-safe).
 *   4. Reject when `|now - timestamp|` exceeds the freshness window
 *      (default 5 minutes per `webhooks.md`'s recommendation).
 *
 * Implementation note: this helper uses `node:crypto`'s `timingSafeEqual`
 * for the comparison. The browser-side equivalent (Web Crypto's
 * `subtle.verify`) is not wrapped here — the SDK's runtime is Node.
 *
 * @module @openwop/openwop/webhook-helpers
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseSignatureValue } from './webhook-header-families.js';

/** Default freshness window per `spec/v1/webhooks.md` §"Replay attack resistance". */
export const DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS = 300;

export interface VerifyWebhookSignatureOptions {
  /**
   * Maximum age in seconds for the delivery timestamp before it's
   * treated as a replay. Default 300 (5 minutes) per the spec.
   * Set to 0 to disable timestamp checks (NOT recommended).
   */
  freshnessWindowSeconds?: number;
  /**
   * Override the "now" timestamp in unix seconds. Useful for testing.
   * Default `Math.floor(Date.now() / 1000)`.
   */
  nowSeconds?: number;
}

export type VerifyWebhookOutcome =
  | { valid: true }
  | { valid: false; reason: 'signature_mismatch' | 'timestamp_expired' | 'timestamp_too_far_in_future' | 'malformed_signature_header' | 'malformed_timestamp_header' };

/**
 * Verify a webhook delivery per `spec/v1/webhooks.md` §"Signature
 * recipe". Returns `{ valid: true }` on success; otherwise
 * `{ valid: false, reason }` so callers can log + alert appropriately.
 *
 * Callers MUST pass the **raw** body bytes — JSON-parsed-then-
 * re-serialized bodies will fail verification because the host
 * signs the exact bytes it delivered.
 *
 * @param secret The pre-shared secret returned from `webhooks.register`.
 * @param signatureHeader The value of the signature header — `OpenWOP-Signature` / `X-openwop-Signature` (`"sha256=abc123…"`) or the legacy `openwop-Webhook-Signature` (`"v1=abc123…"`); see `readWebhookHeaders`.
 * @param timestampHeader The value of the matching timestamp header (unix seconds as string).
 * @param rawBody The exact request body bytes the host POSTed.
 */
export function verifyWebhookSignature(
  secret: string,
  signatureHeader: string,
  timestampHeader: string,
  rawBody: string | Buffer,
  options: VerifyWebhookSignatureOptions = {},
): VerifyWebhookOutcome {
  // 1. Parse the signature header — spec form `sha256=<hex>` (webhooks.md
  //    §"Headers") or the legacy SDK form `v1=<hex>` (RFC 0165 §C.3).
  const providedHex = parseSignatureValue(signatureHeader);
  if (providedHex === null) {
    return { valid: false, reason: 'malformed_signature_header' };
  }
  if (!/^[0-9a-f]+$/i.test(providedHex)) {
    return { valid: false, reason: 'malformed_signature_header' };
  }

  // 2. Parse the timestamp.
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { valid: false, reason: 'malformed_timestamp_header' };
  }

  // 3. Freshness check.
  const window = options.freshnessWindowSeconds ?? DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS;
  if (window > 0) {
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    const delta = now - timestamp;
    if (delta > window) return { valid: false, reason: 'timestamp_expired' };
    // Allow small future skew (within the window) but reject far-future timestamps.
    if (delta < -window) return { valid: false, reason: 'timestamp_too_far_in_future' };
  }

  // 4. Recompute + constant-time compare.
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const signedBytes = `${timestamp}.${bodyStr}`;
  const expectedHex = createHmac('sha256', secret).update(signedBytes, 'utf8').digest('hex');

  const providedBuf = Buffer.from(providedHex, 'hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (providedBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'signature_mismatch' };
  }
  if (!timingSafeEqual(providedBuf, expectedBuf)) {
    return { valid: false, reason: 'signature_mismatch' };
  }

  return { valid: true };
}

export interface SignedWebhookDelivery {
  /** Spec form: `sha256=<hex>` (webhooks.md §"Headers"). */
  readonly signatureHeader: string;
  /** Legacy form this SDK used to emit: `v1=<hex>` (RFC 0165 §C.3). */
  readonly legacySignatureHeader: string;
  readonly timestampHeader: string;
  /** Every header a host should send during the RFC 0165 overlap, by exact name. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Compute the canonical webhook signature for a payload — useful when
 * implementing a host (forward direction) OR when generating test
 * fixtures. Receivers verify via `verifyWebhookSignature`; this is the
 * inverse.
 */
export function signWebhookDelivery(
  secret: string,
  timestamp: number,
  rawBody: string | Buffer,
): SignedWebhookDelivery {
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const hex = createHmac('sha256', secret).update(`${timestamp}.${bodyStr}`, 'utf8').digest('hex');
  return {
    signatureHeader: `sha256=${hex}`,
    legacySignatureHeader: `v1=${hex}`,
    timestampHeader: String(timestamp),
    headers: {
      'OpenWOP-Signature': `sha256=${hex}`,
      'OpenWOP-Timestamp': String(timestamp),
      'OpenWOP-Signature-Algorithm': 'v1',
      'X-openwop-Signature': `sha256=${hex}`,
      'X-openwop-Timestamp': String(timestamp),
      'X-openwop-Signature-Algorithm': 'v1',
      'openwop-Webhook-Signature': `v1=${hex}`,
      'openwop-Webhook-Timestamp': String(timestamp),
    },
  };
}

export { WEBHOOK_HEADER_FAMILIES, parseSignatureValue, readWebhookHeaders } from './webhook-header-families.js';
export type { WebhookHeaderRead } from './webhook-header-families.js';
