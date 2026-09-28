/**
 * RFC 0219 — `OpenWOP-Client-Version` names the corpus release this SDK is
 * built against (CORPUS_TAG), never the package version, and rides every
 * request: the JSON path and the SSE subscribe.
 */
import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';
import { CORPUS_VERSION } from '../index.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const GRAMMAR = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$/;

function expectedFromCorpusTag(): string {
  const tag = readFileSync(resolve(REPO, 'CORPUS_TAG'), 'utf8').trim();
  const m = /^(?:openwop-conformance\/)?v?(\d+)\.(\d+)\.(\d+)(-.+)?$/.exec(tag);
  if (!m) throw new Error(`unparseable CORPUS_TAG ${tag}`);
  return m[4] ? `${m[1]}.${m[2]}` : `${m[1]}.${m[2]}.${m[3]}`;
}

describe('OpenWOP-Client-Version (RFC 0219)', () => {
  it('CORPUS_VERSION matches the header grammar and CORPUS_TAG', () => {
    expect(CORPUS_VERSION).toMatch(GRAMMAR);
    expect(CORPUS_VERSION).toBe(expectedFromCorpusTag());
    const pkg = JSON.parse(readFileSync(resolve(REPO, 'sdk/typescript-v2/package.json'), 'utf8')) as { version: string };
    expect(CORPUS_VERSION).not.toBe(pkg.version);
  });

  it('is sent on a JSON request and on the SSE subscribe', async () => {
    const seen: Headers[] = [];
    const f: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers ?? {});
      seen.push(headers);
      if (headers.get('Accept') === 'text/event-stream') {
        return new Response('event: heartbeat.evaluated\ndata: {"type":"heartbeat.evaluated","payload":{}}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new OpenwopClient({ baseUrl: 'https://host.example', apiKey: 'k', fetch: f });
    expect(client.clientVersion).toBe(CORPUS_VERSION);

    await client.discovery.capabilities();
    await client.runs.get('t/r1');
    for await (const _ of client.host.events()) void _;
    for await (const _ of client.runs.events('t/r1')) void _;

    expect(seen).toHaveLength(4);
    for (const h of seen) expect(h.get('OpenWOP-Client-Version')).toBe(expectedFromCorpusTag());
  });
});
