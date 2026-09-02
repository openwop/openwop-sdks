/**
 * Browser substitute for `webhook-helpers.ts` (openwop-sdks#30).
 *
 * ## Why this file exists
 *
 * `webhook-helpers.ts` imports `node:crypto` for `createHmac` and
 * `timingSafeEqual`. The package barrel re-exports it, and the `exports` map
 * offers only `"."` — so a browser consumer importing ANYTHING from
 * `@openwop/openwop` pulled the barrel, pulled the webhook helpers, and pulled
 * `node:crypto`. Vite/Rollup then failed the BUILD with
 *
 *     "createHmac" is not exported by "__vite-browser-external"
 *
 * which names a bundler-internal shim rather than the real cause, so the error
 * points nowhere useful. Reported 2026-05-26 and still reproducible against the
 * published 1.7.0 fifteen months later.
 *
 * The `browser` field in package.json maps the Node module to this one, so the
 * barrel is importable in a browser again. Webhook signature verification is a
 * SERVER concern — a browser has no business holding the subscription secret —
 * so the honest browser behaviour is to keep the import working and refuse the
 * call, not to ship a second crypto implementation.
 *
 * ## Why it throws rather than returning a failure
 *
 * `verifyWebhookSignature` returning `{ ok: false }` in a browser would be a
 * silent security downgrade: a caller that treats "not ok" as "reject the
 * delivery" behaves identically whether the signature was forged or the
 * platform simply could not check it. Those are different facts and only one of
 * them is about the payload. Throwing keeps them distinguishable.
 */

const REASON =
  'openwop: webhook signature helpers require Node\'s crypto (HMAC-SHA256 + timingSafeEqual) and are not available in a browser build. '
  + 'Webhook verification is a server-side concern — the subscription secret must never reach a browser. '
  + 'Import them on the server from "@openwop/openwop/webhooks".';

/** @see spec/v1/webhooks.md §"Replay attack protection" */
export const DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS = 300;

export function verifyWebhookSignature(): never {
  throw new Error(REASON);
}

export function signWebhookDelivery(): never {
  throw new Error(REASON);
}

// RFC 0165 §C.3 — the header-family readers need no Node builtin, so the
// browser build carries the real implementations (a browser MAY inspect which
// family a delivery carries; it still MUST NOT verify — no secret in a browser).
export { WEBHOOK_HEADER_FAMILIES, parseSignatureValue, readWebhookHeaders } from './webhook-header-families.js';

export type { VerifyWebhookSignatureOptions, VerifyWebhookOutcome, SignedWebhookDelivery, WebhookHeaderRead } from './webhook-helpers.js';
