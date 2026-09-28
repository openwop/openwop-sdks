/**
 * `audit.verify` carries every RFC 0218 §C anomaly shape: `kind` with its own
 * members, and a genesis `chain-break` whose `expectedPrevHash` is `null`.
 */

import { describe, it, expect } from 'vitest';
import { OpenwopClient } from '../client.js';
import type { AuditVerifyAnomaly } from '../types.js';

describe('audit.verify anomalies (RFC 0218 §C)', () => {
  it('passes kind / checkpoint / detail and a null expectedPrevHash through', async () => {
    const body = {
      fromSeq: 0,
      toSeq: 9,
      chainValid: false,
      checkpoints: [],
      anomalies: [
        { atSeq: 0, expectedPrevHash: null, actualPrevHash: 'ab' },
        { atSeq: 8, kind: 'merkle-mismatch', checkpoint: 'cp-1', detail: 'root differs' },
        { atSeq: 3, kind: 'missing-entry' },
      ] satisfies AuditVerifyAnomaly[],
    };
    const f: typeof fetch = async () =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    const res = await new OpenwopClient({ baseUrl: 'https://h.example', apiKey: 'k', fetch: f }).audit.verify(0, 9);
    const [genesis, merkle, missing] = res.anomalies;
    expect(genesis?.kind).toBeUndefined();
    expect(genesis?.expectedPrevHash).toBeNull();
    expect(merkle).toEqual({ atSeq: 8, kind: 'merkle-mismatch', checkpoint: 'cp-1', detail: 'root differs' });
    expect(missing?.kind).toBe('missing-entry');
  });
});
