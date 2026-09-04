/**
 * Webhook delivery-verification helpers per `spec/v2/core/webhooks.md`
 * §Verification. Receivers MUST verify both the HMAC AND the timestamp
 * freshness before accepting a delivery — verifying HMAC alone leaves the
 * receiver open to replay attacks.
 *
 * The signing recipe (webhooks.md §Headers):
 *
 *     hmac = HMAC-SHA256(secret, `${timestamp}.${rawBody}`)
 *     header `OpenWOP-Signature: sha256=<hmac-hex>`
 *     header `OpenWOP-Timestamp: <unix-seconds>`
 *     header `OpenWOP-Signature-Algorithm: v1`
 *
 * A host advertising both majors sends the `X-openwop-*` family beside it
 * with identical values through the overlap; `readWebhookHeaders` accepts
 * either family. The SDK-only `openwop-Webhook-*` names and the `v1=<hex>`
 * value form were removed in v2 (headers.md §Removed).
 *
 * Verification:
 *
 *   1. Parse the `sha256=<hex>` value from the signature header.
 *   2. Reject an unrecognized `OpenWOP-Signature-Algorithm` value (MUST).
 *   3. Reject a timestamp more than ±window from the clock (default 5 min).
 *   4. Recompute `HMAC-SHA256(`${timestamp}.${rawBody}`, secret)` and compare
 *      in constant time.
 *
 * Implementation note: this helper uses `node:crypto`'s `timingSafeEqual`.
 * The browser build substitutes a stub that throws (see
 * `webhook-helpers.browser.ts`).
 *
 * @module @openwop/openwop/webhook-helpers
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseSignatureValue, WEBHOOK_SIGNATURE_ALGORITHMS } from './webhook-header-families.js';

/** Default freshness window per webhooks.md §Verification (±5 minutes). */
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
  /**
   * The `OpenWOP-Signature-Algorithm` value the delivery carried, when the
   * caller read one (`readWebhookHeaders().algorithmHeader`). An
   * unrecognized value is rejected as `unsupported_signature_algorithm`.
   */
  algorithmHeader?: string;
}

export type VerifyWebhookOutcome =
  | { valid: true }
  | {
      valid: false;
      reason:
        | 'signature_mismatch'
        | 'timestamp_expired'
        | 'timestamp_too_far_in_future'
        | 'malformed_signature_header'
        | 'malformed_timestamp_header'
        | 'unsupported_signature_algorithm';
    };

/**
 * Verify a webhook delivery. Returns `{ valid: true }` on success; otherwise
 * `{ valid: false, reason }` so callers can log + alert appropriately.
 *
 * Callers MUST pass the **raw** body bytes — JSON-parsed-then-re-serialized
 * bodies fail verification because the host signs the exact bytes it
 * delivered.
 *
 * @param secret The subscription secret.
 * @param signatureHeader `OpenWOP-Signature` / `X-openwop-Signature` (`"sha256=abc123…"`); see `readWebhookHeaders`.
 * @param timestampHeader The matching timestamp header (unix seconds as string).
 * @param rawBody The exact request body bytes the host POSTed.
 */
export function verifyWebhookSignature(
  secret: string,
  signatureHeader: string,
  timestampHeader: string,
  rawBody: string | Buffer,
  options: VerifyWebhookSignatureOptions = {},
): VerifyWebhookOutcome {
  // 1. Parse the signature header — `sha256=<hex>` only.
  const providedHex = parseSignatureValue(signatureHeader);
  if (providedHex === null) {
    return { valid: false, reason: 'malformed_signature_header' };
  }

  // 2. Reject an unrecognized scheme.
  if (
    options.algorithmHeader !== undefined &&
    !(WEBHOOK_SIGNATURE_ALGORITHMS as readonly string[]).includes(options.algorithmHeader)
  ) {
    return { valid: false, reason: 'unsupported_signature_algorithm' };
  }

  // 3. Parse the timestamp.
  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp <= 0) {
    return { valid: false, reason: 'malformed_timestamp_header' };
  }

  // 4. Freshness check.
  const window = options.freshnessWindowSeconds ?? DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS;
  if (window > 0) {
    const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
    const delta = now - timestamp;
    if (delta > window) return { valid: false, reason: 'timestamp_expired' };
    if (delta < -window) return { valid: false, reason: 'timestamp_too_far_in_future' };
  }

  // 5. Recompute + constant-time compare.
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
  /** `sha256=<hex>` */
  readonly signatureHeader: string;
  readonly timestampHeader: string;
  /** The five `OpenWOP-*` headers a v2 host MUST send on every delivery, minus the two subscription-specific ones (`OpenWOP-Webhook-Id`, `OpenWOP-Event-Type`), plus the `X-openwop-*` twins a dual-major host emits through the overlap. */
  readonly headers: Readonly<Record<string, string>>;
}

/**
 * Compute the canonical webhook signature for a payload — useful when
 * implementing a host (forward direction) OR when generating test fixtures.
 * Receivers verify via `verifyWebhookSignature`; this is the inverse.
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
    timestampHeader: String(timestamp),
    headers: {
      'OpenWOP-Signature': `sha256=${hex}`,
      'OpenWOP-Timestamp': String(timestamp),
      'OpenWOP-Signature-Algorithm': 'v1',
      'X-openwop-Signature': `sha256=${hex}`,
      'X-openwop-Timestamp': String(timestamp),
      'X-openwop-Signature-Algorithm': 'v1',
    },
  };
}

export {
  WEBHOOK_HEADER_FAMILIES,
  WEBHOOK_SIGNATURE_ALGORITHMS,
  parseSignatureValue,
  readWebhookHeaders,
} from './webhook-header-families.js';
export type { WebhookHeaderRead, WebhookSignatureAlgorithm } from './webhook-header-families.js';
