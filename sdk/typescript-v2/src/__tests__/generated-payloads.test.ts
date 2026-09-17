import { describe, expect, it } from 'vitest';
import { KNOWN_RUN_EVENT_TYPES, isKnownRunEventType, narrowRunEvent } from '../generated-payloads.js';
import type { RunEventDoc } from '../types.js';

const base = (type: string, payload: unknown): RunEventDoc => ({ eventId: 'e-0123456789abcdef', runId: 't/r-0123456789abcdef', type, payload, timestamp: '2026-09-17T00:00:00Z', sequence: 0, schemaVersion: 1 });

describe('generated payload narrowing (COMPATIBILITY.md §2.1 — opt-in, never refusing)', () => {
  it('names every codemap type once, sorted', () => {
    expect(KNOWN_RUN_EVENT_TYPES.length).toBe(118);
    expect([...KNOWN_RUN_EVENT_TYPES]).toEqual([...KNOWN_RUN_EVENT_TYPES].sort());
    expect(new Set(KNOWN_RUN_EVENT_TYPES).size).toBe(KNOWN_RUN_EVENT_TYPES.length);
  });
  it('narrows a known type and keeps the payload typed by that type', () => {
    const doc = base('run.started', { workflowId: 'wf' });
    const known = narrowRunEvent(doc);
    expect(known?.type).toBe('run.started');
    if (known?.type === 'run.started') expect(known.payload.workflowId).toBe('wf');
  });
  it('answers undefined for a vendor-org type and for a type from a newer corpus — the doc is still usable untyped', () => {
    expect(isKnownRunEventType('acme.widget-spun')).toBe(false);
    expect(narrowRunEvent(base('acme.widget-spun', { rpm: 3 }))).toBeUndefined();
    expect(narrowRunEvent(base('run.teleported', {}))).toBeUndefined();
  });
});
