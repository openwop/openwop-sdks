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

export interface Capabilities {
  protocolVersion: string;
  supportedEnvelopes: readonly string[];
  schemaVersions: Record<string, number>;
  limits: {
    clarificationRounds: number;
    schemaRounds: number;
    envelopesPerTurn: number;
    maxNodeExecutions?: number;
    /** RFC 0058. Engine-side wall-clock ceiling per run (ms); upper bound for `RunConfigurable.runTimeoutMs`. */
    maxRunDurationMs?: number;
    /** RFC 0058. Engine-side agent-loop iteration ceiling; upper bound for `RunConfigurable.maxLoopIterations`. */
    maxLoopIterations?: number;
    /** RFC 0094 §H. Maximum REST request body size (bytes) the host
     *  accepts. Hosts that advertise it MUST enforce it. */
    maxRequestBodyBytes?: number;
  };
  /** RFC 0094 §H. gRPC transport advertisement per `grpc-transport.md`
   *  §"Capability advertisement". Absent ⇒ the host exposes no gRPC
   *  transport. A host that exposes the gRPC surface advertises this
   *  block AND includes `'grpc'` in `supportedTransports`. REST + SSE
   *  remain exposed regardless. */
  grpc?: {
    /** Toggle — `true` when the gRPC surface is live. */
    supported: boolean;
    /** Full URI: `grpc://` (cleartext, intra-trusted-network only) OR
     *  `grpcs://` (TLS). Hosts SHOULD require TLS in production. */
    endpoint?: string;
    /** Canonical service name. v1 hosts MUST use `openwop.v1.Engine`. */
    service: 'openwop.v1.Engine';
    /** TLS posture. Production hosts MUST set `'required'`. */
    tls: 'required' | 'optional' | 'disabled';
  };
  /** RFC 0101. Multi-party group-conversation advertisement. Absent ⇒ the
   *  host does not support N agents co-participating in one shared
   *  transcript (the single user + single driving agent shape of RFC 0005
   *  remains). When `supported: true`, the host honors the additive
   *  `participants: AgentRef[]` roster on `conversation.opened` and the
   *  conditionally-required per-turn `speakerId` on `role: 'agent'`
   *  conversation turns — advertising `supported: true` without enforcing
   *  both is a dishonest claim (`OPENWOP_REQUIRE_BEHAVIOR=true` fails it). */
  multiPartyConversation?: {
    /** Toggle — `true` when the host supports multi-party conversations. */
    supported: boolean;
    /** Upper bound on `participants[]` size the host accepts. Absent ⇒
     *  host-defined / unbounded. */
    maxParticipants?: number;
  };
  /** RFC 0100. Host exposes itself as an A2A (Agent2Agent) agent. `supported`
   *  alone ⇒ the synchronous `message/send` → poll `tasks/get` round-trip
   *  (`a2a-integration.md`). The optional flags gate the RFC 0100 async/durable
   *  additions. Absent ⇒ no A2A advertisement. */
  a2a?: {
    /** Host exposes itself as an A2A agent. */
    supported: boolean;
    /** A2A 0.3 well-known agent card URL (`/.well-known/agent-card.json`). */
    agentCardUrl: string;
    /** `message/stream` + `tasks/resubscribe` (RFC 0100 §3 resubscribe re-attach). */
    streaming?: boolean;
    /** A2A push-notification config (RFC 0100 §4); a caller-supplied
     *  `pushConfig.url` is SSRF-validated (`a2a-push-egress-ssrf`). */
    pushNotifications?: boolean;
    /** RFC 0100 §2. Host persists the projected `A2ATaskState` per backing run;
     *  `tasks/get` returns live state after disconnect. Absent/false ⇒
     *  synchronous round-trip only. */
    durableTasks?: boolean;
  };
  /** RFC 0109. Host stamps the optional non-secret `agent.model`
   *  (`{ provider, model }`) on `role:'agent'` conversation turns, recording
   *  which model produced the turn (read verbatim on `:fork`). Absent ⇒ no
   *  provenance; the host omits `agent.model`. */
  conversationTurnModelProvenance?: {
    /** Toggle — `true` when the host stamps `agent.model`. */
    supported: boolean;
  };
  /** RFC 0110. Host emits the ephemeral `channel.presence` RunEvent (online +
   *  per-member typing) for `type:'channel'` conversations. Presence is live
   *  state — the host never persists it to the replayable event log and it
   *  never affects replay / `:fork`. Membership-gated (default-deny, CTI-1).
   *  Absent ⇒ no presence. */
  channelPresence?: {
    /** Toggle — `true` when the host emits `channel.presence`. */
    supported: boolean;
  };
  /** Capability advertisement for the host AI-proxy (`aiProviders` in
   *  `capabilities.md`). Absent ⇒ the host advertises no AI-proxy surface.
   *  Carries BYOK policy plus the RFC 0105/0106/0108 self-hosted / speech /
   *  real-time-voice flags. The wire object MAY carry additional fields
   *  (`input`, `authModes`, `maxInlineMediaBytes`) not modeled here. */
  aiProviders?: AIProvidersCapability;
  /** RFC 0104. Portable HITL approver-routing advertisement. When
   *  `approverRouting.supported`, the host honors the OPTIONAL, ADVISORY
   *  `approverGroupRefs` / `approverRoleRefs` / `audience` fields on the
   *  `kind:'approval'` interrupt payload (the SDK carries the interrupt
   *  payload opaquely as `data`, so those advisory fields ride that opaque
   *  object), resolves the advertised `refKinds` against its own RBAC, and
   *  ENFORCES eligibility at resolve time. Absent ⇒ the host ignores them. */
  interrupt?: {
    approverRouting?: {
      /** Host honors the RFC 0104 approver-routing fields. */
      supported: boolean;
      /** Ref kinds the host actually resolves: `'group'` ⇒ honors
       *  `approverGroupRefs`, `'role'` ⇒ honors `approverRoleRefs`. Absent ⇒
       *  advisory-only passthrough (the host resolves neither). */
      refKinds?: readonly ('group' | 'role')[];
      /** Host honors the `audience` notification-targeting override.
       *  Absent/`false` ⇒ the host notifies the resolved eligible union. */
      audience?: boolean;
    };
  };
  extensions?: Record<string, unknown>;
  // Network-handshake superset (all `(future)` fields per capabilities.md)
  implementation?: { name?: string; version?: string; vendor?: string };
  engineVersion?: number;
  eventLogSchemaVersion?: number;
  supportedTransports?: readonly ('rest' | 'mcp' | 'a2a' | 'grpc')[];
  configurable?: Record<string, unknown>;
  observability?: Record<string, unknown>;
  minClientVersion?: string;
}

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

export interface RunSnapshot {
  runId: string;
  workflowId: string;
  status: RunStatus;
  currentNodeId?: string;
  startedAt?: string;
  completedAt?: string;
  nodeStates?: Record<string, unknown>;
  variables?: Record<string, unknown>;
  channels?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  /** Linkage back to the parent run when this run was spawned via
   *  `core.subWorkflow`. Per `interrupt-profiles.md §openwop-interrupt-
   *  cascade-cancel`: child runs preserve `parentRunId` + `parentNodeId`
   *  so cancellation can cascade. Absent for top-level runs. */
  parentRunId?: string;
  parentNodeId?: string;
  /** Surfaced for `waiting-*` runs per `interrupt.md §"Signed-token
   *  callback"`. Carries the open interrupt's metadata so clients can
   *  resolve via `POST /v1/interrupts/{token}` without consulting a
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
 * Per-run parameter overlay carried in `RunOptions.configurable`. Reserved
 * keys are typed; unknown keys are passed through verbatim. See
 * `run-options.md`.
 */
export interface RunConfigurable {
  /** Override the per-run node-execution ceiling. Clamped server-side. */
  recursionLimit?: number;
  /** RFC 0058. Wall-clock run deadline (ms from `run.started`); clamped to
   *  `Capabilities.limits.maxRunDurationMs`. Breach → `cap.breached
   *  { kind: 'run-duration' }` + `run_timeout`. */
  runTimeoutMs?: number;
  /** RFC 0058. Agent-loop iteration ceiling (one per orchestrator turn);
   *  clamped to `Capabilities.limits.maxLoopIterations`. Breach →
   *  `cap.breached { kind: 'loop-iterations' }` + `loop_limit_exceeded`.
   *  Ignored unless the host advertises `capabilities.agents.loop.supported`. */
  maxLoopIterations?: number;
  /** Override AI model for nodes that consume `ctx.config.configurable.model`. */
  model?: string;
  /** Override AI temperature (server SHOULD enforce 0..2). */
  temperature?: number;
  /** Override AI max-tokens cap. */
  maxTokens?: number;
  /** Per-prompt-ID variant override map. */
  promptOverrides?: Record<string, string>;
  /** Implementation-specific extensions; passed through verbatim. */
  [key: string]: unknown;
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

/**
 * Portable JSON diagnostic export for a single run per
 * `spec/v1/debug-bundle.md` + `schemas/debug-bundle.schema.json`.
 *
 * Hosts MAY omit non-required fields. Consumers MUST treat masked /
 * omitted / hashed values as the spec-canonical content per the host's
 * advertised `redactionMode` — they are NOT placeholders for missing
 * data.
 */
export interface DebugBundle {
  bundleVersion: string;
  generatedAt: string;
  host: { name?: string; version?: string; vendor?: string };
  run: Record<string, unknown>;
  events: ReadonlyArray<Record<string, unknown>>;
  redactionApplied: boolean;
  /** Reflects the host's `capabilities.compliance.defaultMode`. */
  redactionMode: 'mask' | 'omit' | 'hash' | 'passthrough';
  /** True when the bundle hit the host's size cap; pair with `truncatedReason`. */
  truncated?: boolean;
  truncatedReason?: string;
  [key: string]: unknown;
}

export interface DebugBundleOptions {
  /** Optional host-extension query parameter to lower the size cap for testing. Spec-canonical hosts SHOULD prefer `host.<vendor>.<query>` namespacing; this is the SQLite-reference convention. */
  maxEvents?: number;
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

// rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
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

/** RFC 0059 versioned, tenant·workspace-scoped ground-truth file
 *  (`workspace-file.schema.json`). The `list` endpoint returns this shape
 *  minus `content` (metadata only). */
export interface WorkspaceFile {
  path: string;
  content: string;
  contentType?: string;
  version: number;
  etag?: string;
  updatedAt: string;
}

/** RFC 0059 request body for `putWorkspaceFile` (`workspace-file-create.schema.json`).
 *  `path` is URL-bound; the host assigns `version`/`etag`/`updatedAt`.
 *  Optimistic concurrency is expressed via the `If-Match` header, not the body. */
export interface PutWorkspaceFileRequest {
  content: string;
  contentType?: string;
}

/**
 * Response from `GET /v1/runs/{runId}/ancestry` — RFC 0040 §C cross-host
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

/** RFC 0054 — response from `GET /v1/runs/{runId}:diff?against={otherRunId}`.
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

export interface PollEventsResponse {
  events: readonly RunEventDoc[];
  isComplete: boolean;
}

/** Mirror of `run-event.schema.json` — top-level shape only. */
export interface RunEventDoc {
  eventId: string;
  runId: string;
  nodeId?: string;
  type: string; // RunEventType — string-typed for forward compat
  payload: unknown;
  timestamp: string;
  sequence: number;
  schemaVersion?: number;
  engineVersion?: string;
  causationId?: string;
}

export interface ErrorEnvelope {
  error: string;
  message: string;
  details?: Record<string, unknown>;
}

export type StreamMode = 'values' | 'updates' | 'messages' | 'debug';

// ─── BYOK / AI providers (Phase H.1 + H.1″) ─────────────────────────────

/**
 * AI policy mode advertised by the host per `capabilities.md`
 * §`aiProviders.policies`. Hosts MAY advertise a subset; clients MUST
 * tolerate any subset.
 *
 *   - `disabled`   — provider MUST NOT be used at all
 *   - `optional`   — no restriction (default)
 *   - `required`   — provider call MUST carry a `credentialRef`
 *   - `restricted` — model MUST match the policy's `allowedModels`
 */
export type AIPolicyMode = 'disabled' | 'optional' | 'required' | 'restricted';

/**
 * Closed-set deny reason returned in `provider_policy_denied.details.reason`
 * per spec §"Wire-format error".
 */
export type AIPolicyDenyReason =
  | 'provider_disabled'
  | 'byok_required'
  | 'byok_required_but_unresolved'
  | 'model_not_allowed';

/**
 * Capability advertisement payload mirroring spec §`aiProviders` +
 * §`aiProviders.policies`. Optional sub-fields are absent on hosts
 * that don't enforce per-provider policies.
 */
export interface AIProvidersCapability {
  /** Provider ids the host's AI-proxy can route to. Optional per
   *  `capabilities.schema.json` (the `aiProviders` block has no required
   *  fields); a host advertising the block normally lists them. */
  supported?: readonly string[];
  /** Subset of `supported` for which BYOK is permitted. */
  byok?: readonly string[];
  /** Optional 4-mode policy enforcement advertisement. */
  policies?: {
    modes: readonly AIPolicyMode[];
    scopes?: readonly string[];
    errorCode?: string;
  };
  /** RFC 0108. Subset of `supported` whose entries are operator-/tenant-
   *  configured OpenAI-compatible endpoints (Ollama / vLLM / LM Studio / any
   *  `/v1/chat/completions`-compatible server), as opposed to a host-managed
   *  connection to a known public vendor. Each entry also appears in
   *  `supported` and MAY also appear in `byok`. The id is an OPAQUE label that
   *  MUST NOT encode the endpoint's network location (RFC 0108 §A.3), and a
   *  client MUST NOT infer model capabilities from it (§B) — the authoritative
   *  sources are `modelCapabilities.advertised[]` and `aiProviders.input`. */
  selfHosted?: readonly string[];
  /** RFC 0105. Present (value MUST be `'supported'`) ⇒ the host exposes speech
   *  synthesis via the host-side `ctx.callSpeechSynthesizer`. Absent ⇒ no TTS
   *  (a call is rejected with `speech_synthesis_unsupported`). */
  speechSynthesis?: 'supported';
  /** RFC 0106. Optional real-time voice profile. Absent ⇒ no live voice. The
   *  sub-flags gate streaming STT / chunked TTS and turn-taking; the host
   *  enforces that `turnDetection`/`bargeIn` require `transcription`. */
  realtimeVoice?: {
    /** Present (`'streaming'`) ⇒ host exposes streaming `ctx.callTranscriber`. */
    transcription?: 'streaming';
    /** Present (`'streaming'`) ⇒ `ctx.callSpeechSynthesizer` honors `stream:true`.
     *  Requires `aiProviders.speechSynthesis: 'supported'`. */
    synthesis?: 'streaming';
    /** Endpointing sophistication; requires `transcription`. */
    turnDetection?: 'vad' | 'semantic';
    /** Present (`'supported'`) ⇒ host emits `voice.barge_in`/`voice.cancelled`
     *  on overlapping speech; requires `transcription`. */
    bargeIn?: 'supported';
  };
  /** RFC 0116. Provider-scoped advert that the host honors the AI-envelope
   *  `generate` request's optional `cachePrefixId` (a tenant-namespaced,
   *  secret-free label) as a routing hint into the routed provider's
   *  server-side context cache. Absent ⇒ the host ignores `cachePrefixId`
   *  (no error). The cache MUST be keyed by `(resolved tenant, cachePrefixId)`
   *  (SECURITY invariant `prompt-prefix-cache-cross-tenant-isolation`) and a
   *  hit/miss MUST NOT change the recorded envelope or
   *  `provider.usage.inputTokens`/`outputTokens` (replay-invariant). NOT a
   *  universal claim — `providers` scopes it per routed provider. */
  promptPrefixCache?: {
    /** Whether the host honors `cachePrefixId`. */
    supported: boolean;
    /** Subset of `supported` for which `cachePrefixId` is honored (prefix
     *  caching is provider-specific, e.g. Anthropic ephemeral). A request
     *  whose routed provider is not listed has `cachePrefixId` ignored. */
    providers?: readonly string[];
  };
}

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

/**
 * Capability advertisement for hosts that operate an MCP client.
 * Mirrors `examples/hosts/postgres/src/mcp-client.ts` reference shape.
 * `trustBoundary: "untrusted"` is REQUIRED per
 * threat-model-prompt-injection.md §"UNTRUSTED marker": tool output is
 * adversarial-tolerant and downstream LLM nodes treat it as user data.
 */
export interface McpClientCapability {
  supported: true;
  transports: readonly string[];
  defaultTimeoutMs?: number;
  trustBoundary: 'untrusted';
}

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

/** Capability advertisement for hosts that implement `core.http.request`. */
export interface HttpClientCapability {
  supported: true;
  methods: readonly ('GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD')[];
  defaultTimeoutMs?: number;
  maxResponseBodyBytes: number;
  ssrfGuard: boolean;
  redirectPolicy?: 'follow' | 'reject';
}

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
}

/** Capability advertisement shape per capabilities.md §`memory`. */
export interface MemoryCapability {
  supported: true;
  maxEntrySizeBytes: number;
  ttlSupported: boolean;
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

/** Capability advertisement shape per capabilities.md §`agents` (Phase 1-6). */
export interface AgentsCapability {
  supported: true;
  profile?: string;
  modelClasses?: readonly ('reasoning' | 'tool-using' | 'chat')[];
  orchestratorPattern?: string;
  memoryBackends?: readonly string[];
  orchestrator?: boolean;
  dispatch?: boolean;
  reasoning?: {
    verbosity: ReasoningVerbosity;
    tokenLimit?: number;
    /** RFC 0024. When `true`, host MAY emit `agent.reasoning.delta`
     *  events incrementally while a reasoning block is still open,
     *  in addition to the final `agent.reasoned`. Consumers that
     *  only read `agent.reasoned` remain correct (the closing event
     *  is authoritative). */
    streaming?: boolean;
  };
}

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
 *  ABSENT on replay / `POST /v1/runs/{runId}:fork`. Membership-gated: every
 *  ref is a current participant (opaque RFC 0041 subject refs, non-PII). */
export interface ChannelPresencePayload {
  conversationId: string;
  /** Subject refs of members currently present (subset of participants). */
  present: readonly string[];
  /** Subset of `present` currently typing (boolean-by-presence; no free text). */
  typing?: readonly string[];
  [key: string]: unknown;
}

/** A `RunEventDoc` narrowed to a specific event-type discriminator +
 *  payload shape. Returned by the `isAgent*` type guards in
 *  `event-helpers.ts`. */
export interface TypedRunEvent<T> extends RunEventDoc {
  payload: T;
}

// ─── Auth profile claims (Phase I.5 + I.6) ──────────────────────────────

/** Profile identifiers per auth-profiles.md. */
export type AuthProfileClaim =
  | 'openwop-audit-log-integrity'
  | 'openwop-auth-api-key-rotation'
  | 'openwop-auth-oauth2-client-credentials'
  | 'openwop-auth-oidc-user-bearer'
  | 'openwop-auth-mtls'
  | 'openwop-discovery-auth-scoped'
  | 'openwop-interrupt-quorum'
  | 'openwop-interrupt-auth-required'
  | 'openwop-interrupt-external-event'
  | 'openwop-interrupt-cascade-cancel'
  | 'openwop-production';

/** Rotation advertisement shape per auth-profiles.md §"openwop-auth-api-key-rotation". */
export interface AuthRotationCapability {
  supported: true;
  minGraceSeconds: number;
}

/** Auth-scoped discovery advertisement per RFC 0011 §A. */
export interface DiscoveryAuthScopedCapability {
  supported: true;
  mode: 'same-endpoint';
}

// ---------------------------------------------------------------------------
// AI Envelope (DRAFT v1.x — `spec/v1/ai-envelope.md`)
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

/** Canonical inbound LLM-emission wire shape per `spec/v1/ai-envelope.md`. */
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

/** Optional capability advertisement per `ai-envelope.md` §"Capability handshake integration". */
export interface EnvelopeContractsCapability {
  advertised: boolean;
}

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
 * ONLY over the run event stream (`GET /v1/runs/{runId}/events`) to a subscriber
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

// ── RFC 0027 + RFC 0028 — Prompt library (spec/v1/prompts.md) ──

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
 * `schemas/prompt-template.schema.json` + spec/v1/prompts.md §PromptTemplate.
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
 * One installed manifest agent, as projected by `GET /v1/agents` /
 * `GET /v1/agents/{agentId}` (RFC 0072 §A). Read-only — never carries the
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

/** Response body for `GET /v1/agents` (RFC 0072 §A). */
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

/** Response for `GET /v1/agents/roster` (RFC 0086 §B). */
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

/** Response for `GET /v1/agents/org-chart/{departmentId}` (RFC 0087 §D) — the
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
 * `POST /v1/host/sample/agents` create surface — they're scoped to
 * the sample-extension and may evolve independently of the
 * normative agent surface. Future RFC promotion would migrate these
 * to the normative wire shape.
 */

/** Body for `POST /v1/host/sample/agents`. The server synthesises
 *  the agentId as `user.<tenantId>.<persona-slug>`. */
export interface CreateUserAgentRequest {
  /** Short name; becomes the `@`-mention slug and chat panel label.
   *  Required, ≤64 chars. */
  persona: string;
  /** Longer display name; defaults to the persona when omitted. */
  label?: string;
  description?: string;
  /** One of: `chat`, `reasoning`, `coding`, `extraction`. */
  modelClass: string;
  /** Inline system prompt body; ≤16 000 chars. The sample-host stores
   *  it directly (no pack-file ref). */
  systemPrompt: string;
  /** Capability ids the agent is allowed to call; ≤32 entries. */
  toolAllowlist?: string[];
  memoryShape?: {
    scratchpad?: boolean;
    conversation?: boolean;
    longTerm?: boolean;
  };
  /** 0.0-1.0; decisions below this are surfaced as low-confidence. */
  confidenceThreshold?: number;
}

/** Response body for `POST /v1/host/sample/agents` — shaped to
 *  match `AgentInventoryEntry` minus normative-only fields, so a
 *  follow-up `GET /v1/agents` returns a row of the same shape. */
export interface UserAgentRecord {
  agentId: string;
  persona: string;
  label: string;
  description?: string;
  modelClass: string;
  packName: string;
  packVersion: string;
  toolAllowlist: string[];
  memoryShape: {
    scratchpad: boolean;
    conversation: boolean;
    longTerm: boolean;
  };
  confidenceThreshold?: number;
  hasHandoffSchemas: false;
}

/** One installable agent-pack summary from the sample host's local
 *  registry mirror (`GET /v1/host/sample/registry/agent-packs`). */
export interface AgentPackSummary {
  /** Pack name, e.g. `core.openwop.agents.code-reviewer`. */
  name: string;
  version: string;
  description?: string;
  /** Personas declared by the pack's `agents[]` (per RFC 0003). */
  personas: string[];
  /** True when at least one of the pack's agents is registered in
   *  this host's in-process AgentRegistry. */
  installed: boolean;
}

export interface AgentPackRegistryResponse {
  packs: AgentPackSummary[];
  total: number;
}

export interface InstallAgentPackRequest {
  /** Must start with `core.openwop.agents.` — the sample's install
   *  route filters to that namespace. */
  name: string;
  /** Defaults to `1.0.0` when omitted. */
  version?: string;
}

export interface InstallAgentPackResponse {
  name: string;
  version: string;
  /** True when the pack was newly installed; false when it was
   *  already present in the registry. */
  installed: boolean;
  alreadyInstalled: boolean;
}

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
 * `GET /v1/tools` catalog. Source-agnostic (node-pack / workflow / mcp /
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
 * `GET /v1/tools?view=compact` (envelope `{ tools: CompactToolDescriptor[] }`) +
 * `GET /v1/tools/{toolId}?view=compact` when the host advertises
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

// ── RFC 0103 Localized content surface (spec/v1/localized-content.md) ──
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

/** Public delivery response for `GET /v1/content/pages/{slug}` — the negotiated
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

/** Request body for `PUT /v1/content/pages/{pageId}/sections/{sectionId}`. */
export interface PutContentSectionRequest {
  /** Target locale; the baseLocale upserts `data`, else `localizations[locale]`. */
  locale: string;
  /** The field overlay for the target locale (host-defined open shape). */
  data: Record<string, unknown>;
}

// ── RFC 0099 Trigger subscription registration (spec/v1/trigger-bridge.md §F) ──

/** Registration body for `POST /v1/trigger-subscriptions`
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

/** `201` response for `POST /v1/trigger-subscriptions`. `binding` carries the
 *  source-specific wiring the caller needs (e.g. `{ ingestUrl,
 *  secretFingerprint }` for webhook); the secret is returned ONCE at creation
 *  (SR-1) — persist it, it is not retrievable again. */
export interface CreateTriggerSubscriptionResponse {
  subscription: TriggerSubscription;
  binding: Record<string, unknown>;
}
