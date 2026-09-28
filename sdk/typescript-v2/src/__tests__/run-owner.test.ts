/** `RunSnapshot.owner.subject` is the RFC 0170 Subject object, not a string. */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';
import type { Subject } from '../types.js';

describe('RunSnapshot.owner.subject', () => {
  it('is a Subject with its actor chain', async () => {
    const f: typeof fetch = async () =>
      new Response(`{"runId":"acme/r-0000000000000001","workflowId":"wf","status":"completed","owner":{"tenant":"acme","subject":{"issuer":"urn:host:api-key","subjectId":"default","tenant":"acme","lane":"api-key","kind":"agent","actor":{"issuer":"urn:host:oidc","subjectId":"u1","tenant":"acme","lane":"oidc","kind":"user"}}},"eventLogSchemaVersion":3,"engineVersion":1,"compensationStatus":"none","variables":{},"startedAt":"t","completedAt":"t"}`, { status: 200, headers: { 'content-type': 'application/json' } });
    const snap = await new OpenwopClient({ baseUrl: 'https://h.example', apiKey: 'k', fetch: f }).runs.get('acme/r-0000000000000001');
    const subject: Subject = snap.owner.subject;
    expect(subject.lane).toBe('api-key');
    expect(subject.actor?.subjectId).toBe('u1');
  });
});
