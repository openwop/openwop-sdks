/**
 * RFC 0165 §C.3 — the webhook helpers accept the spec's `sha256=` signature
 * value and the legacy `v1=` form, sign in the spec form, and pick the first
 * present header family in spec order (`OpenWOP-*`, `X-openwop-*`, legacy).
 *
 * The load-bearing case is the first one: before 1.9.0 a spec-conformant
 * delivery (`X-openwop-Signature: sha256=<hex>`) failed verification with
 * `malformed_signature_header`, because the helper only knew a header shape
 * that appears in no spec file.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { parseSignatureValue, readWebhookHeaders, signWebhookDelivery, verifyWebhookSignature } from '../webhook-helpers.js';

const secret = 's3cret';
const body = '{"runId":"r1","event":{"type":"run.completed"}}';
const ts = 1_760_000_000;
const hex = createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex');

describe('verifyWebhookSignature accepts both value forms', () => {
  it('spec form sha256=<hex> (webhooks.md §"Headers") verifies', () => {
    expect(verifyWebhookSignature(secret, `sha256=${hex}`, String(ts), body, { nowSeconds: ts })).toEqual({ valid: true });
  });
  it('legacy form v1=<hex> still verifies', () => {
    expect(verifyWebhookSignature(secret, `v1=${hex}`, String(ts), body, { nowSeconds: ts })).toEqual({ valid: true });
  });
  it('bare hex and unknown prefixes are malformed', () => {
    expect(verifyWebhookSignature(secret, hex, String(ts), body, { nowSeconds: ts })).toEqual({ valid: false, reason: 'malformed_signature_header' });
    expect(verifyWebhookSignature(secret, `md5=${hex}`, String(ts), body, { nowSeconds: ts })).toEqual({ valid: false, reason: 'malformed_signature_header' });
  });
  it('parseSignatureValue returns the hex or null', () => {
    expect(parseSignatureValue(`sha256=${hex}`)).toBe(hex);
    expect(parseSignatureValue(`v1=${hex}`)).toBe(hex);
    expect(parseSignatureValue('sha256=zz')).toBeNull();
    expect(parseSignatureValue('')).toBeNull();
  });
});

describe('signWebhookDelivery emits the spec form and every header family', () => {
  it('signatureHeader is sha256=<hex>; headers carry OpenWOP-*, X-openwop-*, and legacy names', () => {
    const out = signWebhookDelivery(secret, ts, body);
    expect(out.signatureHeader).toBe(`sha256=${hex}`);
    expect(out.legacySignatureHeader).toBe(`v1=${hex}`);
    expect(out.headers['OpenWOP-Signature']).toBe(`sha256=${hex}`);
    expect(out.headers['X-openwop-Signature']).toBe(`sha256=${hex}`);
    expect(out.headers['openwop-Webhook-Signature']).toBe(`v1=${hex}`);
    expect(out.headers['OpenWOP-Signature-Algorithm']).toBe('v1');
    expect(out.headers['X-openwop-Timestamp']).toBe(String(ts));
    expect(verifyWebhookSignature(secret, out.headers['OpenWOP-Signature']!, out.headers['OpenWOP-Timestamp']!, body, { nowSeconds: ts })).toEqual({ valid: true });
  });
});

describe('readWebhookHeaders picks the first present family in spec order', () => {
  it('OpenWOP-* wins over X-openwop-* wins over legacy; lookups are case-insensitive', () => {
    expect(readWebhookHeaders({ 'x-openwop-signature': 'a', 'x-openwop-timestamp': '1', 'openwop-signature': 'b', 'openwop-timestamp': '2' })).toEqual({ signatureHeader: 'b', timestampHeader: '2', family: 'openwop' });
    expect(readWebhookHeaders({ 'X-OpenWOP-Signature': 'a', 'X-OPENWOP-TIMESTAMP': '1', 'openwop-Webhook-Signature': 'c', 'openwop-Webhook-Timestamp': '3' })).toEqual({ signatureHeader: 'a', timestampHeader: '1', family: 'x-openwop' });
    expect(readWebhookHeaders({ 'openwop-webhook-signature': 'c', 'openwop-webhook-timestamp': '3' })).toEqual({ signatureHeader: 'c', timestampHeader: '3', family: 'legacy' });
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
