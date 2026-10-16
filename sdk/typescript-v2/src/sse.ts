/**
 * SSE consumers for `GET /runs/{runId}/events` (the `runEvents` channel) and
 * `GET /host/events` (the `hostEvents` channel) — events.md §SSE frames.
 * Async-iterable shape so consumers can write
 * `for await (const event of client.runs.events(...))`.
 *
 * Parses `event:` / `data:` / `id:` / `retry:` lines per the WHATWG
 * EventSource grammar. Native fetch + ReadableStream — zero third-party deps.
 *
 * Resumable (RFC 0247): by default the subscribe sends `resumable=true`, and
 * when a stream ends before the run's terminal event (a host's bounded close,
 * a platform or proxy timeout, a dropped connection) the SDK reconnects with
 * `Last-Event-ID` set to the last `id:` it received and keeps yielding, so
 * one `for await` loop spans every connection. Pass `reconnect: false` for
 * the single-connection behaviour of 2.5.0 and earlier.
 *
 * Cancellable: pass an AbortSignal via options, or break out of the
 * for-await loop and the underlying connection is torn down.
 */

import type { HostEventDoc, RunEventDoc, StreamMode } from './types.js';
import { CORPUS_VERSION } from './generated.js';
import { isTerminalRunStatus } from './run-helpers.js';
import { projectId } from './wire-id.js';

/** Tuning for the RFC 0247 reconnect loop. Every field is optional. */
export interface StreamReconnectOptions {
  /** Delay before a reconnect when the host sent no `retry:` field. Default 1000 ms. */
  readonly delayMs?: number;
  /** Ceiling for the exponential backoff applied to failed or empty reconnects. Default 30000 ms. */
  readonly maxDelayMs?: number;
  /** Consecutive failed reconnects before the iterator throws. Default 10. */
  readonly maxAttempts?: number;
}

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
  /**
   * RFC 0247. Default `true`: send `resumable=true` and reconnect with
   * `Last-Event-ID` whenever the stream ends before the terminal event.
   * `false` restores the pre-2.6 behaviour: one connection, no query flag,
   * iteration ends when that connection ends. An object enables reconnect
   * with custom timing.
   */
  readonly reconnect?: boolean | StreamReconnectOptions;
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
  /**
   * RFC 0247; see {@link EventsStreamOptions.reconnect}. The host channel has
   * no terminal event, so with reconnect on the iterator runs until aborted
   * or until a reconnect fails for good. The cursor is the last durable
   * event's `id:`; ephemeral frames carry none and are never redelivered.
   */
  readonly reconnect?: boolean | StreamReconnectOptions;
}

export interface EventsStreamContext {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** The `OpenWOP-Version` value sent on the subscribe request (RFC 0172 §A.3). */
  readonly protocolVersion: string;
  /** Optional fetch implementation override. Defaults to global `fetch`. */
  readonly fetch?: typeof fetch;
}

/**
 * Subscribe to a run's event stream. Yields each `RunEventDoc` (and, in
 * `values` mode, each `RunSnapshot` frame) through the run's terminal event.
 * With reconnect on (the default), a stream the host ends early is resumed
 * with `Last-Event-ID` and never re-yields an event (RFC 0247).
 */
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
  const path = `/runs/${projectId(runId)}/events${qs ? `?${qs}` : ''}`;
  return streamSse<RunEventDoc>(ctx, path, opts, isRunTerminalFrame);
}

/** Subscribe to the host events channel (heartbeat messages; content-free of run data). */
export function streamHostEvents(
  ctx: EventsStreamContext,
  opts: HostEventsStreamOptions = {},
): AsyncGenerator<HostEventDoc, void, void> {
  return streamSse<HostEventDoc>(ctx, opts.path ?? '/host/events', opts, null);
}


const TERMINAL_EVENT_TYPES: ReadonlySet<string> = new Set(['run.completed', 'run.failed', 'run.cancelled']);

/**
 * RFC 0247 §A floor: a host does not end an opted-in stream early within this
 * long of opening it. A resumed run stream that closes sooner WITHOUT a frame
 * is the events.md answer for a run that is already terminal ("close the
 * stream without a frame"), so the iterator ends instead of reconnecting.
 */
const BOUNDED_CLOSE_FLOOR_MS = 15_000;
/** A host-events connection that closes this fast with no frame counts as a failed attempt. */
const QUICK_CLOSE_MS = 1_000;
/** Statuses worth another reconnect attempt; any other non-2xx ends the iterator. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

/** True for a frame that ends the run: a terminal event, or a terminal `state.snapshot`. */
function isRunTerminalFrame(eventName: string, frame: unknown): boolean {
  if (typeof frame !== 'object' || frame === null) return false;
  const f = frame as { type?: unknown; status?: unknown };
  if (typeof f.type === 'string' && TERMINAL_EVENT_TYPES.has(f.type)) return true;
  return eventName === 'state.snapshot' && typeof f.status === 'string' && isTerminalRunStatus(f.status);
}

function resolveReconnect(
  opt: boolean | StreamReconnectOptions | undefined,
): Required<StreamReconnectOptions> | null {
  if (opt === false) return null;
  const o = typeof opt === 'object' ? opt : {};
  return { delayMs: o.delayMs ?? 1_000, maxDelayMs: o.maxDelayMs ?? 30_000, maxAttempts: o.maxAttempts ?? 10 };
}

function withResumableFlag(path: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}resumable=true`;
}

/** `Retry-After` as milliseconds: delta-seconds or an HTTP date. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers.get('retry-after');
  if (raw === null) return null;
  if (/^\d+$/.test(raw.trim())) return Number(raw.trim()) * 1000;
  const at = Date.parse(raw);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done(): void {
      clearTimeout(t);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** A failed (re)connect. `status` 0 is a network error on a reconnect; the original is the `cause`. */
class SseHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfter: number | null,
    cause?: unknown,
  ) {
    super(status === 0 ? `SSE reconnect failed: ${String((cause as Error)?.message ?? cause)}` : `SSE subscribe failed: HTTP ${status}`, { cause });
  }
}

async function* streamSse<T>(
  ctx: EventsStreamContext,
  basePath: string,
  opts: {
    readonly lastEventId?: string;
    readonly signal?: AbortSignal;
    readonly reconnect?: boolean | StreamReconnectOptions;
  },
  isTerminal: ((eventName: string, frame: unknown) => boolean) | null,
): AsyncGenerator<T, void, void> {
  const policy = resolveReconnect(opts.reconnect);
  const url = `${ctx.baseUrl}${policy ? withResumableFlag(basePath) : basePath}`;
  const externalSignal = opts.signal;
  const doFetch = ctx.fetch ?? fetch;

  let cursor = opts.lastEventId;
  let retryMs = policy?.delayMs ?? 0;
  let failures = 0;
  let established = false;
  // Highest run-event `sequence` yielded — the duplicate guard behind the exclusive cursor.
  let maxSequence = -1;

  while (true) {
    if (externalSignal?.aborted) return;
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${ctx.apiKey}`,
      'Cache-Control': 'no-cache',
      'OpenWOP-Version': ctx.protocolVersion,
      'OpenWOP-Client-Version': CORPUS_VERSION,
    };
    if (cursor) headers['Last-Event-ID'] = cursor;

    const internalAbort = new AbortController();
    const onAbort = (): void => internalAbort.abort();
    externalSignal?.addEventListener('abort', onAbort, { once: true });

    const openedAt = Date.now();
    let frames = 0;
    let terminal = false;
    let failure: unknown = null;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    try {
      let res: Response;
      try {
        res = await doFetch(url, { method: 'GET', headers, signal: internalAbort.signal });
      } catch (err) {
        if (externalSignal?.aborted) return;
        // The first connect fails fast, exactly as before RFC 0247.
        if (!policy || !established) throw err;
        throw new SseHttpError(0, null, err);
      }
      if (!res.ok || res.body === null) {
        throw new SseHttpError(res.status, retryAfterMs(res));
      }
      established = true;

      reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let pendingEvent = 'message';
      let pendingData: string[] = [];
      let pendingId: string | undefined;

      /** Flush the buffered frame into 0..N documents; also advances the cursor. */
      const flush = (): T[] => {
        const eventName = pendingEvent;
        const id = pendingId;
        const data = pendingData;
        pendingEvent = 'message';
        pendingData = [];
        pendingId = undefined;
        if (id !== undefined) cursor = id;
        if (data.length === 0) return [];
        let parsed: unknown;
        try {
          parsed = JSON.parse(data.join('\n'));
        } catch {
          return []; // non-JSON frame (vendor extension)
        }
        frames++;
        const docs = (eventName === 'batch' && Array.isArray(parsed) ? parsed : [parsed]) as unknown[];
        const out: T[] = [];
        for (const doc of docs) {
          const seq = (doc as { sequence?: unknown } | null)?.sequence;
          if (isTerminal && typeof seq === 'number') {
            if (seq <= maxSequence) continue; // already yielded on an earlier connection
            maxSequence = seq;
          }
          if (isTerminal?.(eventName, doc)) terminal = true;
          out.push(doc as T);
        }
        return out;
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
              for (const event of flush()) yield event;
              if (terminal) return;
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
              case 'id':
                // A NUL-bearing id is ignored (WHATWG); a durable frame's id is the resume cursor.
                if (!fieldValue.includes('\0')) pendingId = fieldValue;
                break;
              case 'retry':
                if (/^\d+$/.test(fieldValue)) retryMs = Number(fieldValue);
                break;
              default:
                break;
            }
          }
        }
        // Flush any final unterminated frame.
        for (const final of flush()) yield final;
        if (terminal) return;
      } catch (err) {
        if (externalSignal?.aborted) return;
        if (!policy) throw err;
        failure = err; // a dropped connection mid-stream: resume below
      }
    } catch (err) {
      if (!(err instanceof SseHttpError)) throw err;
      if (!policy || !established || (err.status !== 0 && !RETRYABLE_STATUSES.has(err.status))) throw err;
      failure = err;
    } finally {
      externalSignal?.removeEventListener('abort', onAbort);
      try {
        reader?.releaseLock();
      } catch {
        // best-effort
      }
      if (!internalAbort.signal.aborted) internalAbort.abort();
    }

    // The connection ended without the terminal event.
    if (!policy || externalSignal?.aborted) return;
    const lived = Date.now() - openedAt;
    if (failure === null && frames === 0) {
      // events.md: a resume on a terminal run closes without a frame. A host
      // ending an opted-in stream early waits out the RFC 0247 floor first.
      if (isTerminal && lived < BOUNDED_CLOSE_FLOOR_MS) return;
      if (!isTerminal && lived < QUICK_CLOSE_MS) failure = 'empty';
    }
    let delay = retryMs;
    if (failure === null || frames > 0) {
      failures = 0;
    } else {
      failures++;
      if (failures > policy.maxAttempts) {
        throw failure instanceof Error ? failure : new Error('SSE stream kept closing without data');
      }
      delay = Math.min(policy.maxDelayMs, Math.max(retryMs, 1) * 2 ** (failures - 1));
    }
    if (failure instanceof SseHttpError && failure.retryAfter !== null) delay = Math.max(delay, failure.retryAfter);
    await sleep(delay, externalSignal);
  }
}
