/**
 * Run-status + error-code helpers — additive utilities over the wire-format
 * `RunStatus` union, HTTP error envelopes, and run-level error shape
 * declared in `types.ts`.
 *
 * **Why these live here.** `types.ts` declares the canonical wire shapes
 * (mirroring `api/v2/openapi.yaml` + `schemas/v2/run-snapshot.schema.json`).
 * This module adds the constants + predicates SDK consumers need to act
 * on those shapes without redefining them locally. Pulling them into the
 * SDK makes the protocol vocabulary single-sourced for application,
 * integration, and test code.
 *
 * **Forward-compatibility design.** The spec's `RunStatus` enum is
 * intentionally narrower than what host engines may emit: the schema
 * declares *"future statuses MAY be added; readers SHOULD treat unknown
 * values as terminal-unknown rather than throw"*. So `isTerminalRunStatus`
 * accepts `string` and uses a **negative-set** check — anything NOT in
 * the small known-non-terminal set is treated as terminal. This keeps
 * the helper correct against:
 *
 *   - the canonical 10-member spec union (`pending` / `running` / `paused`
 *     / `waiting-approval` / `waiting-input` / `waiting-external` /
 *     `completed` / `failed` / `cancelling` / `cancelled`)
 *   - host extensions like `'planned'`, `'executing'`, `'timed-out'`,
 *     `'interrupted'` which the OpenWOP engine emits
 *   - any future spec additions before the SDK ships an updated minor
 *
 * @module @openwop/openwop/run-helpers
 */

import type { RunStatus, VendorErrorCode } from './types.js';
import { ERROR_CODES, RETRIABLE_ERROR_CODES, VENDOR_ERROR_CODE_PATTERN, type ErrorCode } from './generated.js';

// ─── Run statuses ────────────────────────────────────────────────────────

/**
 * Run statuses considered active — the run MAY still transition. A reader
 * who does not recognize a status string MUST treat it as terminal-unknown
 * (per the spec's forward-compat clause). This list is the narrow,
 * spec-stable enumeration used to derive that decision.
 */
export const ACTIVE_RUN_STATUSES = [
  'pending',
  'running',
  'paused',
  'waiting-approval',
  'waiting-input',
  'waiting-external',
  // RFC 0094 §B — transitional state during the cancel cascade; the run
  // WILL still transition (to terminal `cancelled`), so it is active.
  'cancelling',
] as const;

/**
 * Spec-known terminal statuses. Hosts MAY emit additional terminal values
 * (e.g., `'timed-out'`, `'interrupted'`); use {@link isTerminalRunStatus}
 * for forward-compatible checks instead of literal-set membership.
 */
export const TERMINAL_RUN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
] as const;

export type ActiveRunStatus = (typeof ACTIVE_RUN_STATUSES)[number];
export type TerminalRunStatus = (typeof TERMINAL_RUN_STATUSES)[number];

/**
 * Returns true if the status indicates the run will not transition further.
 *
 * Implemented as a negative check against {@link ACTIVE_RUN_STATUSES}: any
 * value NOT in the spec's known-active set is treated as terminal. This
 * implements the schema's forward-compat clause — a host that emits a
 * status the SDK doesn't know about is assumed to be reporting a terminal
 * state, NOT that the run is still active. The alternative (positive check
 * against {@link TERMINAL_RUN_STATUSES}) would loop polling forever on any
 * unknown value, which is the documented worst-case the clause prevents.
 *
 * Accepts `string` (not just `RunStatus`) so callers can pass values from
 * extended host emissions without casting.
 */
export function isTerminalRunStatus(status: RunStatus | string): boolean {
  return !(ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

// ─── HTTP error-envelope codes ───────────────────────────────────────────

/**
 * The v2 error registry (`spec/v2/errors.json`, errors.md): every code a v2
 * host may return in `ErrorEnvelope.error`, generated into `generated.ts`.
 * Kept under the 1.x name for call-site parity; `ERROR_CODES` is the same
 * array.
 */
export const HTTP_ERROR_CODES = ERROR_CODES;

export type HttpErrorCode = ErrorCode;

/** Type guard that narrows a string to a registered protocol {@link ErrorCode}. */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/** 1.x name for {@link isErrorCode}. */
export const isHttpErrorCode = isErrorCode;

/** True for the registry rows marked `retriable: true`; retry timing lives in `Retry-After` only (RFC 0171 §B.2). */
export function isRetriableErrorCode(value: unknown): value is (typeof RETRIABLE_ERROR_CODES)[number] {
  return typeof value === 'string' && (RETRIABLE_ERROR_CODES as readonly string[]).includes(value);
}

/** True for a well-formed vendor code (`<org>.<name>`, `openwop.` reserved); does not check org registration. */
export function isVendorErrorCode(value: unknown): value is VendorErrorCode {
  return typeof value === 'string' && VENDOR_ERROR_CODE_PATTERN.test(value);
}

// ─── Run error codes ─────────────────────────────────────────────────────

/**
 * Run-document error codes — stable identifiers used in
 * `RunSnapshot.error.code` when a run reaches `failed`. These are distinct
 * from the HTTP-level `ErrorEnvelope.error` codes above: a request can fail
 * with `unauthenticated` before a run exists, while a run can fail later
 * with `node_execution_failed` or `recursion_limit_exceeded`.
 *
 * Add a new code here when adding a new run failure mode that crosses the
 * network boundary. Do NOT add codes for purely internal engine errors.
 *
 * **Drift risk note.** This list is canonical for SDK consumers but is
 * NOT yet pinned by `conformance/src/scenarios/errors.test.ts` against
 * host emission. A future conformance addition (tracked separately)
 * SHOULD compare host-emitted error codes against this set and fail on
 * unrecognized values. Until that lands, drift between this list + the
 * engine's actual emission set is detectable only by manual review.
 */
export const RUN_ERROR_CODES = [
  // Authorization / access
  'auth_required',
  'forbidden',
  'workspace_not_found',

  // Run-state conflicts
  'run_already_active',
  'run_not_found',
  'run_terminal',
  'engine_version_mismatch',

  // Validation
  'invalid_workflow_definition',
  'invalid_trigger_input',
  'node_type_not_found',
  'config_validation_failed',

  // Quota / budget
  'token_budget_exceeded',
  'concurrent_run_limit_reached',
  'rate_limited',

  // Execution
  'node_timeout',
  'global_timeout',
  'node_execution_failed',
  'external_call_failed',
  'recursion_limit_exceeded',
  'run_timeout',
  'loop_limit_exceeded',
  'envelope_refusal',
  'capability_not_provided',

  // Approval
  'approval_timeout',
  'approval_token_invalid',
  'approval_token_expired',
  'approval_token_consumed',

  // Persistence
  'persistence_failed',
  'doc_budget_exceeded',
] as const;

export type RunErrorCode = (typeof RUN_ERROR_CODES)[number];

/**
 * Type guard that narrows a string to a known {@link RunErrorCode}.
 * Returns false for unknown / malformed values rather than throwing —
 * SDK consumers usually want to display a fallback for unknown codes
 * rather than crash the render pipeline.
 */
export function isRunErrorCode(value: unknown): value is RunErrorCode {
  return typeof value === 'string' && (RUN_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Run-level error shape — the structured `error` field on a `failed` run
 * document. Distinct from the HTTP-level {@link import('./types.js').ErrorEnvelope}:
 *
 *   - `RunError` lives on the run document; describes WHY the run failed.
 *     `code` is from the typed {@link RunErrorCode} vocabulary.
 *   - `ErrorEnvelope` lives on HTTP error responses; describes WHY the
 *     request failed. `error` is a registered {@link ErrorCode} or a vendor
 *     code (`<org>.<name>`).
 *
 * The shapes share `message` and `details` but diverge on the code field
 * name (`code` vs `error`) by design — they represent different layers.
 */
export interface RunError {
  code: RunErrorCode;
  message: string;
  /** Optional node-id where the error originated. */
  nodeId?: string;
  /** Optional structured context — implementations MAY extend. */
  details?: Record<string, unknown>;
}
