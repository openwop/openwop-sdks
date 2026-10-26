/**
 * Corpus v2.46.28: RFC 0251 eval-run baseline selection on `runs.create`, and the
 * operations added to `spec/v2/path-manifest.json` since v2.45.10 (RFC 0249 proposals,
 * the connection-provider registry, the host test-event emitter, and the front-end
 * plugin frame + RPC).
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';

interface Captured { url: string; method: string; headers: Headers; body: unknown }

function mockClient(
  responder: (req: Captured) => { status: number; body?: unknown; text?: string; headers?: Record<string, string> } = () => ({ status: 200, body: {} }),
): { client: OpenwopClient; captured: Captured[] } {
  const captured: Captured[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const raw = typeof init?.body === 'string' ? init.body : undefined;
    const req = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers ?? {}),
      body: raw !== undefined ? JSON.parse(raw) : undefined,
    };
    captured.push(req);
    const r = responder(req);
    const payload = r.text ?? (r.body !== undefined ? JSON.stringify(r.body) : null);
    return new Response(payload, { status: r.status, headers: new Headers(r.headers ?? {}) });
  };
  return { client: new OpenwopClient({ baseUrl: 'https://host.example', apiKey: 'k', fetch: mockFetch }), captured };
}

describe('runs.create eval baseline selection (RFC 0251 §B)', () => {
  it('sends evalModes and baselineRunId at the body root, beside evalSuiteRef', async () => {
    const { client, captured } = mockClient(() => ({ status: 201, body: { runId: 't/r2', status: 'pending', eventsUrl: '/runs/t%2Fr2/events' } }));
    await client.runs.create({
      mode: 'eval',
      evalSuiteRef: 'suite://s',
      agentId: 'a',
      evalModes: ['golden', 'regression'],
      baselineRunId: 't/r1',
    });
    expect(captured[0]!.body).toEqual({
      mode: 'eval',
      evalSuiteRef: 'suite://s',
      agentId: 'a',
      evalModes: ['golden', 'regression'],
      baselineRunId: 't/r1',
    });
  });

  it('omits both when absent', async () => {
    const { client, captured } = mockClient(() => ({ status: 201, body: { runId: 't/r2', status: 'pending', eventsUrl: '' } }));
    await client.runs.create({ mode: 'eval', evalSuiteRef: 'suite://s', agentId: 'a' });
    const body = captured[0]!.body as Record<string, unknown>;
    expect('evalModes' in body).toBe(false);
    expect('baselineRunId' in body).toBe(false);
  });
});

describe('proposals (RFC 0249)', () => {
  it('maps each operation to its method, path and body', async () => {
    const { client, captured } = mockClient(() => ({ status: 200, body: { items: [] } }));
    await client.proposals.list({ state: 'draft', kind: 'prompt-template', limit: 5, cursor: 'c' });
    await client.proposals.submit({ kind: 'prompt-template', artifact: { templateId: 'x' } }, { idempotencyKey: 'i1' });
    await client.proposals.get('p/1');
    await client.proposals.revise('p1', { title: 't' });
    await client.proposals.archive('p1');
    await client.proposals.apply('p1', { artifactDigest: 'sha256:ab' }, { idempotencyKey: 'i2' });
    await client.proposals.reject('p1', { reason: 'no' });
    expect(captured.map((c) => `${c.method} ${c.url.replace('https://host.example', '')}`)).toEqual([
      'GET /proposals?state=draft&kind=prompt-template&limit=5&cursor=c',
      'POST /proposals',
      'GET /proposals/p%2F1',
      'PATCH /proposals/p1',
      'DELETE /proposals/p1',
      'POST /proposals/p1:apply',
      'POST /proposals/p1:reject',
    ]);
    expect(captured[1]!.headers.get('Idempotency-Key')).toBe('i1');
    expect(captured[5]!.headers.get('Idempotency-Key')).toBe('i2');
    expect(captured[5]!.body).toEqual({ artifactDigest: 'sha256:ab' });
    expect(captured[6]!.body).toEqual({ reason: 'no' });
  });
});

describe('connection providers', () => {
  it('list and resolve, the qualified form as a pack query parameter', async () => {
    const { client, captured } = mockClient(() => ({ status: 200, body: { providers: [], refusals: [] } }));
    await client.connectionProviders.list();
    await client.connectionProviders.resolve('slack');
    await client.connectionProviders.resolve('slack', { pack: '@acme/slack' });
    expect(captured.map((c) => c.url.replace('https://host.example', ''))).toEqual([
      '/connection-providers',
      '/connection-providers/slack',
      '/connection-providers/slack?pack=%40acme%2Fslack',
    ]);
  });
});

describe('host test events and front-end plugins', () => {
  it('emitTestEvent posts the delivery class with an Idempotency-Key', async () => {
    const { client, captured } = mockClient(() => ({ status: 202, body: { eventId: 'e1', type: 'host-test.durable-triggered' } }));
    const out = await client.host.emitTestEvent({ delivery: 'durable' }, { idempotencyKey: 'k1' });
    expect(out.type).toBe('host-test.durable-triggered');
    expect(captured[0]!.method).toBe('POST');
    expect(captured[0]!.url).toBe('https://host.example/host/events/test');
    expect(captured[0]!.body).toEqual({ delivery: 'durable' });
    expect(captured[0]!.headers.get('Idempotency-Key')).toBe('k1');
  });

  it('uiPluginFrame returns the HTML verbatim; dispatch wraps the message', async () => {
    const html = '<!doctype html><title>p</title>';
    const { client, captured } = mockClient((req) =>
      req.method === 'GET'
        ? { status: 200, text: html, headers: { 'content-type': 'text/html' } }
        : { status: 200, body: { openwop: 'ui-plugin/1', type: 'response', id: 1, ok: false, error: { code: 'method_not_allowed' } } },
    );
    expect(await client.host.uiPluginFrame('@acme/editor', 'main')).toBe(html);
    expect(captured[0]!.headers.get('Accept')).toBe('text/html');
    expect(captured[0]!.url).toBe('https://host.example/host/ui-plugins/%40acme%2Feditor/main/frame');
    const res = await client.host.dispatchUiPluginRequest('@acme/editor', 'main', {
      openwop: 'ui-plugin/1',
      type: 'request',
      id: 1,
      method: 'host.toast',
    });
    expect(res.ok).toBe(false);
    expect(captured[1]!.body).toEqual({ message: { openwop: 'ui-plugin/1', type: 'request', id: 1, method: 'host.toast' } });
  });
});
