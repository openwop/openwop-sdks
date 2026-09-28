/**
 * `client.content.deletePage` — `DELETE /v1/content/pages/{pageId}`
 * (`localized-content.md` §D; `api/openapi.yaml` `deleteContentPage`,
 * corpus 2.42.2+). Uses the `OpenwopClientOptions.fetch` override — tests
 * the wire mapping, not a live runtime.
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';

function mockClient(status: number, body?: unknown): { client: OpenwopClient; captured: { url: string; method: string }[] } {
  const captured: { url: string; method: string }[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    captured.push({ url, method: init?.method ?? 'GET' });
    return new Response(body !== undefined ? JSON.stringify(body) : null, {
      status,
      headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    });
  };
  const client = new OpenwopClient({ baseUrl: 'https://test.example/', apiKey: 'k', fetch: mockFetch });
  return { client, captured };
}

describe('content.deletePage', () => {
  it('sends DELETE /v1/content/pages/{pageId} and resolves on 204', async () => {
    const { client, captured } = mockClient(204);
    await expect(client.content.deletePage('page 1')).resolves.toBeUndefined();
    expect(captured[0]?.method).toBe('DELETE');
    expect(new URL(captured[0]!.url).pathname).toBe('/v1/content/pages/page%201');
  });

  it('throws on 404', async () => {
    const { client } = mockClient(404, { error: 'not_found', message: 'no page' });
    await expect(client.content.deletePage('gone')).rejects.toMatchObject({ status: 404 });
  });
});
