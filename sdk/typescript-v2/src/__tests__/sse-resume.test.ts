/**
 * RFC 0247 — resumable SSE streams. A host may end an opted-in stream before
 * the run's terminal event, and platforms end long streams regardless. The
 * SDK must resume with `Last-Event-ID` = the last `id:` it received, honour
 * `retry:`, never re-yield an event, and stop at the terminal event.
 */
import { describe, expect, it } from 'vitest';
import { streamEvents, streamHostEvents } from '../sse.js';

type Step = { status?: number; body?: string; headers?: Record<string, string> } | 'network-error';

/** A fetch that serves one scripted response per connect and records each request. */
function scripted(steps: Step[]) {
  const seen: { url: URL; lastEventId: string | null }[] = [];
  const f: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers ?? {});
    seen.push({ url: new URL(String(input)), lastEventId: headers.get('Last-Event-ID') });
    const step = steps[seen.length - 1];
    if (step === undefined) throw new Error(`unexpected connect #${seen.length}`);
    if (step === 'network-error') throw new TypeError('fetch failed');
    return new Response(step.body ?? '', {
      status: step.status ?? 200,
      headers: { 'content-type': 'text/event-stream', ...(step.headers ?? {}) },
    });
  };
  return { f, seen };
}

const ctx = (f: typeof fetch) => ({ baseUrl: 'https://host.example', apiKey: 'k', protocolVersion: '2.0', fetch: f });
const ev = (seq: number, type: string) =>
  `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify({ eventId: `e${seq}`, runId: 't/r1', type, payload: {}, timestamp: 't', sequence: seq, schemaVersion: 1 })}\n\n`;
const fast = { delayMs: 1, maxDelayMs: 4, maxAttempts: 3 };

describe('streamEvents resumes a stream the host ended early (RFC 0247)', () => {
  it('reconnects with the last id, honours retry:, yields no duplicates, stops at the terminal event', async () => {
    const { f, seen } = scripted([
      { body: `retry: 5\n\n${ev(0, 'run.started')}${ev(1, 'node.started')}` },
      // A host that re-sends the resumption point is guarded against.
      { body: `${ev(1, 'node.started')}${ev(2, 'node.completed')}` },
      { body: ev(3, 'run.completed') },
    ]);
    const started = Date.now();
    const out: string[] = [];
    for await (const e of streamEvents(ctx(f), 't/r1', { reconnect: fast })) out.push(`${e.sequence}:${e.type}`);
    expect(out).toEqual(['0:run.started', '1:node.started', '2:node.completed', '3:run.completed']);
    expect(seen.map((s) => s.lastEventId)).toEqual([null, '1', '2']);
    for (const s of seen) expect(s.url.searchParams.get('resumable')).toBe('true');
    expect(Date.now() - started).toBeGreaterThanOrEqual(8); // two waits of the host's retry: 5
  });

  it('resumes from the caller-supplied lastEventId and a batch frame id', async () => {
    const batch = `id: 6\nevent: batch\ndata: ${JSON.stringify([5, 6].map((sequence) => ({ type: 'node.started', sequence })))}\n\n`;
    const { f, seen } = scripted([{ body: batch }, { body: ev(7, 'run.failed') }]);
    const out: number[] = [];
    for await (const e of streamEvents(ctx(f), 't/r1', { lastEventId: '4', reconnect: fast })) out.push(e.sequence);
    expect(out).toEqual([5, 6, 7]);
    expect(seen.map((s) => s.lastEventId)).toEqual(['4', '6']);
  });

  it('ends when a resume on a terminal run closes at once without a frame (events.md)', async () => {
    const { f, seen } = scripted([{ body: ev(0, 'run.started') }, { body: ': keep-alive\n\n' }]);
    const out: number[] = [];
    for await (const e of streamEvents(ctx(f), 't/r1', { reconnect: fast })) out.push(e.sequence);
    expect(out).toEqual([0]);
    expect(seen).toHaveLength(2);
  });

  it('ends at a terminal state.snapshot in values mode', async () => {
    const snap = (status: string) => `id: 2\nevent: state.snapshot\ndata: ${JSON.stringify({ runId: 't/r1', status })}\n\n`;
    const { f, seen } = scripted([{ body: snap('running') }, { body: snap('completed') }]);
    const out: string[] = [];
    for await (const s of streamEvents(ctx(f), 't/r1', { streamMode: 'values', reconnect: fast })) out.push((s as unknown as { status: string }).status);
    expect(out).toEqual(['running', 'completed']);
    expect(seen).toHaveLength(2);
  });

  it('retries a dropped connection and a 503, honouring Retry-After', async () => {
    const { f, seen } = scripted([
      { body: ev(0, 'run.started') },
      'network-error',
      { status: 503, headers: { 'retry-after': '0' } },
      { body: ev(1, 'run.cancelled') },
    ]);
    const out: number[] = [];
    for await (const e of streamEvents(ctx(f), 't/r1', { reconnect: fast })) out.push(e.sequence);
    expect(out).toEqual([0, 1]);
    expect(seen.map((s) => s.lastEventId)).toEqual([null, '0', '0', '0']);
  });

  it('stops on a non-retryable status instead of reconnecting', async () => {
    const { f, seen } = scripted([{ body: ev(0, 'run.started') }, { status: 403 }]);
    const out: number[] = [];
    await expect(async () => {
      for await (const e of streamEvents(ctx(f), 't/r1', { reconnect: fast })) out.push(e.sequence);
    }).rejects.toThrow('SSE subscribe failed: HTTP 403');
    expect(out).toEqual([0]);
    expect(seen).toHaveLength(2);
  });

  it('gives up after maxAttempts consecutive failed reconnects', async () => {
    const { f, seen } = scripted([{ body: ev(0, 'run.started') }, 'network-error', 'network-error', 'network-error', 'network-error']);
    await expect(async () => {
      for await (const _ of streamEvents(ctx(f), 't/r1', { reconnect: fast })) void _;
    }).rejects.toThrow(/SSE reconnect failed: fetch failed/);
    expect(seen).toHaveLength(5); // the first connect + 1 + maxAttempts (3)
  });

  it('fails fast on the first connect, as before', async () => {
    const { f, seen } = scripted([{ status: 503 }]);
    await expect(async () => {
      for await (const _ of streamEvents(ctx(f), 't/r1', { reconnect: fast })) void _;
    }).rejects.toThrow('SSE subscribe failed: HTTP 503');
    expect(seen).toHaveLength(1);
  });

  it('reconnect: false keeps the single-connection behaviour and sends no resumable flag', async () => {
    const { f, seen } = scripted([{ body: ev(0, 'run.started') }]);
    const out: number[] = [];
    for await (const e of streamEvents(ctx(f), 't/r1', { reconnect: false })) out.push(e.sequence);
    expect(out).toEqual([0]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url.searchParams.has('resumable')).toBe(false);
  });

  it('an abort during the reconnect wait stops reconnecting', async () => {
    const { f, seen } = scripted([{ body: ev(0, 'run.started') }]);
    const ac = new AbortController();
    const out: number[] = [];
    for await (const e of streamEvents(ctx(f), 't/r1', { signal: ac.signal, reconnect: { delayMs: 10_000 } })) {
      out.push(e.sequence);
      setTimeout(() => ac.abort(), 5);
    }
    expect(out).toEqual([0]);
    expect(seen).toHaveLength(1);
  });
});

describe('streamHostEvents resumes from the last durable id (RFC 0247)', () => {
  it('ephemeral frames (no id:) do not move the cursor; a quick empty close backs off', async () => {
    const host = (id: string | null, type: string) => `${id ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify({ type, payload: {} })}\n\n`;
    const { f, seen } = scripted([
      { body: host('h-1', 'heartbeat.evaluated') + host(null, 'host-test.ephemeral') },
      { body: '' },
      { body: host('h-2', 'heartbeat.stateChanged') },
    ]);
    const ac = new AbortController();
    const out: string[] = [];
    for await (const e of streamHostEvents(ctx(f), { signal: ac.signal, reconnect: fast })) {
      out.push(e.type);
      if (out.length === 3) ac.abort();
    }
    expect(out).toEqual(['heartbeat.evaluated', 'host-test.ephemeral', 'heartbeat.stateChanged']);
    expect(seen.map((s) => s.lastEventId)).toEqual([null, 'h-1', 'h-1']);
    expect(seen[0]!.url.pathname).toBe('/host/events');
    expect(seen[0]!.url.searchParams.get('resumable')).toBe('true');
  });
});
