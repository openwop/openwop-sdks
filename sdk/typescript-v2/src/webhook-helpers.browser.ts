/**
 * Browser substitute for `webhook-helpers.ts`.
 *
 * `webhook-helpers.ts` imports `node:crypto` for `createHmac` and
 * `timingSafeEqual`. The `browser` field in package.json maps that module to
 * this one so a browser bundle builds. Webhook signature verification is a
 * SERVER concern — a browser has no business holding the subscription
 * secret — so the honest browser behaviour is to keep the import working and
 * refuse the call, not to ship a second crypto implementation.
 *
 * It throws rather than returning a failure: `{ valid: false }` in a browser
 * would be a silent security downgrade — a caller that treats "not valid" as
 * "reject the delivery" behaves identically whether the signature was forged
 * or the platform simply could not check it. Throwing keeps them
 * distinguishable.
 */

const REASON =
  'openwop: webhook signature helpers require Node\'s crypto (HMAC-SHA256 + timingSafeEqual) and are not available in a browser build. '
  + 'Webhook verification is a server-side concern — the subscription secret must never reach a browser. '
  + 'Import them on the server from "@openwop/openwop/webhooks".';

/** @see spec/v2/core/webhooks.md §Verification */
export const DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS = 300;

export function verifyWebhookSignature(): never {
  throw new Error(REASON);
}

export function signWebhookDelivery(): never {
  throw new Error(REASON);
}

// The header-family readers need no Node builtin, so the browser build
// carries the real implementations (a browser MAY inspect which family a
// delivery carries; it still MUST NOT verify — no secret in a browser).
export {
  WEBHOOK_HEADER_FAMILIES,
  WEBHOOK_SIGNATURE_ALGORITHMS,
  parseSignatureValue,
  readWebhookHeaders,
} from './webhook-header-families.js';

export type { VerifyWebhookSignatureOptions, VerifyWebhookOutcome, SignedWebhookDelivery } from './webhook-helpers.js';
export type { WebhookHeaderRead, WebhookSignatureAlgorithm } from './webhook-header-families.js';
