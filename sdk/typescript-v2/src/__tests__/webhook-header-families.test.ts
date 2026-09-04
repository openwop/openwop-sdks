/**
 * webhooks.md §Headers / §Verification / §Dual emission — the v2 helpers sign
 * and verify the `sha256=<hex>` form under the `OpenWOP-*` family, accept the
 * `X-openwop-*` twins a dual-major host emits through the overlap, reject an
 * unrecognized `OpenWOP-Signature-Algorithm`, and no longer know the SDK-only
 * `openwop-Webhook-*` names or the `v1=<hex>` value form (headers.md §Removed).
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  WEBHOOK_HEADER_FAMILIES,
  parseSignatureValue,
  readWebhookHeaders,
  signWebhookDelivery,
  verifyWebhookSignature,
} from '../webhook-helpers.js';

const secret = 's3cret';
const body = '{"runId":"r1","event":{"type":"run.completed"}}';
const ts = 1_760_000_000;
const hex = createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex');

describe('verifyWebhookSignature — v2 value form', () => {
  it('sha256=<hex> verifies', () => {
    expect(verifyWebhookSignature(secret, `sha256=${hex}`, String(ts), body, { nowSeconds: ts })).toEqual({ valid: true });
  });
  it('the removed v1=<hex> form, bare hex and unknown prefixes are malformed', () => {
    for (const v of [`v1=${hex}`, hex, `md5=${hex}`]) {
      expect(verifyWebhookSignature(secret, v, String(ts), body, { nowSeconds: ts })).toEqual({ valid: false, reason: 'malformed_signature_header' });
    }
  });
  it('an unrecognized OpenWOP-Signature-Algorithm is rejected; `v1` is accepted', () => {
    expect(verifyWebhookSignature(secret, `sha256=${hex}`, String(ts), body, { nowSeconds: ts, algorithmHeader: 'v2' })).toEqual({ valid: false, reason: 'unsupported_signature_algorithm' });
    expect(verifyWebhookSignature(secret, `sha256=${hex}`, String(ts), body, { nowSeconds: ts, algorithmHeader: 'v1' })).toEqual({ valid: true });
  });
  it('a timestamp outside ±5 minutes is rejected', () => {
    expect(verifyWebhookSignature(secret, `sha256=${hex}`, String(ts), body, { nowSeconds: ts + 301 })).toEqual({ valid: false, reason: 'timestamp_expired' });
    expect(verifyWebhookSignature(secret, `sha256=${hex}`, String(ts), body, { nowSeconds: ts - 301 })).toEqual({ valid: false, reason: 'timestamp_too_far_in_future' });
  });
  it('parseSignatureValue returns the hex or null', () => {
    expect(parseSignatureValue(`sha256=${hex}`)).toBe(hex);
    expect(parseSignatureValue(`v1=${hex}`)).toBeNull();
    expect(parseSignatureValue('sha256=zz')).toBeNull();
    expect(parseSignatureValue('')).toBeNull();
  });
});

describe('signWebhookDelivery emits the OpenWOP-* family (+ the overlap twins)', () => {
  it('no legacy header, no v1= value', () => {
    const out = signWebhookDelivery(secret, ts, body);
    expect(out.signatureHeader).toBe(`sha256=${hex}`);
    expect(out.headers['OpenWOP-Signature']).toBe(`sha256=${hex}`);
    expect(out.headers['OpenWOP-Timestamp']).toBe(String(ts));
    expect(out.headers['OpenWOP-Signature-Algorithm']).toBe('v1');
    expect(out.headers['X-openwop-Signature']).toBe(`sha256=${hex}`);
    expect(Object.keys(out.headers).some((k) => k.toLowerCase().startsWith('openwop-webhook-'))).toBe(false);
    expect(Object.values(out.headers).some((v) => v.startsWith('v1='))).toBe(false);
    expect(verifyWebhookSignature(secret, out.headers['OpenWOP-Signature']!, out.headers['OpenWOP-Timestamp']!, body, { nowSeconds: ts })).toEqual({ valid: true });
  });
});

describe('readWebhookHeaders — OpenWOP-* first, X-openwop-* through the overlap, nothing else', () => {
  it('exactly two families, in spec order', () => {
    expect(WEBHOOK_HEADER_FAMILIES.map((f) => f.family)).toEqual(['openwop', 'x-openwop']);
  });
  it('OpenWOP-* wins over X-openwop-*; lookups are case-insensitive; the algorithm rides along', () => {
    expect(readWebhookHeaders({ 'x-openwop-signature': 'a', 'x-openwop-timestamp': '1', 'openwop-signature': 'b', 'openwop-timestamp': '2', 'OPENWOP-SIGNATURE-ALGORITHM': 'v1' }))
      .toEqual({ signatureHeader: 'b', timestampHeader: '2', algorithmHeader: 'v1', family: 'openwop' });
    expect(readWebhookHeaders({ 'X-OpenWOP-Signature': 'a', 'X-OPENWOP-TIMESTAMP': '1' }))
      .toEqual({ signatureHeader: 'a', timestampHeader: '1', family: 'x-openwop' });
  });
  it('the legacy openwop-Webhook-* family is not read', () => {
    expect(readWebhookHeaders({ 'openwop-webhook-signature': 'c', 'openwop-webhook-timestamp': '3' })).toBeNull();
  });
  it('an incomplete family is skipped; nothing complete → null', () => {
    expect(readWebhookHeaders({ 'OpenWOP-Signature': 'b', 'X-openwop-Signature': 'a', 'X-openwop-Timestamp': '1' })).toEqual({ signatureHeader: 'a', timestampHeader: '1', family: 'x-openwop' });
    expect(readWebhookHeaders({ 'Content-Type': 'application/json' })).toBeNull();
  });
  it('accepts a Headers-like object with get()', () => {
    const h = new Map<string, string>([['openwop-signature', `sha256=${hex}`], ['openwop-timestamp', String(ts)]]);
    const like = { get: (n: string) => h.get(n.toLowerCase()) ?? null };
    const read = readWebhookHeaders(like);
    expect(read?.family).toBe('openwop');
    expect(verifyWebhookSignature(secret, read!.signatureHeader, read!.timestampHeader, body, { nowSeconds: ts })).toEqual({ valid: true });
  });
});
