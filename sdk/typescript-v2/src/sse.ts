/**
 * SSE consumers for `GET /runs/{runId}/events` (the `runEvents` channel) and
 * `GET /host/events` (the `hostEvents` channel) — events.md §SSE frames.
 * Async-iterable shape so consumers can write
 * `for await (const event of client.runs.events(...))`.
 *
 * Parses `event:` / `data:` / `id:` lines per the WHATWG EventSource
 * grammar. Native fetch + ReadableStream — zero third-party deps.
 *
 * Cancellable: pass an AbortSignal via options, or break out of the
 * for-await loop and the underlying connection is torn down.
 */

import type { HostEventDoc, RunEventDoc, StreamMode } from './types.js';

export interface EventsStreamOptions {
  /**
   * Single mode (e.g., 'updates') OR array of modes (mixed mode, e.g.,
   * ['updates', 'messages']). Arrays serialize to a comma-separated
   * `?streamMode=updates,messages` query (events.md §The events channel).
   */
  readonly streamMode?: StreamMode | readonly StreamMode[];
  /** `Last-Event-ID` — the host resumes at the next sequence and never re-emits the resumption point. */
  readonly lastEventId?: string;
  readonly signal?: AbortSignal;
  /**
   * Batching hint (0..5000). The host accumulates events into one
   * `event: batch` frame whose `data:` is an array of `RunEventDoc`; the SDK
   * flattens the batch back into individual yields.
   */
  readonly bufferMs?: number;
}

export interface HostEventsStreamOptions {
  /** `Last-Event-ID` for resumption. */
  readonly lastEventId?: string;
  readonly signal?: AbortSignal;
  /**
   * The channel address. Default `/host/events`; a host MAY declare another
   * under `heartbeat.deliveryChannel` (capabilities.md).
   */
  readonly path?: string;
}

export interface EventsStreamContext {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** The `OpenWOP-Version` value sent on the subscribe request (RFC 0172 §A.3). */
  readonly protocolVersion: string;
  /** Optional fetch implementation override. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
}

/** Subscribe to a run's event stream. Yields each `RunEventDoc` until the host closes after the terminal event. */
export function streamEvents(
  ctx: EventsStreamContext,
  runId: string,
  opts: EventsStreamOptions = {},
): AsyncGenerator<RunEventDoc, void, void> {
  const params = new URLSearchParams();
  if (opts.streamMode) {
    const modeParam: string =
      typeof opts.streamMode === 'string' ? opts.streamMode : opts.streamMode.join(',');
    params.set('streamMode', modeParam);
  }
  if (opts.bufferMs !== undefined) {
    params.set('bufferMs', String(opts.bufferMs));
  }
  const qs = params.toString();
  const path = `/runs/${encodeURIComponent(runId)}/events${qs ? `?${qs}` : ''}`;
  return streamSse<RunEventDoc>(ctx, path, opts);
}

/** Subscribe to the host events channel (heartbeat messages; content-free of run data). */
export function streamHostEvents(
  ctx: EventsStreamContext,
  opts: HostEventsStreamOptions = {},
): AsyncGenerator<HostEventDoc, void, void> {
  return streamSse<HostEventDoc>(ctx, opts.path ?? '/host/events', opts);
}

async function* streamSse<T>(
  ctx: EventsStreamContext,
  path: string,
  opts: { readonly lastEventId?: string; readonly signal?: AbortSignal },
): AsyncGenerator<T, void, void> {
  const url = `${ctx.baseUrl}${path}`;

  const headers: Record<string, string> = {
    Accept: 'text/event-stream',
    Authorization: `Bearer ${ctx.apiKey}`,
    'Cache-Control': 'no-cache',
    'OpenWOP-Version': ctx.protocolVersion,
  };
  if (opts.lastEventId) {
    headers['Last-Event-ID'] = opts.lastEventId;
  }

  const internalAbort = new AbortController();
  const externalSignal = opts.signal;
  if (externalSignal) {
    if (externalSignal.aborted) internalAbort.abort();
    else externalSignal.addEventListener('abort', () => internalAbort.abort(), { once: true });
  }

  const doFetch = ctx.fetch ?? fetch;
  const res = await doFetch(url, { method: 'GET', headers, signal: internalAbort.signal });
  if (!res.ok || res.body === null) {
    throw new Error(`SSE subscribe failed: HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let pendingEvent = 'message';
  let pendingData: string[] = [];

  /**
   * Flush the buffered frame. Returns 0 elements when the buffer is empty or
   * non-JSON (skip), 1 element for a normal `event: <type>` frame, N for an
   * `event: batch` frame whose `data:` is a JSON array.
   */
  const flushAndYield = (): T[] => {
    if (pendingData.length === 0) {
      pendingEvent = 'message';
      return [];
    }
    const dataStr = pendingData.join('\n');
    const eventType = pendingEvent;
    pendingEvent = 'message';
    pendingData = [];
    try {
      const parsed = JSON.parse(dataStr) as unknown;
      if (eventType === 'batch' && Array.isArray(parsed)) {
        return parsed as T[];
      }
      return [parsed as T];
    } catch {
      // Skip non-JSON frames (keep-alive payloads, vendor extensions).
      return [];
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nlIdx: number;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, nlIdx).replace(/\r$/, '');
        buffer = buffer.slice(nlIdx + 1);

        if (rawLine === '') {
          for (const event of flushAndYield()) yield event;
          continue;
        }
        if (rawLine.startsWith(':')) continue; // keep-alive comment

        const colon = rawLine.indexOf(':');
        const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
        const valueRaw = colon === -1 ? '' : rawLine.slice(colon + 1);
        const fieldValue = valueRaw.startsWith(' ') ? valueRaw.slice(1) : valueRaw;

        switch (field) {
          case 'event':
            pendingEvent = fieldValue;
            break;
          case 'data':
            pendingData.push(fieldValue);
            break;
          default:
            // `id:` is the sequence; the consumer reads it from the document itself.
            break;
        }
      }
    }
    // Flush any final unterminated frame.
    for (const final of flushAndYield()) yield final;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // best-effort
    }
    if (!internalAbort.signal.aborted) internalAbort.abort();
  }
}
