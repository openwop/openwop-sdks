/**
 * SDK tests for `OpenwopClient.content.*` (RFC 0103) +
 * `OpenwopClient.triggerSubscriptions.create` (RFC 0099).
 *
 * Verifies each method maps to the correct HTTP method + path + body +
 * headers, that reads return `null` on 404/501 (capability absent), and
 * that `getPage` forwards `Accept-Language`. Uses the
 * `OpenwopClientOptions.fetch` override to inject a mock fetch (the
 * `prompts.test.ts` / `audit.test.ts` pattern) — tests the wire mapping,
 * not a live runtime.
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body?: string;
}

function mockClient(
  responder: (req: CapturedRequest) => { status: number; body?: unknown },
): { client: OpenwopClient; captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers ?? {});
    const body = init?.body != null ? String(init.body) : undefined;
    captured.push(body !== undefined ? { url, method: init?.method ?? 'GET', headers, body } : { url, method: init?.method ?? 'GET', headers });
    const r = responder(captured[captured.length - 1]!);
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, {
      status: r.status,
      headers: new Headers(r.body !== undefined ? { 'content-type': 'application/json' } : {}),
    });
  };
  const client = new OpenwopClient({ baseUrl: 'https://test.example/', apiKey: 'k', fetch: mockFetch });
  return { client, captured };
}

describe('content + trigger REST helpers', () => {
  it('getPage maps to GET /content/pages/{slug} + forwards Accept-Language', async () => {
    const { client, captured } = mockClient(() => ({
      status: 200,
      body: { version: '1', generatedAt: 't', locale: 'fr-FR', slug: 'home', page: { pageId: 'p', slug: 'home', name: 'Home', status: 'published', sectionOrder: [] }, sections: [] },
    }));
    const res = await client.content.getPage('home', 'fr-FR');
    expect(captured[0]?.method).toBe('GET');
    expect(captured[0]?.url).toContain('/content/pages/home');
    expect(captured[0]?.headers.get('Accept-Language')).toBe('fr-FR');
    expect(res?.locale).toBe('fr-FR');
  });

  it('getPage returns null on 404 and 501', async () => {
    const r404 = mockClient(() => ({ status: 404 }));
    expect(await r404.client.content.getPage('missing')).toBeNull();
    const r501 = mockClient(() => ({ status: 501 }));
    expect(await r501.client.content.getPage('x')).toBeNull();
  });

  it('listPages / getSettings return null on 501', async () => {
    const { client } = mockClient(() => ({ status: 501 }));
    expect(await client.content.listPages()).toBeNull();
    expect(await client.content.getSettings()).toBeNull();
  });

  it('putSection maps to PUT with the locale+data body', async () => {
    const { client, captured } = mockClient(() => ({
      status: 200,
      body: { sectionId: 's', sectionType: 'hero', data: {}, localizations: {}, status: 'draft', enabled: true, order: 0 },
    }));
    await client.content.putSection('p1', 's1', { locale: 'fr-FR', data: { title: 'Bonjour' } });
    expect(captured[0]?.method).toBe('PUT');
    expect(captured[0]?.url).toContain('/content/pages/p1/sections/s1');
    expect(JSON.parse(captured[0]!.body!)).toEqual({ locale: 'fr-FR', data: { title: 'Bonjour' } });
  });

  it('triggerSubscriptions.create maps to POST /trigger-subscriptions', async () => {
    const { client, captured } = mockClient(() => ({
      status: 201,
      body: { subscription: { subscriptionId: 'sub-1' }, binding: { ingestUrl: 'https://h/ingest', secretFingerprint: 'abc' } },
    }));
    const res = await client.triggerSubscriptions.create({ source: { kind: 'webhook' }, workflowId: 'wf-1' });
    expect(captured[0]?.method).toBe('POST');
    expect(captured[0]?.url).toContain('/trigger-subscriptions');
    expect(res.binding.secretFingerprint).toBe('abc');
  });
});
