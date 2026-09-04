/**
 * Request/response types for the openwop REST surface.
 *
 * Mirrors `api/openapi.yaml` and the JSON Schemas in
 * `schemas/`. Hand-authored rather than codegen'd — see
 * SDK README §rationale.
 *
 * Forward-compat: types use `string` (not narrow unions) for fields whose
 * spec'd values may grow over time (status enums, event types, error codes).
 * Consumers wanting exhaustive narrowing should `as const` their checks
 * rather than relying on the SDK to refuse unknown values.
 */

import type { CapabilityFamilyKey, ErrorCode } from './generated.js';

/** Run statuses per `RunSnapshot.status` in OpenAPI. */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'waiting-approval'
  | 'waiting-input'
  | 'waiting-external'
  | 'completed'
  | 'failed'
  /** RFC 0094 §B — transitional state between a cancel request being
   *  accepted and the terminal `cancelled`. Non-terminal: a snapshot
   *  read during the cancel cascade carries it. */
  | 'cancelling'
  | 'cancelled';

/**
 * The `kind` discriminator on a `cap.breached` event payload
 * (`run-event-payloads.schema.json#capBreached`). The four engine kinds, the
 * RFC 0008 §K `wasm-*` runtime caps, and the RFC 0058 run-scoped bounds.
 */
export type CapBreachedKind =
  | 'clarification'
  | 'schema'
  | 'envelopes'
  | 'node-executions'
  | 'wasm-memory'
  | 'wasm-fuel'
  | 'wasm-execution-time'
  | 'run-duration'
  | 'loop-iterations';

/**
 * RFC 0151 §D — the run's compensation (unwind) rollup on `RunSnapshot`,
 * kept separate from `RunStatus` on purpose: `status` is the FORWARD
 * execution state and RFC 0151 forbids reinterpreting it (there is
 * deliberately no `compensating` run status). Capability-gated: a host that
 * does not advertise `capabilities.compensation` omits the field; an
 * advertising host carries it on every snapshot, `none` when idle. The
 * value is the deterministic fold of the `compensation.*` events defined in
 * `spec/v2/core/compensation.md §"Run rollup: compensationStatus"`.
 */
export type CompensationStatus =
  | 'none'
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'manual';

/** `RunSnapshot.owner` — closed; `subject` REQUIRED (identity.md). */
export interface RunOwner {
  tenant: string;
  workspace?: string;
  subject: string;
}

/** `schemas/v2/run-snapshot.schema.json` — the fold of the event log through the run projection (runs.md §Snapshot). */
export interface RunSnapshot {
  runId: string;
  workflowId: string;
  status: RunStatus;
  owner: RunOwner;
  /** The era key, integer ≥ 2; a v2 host stamps `3` on every run it creates. */
  eventLogSchemaVersion: number;
  engineVersion?: number;
  /** RFC 0151 §D. Present iff the host advertises `capabilities.compensation`.
   *  See {@link CompensationStatus}. */
  compensationStatus?: CompensationStatus;
  currentNodeId?: string;
  startedAt?: string;
  completedAt?: string;
  nodeStates?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  channels?: Record<string, unknown>;
  /** `{ code, message, details? }` on terminal `failed`. */
  error?: { code: string; message: string; details?: Record<string, unknown> };
  /** The persisted `RunOptions` (runs.md §Run options). */
  configurable?: RunConfigurable;
  tags?: readonly string[];
  metadata?: Record<string, unknown>;
  agent?: AgentRef;
  /** MUST NOT change for the run's lifetime. */
  runOrchestrator?: AgentRef;
  metrics?: {
    openwopCost?: {
      usd?: number;
      tokens?: { input?: number; output?: number };
      model?: string;
      provider?: string;
      duration_ms?: number;
    };
    [key: string]: unknown;
  };
  /** Linkage back to the parent run when this run was spawned via
   *  `core.subWorkflow`. Per `interrupt-profiles.md §openwop-interrupt-
   *  cascade-cancel`: child runs preserve `parentRunId` + `parentNodeId`
   *  so cancellation can cascade. Absent for top-level runs. */
  parentRunId?: string;
  parentNodeId?: string;
  /** Surfaced for `waiting-*` runs per `interrupt.md §"Signed-token
   *  callback"`. Carries the open interrupt's metadata so clients can
   *  resolve via `POST /interrupts/{token}` without consulting a
   *  separate endpoint. Hosts MAY omit `data` to keep payloads small;
   *  the token + callbackUrl are the load-bearing fields. */
  interrupt?: {
    kind: string;
    nodeId: string;
    interruptToken?: string;
    callbackUrl?: string;
    data?: unknown;
  };
}

/**
 * `schemas/v2/configurable.schema.json` — closed, nested and versioned (RFC
 * 0171 §D.1; runs.md §Run options). `version` is REQUIRED and is `1`. An
 * unknown root key, an unknown key inside a section, or a dotted key is
 * rejected with `400 validation_error`; vendor keys live under
 * `extensions.<org>`.
 */
export interface RunConfigurable {
  version: 1;
  run?: {
    /** Clamped to `limits.maxNodeExecutions`. */
    recursionLimit?: number;
    /** Resolves to `min(runTimeoutMs, limits.maxRunDurationMs)`; breach → `run_timeout`. */
    runTimeoutMs?: number;
    /** Resolves against `limits.maxLoopIterations`; breach → `loop_limit_exceeded`. */
    maxLoopIterations?: number;
    /** The `low-confidence` interrupt threshold. */
    escalationThreshold?: number;
  };
  ai?: {
    /** MUST be in `aiProviders.supported`, else `400 validation_error`. */
    provider?: string;
    model?: string;
    /** 0..2 */
    temperature?: number;
    maxTokens?: number;
    /** References a provider in `aiProviders.byok`; never carries key material. */
    credentialRef?: string;
    promptOverrides?: Record<string, string>;
    /** Test-keys-only; `403 mock_provider_forbidden` on a production credential. */
    mockProvider?: string;
    reasoningVerbosity?: 'none' | 'summary' | 'full';
    /** The `envelope.refusal` ceiling (events.md E5). */
    maxRefusals?: number;
  };
  distillation?: {
    /** Resolves to `min(tokenBudget, memory.distillation.maxTokenBudget)`. */
    tokenBudget?: number;
  };
  /** `schemas/v2/budget-policy.schema.json`. */
  budget?: Record<string, unknown>;
  /** A vendor key lives under its registered org and nowhere else. */
  extensions?: Record<string, Record<string, unknown>>;
}

export interface CreateRunRequest {
  /**
   * The workflow to run. Required for a normal run; OMITTED for an eval run
   * (`mode: 'eval'`), which targets `agentId` + `evalSuiteRef` instead
   * (RFC 0081 §B). The server enforces the conditional requirement.
   */
  workflowId?: string;
  inputs?: Record<string, unknown>;
  tenantId?: string;
  scopeId?: string;
  /** `schemas/v2/residency.schema.json`; an unadvertised `region` → `422 residency_unavailable`. */
  residency?: { region?: string; [key: string]: unknown };
  /** The signed-token callback (interrupt.md). */
  callbackUrl?: string;
  configurable?: RunConfigurable;
  tags?: readonly string[];
  metadata?: Record<string, unknown>;
  /** RFC 0081 §B. `'eval'` makes this run an eval-suite projection (see `evalSuiteRef` + `agentId`). Omit for a normal workflow run. */
  mode?: 'eval';
  /** RFC 0081. URI of the `AgentEvalSuite` to run. Required when `mode === 'eval'`. */
  evalSuiteRef?: string;
  /** RFC 0081. The manifest agent the eval suite targets. Required when `mode === 'eval'`. */
  agentId?: string;
}

export interface CreateRunResponse {
  runId: string;
  status: RunStatus;
  eventsUrl: string;
  statusUrl?: string;
}

export interface CancelRunRequest {
  reason?: string;
}

export interface CancelRunResponse {
  runId: string;
  status: 'cancelled' | 'cancelling';
}

export interface RegisterWebhookRequest {
  /** Receiver URL the host will POST signed deliveries to. */
  url: string;
  /** Event types to subscribe to (subset of the `RunEventType` enum). */
  events: readonly string[];
  /** Optional pre-shared secret; if omitted the host generates one and returns it in the response. */
  secret?: string;
  /** Optional tag filter — only events from runs carrying these tags are delivered. */
  tags?: readonly string[];
}

export interface RegisterWebhookResponse {
  /** Server-issued opaque subscription id; pass to `webhooks.unregister`. */
  subscriptionId: string;
  url: string;
  /**
   * The signing secret. **Returned ONCE on registration** — the host
   * cannot recover it later. Store it server-side for HMAC verification.
   */
  secret: string;
  eventTypes: readonly string[];
  createdAt: string;
}

export interface PauseRunRequest {
  reason?: string;
  drainPolicy?: 'immediate' | 'drain-current-node';
}

export interface PauseRunResponse {
  runId: string;
  status: 'paused';
  pausedAt?: string;
}

export interface ResumeRunRequest {
  reason?: string;
}

export interface ResumeRunResponse {
  runId: string;
  status: 'running';
  resumedAt?: string;
}

// rest-endpoints.md §"POST /runs:bulk-cancel" (closes R1).
export interface BulkCancelRunsRequest {
  runIds: readonly string[];
  reason?: string;
}

export interface BulkCancelRunResult {
  runId: string;
  ok: boolean;
  status?: 'cancelled' | 'cancelling';
  error?: { error: string; message: string; details?: Record<string, unknown> };
}

export interface BulkCancelRunsResponse {
  results: BulkCancelRunResult[];
}

// auth-profiles.md §"openwop-audit-log-integrity" §4. The response
// shape is canonically defined by schemas/audit-verify-result.schema.json;
// this TS view tracks the same fields with names normalized to
// camelCase. Hosts that don't advertise the profile return 404.
export interface AuditVerifyResult {
  fromSeq: number;
  toSeq: number;
  chainValid: boolean;
  checkpointsValid?: boolean;
  checkpoints: AuditVerifyCheckpoint[];
  anomalies: AuditVerifyAnomaly[];
}

export interface AuditVerifyCheckpoint {
  checkpoint: string;
  atSequence: number;
  merkleRoot: string;
  signature: string;
}

export interface AuditVerifyAnomaly {
  atSeq: number;
  expectedPrevHash: string;
  actualPrevHash: string;
}

export interface ForkRunRequest {
  fromSeq: number;
  mode: 'replay' | 'branch';
  runOptionsOverlay?: Record<string, unknown>;
}

export interface ForkRunResponse {
  runId: string;
  sourceRunId: string;
  fromSeq?: number;
  mode: 'replay' | 'branch';
  status: RunStatus;
  eventsUrl: string;
}

/** RFC 0056 — a non-blocking quality signal on a run/event/node. */
export type AnnotationSignal =
  | { kind: 'rating'; rating: number }
  | { kind: 'flag' }
  | { kind: 'label'; label: string }
  | { kind: 'correction'; correction: string };

/** RFC 0056 persisted annotation (`annotation.schema.json`). A side-resource —
 *  not a replayable run-event-log entry. */
export interface Annotation {
  annotationId: string;
  target: { runId: string; eventId?: string; nodeId?: string };
  signal: AnnotationSignal;
  actor: { principalRef: string };
  note?: string;
  createdAt: string;
}

/** RFC 0056 request body for `createAnnotation` (`annotation-create.schema.json`).
 *  The host assigns `annotationId`/`createdAt`/`actor` and binds `target.runId`. */
export interface CreateAnnotationRequest {
  target?: { eventId?: string; nodeId?: string };
  signal: AnnotationSignal;
  note?: string;
}

/**
 * Response from `GET /runs/{runId}/ancestry` — RFC 0040 §C cross-host
 * composition parent. `parent: null` for top-level runs (not dispatched
 * from any other run); otherwise `parent.wellKnownUrl` is set when the
 * parent is on a different host so callers can walk the chain.
 *
 * Capability-gated: hosts not advertising
 * `capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported: true`
 * return 404; the SDK surfaces that as `null` via `runs.ancestry()`.
 */
export interface RunAncestryResponse {
  runId: string;
  hostId: string;
  parent: null | {
    runId: string;
    hostId: string;
    wellKnownUrl?: string;
    cause: 'mcp-tool-call' | 'a2a-message' | 'core.subWorkflow' | 'core.dispatch';
  };
}

/** RFC 0054 — response from `GET /runs/{runId}:diff?against={otherRunId}`.
 *  Mirror of `run-diff-response.schema.json`. Deterministic, replay-aware
 *  structured diff of two runs' event sequences + terminal states. */
export interface RunDiffEventDiff {
  seq: number;
  op: 'added' | 'removed' | 'changed';
  /** Present unless `op === 'added'`. */
  aEvent?: RunEventDoc;
  /** Present unless `op === 'removed'`. */
  bEvent?: RunEventDoc;
}

export interface RunDiffResponse {
  /** The `{runId}` run. */
  a: string;
  /** The `against` run. */
  b: string;
  /** Sequence at which the logs first diverge; null if identical. */
  divergedAtSeq: number | null;
  eventDiffs: RunDiffEventDiff[];
  /** Diff of terminal RunSnapshot states (redaction-safe). */
  stateDiff: Record<string, unknown>;
  /** True if either run was in-flight and only a prefix was compared. */
  truncated?: boolean;
}

export interface ResolveInterruptRequest {
  resumeValue: unknown;
}

export interface ResolveInterruptResponse {
  runId: string;
  nodeId: string;
  status: RunStatus;
}

/**
 * Token-scoped interrupt inspection response — mirrors `suspend-request.schema.json`
 * (the `InterruptPayload` shape).
 */
export interface InterruptByTokenInspection {
  kind:
    | 'approval'
    | 'clarification'
    | 'external-event'
    | 'custom'
    // Multi-Agent Shift Phase 4 — multi-turn user interjections.
    | 'conversation.start'
    | 'conversation.exchange'
    | 'conversation.close'
    // Phase 1 — confidence-escalation contract.
    | 'low-confidence';
  key: string;
  resumeSchema?: Record<string, unknown>;
  timeoutMs?: number;
  data: unknown;
}

export interface ResolveInterruptByTokenResponse {
  // Server-defined shape (openapi declares `type: object`); kept as
  // unknown-typed object so SDK consumers narrow per implementation.
  [key: string]: unknown;
}

/** `GET /runs/{runId}/events/poll` response (events.md §Poll) — closed. */
export interface PollEventsResponse {
  runId: string;
  events: readonly RunEventDoc[];
  /** The highest sequence in the log at the time of the response; `-1` when the log is empty. */
  lastSequence: number;
  /** The snapshot status. */
  status: RunStatus;
  /** Whether the run is terminal. */
  isTerminal: boolean;
}

/** Mirror of `run-event.schema.json` — top-level shape only. */
export interface RunEventDoc {
  eventId: string;
  runId: string;
  nodeId?: string;
  type: string; // RunEventType — string-typed for forward compat
  payload: unknown;
  timestamp: string;
  /** The one ordering field: integer ≥ 0, first event `0`, strictly increasing per run. */
  sequence: number;
  /** Per-event schema version, integer ≥ 1 (RFC 0172 §B axis 5). */
  schemaVersion: number;
  /** Integer ≥ 0 everywhere (RFC 0172 §B axis 3). */
  engineVersion?: number;
  causationId?: string;
}

/**
 * A vendor error code: `<org>.<name>` with the org registered in
 * `spec/v2/declaration.json`; `openwop.` is reserved (errors.md). The template
 * literal keeps `ErrorEnvelope.error` open to registered vendor codes while
 * every protocol code is a member of the generated {@link ErrorCode} union.
 */
export type VendorErrorCode = `${string}.${string}`;

/** `{ error, message, details? }` and nothing else (errors.md §The envelope). */
export interface ErrorEnvelope {
  error: ErrorCode | VendorErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type StreamMode = 'values' | 'updates' | 'messages' | 'debug';

// ─── Discovery: the closed v2 root (capabilities.md; RFC 0169, 0172, 0176) ──

/** Maturity of a capability record. */
export type CapabilityStatus = 'stable' | 'experimental' | 'deprecated';

/** The five wire-legal witness classes (RFC 0168 §B); `unwitnessable` never appears on the wire. */
export type WitnessClass =
  | 'witnessable-unaided'
  | 'witnessable-gated'
  | 'seam-gated'
  | 'claims-check'
  | 'negative-existence';

/**
 * One capability record (RFC 0169 §A). `status`, `since` and `witness` are
 * REQUIRED; `until` is REQUIRED when `status` is `experimental` or
 * `deprecated` and MUST NOT be present when `stable`. `supported` does not
 * exist — presence of the record is the claim. The remaining members are the
 * family's facets (`spec/v2/facets/<key>.schema.json` where hand-decided).
 */
export interface CapabilityRecord {
  status: CapabilityStatus;
  /** `<major>.<minor>` */
  since: string;
  /** `<major>.<minor>` or `YYYY-MM-DD` */
  until?: string;
  witness: WitnessClass;
  [facet: string]: unknown;
}

/** A version-axis grammar: `<major>.<minor>` with no leading zero (RFC 0149 §C). */
export type ProtocolVersion = `${number}.${number}`;

/**
 * The closed v2 discovery root (`schemas/v2/capabilities.schema.json`,
 * `additionalProperties: false`). Every key is one of the generated
 * {@link CapabilityMetadataKey}s, a family key ({@link CapabilityFamilyKey})
 * carrying a {@link CapabilityRecord}, or `extensions`. `protocolVersions`
 * and `preferredVersion` are REQUIRED (versioning.md §1.1).
 */
export type Capabilities = {
  /** Every `<major>.<minor>` this host serves. */
  protocolVersions: readonly ProtocolVersion[];
  /** The header-less default; MUST be a member of `protocolVersions[]`. */
  preferredVersion: ProtocolVersion;
  /** Kept as `preferredVersion`'s twin for v1 readers through the overlap. */
  protocolVersion?: ProtocolVersion;
  /** RFC 0172 row C5.8 — a host MAY refuse a client below it with `426 client_version_unsupported`. */
  minClientVersion?: string;
  /** Integer everywhere (RFC 0172 §B axis 3). */
  engineVersion?: number;
  /** The era key; a v2 host writes `3`. */
  eventLogSchemaVersion?: number;
  implementation?: { name?: string; version?: string; vendor?: string };
  /** `extensions.<org>.<name>` — vendor and host extension records; the org's own shape. */
  extensions?: Record<`${string}.${string}`, Record<string, unknown>>;
  configurable?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  runtimeCapabilities?: Record<string, unknown>;
  testing?: Record<string, unknown>;
  conformance?: Record<string, unknown>;
  fixtures?: Record<string, unknown>;
  compliance?: Record<string, unknown>;
  discovery?: Record<string, unknown>;
} & {
  readonly [K in CapabilityFamilyKey]?: CapabilityRecord;
};

// ─── RFC 0173 — compensation, effect ledger, effect seams ─────────────────

/** `GET /runs/{runId}/compensation` (`schemas/v2/compensation-projection.schema.json`). */
export interface CompensationProjection {
  runId: string;
  status: 'none' | 'pending' | 'running' | 'completed' | 'partial' | 'failed' | 'manual-intervention';
  plan: readonly {
    nodeId: string;
    order: number;
    /** `schemas/v2/compensation-policy.schema.json` */
    policy?: Record<string, unknown>;
    irreversibleEffect?: boolean;
  }[];
  attempts: readonly {
    nodeId: string;
    attempt: number;
    outcome: 'succeeded' | 'failed' | 'skipped' | 'manual';
    at: string;
    reason?: string;
  }[];
}

/** `GET /runs/{runId}/effects` (`schemas/v2/effect-ledger-projection.schema.json`). */
export interface EffectLedgerProjection {
  runId: string;
  effects: readonly {
    effectId: string;
    nodeId: string;
    attempt: number;
    invocationId?: string;
    keying: 'business-identity' | 'activity-recipe';
    /** Redaction-safe provider-side identity; never credential material. */
    providerKey?: string;
    state: 'claimed' | 'completed' | 'released' | 'escaped';
    at: string;
  }[];
}

/** `GET /host/effect-seams` (`schemas/v2/effect-seam-manifest.schema.json`). */
export interface EffectSeamManifest {
  manifestVersion: '1';
  host: {
    name: string;
    build: { kind: 'image-digest' | 'commit' | 'artifact-sha256'; id: string };
  };
  seams: readonly {
    /** The outbound effect path, host-named (e.g. `http.fetch`). */
    seam: string;
    kind: 'http' | 'queue' | 'storage' | 'provider-sdk' | 'webhook-fanout';
    guarded: true;
    guardedBy: string;
    branchReFires?: boolean;
    note?: string;
  }[];
}

// ─── Host events channel (`/host/events`; events.md §Host events) ─────────

/** `heartbeat.evaluated` (`schemas/v2/heartbeat-evaluated.schema.json`). */
export interface HeartbeatEvaluatedPayload {
  heartbeatId: string;
  status: 'ok' | 'timeout' | 'error';
  changed: boolean;
  [key: string]: unknown;
}

/** `heartbeat.stateChanged` (`schemas/v2/heartbeat-state-changed.schema.json`). */
export interface HeartbeatStateChangedPayload {
  heartbeatId: string;
  from: Record<string, unknown>;
  to: Record<string, unknown>;
  [key: string]: unknown;
}

/** One frame of the `hostEvents` channel — content-free of run data. */
export interface HostEventDoc {
  type: string;
  payload: unknown;
  timestamp?: string;
  [key: string]: unknown;
}

// ─── AI run overlay ─────────────────────────────────────────────────────

/**
 * Opaque host-issued reference to a stored secret. Sent via
 * `RunOptions.configurable.ai.credentialRef`; the host resolves
 * server-side and never echoes the cleartext back to the client.
 * Per `auth.md` §"Secret resolution" + SR-1.
 */
export type AICredentialRef = string;

/**
 * AI overlay slot on `RunConfigurable.ai`. Picks the provider+model
 * and (optionally) names a credentialRef the host MUST resolve.
 */
export interface AIRunOverlay {
  provider?: string;
  model?: string;
  credentialRef?: AICredentialRef;
  /** Implementation extensions; passed through verbatim. */
  [key: string]: unknown;
}

// ─── MCP client (Phase H.2) ─────────────────────────────────────────────

/** Wire shape of the `core.mcp.toolCall` node config. */
export interface McpToolCallNodeConfig {
  serverId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  timeoutMs?: number;
}

/** Sanitized summary emitted on the `mcp.invoked` event payload (MCP-1). */
export interface McpInvokedSummary {
  serverId: string;
  toolName: string;
  argumentsSha256: string;
  resultSha256: string;
  resultLength: number;
  isError: boolean;
  durationMs: number;
}

// ─── HTTP client (Phase H.3) ────────────────────────────────────────────

/** Wire shape of the `core.http.request` node config. */
export interface HttpRequestNodeConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  expectStatus?: number | readonly number[];
}

// ─── Agent memory / MemoryAdapter (Phase I.1) ───────────────────────────

/** Mirror of `schemas/memory-entry.schema.json`. */
export interface MemoryEntry {
  id: string;
  content: string;
  tags: readonly string[];
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** Optional TTL. Entries past `expiresAt` MUST NOT surface from list/get. */
  expiresAt?: string;
}

/** Mirror of `schemas/memory-list-options.schema.json`. */
export interface MemoryListOptions {
  /** Host MAY further bound. */
  limit?: number;
  /** Filter to entries carrying this tag. */
  tag?: string;
  /** RFC 0113. Max cumulative tokens across returned entries, denominated in
   *  `capabilities.memory.injectionBudget.tokenCounter`. The adapter returns a
   *  prefix of the ranked list whose cumulative tokens do not exceed this; a
   *  single over-budget entry is omitted (not truncated). Requires the host to
   *  advertise `memory.injectionBudget.supported`. */
  tokenBudget?: number;
  /** RFC 0113. Selection order. `recency` (default) is most-recent-first;
   *  `relevance` DELEGATES to `memory.search` semantic mode (RFC 0080) — it
   *  requires `query` and that the host advertise `memory.search` semantic. */
  rank?: 'recency' | 'relevance';
  /** RFC 0113. Free-text relevance anchor; REQUIRED when `rank: 'relevance'`. */
  query?: string;
}

// ─── Reasoning + agent events (Phase I.2) ───────────────────────────────

/** Mirror of `schemas/agent-ref.schema.json`. */
export interface AgentRef {
  agentId: string;
  modelClass?: 'reasoning' | 'tool-using' | 'chat';
  memoryRef?: string;
  version?: string;
}

/** Reasoning verbosity per capabilities.md §`agents.reasoning`. */
export type ReasoningVerbosity = 'off' | 'summary' | 'full';

// ─── agent.* event payloads (RFC 0002 §B + RFC 0024) ────────────────────
//
// Mirror of `schemas/run-event-payloads.schema.json#$defs.agent*`. Field
// names + types match the canonical wire contract verbatim; the `[key:
// string]: unknown` index signature reflects the deliberate
// `additionalProperties: true` carve-out on the agent.* payloads (Phase
// 1 of the multi-agent shift). When the canonical schema changes, these
// interfaces MUST be updated in lock-step — see the assertion in
// `__tests__/event-helpers.test.ts` that exercises every required field.

/** `agent.reasoned` payload (RFC 0002 §B). Fired once per closed
 *  reasoning block. The `reasoning` field is authoritative — when a
 *  streaming host also emitted `agent.reasoning.delta` events, this
 *  event still carries the complete trace (possibly after host-side
 *  truncation under `verbosity: 'summary'`). */
export interface AgentReasonedPayload {
  agentId: string;
  reasoning: string;
  verbosity?: ReasoningVerbosity;
  [key: string]: unknown;
}

/** `agent.reasoning.delta` payload (RFC 0024). Incremental reasoning
 *  chunk emitted while a reasoning block is still open. Consumers
 *  concatenate `delta` strings in `sequence` order to reconstruct
 *  the in-progress trace; the closing `agent.reasoned` event carries
 *  the authoritative final content. */
export interface AgentReasoningDeltaPayload {
  agentId: string;
  delta: string;
  sequence: number;
  verbosity?: ReasoningVerbosity;
  [key: string]: unknown;
}

/** `agent.toolCalled` payload (RFC 0002 §B). Pairs with `agent.toolReturned`
 *  via shared `callId`; the toolReturned event's `causationId` equals
 *  the toolCalled event's `eventId`. */
export interface AgentToolCalledPayload {
  agentId: string;
  toolName: string;
  callId: string;
  inputs?: unknown;
  [key: string]: unknown;
}

/** `agent.toolReturned` payload (RFC 0002 §B). `outcome` and `error`
 *  are mutually exclusive: success returns set `outcome`; failures set
 *  `error`. Hosts that need stricter validation layer it host-side. */
export interface AgentToolReturnedPayload {
  agentId: string;
  toolName: string;
  callId: string;
  outcome?: unknown;
  error?: ErrorEnvelope;
  [key: string]: unknown;
}

/** `agent.handoff` payload (RFC 0002 §B). Note the distinct field
 *  names — `fromAgentId` / `toAgentId`, NOT a single `agentId` like
 *  the other agent.* events. */
export interface AgentHandoffPayload {
  fromAgentId: string;
  toAgentId: string;
  reason?: string;
  [key: string]: unknown;
}

/** `agent.decided` payload (RFC 0002 §B). `confidence` in `[0, 1]`
 *  drives the low-confidence escalation contract (`node.suspended
 *  { reason: 'low-confidence' }`) when below the resolved threshold. */
export interface AgentDecidedPayload {
  agentId: string;
  decision: unknown;
  confidence?: number;
  [key: string]: unknown;
}

/** `memory.written` payload (RFC 0057). Content-free per-write attribution:
 *  identifiers + non-secret tags only — never the entry content (the read
 *  side serves that, already SR-1-redacted). `nodeId` is omitted for host
 *  session-end writes with no node attribution. */
export interface MemoryWrittenPayload {
  memoryRef: string;
  memoryId: string;
  nodeId?: string;
  agentId?: string;
  tags?: string[];
  [key: string]: unknown;
}

/** `output.chunk` / `ai.message.chunk` payload (RFC 0094 §D —
 *  `run-event-payloads.schema.json#$defs/outputChunk`). Emitted for
 *  streaming output (e.g., LLM token chunks); stream-mode `messages`
 *  consumers see these. `runId` is required so multiplexed consumers
 *  can route chunks without out-of-band context; `isLast` is required —
 *  consumers rely on it for fold termination. `meta` carries the tiered
 *  metadata per `stream-modes.md §messages` (Tier 1 typed slots + a
 *  Tier 2 provider-pass-through escape hatch); kept loosely typed here
 *  like the other extensible payload meta objects. */
export interface OutputChunkPayload {
  nodeId: string;
  /** Run this chunk belongs to. */
  runId: string;
  chunk: string;
  /** True for the final chunk of a given AI node call. */
  isLast: boolean;
  /** Optional sub-stream identifier when a node emits multiple
   *  parallel streams. */
  channel?: string;
  /** Tiered chunk metadata (`finishReason`, `logprobs`, `toolCalls`,
   *  `model`, `usage`, `provider` pass-through, …). */
  meta?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── RFC 0106 voice.* run-event payloads ────────────────────────────────
// Mirror `run-event-payloads.schema.json`. These events are emitted on the
// durable event log by the host-side `ctx.callTranscriber` /
// `ctx.callSpeechSynthesizer(stream:true)` methods (out of client-SDK scope);
// a client tails them off the run event stream.

/** `voice.speech_start` (RFC 0106). Host detected start of speech. */
export interface VoiceSpeechStartPayload {
  /** Milliseconds since the turn/session epoch. */
  atMs: number;
  [key: string]: unknown;
}

/** `voice.transcript` (RFC 0106). An interim or final transcript fragment.
 *  `contentTrust` is REQUIRED and always `'untrusted'` — live transcript is
 *  untrusted ingress (`voice-transcript-untrusted`); consumers MUST NOT
 *  promote it to higher authority. */
export interface VoiceTranscriptPayload {
  text: string;
  /** `true` once the fragment is finalized (committed at `voice.turn_commit`). */
  isFinal: boolean;
  atMs: number;
  /** Always `'untrusted'`. */
  contentTrust: 'untrusted';
  /** Stable prefix carried across interim revisions. */
  committedPrefix?: string;
  /** Provider-formatted variant (punctuation/casing). */
  formatted?: string;
  /** Provider stability score for an interim fragment. */
  stability?: number;
  [key: string]: unknown;
}

/** `voice.endpoint_candidate` (RFC 0106). A `semantic` turn detector's
 *  candidate end-of-turn, distinct from the committed `voice.turn_commit`. */
export interface VoiceEndpointCandidatePayload {
  atMs: number;
  /** Detector confidence in the candidate endpoint. */
  confidence?: number;
  [key: string]: unknown;
}

/** `voice.turn_commit` (RFC 0106). The turn is committed; `finalText` is the
 *  settled transcript the `ctx.callTranscriber` Promise resolves with. */
export interface VoiceTurnCommitPayload {
  atMs: number;
  finalText: string;
  [key: string]: unknown;
}

/** `voice.synthesis_chunk` (RFC 0106). Metadata for a streamed-synthesis
 *  clause-boundary chunk; bytes ride `url`/`streamRef` (or inline `base64`
 *  only under the host cap), never inlined past the cap. */
export interface VoiceSynthesisChunkPayload {
  /** Monotonic chunk sequence within the synthesis. */
  seq: number;
  mimeType: string;
  /** Host-served URL for the chunk bytes. */
  url?: string;
  /** Live-conduit handle for the chunk bytes. */
  streamRef?: string;
  /** Inline bytes — present only under the host's inline cap. */
  base64?: string;
  durationMs?: number;
  /** `true` for the final chunk of the synthesis. */
  final?: boolean;
  [key: string]: unknown;
}

/** `voice.barge_in` (RFC 0106). Overlapping speech detected during playback. */
export interface VoiceBargeInPayload {
  atMs: number;
  [key: string]: unknown;
}

/** `voice.cancelled` (RFC 0106). Downstream work cancelled (e.g. after a
 *  barge-in); no synthesis chunk follows. */
export interface VoiceCancelledPayload {
  atMs: number;
  /** Host-defined cancellation reason. */
  reason?: string;
  [key: string]: unknown;
}

/** `channel.presence` (RFC 0110). EPHEMERAL online + typing presence for a
 *  `type:'channel'` conversation. Observable on the LIVE run-event stream
 *  only — the host MUST NOT persist it to the replayable event log, so it is
 *  ABSENT on replay / `POST /runs/{runId}:fork`. Membership-gated: every
 *  ref is a current participant (opaque RFC 0041 subject refs, non-PII). */
export interface ChannelPresencePayload {
  conversationId: string;
  /** Subject refs of members currently present (subset of participants). */
  present: readonly string[];
  /** Subset of `present` currently typing (boolean-by-presence; no free text). */
  typing?: readonly string[];
  [key: string]: unknown;
}

/** `core.dispatch.fanOut` (RFC 0118). Emitted by `core.dispatch` when a
 *  `fanOutPolicy: 'parallel'` wave BEGINS, so the parent stays observable while
 *  children run concurrently. Emitted ONLY on the parallel path; the envelope's
 *  `nodeId` carries the dispatching node id and `causationId` is the consumed
 *  `runOrchestrator.decided` event. Per `run-event-payloads.schema.json`
 *  `$defs.dispatchFanOut`. */
export interface DispatchFanOutPayload {
  /** Always `'parallel'` — this event fires only on the parallel fan-out path. */
  fanOutPolicy: 'parallel';
  /** Number of children dispatched in this fan-out (`> 1` by construction). */
  childCount: number;
  /** Effective concurrency ceiling for the wave, when bounded
   *  (`min(config.maxConcurrency ?? ∞, capabilities.dispatch.maxFanOut ?? ∞)`). */
  maxConcurrency?: number;
  /** The `joinPolicy.mode` governing this fan-out. */
  joinMode?: 'wait-all' | 'quorum' | 'first' | 'race';
  [key: string]: unknown;
}

/** `core.dispatch.join` (RFC 0118). Emitted by `core.dispatch` when a
 *  `fanOutPolicy: 'parallel'` join is satisfied (or fails). `mergeOrder` is the
 *  canonical replay-deterministic record of the output-merge tiebreak — a
 *  replay/`:fork` MUST re-apply `outputMapping` in `mergeOrder` (the parent
 *  host's observed wall-clock terminal order), never in `nextWorkerIds` order.
 *  Per `run-event-payloads.schema.json` `$defs.dispatchJoin`. */
export interface DispatchJoinPayload {
  /** `'satisfied'` — `mode` met, `onChildFailure` did not fail the node.
   *  `'failed'` — `fail-fast` tripped or `mode` unsatisfiable (node fails).
   *  `'partial'` — `mode` met but ≥1 child non-`completed` under
   *  `collect`/`absorb` (node SUCCEEDS). */
  joinOutcome: 'satisfied' | 'failed' | 'partial';
  /** Number of children that reached `completed`. */
  completedCount: number;
  /** Number of children that reached `failed`. */
  failedCount: number;
  /** Number of children cancelled (e.g. in-flight when a `quorum`/`first`/
   *  `race`/`fail-fast` join short-circuited). */
  cancelledCount?: number;
  /** `childRunId`s in the parent host's observed wall-clock terminal order —
   *  the replay-deterministic tiebreak for colliding `outputMapping` keys.
   *  Recorded at terminal-fold time; never recomputed from child timestamps. */
  mergeOrder: readonly string[];
  [key: string]: unknown;
}

/** `context.summarized` (RFC 0111). Emitted when the host replaces older
 *  in-window orchestrator-loop transcript turns with a host-produced summary to
 *  honor `multiAgent.executionModel.contextBudget.transcriptTokenBudget`.
 *  CONTENT-FREE: the summary text never rides the wire — `summaryRef` is an
 *  artifactId resolved via `GET /runs/{runId}/artifacts/{artifactId}`. The
 *  summary is nondeterministic host output governed like an RFC 0041 envelope:
 *  on `:fork mode:replay` the host MUST reuse this recorded `summaryRef` and
 *  MUST NOT re-summarize. `replacedTurns` lists the event ids the summary stands
 *  in for, so a replay engine reconstructs the exact transcript. */
export interface ContextSummarizedPayload {
  /** The orchestrator-loop iteration whose transcript assembly triggered this. */
  iteration: number;
  /** Event ids the summary stands in for (a contiguous most-recent-replaced range). */
  replacedTurns: readonly string[];
  /** ArtifactId of the persisted summary (the summary text is NOT inlined). */
  summaryRef: string;
  /** Unit `tokensBefore`/`tokensAfter` are denominated in; equals the advertised
   *  `contextBudget.tokenCounter`. */
  tokenCounter: 'o200k_base' | 'cl100k_base' | 'chars' | 'host-defined';
  /** Token count of the replaced range before summarization. */
  tokensBefore: number;
  /** Token count of the summary that replaced the range (expected ≤ tokensBefore). */
  tokensAfter: number;
  [key: string]: unknown;
}

/** A `RunEventDoc` narrowed to a specific event-type discriminator +
 *  payload shape. Returned by the `isAgent*` type guards in
 *  `event-helpers.ts`. */
export interface TypedRunEvent<T> extends RunEventDoc {
  payload: T;
}

// ---------------------------------------------------------------------------
// AI Envelope (`spec/v2/core/events.md` §AI envelopes)
//
// Inbound LLM-emission envelope. Distinct from `RunEventDoc` (outbound event
// log) and `ErrorEnvelope` (host HTTP error response). Top-level shape is
// closed; payload shape is selected by `type` and validated against a
// per-kind JSON Schema advertised via `Capabilities.supportedEnvelopes` +
// `Capabilities.schemaVersions`. See spec doc for full normative prose.
// ---------------------------------------------------------------------------

/** Wire metadata on every AI Envelope. */
export interface EnvelopeMeta {
  /** Provenance of this emission. */
  source: 'ai-generation' | 'user' | 'system';
  /** Mirrors `RunEventDoc.contentTrust`. Hosts MUST set 'untrusted' for MCP / A2A origin. */
  contentTrust?: 'trusted' | 'untrusted';
  /** ISO 8601 UTC timestamp. */
  ts: string;
  /** Optional W3C trace-context for distributed tracing. */
  traceparent?: string;
  /** Optional human-readable label for ops dashboards. */
  label?: string;
}

/** Chunking info for streamed emissions. (in-flight) */
export interface PartialInfo {
  isPartial: boolean;
  index: number;
  /** -1 when total is unknown (streaming without precount). */
  total: number;
}

/** Canonical inbound LLM-emission wire shape per `spec/v2/core/ai-envelope.md`. */
export interface AIEnvelope<TPayload = unknown> {
  /** Discriminator for payload shape, kind routing, and Envelope Contract gate. */
  type: string;
  /** Per-kind schema version. Absent → treat as 0. */
  schemaVersion?: number;
  /** Globally unique envelope id. Engine-assigned if absent on receipt. */
  envelopeId: string;
  /** Caller-stable id for dedup, replay short-circuit, and causal chaining. */
  correlationId: string;
  /** Set when the emitting node is identifiable. */
  nodeId?: string;
  /** Discriminated payload. Shape selected by `type`. */
  payload: TPayload;
  /** Wire metadata. */
  meta: EnvelopeMeta;
  /** Present when this is one fragment of a streamed emission. */
  partial?: PartialInfo;
}

/** Per-typeId envelope-kind permission set per `ai-envelope.md` §"Envelope Contract". */
export interface EnvelopeContract {
  /** Kinds the engine will accept from this node. */
  accepts: string[];
  /** Refusal behavior for non-`accepts`, non-universal kinds. */
  refusalMode: 'fail-node' | 'discard-and-warn';
}

/** Returned by the engine's `acceptEnvelope` path. */
export type EnvelopeOutcome =
  | { status: 'accepted'; recordedEventIds: string[] }
  | { status: 'gated'; reason: string; gate: EnvelopeContractRefusal }
  | { status: 'invalid'; reason: string; details: ValidationDetail[] }
  | { status: 'breached'; reason: string; capKind: 'envelopes' | 'schema' | 'clarification' };

export interface EnvelopeContractRefusal {
  refusedType: string;
  acceptedTypes: string[];
  refusalMode: 'fail-node' | 'discard-and-warn';
}

export interface ValidationDetail {
  path: string;
  message: string;
}

/** Optional capability advertisement. Default when absent: 'warn'. */
export type EnvelopeStrictness = 'warn' | 'strict';

// Universal-kind payloads. Per-kind schemas at `schemas/envelopes/<kind>.schema.json`.

/** Payload of the universal `clarification.request` envelope kind. */
export interface ClarificationRequestPayload {
  questions: Array<{
    id: string;
    question: string;
    schema?: Record<string, unknown>;
  }>;
  contextType?: string;
}

/** Payload of the universal `schema.request` envelope kind. */
export interface SchemaRequestPayload {
  envelopeType: string;
  reason?: string;
}

/** Payload of the universal `schema.response` envelope kind (LLM ack). */
export interface SchemaResponsePayload {
  envelopeType: string;
  ack: true;
}

/**
 * Payload of the universal `error` envelope kind (the LLM's deliberate error
 * report). Distinct from `ErrorEnvelope` (the host's HTTP error response).
 */
export interface AIEnvelopeErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Payload of the core `ui.a2ui-surface` envelope kind (RFC 0102 — A2UI
 * agent-authored interface surfaces, `schemas/envelopes/ui.a2ui-surface.schema.json`).
 * An advertised, optional core kind beside the `media.*` family: a declarative
 * interactive UI a consumer renders with native widgets, routing user actions
 * back **without executing agent-supplied code**.
 *
 * `surface` is the closed component tree, kept loose here (`Record<string,
 * unknown>`) — it is rendered by a dedicated A2UI renderer the SDK does not
 * provide, and matches the SDK convention of keeping complex nested shapes
 * structural (cf. `ClarificationRequestPayload.questions[].schema`).
 *
 * NOTE: the broader AI-envelope surface (`AIEnvelope`, `EnvelopeMeta`, the
 * universal payloads) is currently modeled only in this TypeScript SDK; the
 * Python and Go SDKs do not yet model AI envelopes. `A2UISurfacePayload`
 * therefore lands here only; cross-SDK AI-envelope modeling is a separate
 * follow-on (tracked in PARITY.md), not part of RFC 0102.
 */
export interface A2UISurfacePayload {
  /** The A2UI catalog version the surface targets. A host-enumerated,
   *  growing set (currently `'0.9.1'`); a consumer MUST refuse an unknown /
   *  higher version with `unknown_schema_version`. Typed as `string` (not a
   *  pinned literal) so the read-type stays forward-compatible as the host's
   *  supported set grows; the consumer enforces refuse-unknown at runtime. */
  catalogVersion: string;
  /** The A2UI surface document — a closed component tree, self-contained and
   *  renderable from the payload alone (never a live reference into an
   *  external catalog). Kept structural; rendered by an A2UI renderer. */
  surface: Record<string, unknown>;
  /** OPTIONAL model reasoning (RFC 0030 §A), conventionally first. */
  reasoning?: string;
}

/**
 * RFC 0114 — a single RFC 6902 (JSON-Patch) operation inside an
 * {@link A2uiSurfaceDeltaFrame}. The `test` op is deliberately EXCLUDED (a
 * fire-and-forget transport frame cannot act on a failed conditional);
 * `move`/`copy` are permitted but OPTIONAL for a host to emit.
 */
export interface A2uiSurfacePatchOp {
  /** RFC 6902 operation. `test` is excluded by RFC 0114. */
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy';
  /** RFC 6901 JSON-Pointer into the target surface. */
  path: string;
  /** RFC 6901 JSON-Pointer source for `move`/`copy`. */
  from?: string;
  /** The value for `add`/`replace`. Walked by the SR-1 redaction harness
   *  exactly like a full-surface value. */
  value?: unknown;
}

/**
 * RFC 0114 — a HOST-SIDE TRANSPORT frame carrying an RFC 6902 delta over a
 * recorded `ui.a2ui-surface` envelope ({@link A2UISurfacePayload}). Delivered
 * ONLY over the run event stream (`GET /runs/{runId}/events`) to a subscriber
 * that negotiated `?a2uiDelta=1`; every other consumer (the event-log read,
 * replay, `:fork`, any non-negotiating subscriber) receives the materialized
 * FULL surface. This is NOT a recorded-envelope shape — the recorded
 * `ui.a2ui-surface` payload is unchanged and always full. The consumer applies
 * `patch` to the surface last delivered under `surfaceRef`, then re-validates
 * the result against the closed `catalogVersion` catalog before render; on any
 * apply/validation failure it falls back fail-closed and the host
 * re-materializes the full surface. Per
 * `schemas/a2ui-surface-delta-frame.schema.json`. A host advertises support via
 * the `a2uiSurface.deltaTransport` capability flag.
 */
export interface A2uiSurfaceDeltaFrame {
  /** The recorded `ui.a2ui-surface` envelope id this delta patches. */
  surfaceRef: string;
  /** MUST equal the referenced full surface's `catalogVersion`; a
   *  catalog-version change MUST start from a fresh full surface. */
  catalogVersion: string;
  /** A non-empty RFC 6902 document applied over the surface last delivered
   *  under `surfaceRef`. */
  patch: A2uiSurfacePatchOp[];
}

// ── RFC 0027 + RFC 0028 — Prompt library (spec/v2/core/prompts.md) ──

/**
 * Role a PromptTemplate plays when composed into an LLM call. Shared enum
 * `$ref`-ed by every schema that names a prompt kind. Per
 * `schemas/prompt-kind.schema.json`.
 */
export type PromptKind = 'system' | 'user' | 'few-shot' | 'schema-hint';

/**
 * Typed interpolation slot in a PromptTemplate. Bindings are validated
 * against this declaration before composition. Per
 * `schemas/prompt-template.schema.json#/$defs/PromptVariable`.
 */
export interface PromptVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  source?: 'input' | 'variable' | 'secret' | 'context';
  extractPath?: string;
  defaultValue?: unknown;
  description?: string;
}

/**
 * Named, versioned, variable-bound prompt body. Per
 * `schemas/prompt-template.schema.json` + spec/v2/core/prompts.md §PromptTemplate.
 *
 * `meta.packName` + `meta.packVersion` are required when `meta.source: "pack"`
 * (RFC 0028 §C); a JSON-Schema `if/then` conditional enforces this at the
 * wire layer.
 */
export interface PromptTemplate {
  templateId: string;
  version: string;
  kind: PromptKind;
  text: string;
  name?: string;
  description?: string;
  variables?: PromptVariable[];
  modelHints?: {
    modelClass?: string;
    temperature?: number;
    maxTokens?: number;
    envelopeType?: string;
  };
  tags?: string[];
  meta?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    source?: 'host' | 'pack' | 'user';
    packName?: string;
    packVersion?: string;
  };
}

/**
 * Reference to a PromptTemplate. Two equivalent forms — the stringy URI
 * `prompt:<templateId>[@<version>]` and the structured object — per
 * `schemas/prompt-ref.schema.json`. The stringy form is canonical for
 * inline use; the object form is canonical when `libraryId` disambiguation
 * or per-reference `variableOverrides` are needed.
 */
export type PromptRef =
  | string
  | {
      libraryId?: string;
      templateId: string;
      version?: string;
      variableOverrides?: Record<string, unknown>;
    };

/** Filter set for `client.prompts.list(...)` per RFC 0028 §A. */
export interface ListPromptsRequest {
  kind?: PromptKind;
  tag?: string;
  modelClass?: string;
  source?: 'host' | 'pack' | 'user';
  cursor?: string;
  limit?: number;
}

export interface ListPromptsResponse {
  items: PromptTemplate[];
  nextCursor?: string;
}

/** Identifier set for `client.prompts.get(...)` per RFC 0028 §A. */
export interface GetPromptRequest {
  templateId: string;
  /** Pin to a SemVer version. When omitted, returns the latest. */
  version?: string;
  /** Disambiguate when multiple installed packs ship the same templateId. */
  libraryId?: string;
}

/** Request shape for `client.prompts.render(...)` per RFC 0028 §A. */
export interface RenderPromptRequest {
  ref: PromptRef;
  variables: Record<string, unknown>;
  /**
   * Aggregate trust marker for the supplied bindings; propagated through
   * composition per RFC 0027 §E. Defaults to `trusted` when omitted.
   */
  contentTrust?: 'trusted' | 'untrusted';
}

/** Response shape for `client.prompts.render(...)`. The `hash` and
 *  `variableHashes` are always present; `composed` populates only under
 *  `capabilities.prompts.observability: "full"`. Same deterministic-hash
 *  invariant as `prompt.composed` events (RFC 0027 §F). */
export interface RenderPromptResponse {
  hash: string;
  refs: string[];
  variableHashes: Record<string, string>;
  composed?: string;
  contentTrust?: 'trusted' | 'untrusted';
}

/**
 * Thrown when the server returns a non-2xx response. Carries the original
 * status, parsed error envelope (if available), the raw response text,
 * and any `traceparent` the server returned (per
 * `observability.md` §Trace context propagation —
 * "Clients SHOULD display the trace ID in error messages so operators
 * can search backend traces").
 */
export class WopError extends Error {
  readonly status: number;
  readonly envelope: ErrorEnvelope | undefined;
  readonly rawText: string;
  /** W3C `traceparent` from the response headers, when present. */
  readonly traceparent: string | undefined;
  /** 32-hex-char trace ID extracted from `traceparent`, when parseable. */
  readonly traceId: string | undefined;

  constructor(
    status: number,
    rawText: string,
    envelope: ErrorEnvelope | undefined,
    traceparent: string | undefined,
  ) {
    const traceId = traceparent ? extractTraceId(traceparent) : undefined;
    const baseMessage = envelope?.message ?? `openwop request failed: HTTP ${status}`;
    const messageWithTrace = traceId ? `${baseMessage} (trace=${traceId})` : baseMessage;
    super(messageWithTrace);
    this.name = 'WopError';
    this.status = status;
    this.rawText = rawText;
    this.envelope = envelope;
    this.traceparent = traceparent;
    this.traceId = traceId;
  }
}

/**
 * Extract the 32-hex trace ID from a W3C traceparent header. Format:
 * `00-<32-hex>-<16-hex>-<2-hex>`. Returns undefined for malformed
 * input — never throws (errors during error construction would be
 * truly miserable).
 */
function extractTraceId(traceparent: string): string | undefined {
  const parts = traceparent.split('-');
  if (parts.length < 3) return undefined;
  const traceId = parts[1];
  if (!traceId || !/^[0-9a-f]{32}$/i.test(traceId)) return undefined;
  return traceId;
}

/**
 * One installed manifest agent, as projected by `GET /agents` /
 * `GET /agents/{agentId}` (RFC 0072 §A). Read-only — never carries the
 * system-prompt body, resolved handoff schemas, or credential material (SR-1).
 */
export interface AgentInventoryEntry {
  agentId: string;
  persona: string;
  label: string;
  description?: string;
  modelClass: string;
  packName: string;
  packVersion: string;
  toolAllowlist: string[];
  hasHandoffSchemas: boolean;
  memoryShape?: { scratchpad?: boolean; conversation?: boolean; longTerm?: boolean };
  confidenceThreshold?: number;
  /** RFC 0072 §C — optional capability tiers this host does not satisfy, inert here. */
  degraded?: string[];
}

/** Response body for `GET /agents` (RFC 0072 §A). */
export interface AgentInventoryResponse {
  agents: AgentInventoryEntry[];
  total: number;
}

/* ── Standing agent roster + org-chart (RFC 0086 / 0087) ──────────────── */

/** RFC 0086 §A — a standing agent INSTANCE: a `host:<id>` AgentRef that
 *  references a manifest/deployment and owns a workflow portfolio. */
export interface AgentRosterEntry {
  rosterId: string;
  persona: string;
  agentRef: { agentId: string; version?: string; channel?: string };
  workflows?: string[];
  owner: { tenantId: string; workspaceId?: string };
  enabled?: boolean;
  label?: string;
  description?: string;
}

/** Response for `GET /agents/roster` (RFC 0086 §B). */
export interface AgentRosterResponse {
  roster: AgentRosterEntry[];
  total: number;
}

/** RFC 0087 §A — an org-chart department (a tree node via `parentDepartmentId`). */
export interface OrgChartDepartment {
  departmentId: string;
  name: string;
  parentDepartmentId: string | null;
  roles: { roleId: string; name: string }[];
}

/** RFC 0087 §A — an org-chart member (a roster instance placed in a dept/role). */
export interface OrgChartMember {
  rosterId: string;
  departmentId: string;
  roleId: string;
  reportsTo: string | null;
}

/** RFC 0087 §A — the descriptive org-chart over roster members. Carries no
 *  authority-bearing field by design (§B `org-position-no-authority-escalation`). */
export interface AgentOrgChart {
  owner: { tenantId: string; workspaceId?: string };
  departments: OrgChartDepartment[];
  members: OrgChartMember[];
}

/** Response for `GET /agents/org-chart/{departmentId}` (RFC 0087 §D) — the
 *  department subtree + the responsibility roll-up (union of member portfolios). */
export interface OrgChartResponsibilityView {
  department: OrgChartDepartment;
  members: OrgChartMember[];
  responsibilities: string[];
}

/* ── User-authored agents (sample-extension; non-normative) ─────────────
 * Backs the workflow-engine sample app's Agents tab. Pack-installed
 * agents come through `AgentInventoryEntry` above (RFC 0072 §A
 * normative inventory). The types below mirror the sample-host
 * `POST /host/sample/agents` create surface — they're scoped to
 * the sample-extension and may evolve independently of the
 * normative agent surface. Future RFC promotion would migrate these
 * to the normative wire shape.
 */

// ── RFC 0081 — Agent evaluation (eval-summary.schema.json) ─────────────

/** Abstract model class (RFC 0002 / RFC 0003 manifest vocabulary). */
export type AgentModelClass =
  | 'reasoning'
  | 'writing'
  | 'coding'
  | 'research'
  | 'classification'
  | 'general';

/** A redaction-safe safety finding ({kind, severity} descriptor — never excerpted content). */
export interface EvalSafetyFinding {
  kind: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

/** Per-task result on an `EvalSummary` (content-free: scores + scalars + ids). */
export interface EvalTaskResult {
  taskId: string;
  score: number;
  passed: boolean;
  costUsd?: number;
  latencyMs?: number;
  schemaValid?: boolean;
  safetyFindings?: readonly EvalSafetyFinding[];
}

/** The regression block on an `EvalSummary` (RFC 0081 §D `regression` mode). */
export interface EvalRegression {
  baselineRunId: string;
  scoreDelta: number;
  diffRef?: string;
}

/**
 * RFC 0081 §C — the terminal scorecard of an eval run, read via
 * `client.runs.evalSummary(runId)`. Content-free: scores, scalars, ids, and
 * redaction-safe safety descriptors only (`eval-summary-no-content-leak`).
 */
export interface EvalSummary {
  suiteId: string;
  suiteVersion: string;
  evaluatedModelClass?: AgentModelClass;
  aggregateScore: number;
  passed: boolean;
  taskCount: number;
  passedCount: number;
  totalCostUsd?: number;
  tasks: readonly EvalTaskResult[];
  regression?: EvalRegression;
}

// ── RFC 0082 — Agent deployment lifecycle ─────────────────────────────

/** The seven-state deployment lifecycle (RFC 0082 §C). */
export type DeploymentState =
  | 'draft'
  | 'test'
  | 'staged'
  | 'active'
  | 'paused'
  | 'deprecated'
  | 'rolled-back';

/**
 * RFC 0078 §B — a portable tool descriptor as projected onto the host's
 * `GET /tools` catalog. Source-agnostic (node-pack / workflow / mcp /
 * connector / host-extension); `safetyTier`, `egress`, and `approval` let a
 * caller reason about a tool's blast radius before invoking it.
 */
export interface ToolDescriptor {
  toolId: string;
  source: 'node-pack' | 'workflow' | 'mcp' | 'connector' | 'host-extension';
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  auth?: Record<string, unknown>;
  egress?: 'none' | 'safe-fetch' | 'host-mediated' | 'host-owned';
  approval?: 'never' | 'conditional' | 'always';
  replayPolicy?: 'deterministic' | 'idempotent' | 'non-deterministic';
  safetyTier: 'pure' | 'read' | 'write' | 'exec';
  costHint?: string;
  latencyHint?: string;
}

/**
 * RFC 0112 — a compact, model-facing projection of `ToolDescriptor`, returned by
 * `GET /tools?view=compact` (envelope `{ tools: CompactToolDescriptor[] }`) +
 * `GET /tools/{toolId}?view=compact` when the host advertises
 * `capabilities.toolCatalog.compactView`. The heavy descriptor fields
 * (`outputSchema`/`auth`/`egress`/`approval`/`replayPolicy`/`costHint`/`latencyHint`)
 * are dropped, and any `inputSchema` is bounded to the compact structural subset
 * (top-level `type: "object"` with `properties`; no
 * `$ref`/`oneOf`/`allOf`/`anyOf`/`not`/`patternProperties`/`dependentSchemas`).
 */
export interface CompactToolDescriptor {
  toolId: string;
  source: 'node-pack' | 'workflow' | 'mcp' | 'connector' | 'host-extension';
  safetyTier: 'pure' | 'read' | 'write' | 'exec';
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * RFC 0082 §C — a per-(agentId, version) deployment record, returned by
 * `client.agents.listDeployments` / `transitionDeployment`. Host-runtime state
 * distinct from the immutable manifest and the registry's published tags.
 */
export interface AgentDeployment {
  agentId: string;
  version: string;
  state: DeploymentState;
  canaryPercent?: number;
  rollbackPointer?: string;
  channels?: readonly string[];
  evalRunId?: string;
  approvalGateId?: string;
}

/**
 * RFC 0082 §E — the `transitionDeployment` request body. The host authorizes it
 * fail-closed (RFC 0049 `deploy:*`), runs any RFC 0051 approvalGate, and enforces
 * RFC 0081 `requiredEval` before emitting `deployment.promoted`.
 */
export interface AgentDeploymentTransition {
  version: string;
  transition: 'promote' | 'pause' | 'deprecate' | 'rollback' | 'adjust-canary';
  toState?: DeploymentState;
  channel?: string;
  canaryPercent?: number;
  evalRunId?: string;
  reason?: string;
}

// ── RFC 0103 Localized content surface (spec/v2/core/localized-content.md) ──
// Mirror schemas/localized-content-*.schema.json. Host-defined structured
// content (`data`, `localizations`, `seo`) is kept open per the schemas
// (additionalProperties: true) — it is the host's content model, not a
// fixed wire shape.

export type LocalizedContentStatus = 'draft' | 'published';

/** A content page record (`schemas/localized-content-page.schema.json`). */
export interface LocalizedContentPage {
  pageId: string;
  slug: string;
  /** Human-facing page name (admin/authoring label). */
  name: string;
  status: LocalizedContentStatus;
  /** Ordered section ids composing the page. */
  sectionOrder: readonly string[];
  /** Open SEO metadata object (host-defined). */
  seo?: Record<string, unknown>;
}

/** A content section record (`schemas/localized-content-section.schema.json`).
 *  A section is one record: a base `data` payload + a sparse `localizations`
 *  map (BCP-47 keys, never the base locale). */
export interface LocalizedContentSection {
  sectionId: string;
  sectionType: string;
  /** Base-locale field payload (host-defined open shape). */
  data: Record<string, unknown>;
  /** Per-locale sparse field overlays, keyed by BCP-47 locale. */
  localizations: Record<string, Record<string, unknown>>;
  status: LocalizedContentStatus;
  enabled: boolean;
  order: number;
}

/** Public delivery response for `GET /content/pages/{slug}` — the negotiated
 *  locale's resolved page + sections (the RFC 0103 `resolveSection` merge is
 *  applied host-side: exact → language-family → base). */
export interface LocalizedContentPageResponse {
  /** Response schema version marker (e.g. `"1"`). */
  version: string;
  generatedAt: string;
  /** The negotiated locale this response was resolved for. */
  locale: string;
  slug: string;
  page: LocalizedContentPage;
  sections: readonly LocalizedContentSection[];
}

/** Language settings (`schemas/localized-content-language-settings.schema.json`). */
export interface LocalizedContentLanguageSettings {
  baseLocale: string;
  supportedLocales: readonly string[];
  autoTranslateOnPublish: boolean;
}

/** Request body for `PUT /content/pages/{pageId}/sections/{sectionId}`. */
export interface PutContentSectionRequest {
  /** Target locale; the baseLocale upserts `data`, else `localizations[locale]`. */
  locale: string;
  /** The field overlay for the target locale (host-defined open shape). */
  data: Record<string, unknown>;
}

// ── RFC 0099 Trigger subscription registration (spec/v2/core/trigger-bridge.md §F) ──

/** Registration body for `POST /trigger-subscriptions`
 *  (`schemas/trigger-subscription-registration.schema.json`). */
export interface TriggerSubscriptionRegistration {
  /** External event source descriptor (host-defined: webhook / email / form …). */
  source: Record<string, unknown>;
  workflowId: string;
  dedupEnabled?: boolean;
  inputMapping?: Record<string, unknown>;
  retryPolicy?: Record<string, unknown>;
  verification?: Record<string, unknown>;
}

/** The persisted trigger subscription the host assigns
 *  (`schemas/trigger-subscription.schema.json`). Kept open beyond the
 *  registration fields the host echoes back. */
export type TriggerSubscription = Record<string, unknown>;

/** `201` response for `POST /trigger-subscriptions`. `binding` carries the
 *  source-specific wiring the caller needs (e.g. `{ ingestUrl,
 *  secretFingerprint }` for webhook); the secret is returned ONCE at creation
 *  (SR-1) — persist it, it is not retrievable again. */
export interface CreateTriggerSubscriptionResponse {
  subscription: TriggerSubscription;
  binding: Record<string, unknown>;
}
