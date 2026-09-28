/**
 * Tenant-bound id wire form (`spec/v2/core/identity.md` §5 "Wire form"):
 * every UTF-8 byte outside `[A-Za-z0-9._-]` projects to `~` + two uppercase
 * hex digits; a wire id in either the projected or the percent form decodes
 * back to the bound id.
 */

import { describe, it, expect } from 'vitest';
import { projectId, unprojectId } from '../wire-id.js';
import { OpenwopClient } from '../client.js';

describe('projectId', () => {
  it('projects the spec example and the anon: prefix', () => {
    expect(projectId('acme/r-9f3c')).toBe('acme~2Fr-9f3c');
    expect(projectId('anon:sess-3f9c/r_1.2')).toBe('anon~3Asess-3f9c~2Fr_1.2');
  });

  it('escapes ~ itself and every byte of a non-ASCII character, uppercase', () => {
    expect(projectId('a~b/c')).toBe('a~7Eb~2Fc');
    expect(projectId('café/r')).toBe('caf~C3~A9~2Fr');
    expect(projectId('t/😀')).toBe('t~2F~F0~9F~98~80');
  });

  it('never double-escapes an id that is already a wire form', () => {
    expect(projectId('acme~2Fr-9f3c')).toBe('acme~2Fr-9f3c');
    expect(projectId('acme%2Fr-9f3c')).toBe('acme~2Fr-9f3c');
    expect(projectId('acme%2fr-9f3c')).toBe('acme~2Fr-9f3c');
  });

  it('leaves a bare opaque segment unchanged', () => {
    expect(projectId('r-9f3c0000000000000000')).toBe('r-9f3c0000000000000000');
  });
});

describe('unprojectId', () => {
  it('accepts both the projected and the percent form', () => {
    expect(unprojectId('acme~2Fr-9f3c')).toBe('acme/r-9f3c');
    expect(unprojectId('acme%2Fr-9f3c')).toBe('acme/r-9f3c');
    expect(unprojectId('caf~C3~A9~2Fr')).toBe('café/r');
    expect(unprojectId('acme/r-9f3c')).toBe('acme/r-9f3c');
  });

  it('round-trips', () => {
    for (const id of ['acme/r-9f3c', 'anon:s/x', 'a~b/c', 'café/r', 't/😀']) {
      expect(unprojectId(projectId(id))).toBe(id);
    }
  });
});

describe('the client sends tenant-bound ids projected', () => {
  it('runs and webhooks path segments use ~2F, not %2F', async () => {
    const urls: string[] = [];
    const f: typeof fetch = async (input) => {
      urls.push(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
      return new Response(null, { status: 204 });
    };
    const client = new OpenwopClient({ baseUrl: 'https://h.example', apiKey: 'k', fetch: f });
    await client.webhooks.unregister('acme/sub-1');
    await client.runs.diff('acme/r1', 'acme~2Fr2').catch(() => undefined);
    expect(new URL(urls[0]!).pathname).toBe('/webhooks/acme~2Fsub-1');
    expect(urls[1]).toBe('https://h.example/runs/acme~2Fr1:diff?against=acme~2Fr2');
  });
});
