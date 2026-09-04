/**
 * The v2 wire contract this package exists for (RFC 0172 §A, RFC 0171 §C.1,
 * events.md §Poll): bare-origin unversioned paths, `OpenWOP-Version` on every
 * request, the `OpenWOP-*` header family, `afterSequence`, and the generated
 * error-code registry.
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient, SDK_PROTOCOL_MAJOR, protocolVersionHeader } from '../client.js';
import { streamEvents, streamHostEvents } from '../sse.js';
import {
  ERROR_CODES,
  ERROR_CODE_HTTP_STATUS,
  RETRIABLE_ERROR_CODES,
  CAPABILITY_FAMILY_KEYS,
  CAPABILITY_METADATA_KEYS,
} from '../generated.js';
import { isErrorCode, isRetriableErrorCode, isVendorErrorCode, HTTP_ERROR_CODES } from '../run-helpers.js';
import { WopError } from '../types.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..', '..', '..', '..');

interface Captured { url: string; method: string; headers: Headers }

function mockClient(
  responder: (req: Captured) => { status: number; body?: unknown; headers?: Record<string, string> } = () => ({ status: 200, body: {} }),
  opts: { major?: number } = {},
): { client: OpenwopClient; captured: Captured[] } {
  const captured: Captured[] = [];
  const mockFetch: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const req = { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers ?? {}) };
    captured.push(req);
    const r = responder(req);
    const headers = new Headers(r.headers ?? {});
    if (r.body !== undefined && !headers.has('content-type')) headers.set('content-type', 'application/json');
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : null, { status: r.status, headers });
  };
  const client = new OpenwopClient({ baseUrl: 'https://host.example/', apiKey: 'k', fetch: mockFetch, ...opts });
  return { client, captured };
}

describe('OpenWOP-Version negotiation (RFC 0172 §A.3)', () => {
  it('defaults to major 2 and renders <major>.0', () => {
    expect(SDK_PROTOCOL_MAJOR).toBe(2);
    expect(protocolVersionHeader(2)).toBe('2.0');
    expect(protocolVersionHeader(3)).toBe('3.0');
    expect(() => protocolVersionHeader(1.5)).toThrow(TypeError);
    expect(mockClient().client.protocolVersion).toBe('2.0');
    expect(mockClient(undefined, { major: 3 }).client.protocolVersion).toBe('3.0');
  });

  it('is sent on every request — authenticated, unauthenticated, mutation, read', async () => {
    const { client, captured } = mockClient(() => ({ status: 200, body: { protocolVersions: ['2.0'], preferredVersion: '2.0' } }));
    await client.discovery.capabilities();
    await client.runs.get('t/r1');
    await client.runs.create({ workflowId: 'wf' }, { idempotencyKey: 'idem-1', dedup: 'enforce' });
    await client.interrupts.inspectByToken('tok');
    await client.host.effectSeams();
    expect(captured).toHaveLength(5);
    for (const req of captured) {
      expect(req.headers.get('OpenWOP-Version')).toBe('2.0');
      expect(req.url.includes('/v1')).toBe(false);
    }
    expect(captured[0]!.headers.has('Authorization')).toBe(false);
    expect(captured[3]!.headers.has('Authorization')).toBe(false);
    expect(captured[1]!.headers.get('Authorization')).toBe('Bearer k');
  });

  it('a 406 protocol_version_unsupported surfaces as a WopError with the typed code', async () => {
    const { client } = mockClient(() => ({
      status: 406,
      body: { error: 'protocol_version_unsupported', message: 'unlisted major', details: { protocolVersions: ['1.12'] } },
    }));
    await expect(client.runs.get('t/r1')).rejects.toBeInstanceOf(WopError);
    try {
      await client.runs.get('t/r1');
    } catch (err) {
      const e = err as WopError;
      expect(e.status).toBe(406);
      expect(e.envelope?.error).toBe('protocol_version_unsupported');
      expect(isErrorCode(e.envelope?.error)).toBe(true);
    }
  });
});

describe('header renames (headers.md)', () => {
  it('OpenWOP-Dedup replaces X-Dedup; Idempotency-Key keeps its standard name', async () => {
    const { client, captured } = mockClient(() => ({ status: 201, body: { runId: 't/r', status: 'pending', eventsUrl: '/runs/t%2Fr/events' } }));
    await client.runs.create({ workflowId: 'wf' }, { idempotencyKey: 'idem-1', dedup: 'enforce' });
    const h = captured[0]!.headers;
    expect(h.get('OpenWOP-Dedup')).toBe('enforce');
    expect(h.get('Idempotency-Key')).toBe('idem-1');
    expect(h.has('X-Dedup')).toBe(false);
    expect(captured[0]!.url).toBe('https://host.example/runs');
  });
});

describe('paths are unversioned keys on the bare origin (versioning.md §1.2)', () => {
  it('a sample across every namespace', async () => {
    const { client, captured } = mockClient(() => ({ status: 200, body: {} }));
    await client.discovery.openapi();
    await client.workflows.get('wf');
    await client.runs.get('t/r1');
    await client.runs.compensation('t/r1');
    await client.runs.effects('t/r1');
    await client.agents.getOrgChart();
    await client.tools.list();
    await client.prompts.render({ ref: 'x', variables: {} } as never);
    await client.audit.verify(0, 1);
    await client.content.getSettings();
    await client.webhooks.unregister('wh1');
    await client.host.effectSeams();
    expect(captured.map((c) => new URL(c.url).pathname)).toEqual([
      '/openapi.json',
      '/workflows/wf',
      '/runs/t%2Fr1',
      '/runs/t%2Fr1/compensation',
      '/runs/t%2Fr1/effects',
      '/agents/org-chart',
      '/tools',
      '/prompts:render',
      '/audit/verify',
      '/content/settings',
      '/webhooks/wh1',
      '/host/effect-seams',
    ]);
  });
});

describe('poll cursor (events.md §Poll)', () => {
  it('sends afterSequence, never lastSequence, and reads the closed response', async () => {
    const page = { runId: 't/r1', events: [], lastSequence: -1, status: 'running', isTerminal: false };
    const { client, captured } = mockClient(() => ({ status: 200, body: page }));
    const res = await client.runs.pollEvents('t/r1', { afterSequence: 7, timeoutSeconds: 5 });
    const url = new URL(captured[0]!.url);
    expect(url.pathname).toBe('/runs/t%2Fr1/events/poll');
    expect(url.searchParams.get('afterSequence')).toBe('7');
    expect(url.searchParams.get('timeout')).toBe('5');
    expect(url.searchParams.has('lastSequence')).toBe(false);
    expect(res.lastSequence).toBe(-1);
    expect(res.isTerminal).toBe(false);
  });
});

describe('SSE channels carry the version header and unversioned paths', () => {
  const sse = (frames: string) => {
    const seen: Captured[] = [];
    const f: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      seen.push({ url, method: init?.method ?? 'GET', headers: new Headers(init?.headers ?? {}) });
      return new Response(frames, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    return { f, seen };
  };

  it('runEvents: /runs/{runId}/events + OpenWOP-Version + Last-Event-ID; batch frames flatten', async () => {
    const { f, seen } = sse('id: 1\nevent: batch\ndata: [{"eventId":"e1","runId":"t/r1","type":"run.started","payload":{},"timestamp":"t","sequence":0,"schemaVersion":1},{"eventId":"e2","runId":"t/r1","type":"run.completed","payload":{},"timestamp":"t","sequence":1,"schemaVersion":1}]\n\n');
    const out = [];
    for await (const ev of streamEvents({ baseUrl: 'https://host.example', apiKey: 'k', protocolVersion: '2.0', fetch: f }, 't/r1', { lastEventId: '0', streamMode: ['updates', 'messages'] })) out.push(ev.type);
    expect(out).toEqual(['run.started', 'run.completed']);
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe('/runs/t%2Fr1/events');
    expect(url.searchParams.get('streamMode')).toBe('updates,messages');
    expect(seen[0]!.headers.get('OpenWOP-Version')).toBe('2.0');
    expect(seen[0]!.headers.get('Last-Event-ID')).toBe('0');
  });

  it('hostEvents: /host/events by default, overridable by heartbeat.deliveryChannel', async () => {
    const { f, seen } = sse(': keep-alive\n\nevent: heartbeat.evaluated\ndata: {"type":"heartbeat.evaluated","payload":{"heartbeatId":"h1","status":"ok","changed":false}}\n\n');
    const out = [];
    for await (const ev of streamHostEvents({ baseUrl: 'https://host.example', apiKey: 'k', protocolVersion: '2.0', fetch: f })) out.push(ev.type);
    expect(out).toEqual(['heartbeat.evaluated']);
    expect(new URL(seen[0]!.url).pathname).toBe('/host/events');
    expect(seen[0]!.headers.get('OpenWOP-Version')).toBe('2.0');
    for await (const _ of streamHostEvents({ baseUrl: 'https://host.example', apiKey: 'k', protocolVersion: '2.0', fetch: f }, { path: '/ops/heartbeats' })) void _;
    expect(new URL(seen[1]!.url).pathname).toBe('/ops/heartbeats');
  });
});

describe('generated registries match the vendored corpus', () => {
  it('ERROR_CODES is exactly spec/v2/errors.json, sorted, with the registered status + retriable rows', () => {
    const registry = JSON.parse(readFileSync(resolve(REPO, 'spec/v2/errors.json'), 'utf8')) as { rows: { code: string; httpStatus: number; retriable: boolean }[] };
    const codes = registry.rows.map((r) => r.code).sort();
    expect([...ERROR_CODES]).toEqual(codes);
    expect(ERROR_CODES).toHaveLength(94);
    // rc.1 grew the registry by two rows; the union tracks it, not a hand-kept list.
    expect(isErrorCode('fork_point_invalid')).toBe(true);
    expect(isErrorCode('webhook_url_rejected')).toBe(true);
    expect(ERROR_CODE_HTTP_STATUS['fork_point_invalid']).toBe(422);
    expect(ERROR_CODE_HTTP_STATUS['webhook_url_rejected']).toBe(400);
    expect(HTTP_ERROR_CODES).toBe(ERROR_CODES);
    for (const r of registry.rows) expect(ERROR_CODE_HTTP_STATUS[r.code as (typeof ERROR_CODES)[number]]).toBe(r.httpStatus);
    expect([...RETRIABLE_ERROR_CODES].sort()).toEqual(registry.rows.filter((r) => r.retriable).map((r) => r.code).sort());
    expect(isErrorCode('rate_limited')).toBe(true);
    expect(isRetriableErrorCode('rate_limited')).toBe(true);
    expect(isRetriableErrorCode('not_found')).toBe(false);
    expect(isErrorCode('acme.quota_exceeded')).toBe(false);
    expect(isVendorErrorCode('acme.quota_exceeded')).toBe(true);
    expect(isVendorErrorCode('openwop.reserved')).toBe(false);
  });

  it('capability keys partition the closed root of capabilities.schema.json', () => {
    const schema = JSON.parse(readFileSync(resolve(REPO, 'schemas/v2/capabilities.schema.json'), 'utf8')) as {
      additionalProperties: boolean; required: string[]; properties: Record<string, { required?: string[] }>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required.sort()).toEqual(['preferredVersion', 'protocolVersions']);
    const all = Object.keys(schema.properties).sort();
    expect([...CAPABILITY_FAMILY_KEYS, ...CAPABILITY_METADATA_KEYS].sort()).toEqual(all);
    for (const k of CAPABILITY_FAMILY_KEYS) expect(schema.properties[k]?.required).toEqual(expect.arrayContaining(['status', 'since', 'witness']));
  });
});
