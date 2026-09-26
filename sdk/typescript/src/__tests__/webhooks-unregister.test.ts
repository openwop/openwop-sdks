/**
 * `client.webhooks.unregister` sends the `tenantId` query parameter the v1
 * contract requires (`spec/v1/webhooks.md` §Unregister; `api/openapi.yaml`
 * `unregisterWebhook`, corpus 2.37.1+). openwop-sdks#50.
 *
 * Uses the `OpenwopClientOptions.fetch` override — tests the wire mapping,
 * not a live runtime.
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';

function mockClient(): { client: OpenwopClient; captured: { url: string; method: string }[] } {
  const captured: { url: string; method: string }[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({ url, method: init?.method ?? 'GET' });
    return new Response(null, { status: 204 });
  };
  const client = new OpenwopClient({ baseUrl: 'https://test.example/', apiKey: 'k', fetch: mockFetch });
  return { client, captured };
}

describe('webhooks.unregister', () => {
  it('sends DELETE /v1/webhooks/{id}?tenantId={tenantId}', async () => {
    const { client, captured } = mockClient();
    await client.webhooks.unregister('sub/1', 'tenant a');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe('DELETE');
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/v1/webhooks/sub%2F1');
    expect(url.searchParams.get('tenantId')).toBe('tenant a');
  });

  it('deprecated form (no tenantId) keeps its old wire shape — no query', async () => {
    const { client, captured } = mockClient();
    await client.webhooks.unregister('sub-1');
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/v1/webhooks/sub-1');
    expect(url.search).toBe('');
  });
});
