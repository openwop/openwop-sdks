"""
Request/response types mirroring the OpenAPI 3.1 spec
(`api/openapi.yaml`) and JSON Schemas
(`schemas/`).

Hand-authored rather than codegen'd — see SDK README §rationale.
String-typed enums (Literal aliases) for fields whose spec'd values
may grow over time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

# ── Type aliases ────────────────────────────────────────────────────────

RunStatus = Literal[
    "pending",
    "running",
    "paused",
    "waiting-approval",
    "waiting-input",
    "waiting-external",
    "completed",
    "failed",
    "cancelling",
    "cancelled",
]
"""Run statuses per `RunSnapshot.status` in OpenAPI.

``waiting-external`` distinguishes external-event waits from HITL waits at
the wire level (`interrupt-profiles.md §openwop-interrupt-external-event`).
``cancelling`` (RFC 0094 §B) is the transitional state between a cancel
request being accepted and the terminal ``cancelled``; both are active
(non-terminal) — see :data:`ACTIVE_RUN_STATUSES`.
"""

StreamMode = Literal["values", "updates", "messages", "debug"]


# ── Capabilities ────────────────────────────────────────────────────────

@dataclass(frozen=True)
class CapabilitiesLimits:
    clarificationRounds: int
    schemaRounds: int
    envelopesPerTurn: int
    maxNodeExecutions: int | None = None
    # RFC 0058 run-execution bounds.
    maxRunDurationMs: int | None = None
    maxLoopIterations: int | None = None
    # RFC 0094 §H. Maximum REST request body size (bytes) the host accepts.
    maxRequestBodyBytes: int | None = None


@dataclass(frozen=True)
class CapabilitiesGrpc:
    """RFC 0094 §H gRPC transport advertisement per `grpc-transport.md`
    §"Capability advertisement". Absent from :class:`Capabilities` ⇒ the
    host exposes no gRPC transport; REST + SSE remain exposed regardless.
    """

    supported: bool
    # Canonical service name. v1 hosts MUST use "openwop.v1.Engine".
    service: Literal["openwop.v1.Engine"]
    # TLS posture. Production hosts MUST set "required".
    tls: Literal["required", "optional", "disabled"]
    # Full URI: grpc:// (cleartext, intra-trusted-network only) or grpcs:// (TLS).
    endpoint: str | None = None


@dataclass(frozen=True)
class CapabilitiesMultiPartyConversation:
    """RFC 0101 multi-party group-conversation advertisement. Absent from
    :class:`Capabilities` ⇒ the host does not support N agents
    co-participating in one shared transcript (the single user + single
    driving agent shape of RFC 0005 remains). When ``supported`` is true,
    the host honors the additive ``participants: AgentRef[]`` roster on
    ``conversation.opened`` and the conditionally-required per-turn
    ``speakerId`` on ``role: 'agent'`` conversation turns.
    """

    supported: bool
    # Upper bound on participants[] the host accepts; None ⇒ host-defined / unbounded.
    maxParticipants: int | None = None


@dataclass(frozen=True)
class CapabilitiesRealtimeVoice:
    """RFC 0106 real-time voice profile (capability advertisement). Absent from
    :class:`CapabilitiesAIProviders` ⇒ no live voice. The host enforces that
    ``turnDetection`` / ``bargeIn`` require ``transcription``. ``ctx.*`` voice
    methods are host-side and not modeled in this client SDK.
    """

    # Present ("streaming") ⇒ host exposes streaming ctx.callTranscriber.
    transcription: Literal["streaming"] | None = None
    # Present ("streaming") ⇒ ctx.callSpeechSynthesizer honors stream:true.
    synthesis: Literal["streaming"] | None = None
    # Endpointing sophistication; requires transcription.
    turnDetection: Literal["vad", "semantic"] | None = None
    # Present ("supported") ⇒ host emits voice.barge_in/voice.cancelled.
    bargeIn: Literal["supported"] | None = None


@dataclass(frozen=True)
class CapabilitiesPromptPrefixCache:
    """RFC 0116 provider-scoped prompt-prefix-cache advertisement (nested under
    :class:`CapabilitiesAIProviders`). ``supported`` ⇒ the host honors the
    AI-envelope ``generate`` request's optional ``cachePrefixId`` (a
    tenant-namespaced, secret-free label) as a routing hint into the routed
    provider's server-side context cache. Absent ⇒ the host ignores
    ``cachePrefixId`` (no error). The cache MUST be keyed by
    ``(resolved tenant, cachePrefixId)`` (SECURITY invariant
    ``prompt-prefix-cache-cross-tenant-isolation``) and a hit/miss MUST NOT
    change the recorded envelope or ``provider.usage`` token counts
    (replay-invariant). NOT a universal claim — ``providers`` scopes it per
    routed provider.
    """

    supported: bool
    # Subset of `supported` for which cachePrefixId is honored (prefix caching
    # is provider-specific). A request whose routed provider is not listed has
    # cachePrefixId ignored.
    providers: list[str] | None = None


@dataclass(frozen=True)
class CapabilitiesAIProviders:
    """Host AI-proxy capability advertisement (``aiProviders`` in
    capabilities.md). Every field is optional per ``capabilities.schema.json``
    (the block declares no required fields). The wire object MAY carry
    additional fields (``input``, ``authModes``, ``maxInlineMediaBytes``) not
    modeled here.
    """

    # Provider ids the host's AI-proxy can route to.
    supported: list[str] | None = None
    # Subset of `supported` for which BYOK is permitted.
    byok: list[str] | None = None
    # Optional 4-mode policy enforcement advertisement (opaque here).
    policies: dict[str, Any] | None = None
    # RFC 0108. Subset of `supported` that are operator-/tenant-configured
    # OpenAI-compatible endpoints. The id is an OPAQUE label that MUST NOT
    # encode the endpoint location, and a client MUST NOT infer model
    # capabilities from it (RFC 0108 §A.3/§B).
    selfHosted: list[str] | None = None
    # RFC 0105. "supported" ⇒ host exposes speech synthesis (host-side
    # ctx.callSpeechSynthesizer). Absent ⇒ no TTS.
    speechSynthesis: Literal["supported"] | None = None
    # RFC 0106. Real-time voice profile.
    realtimeVoice: CapabilitiesRealtimeVoice | None = None
    # RFC 0116. Provider-scoped prompt-prefix-cache advertisement.
    promptPrefixCache: CapabilitiesPromptPrefixCache | None = None


@dataclass(frozen=True)
class CapabilitiesA2A:
    """RFC 0100 A2A (Agent2Agent) advertisement. ``supported`` alone ⇒ the
    synchronous ``message/send`` → poll ``tasks/get`` round-trip. The optional
    flags gate the RFC 0100 async/durable additions. Absent from
    :class:`Capabilities` ⇒ no A2A advertisement.
    """

    supported: bool
    # A2A 0.3 well-known agent card URL (/.well-known/agent-card.json).
    agentCardUrl: str
    # message/stream + tasks/resubscribe (RFC 0100 §3 resubscribe re-attach).
    streaming: bool | None = None
    # A2A push-notification config (RFC 0100 §4); pushConfig.url is SSRF-validated.
    pushNotifications: bool | None = None
    # RFC 0100 §2. Host persists the projected A2ATaskState; tasks/get returns
    # live state after disconnect. Absent/false ⇒ synchronous round-trip only.
    durableTasks: bool | None = None


@dataclass(frozen=True)
class CapabilitiesConversationTurnModelProvenance:
    """RFC 0109. Host stamps the optional non-secret ``agent.model``
    (``{provider, model}``) on ``role:'agent'`` conversation turns, read
    verbatim on ``:fork``. Absent from :class:`Capabilities` ⇒ no provenance.
    """

    supported: bool


@dataclass(frozen=True)
class CapabilitiesChannelPresence:
    """RFC 0110. Host emits the ephemeral ``channel.presence`` RunEvent (online
    + per-member typing) for ``type:'channel'`` conversations. Presence is live
    state — never persisted to the replayable log, never affects replay/``:fork``,
    and membership-gated (default-deny). Absent ⇒ no presence.
    """

    supported: bool


@dataclass(frozen=True)
class CapabilitiesApproverRouting:
    """RFC 0104 portable HITL approver-routing advertisement. When
    ``supported``, the host honors the OPTIONAL advisory ``approverGroupRefs`` /
    ``approverRoleRefs`` / ``audience`` fields on the ``kind:'approval'``
    interrupt payload (the SDK carries the interrupt payload opaquely, so those
    advisory fields ride that opaque object), resolves the advertised
    ``refKinds`` against its own RBAC, and enforces eligibility at resolve time.
    """

    supported: bool
    # Ref kinds the host resolves: "group" ⇒ approverGroupRefs,
    # "role" ⇒ approverRoleRefs. None ⇒ advisory-only passthrough.
    refKinds: list[Literal["group", "role"]] | None = None
    # Host honors the `audience` notification-targeting override; None/False ⇒
    # notifies the resolved eligible union.
    audience: bool | None = None


@dataclass(frozen=True)
class CapabilitiesInterrupt:
    """RFC 0104 interrupt capability block. Absent from :class:`Capabilities` ⇒
    the host advertises no interrupt-level options."""

    approverRouting: CapabilitiesApproverRouting | None = None


@dataclass(frozen=True)
class CapabilitiesMemoryInjectionBudget:
    """RFC 0113 injection-budget advertisement (nested under
    :class:`CapabilitiesMemory`). ``supported`` ⇒ the host honors
    ``MemoryListOptions.tokenBudget`` (a token-bounded prefix of the ranked,
    SR-1-redacted, single-tenant entry list). Absent ⇒ a supplied
    ``tokenBudget`` is ignored (today's ``limit``/``tag`` behavior).
    """

    supported: bool
    # Unit tokenBudget is denominated in. "chars" counts UTF-8/Unicode
    # characters of the entry content (tokenizer-free).
    tokenCounter: (
        Literal["o200k_base", "cl100k_base", "chars", "host-defined"] | None
    ) = None


@dataclass(frozen=True)
class CapabilitiesMemory:
    """RFC 0113 agent-memory capability descriptors. Absent from
    :class:`Capabilities` ⇒ a supplied ``tokenBudget`` is ignored. The wire
    ``memory`` block MAY carry other descriptors not modeled here (e.g.
    ``search``).
    """

    injectionBudget: CapabilitiesMemoryInjectionBudget | None = None


@dataclass(frozen=True)
class CapabilitiesRestTransport:
    """RFC 0115 conditional-GET + Content-Encoding negotiation on run reads
    (``GET /v1/runs/{runId}``). Absent from :class:`Capabilities` ⇒ the host
    returns today's ``200`` + identity body. Distinct from the file-egress
    ``fileHandling.transport`` sub-capability — this advertises HTTP-layer poll
    economy on the run-read REST surface.
    """

    # Host emits a strong, event-log-sequence-derived ETag on GET /v1/runs/{runId}
    # and honors If-None-Match with a 304 (empty body) when the validator matches.
    conditionalRunGet: bool | None = None
    # Content-Encoding values the host will negotiate on run reads. "gzip" is the
    # baseline; "br"/"zstd" are optional. Each advertised value's decoded body is
    # byte-identical to the identity body.
    contentEncodings: list[Literal["gzip", "br", "zstd"]] | None = None


@dataclass(frozen=True)
class CapabilitiesToolCatalog:
    """RFC 0112 tool-catalog advertisement. ``compactView`` ⇒ the host serves the
    model-facing compact projection at ``GET /v1/tools?view=compact`` (and
    ``GET /v1/tools/{toolId}?view=compact``). Absent from :class:`Capabilities`
    ⇒ no compact view.
    """

    compactView: bool | None = None


@dataclass(frozen=True)
class CapabilitiesA2uiSurface:
    """RFC 0114 A2UI-surface advertisement. ``deltaTransport`` ⇒ the host emits
    RFC 6902 delta frames over the run event stream to a subscriber that
    negotiated ``?a2uiDelta=1`` (every other consumer receives the materialized
    full surface). Absent from :class:`Capabilities` ⇒ full surfaces only.
    """

    deltaTransport: bool | None = None


@dataclass(frozen=True)
class CapabilitiesUiPlugins:
    """RFC 0117 (amended by RFC 0119). Host loads SIGNED, SANDBOXED front-end
    plugin packs (``kind:'frontend-plugin'``) in an origin/execution-isolated
    sandbox and talks to them over the closed ``ui-plugin/1`` host-RPC boundary.
    Discovery surface only — the RPC envelope + the ``frontend-plugin`` manifest
    are a renderer/registry concern the SDK does not model. Absent from
    :class:`Capabilities` ⇒ the host loads no plugin packs.
    """

    supported: bool
    # Categorical isolation MECHANISM (5 named values —
    # cross-origin-iframe/wasm/process/container/vm — plus a vendor
    # x-host-<host>-<key> form, hence an open str). ALL values denote the SAME
    # mandatory isolation property; None ⇒ "cross-origin-iframe" (the default).
    isolation: str | None = None
    # Plugin surfaces this host renders; a pack surface not in this set is
    # installable-but-inert (graceful degradation).
    surfaces: list[Literal["artifact-viewer", "route", "settings-panel"]] | None = None
    # The ui-plugin/1 host-RPC methods this host honors; a call to a method not
    # in this set is rejected with method_not_allowed.
    hostApi: (
        list[
            Literal["artifact.read", "artifact.write", "host.toast", "host.navigate"]
        ]
        | None
    ) = None
    # Per-plugin entry-bundle byte ceiling the host will load.
    maxEntryBytes: int | None = None


@dataclass(frozen=True)
class CapabilitiesDispatch:
    """RFC 0007 + RFC 0118 top-level ``core.dispatch`` capability descriptors
    (``capabilities.md`` §``dispatch``) — the discovery surface for parallel
    sub-workflow fan-out/join. All fields OPTIONAL + read-only; absent
    descriptors carry the documented conservative defaults (a host that omits
    ``joinModes`` implements no parallel join; one that omits
    ``onChildFailureModes`` accepts only ``'collect'``). Distinct from the
    legacy boolean ``agents.dispatch``.
    """

    # Host implements the core.dispatch Core typeId (top-level mirror of the
    # legacy agents.dispatch boolean).
    supported: bool | None = None
    # Host honors nextWorkerIds.length > 1; since RFC 0118 also the gate for
    # accepting fanOutPolicy:'parallel' at registration.
    fanOutSupported: bool | None = None
    # fanOutPolicy values the host accepts. Absent ⇒ ["sequential","reject"].
    fanOutPolicies: list[Literal["sequential", "reject", "parallel"]] | None = None
    # joinPolicy.mode values the host implements for parallel fan-out. Absent ⇒
    # no parallel join.
    joinModes: list[Literal["wait-all", "quorum", "first", "race"]] | None = None
    # joinPolicy.onChildFailure error-aggregation values (orthogonal to
    # joinModes). Absent ⇒ ["collect"] only.
    onChildFailureModes: list[Literal["collect", "fail-fast", "absorb"]] | None = None
    # Host's hard concurrency/breadth ceiling for a parallel fan-out. Absent ⇒
    # unbounded (treat as "unknown, may be capped").
    maxFanOut: int | None = None


# The `kind` discriminator on a `cap.breached` payload
# (run-event-payloads.schema.json#capBreached): four engine kinds + RFC 0008 §K
# wasm-* runtime caps + RFC 0058 run-scoped bounds.
CapBreachedKind = Literal[
    "clarification",
    "schema",
    "envelopes",
    "node-executions",
    "wasm-memory",
    "wasm-fuel",
    "wasm-execution-time",
    "run-duration",
    "loop-iterations",
]


@dataclass(frozen=True)
class Capabilities:
    protocolVersion: str
    supportedEnvelopes: list[str]
    schemaVersions: dict[str, int]
    limits: CapabilitiesLimits
    extensions: dict[str, Any] | None = None
    # Network-handshake superset (all (future) per capabilities.md)
    implementation: dict[str, Any] | None = None
    engineVersion: int | None = None
    eventLogSchemaVersion: int | None = None
    supportedTransports: list[str] | None = None
    configurable: dict[str, Any] | None = None
    observability: dict[str, Any] | None = None
    minClientVersion: str | None = None
    # RFC 0094 §H gRPC transport advertisement.
    grpc: CapabilitiesGrpc | None = None
    # RFC 0101 multi-party group-conversation advertisement.
    multiPartyConversation: CapabilitiesMultiPartyConversation | None = None
    # Host AI-proxy advertisement (RFC 0105/0106/0108 sub-flags live here).
    aiProviders: CapabilitiesAIProviders | None = None
    # RFC 0100 A2A (Agent2Agent) advertisement.
    a2a: CapabilitiesA2A | None = None
    # RFC 0109 conversation-turn model provenance advertisement.
    conversationTurnModelProvenance: (
        CapabilitiesConversationTurnModelProvenance | None
    ) = None
    # RFC 0110 channel-presence advertisement.
    channelPresence: CapabilitiesChannelPresence | None = None
    # RFC 0104 interrupt capability block (approver routing).
    interrupt: CapabilitiesInterrupt | None = None
    # RFC 0113 agent-memory advertisement (injection budget).
    memory: CapabilitiesMemory | None = None
    # RFC 0115 conditional-GET + Content-Encoding on run reads.
    restTransport: CapabilitiesRestTransport | None = None
    # RFC 0112 compact tool-catalog view advertisement.
    toolCatalog: CapabilitiesToolCatalog | None = None
    # RFC 0114 A2UI surface delta-transport advertisement.
    a2uiSurface: CapabilitiesA2uiSurface | None = None
    # RFC 0117 (amended by RFC 0119) front-end plugin advertisement.
    uiPlugins: CapabilitiesUiPlugins | None = None
    # RFC 0007 + RFC 0118 top-level core.dispatch fan-out/join descriptors.
    dispatch: CapabilitiesDispatch | None = None


# ── RunSnapshot ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class RunSnapshotError:
    code: str
    message: str
    details: dict[str, Any] | None = None


@dataclass(frozen=True)
class RunSnapshot:
    runId: str
    workflowId: str
    status: RunStatus
    currentNodeId: str | None = None
    startedAt: str | None = None
    completedAt: str | None = None
    nodeStates: dict[str, Any] | None = None
    variables: dict[str, Any] | None = None
    channels: dict[str, Any] | None = None
    error: RunSnapshotError | None = None
    engineVersion: str | None = None
    eventLogSchemaVersion: int | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    configurable: dict[str, Any] | None = None


# ── RunOptions / configurable ───────────────────────────────────────────

@dataclass
class RunConfigurable:
    """Per-run parameter overlay carried in `RunOptions.configurable`.

    Reserved keys are typed; unknown keys are passed through verbatim
    via `extras`. See `run-options.md`.
    """

    recursionLimit: int | None = None
    runTimeoutMs: int | None = None  # RFC 0058
    maxLoopIterations: int | None = None  # RFC 0058
    model: str | None = None
    temperature: float | None = None
    maxTokens: int | None = None
    promptOverrides: dict[str, str] | None = None
    extras: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        if self.recursionLimit is not None:
            out["recursionLimit"] = self.recursionLimit
        if self.runTimeoutMs is not None:
            out["runTimeoutMs"] = self.runTimeoutMs
        if self.maxLoopIterations is not None:
            out["maxLoopIterations"] = self.maxLoopIterations
        if self.model is not None:
            out["model"] = self.model
        if self.temperature is not None:
            out["temperature"] = self.temperature
        if self.maxTokens is not None:
            out["maxTokens"] = self.maxTokens
        if self.promptOverrides is not None:
            out["promptOverrides"] = dict(self.promptOverrides)
        out.update(self.extras)
        return out


# ── Run lifecycle requests/responses ────────────────────────────────────

@dataclass
class CreateRunRequest:
    workflowId: str
    inputs: dict[str, Any] | None = None
    tenantId: str | None = None
    scopeId: str | None = None
    callbackUrl: str | None = None
    configurable: RunConfigurable | dict[str, Any] | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None


@dataclass(frozen=True)
class CreateRunResponse:
    runId: str
    status: RunStatus
    eventsUrl: str
    statusUrl: str | None = None


@dataclass
class CancelRunRequest:
    reason: str | None = None


@dataclass(frozen=True)
class CancelRunResponse:
    runId: str
    status: Literal["cancelled", "cancelling"]


@dataclass
class PauseRunRequest:
    reason: str | None = None
    drainPolicy: Literal["immediate", "drain-current-node"] | None = None


@dataclass(frozen=True)
class PauseRunResponse:
    runId: str
    status: Literal["paused"]
    pausedAt: str | None = None


@dataclass
class ResumeRunRequest:
    reason: str | None = None


@dataclass(frozen=True)
class ResumeRunResponse:
    runId: str
    status: Literal["running"]
    resumedAt: str | None = None


# spec/v1/webhooks.md — webhook subscription register / unregister.
@dataclass
class RegisterWebhookRequest:
    url: str
    events: list[str]
    secret: str | None = None
    tags: list[str] | None = None


@dataclass(frozen=True)
class RegisterWebhookResponse:
    """Response from POST /v1/webhooks.

    The ``secret`` field is returned ONCE on registration — store it
    server-side for HMAC verification. The host cannot recover it.
    """

    subscriptionId: str
    url: str
    secret: str
    eventTypes: list[str]
    createdAt: str


# spec/v1/debug-bundle.md — portable JSON diagnostic export.
@dataclass(frozen=True)
class DebugBundle:
    """Portable JSON export of a single run's diagnostic state.

    Hosts MAY omit non-required fields. Consumers MUST treat masked /
    omitted / hashed values as the spec-canonical content per
    ``redactionMode`` — they are NOT placeholders for missing data.
    """

    bundleVersion: str
    generatedAt: str
    host: dict[str, Any]
    run: dict[str, Any]
    events: list[dict[str, Any]]
    redactionApplied: bool
    redactionMode: Literal["mask", "omit", "hash", "passthrough"]
    truncated: bool | None = None
    truncatedReason: str | None = None


# rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
@dataclass
class BulkCancelRunsRequest:
    runIds: list[str]
    reason: str | None = None


@dataclass(frozen=True)
class BulkCancelRunResult:
    runId: str
    ok: bool
    status: Literal["cancelled", "cancelling"] | None = None
    error: dict[str, Any] | None = None


@dataclass(frozen=True)
class BulkCancelRunsResponse:
    results: list[BulkCancelRunResult]


# auth-profiles.md §"openwop-audit-log-integrity" §4 — verify endpoint.
@dataclass(frozen=True)
class AuditVerifyCheckpoint:
    checkpoint: str
    atSequence: int
    merkleRoot: str
    signature: str


@dataclass(frozen=True)
class AuditVerifyAnomaly:
    atSeq: int
    expectedPrevHash: str
    actualPrevHash: str


@dataclass(frozen=True)
class AuditVerifyResult:
    fromSeq: int
    toSeq: int
    chainValid: bool
    checkpoints: list[AuditVerifyCheckpoint]
    anomalies: list[AuditVerifyAnomaly]
    checkpointsValid: bool | None = None


@dataclass
class ForkRunRequest:
    fromSeq: int
    mode: Literal["replay", "branch"]
    runOptionsOverlay: dict[str, Any] | None = None


@dataclass(frozen=True)
class ForkRunResponse:
    runId: str
    sourceRunId: str
    mode: Literal["replay", "branch"]
    status: RunStatus
    eventsUrl: str
    fromSeq: int | None = None


# ── RFC 0056 run feedback / annotations ─────────────────────────────────


@dataclass(frozen=True)
class Annotation:
    """RFC 0056 persisted annotation (``annotation.schema.json``). A side-
    resource — not a replayable run-event-log entry. ``signal`` is a dict
    discriminated by ``kind`` (rating / correction / label / flag)."""

    annotationId: str
    target: dict[str, str]
    signal: dict[str, Any]
    actor: dict[str, str]
    createdAt: str
    note: str | None = None


@dataclass(frozen=True)
class CreateAnnotationRequest:
    """Request body for ``create_annotation`` (``annotation-create.schema.json``).
    The host assigns ``annotationId`` / ``createdAt`` / ``actor`` and binds
    ``target.runId``; the client supplies only the signal (+ optional anchor
    and note)."""

    signal: dict[str, Any]
    target: dict[str, str] | None = None
    note: str | None = None


# ── RFC 0059 agent workspace ────────────────────────────────────────────


@dataclass(frozen=True)
class WorkspaceFile:
    """RFC 0059 versioned, tenant·workspace-scoped ground-truth file
    (``workspace-file.schema.json``). The ``list`` endpoint returns this shape
    minus ``content`` (metadata only)."""

    path: str
    content: str
    version: int
    updatedAt: str
    contentType: str | None = None
    etag: str | None = None


@dataclass(frozen=True)
class PutWorkspaceFileRequest:
    """Request body for ``put_workspace_file`` (``workspace-file-create.schema.json``).
    ``path`` is URL-bound; the host assigns ``version`` / ``etag`` / ``updatedAt``.
    Optimistic concurrency is expressed via the ``If-Match`` header, not the body."""

    content: str
    contentType: str | None = None


# ── RFC 0040 Phase 3 cross-host causation ───────────────────────────────


@dataclass(frozen=True)
class RunAncestryParent:
    runId: str
    hostId: str
    cause: Literal["mcp-tool-call", "a2a-message", "core.subWorkflow", "core.dispatch"]
    wellKnownUrl: str | None = None


@dataclass(frozen=True)
class RunAncestryResponse:
    """RFC 0040 §C response shape — `GET /v1/runs/{runId}/ancestry`.

    `parent: None` for top-level runs (not dispatched from any other run);
    when set, `parent.wellKnownUrl` identifies the parent host's discovery
    doc URL so callers walk the chain across hosts one hop at a time.
    Capability-gated on
    `capabilities.multiAgent.executionModel.crossHostCausation.ancestryEndpointSupported`.
    """

    runId: str
    hostId: str
    parent: RunAncestryParent | None


# ── HITL ────────────────────────────────────────────────────────────────

@dataclass
class ResolveInterruptRequest:
    resumeValue: Any


@dataclass(frozen=True)
class ResolveInterruptResponse:
    runId: str
    nodeId: str
    status: RunStatus


@dataclass(frozen=True)
class InterruptByTokenInspection:
    """Mirror of `suspend-request.schema.json` (InterruptPayload)."""

    kind: Literal[
        "approval",
        "clarification",
        "external-event",
        "custom",
        # Multi-Agent Shift Phase 4 — multi-turn user interjections.
        "conversation.start",
        "conversation.exchange",
        "conversation.close",
        # Phase 1 — confidence-escalation contract.
        "low-confidence",
    ]
    key: str
    data: Any
    resumeSchema: dict[str, Any] | None = None
    timeoutMs: int | None = None


# ── Events / poll ───────────────────────────────────────────────────────

@dataclass(frozen=True)
class RunEventDoc:
    """Mirror of `run-event.schema.json` — top-level shape only.

    Per-event payload schemas live in `run-event-payloads.schema.json`;
    the SDK keeps `payload` as `Any` for forward-compat (consumers that
    want strict per-event validation should layer the payloads schema
    via Ajv/jsonschema themselves).
    """

    eventId: str
    runId: str
    type: str
    payload: Any
    timestamp: str
    sequence: int
    nodeId: str | None = None
    schemaVersion: int | None = None
    engineVersion: str | None = None
    causationId: str | None = None


@dataclass(frozen=True)
class PollEventsResponse:
    events: list[RunEventDoc]
    isComplete: bool


# ── Error envelope ──────────────────────────────────────────────────────

HTTP_ERROR_CODES = frozenset(
    {
        # Auth / access
        "unauthenticated",
        "forbidden",
        "key_expired",
        "key_revoked",
        # Request / routing
        "validation_error",
        "not_found",
        "rate_limited",
        # Idempotency / run creation conflicts
        "run_already_active",
        "idempotency_in_flight",
        "idempotency_key_mismatch",
        # Streaming / protocol negotiation
        "unsupported_stream_mode",
        "force_engine_version_forbidden",
        "mock_provider_forbidden",
        # Capability / credential negotiation
        "capability_not_provided",
        "capability_required",
        "credential_required",
        "credential_forbidden",
        "credential_unavailable",
        # Node-pack lifecycle (registry + lockfile)
        "pack_integrity_mismatch",
        "pack_signature_invalid",
        "pack_peer_dependency_missing",
        "pack_lockfile_incomplete",
        "pack_version_not_found",
        # HITL / interrupt callbacks
        "interrupt_not_found",
        "approval_token_invalid",
        "approval_token_expired",
        "approval_token_consumed",
        # Phase H.1″ — AI provider policy enforcement.
        "provider_policy_denied",
        # Phase H.2 — MCP client.
        "mcp_server_not_configured",
        "mcp_timeout",
        "mcp_network_error",
        "mcp_server_error",
        "mcp_protocol_error",
        "mcp_tool_error",
        # Phase H.3 — HTTP client.
        "http_url_rejected",
        "http_timeout",
        "http_network_error",
        "http_unexpected_status",
        # Phase H webhook codes (spec-de-facto).
        "webhook_url_rejected",
        "subscription_not_found",
        # Generic server failure
        "internal_error",
    }
)
"""Canonical REST/MCP `ErrorEnvelope.error` codes for common branching."""


def is_http_error_code(value: object) -> bool:
    """Return True when *value* is a known canonical HTTP error code."""

    return isinstance(value, str) and value in HTTP_ERROR_CODES


@dataclass(frozen=True)
class ErrorEnvelope:
    error: str
    message: str
    details: dict[str, Any] | None = None


# ─── Run statuses (forward-compatible) ────────────────────────────────────

ACTIVE_RUN_STATUSES: frozenset[str] = frozenset(
    {
        "pending",
        "running",
        "paused",
        "waiting-approval",
        "waiting-input",
        "waiting-external",
        # RFC 0094 §B — transitional state during the cancel cascade; the
        # run WILL still transition (to terminal "cancelled"), so active.
        "cancelling",
    }
)
"""Run statuses considered active — the run MAY still transition.

Hosts MAY emit additional terminal values per the schema's forward-compat
clause (e.g., ``timed-out``, ``interrupted``); readers MUST treat unknown
statuses as terminal-unknown, NOT as still-active. Match the TypeScript
SDK's ``ACTIVE_RUN_STATUSES`` constant + ``isTerminalRunStatus`` predicate.
"""

TERMINAL_RUN_STATUSES: frozenset[str] = frozenset(
    {
        "completed",
        "failed",
        "cancelled",
    }
)
"""Spec-known terminal statuses. Hosts MAY emit additional terminal values;
use :func:`is_terminal_run_status` for forward-compat checks instead of
literal-set membership.
"""


def is_terminal_run_status(status: str) -> bool:
    """Return True when ``status`` indicates the run will not transition further.

    Implemented as a negative check against :data:`ACTIVE_RUN_STATUSES` — any
    value NOT in the spec's known-active set is treated as terminal. This
    implements the schema's forward-compat clause; the alternative (positive
    check against :data:`TERMINAL_RUN_STATUSES`) would loop polling forever
    on any unknown value.
    """

    return isinstance(status, str) and status not in ACTIVE_RUN_STATUSES


# ─── Run-document error codes ─────────────────────────────────────────────

RUN_ERROR_CODES: frozenset[str] = frozenset(
    {
        # Authorization / access
        "auth_required",
        "forbidden",
        "workspace_not_found",
        # Run-state conflicts
        "run_already_active",
        "run_not_found",
        "run_terminal",
        "engine_version_mismatch",
        # Validation
        "invalid_workflow_definition",
        "invalid_trigger_input",
        "node_type_not_found",
        "config_validation_failed",
        # Quota / budget
        "token_budget_exceeded",
        "concurrent_run_limit_reached",
        "rate_limited",
        # Execution
        "node_timeout",
        "global_timeout",
        "node_execution_failed",
        "external_call_failed",
        "recursion_limit_exceeded",
        "run_timeout",
        "loop_limit_exceeded",
        "capability_not_provided",
        # Approval
        "approval_timeout",
        "approval_token_invalid",
        "approval_token_expired",
        "approval_token_consumed",
        # Persistence
        "persistence_failed",
        "doc_budget_exceeded",
    }
)
"""Run-document error codes — stable identifiers used in
``RunSnapshot.error.code`` when a run reaches ``failed``. Distinct from
:data:`HTTP_ERROR_CODES` (which describe HTTP-level request failures).
Matches the TypeScript SDK's ``RUN_ERROR_CODES`` constant.
"""


def is_run_error_code(value: object) -> bool:
    """Return True when ``value`` is a known canonical run-document error code."""

    return isinstance(value, str) and value in RUN_ERROR_CODES


@dataclass(frozen=True)
class AgentInventoryEntry:
    """RFC 0072 §A — one installed manifest agent, as projected by
    ``GET /v1/agents`` / ``GET /v1/agents/{agentId}``. Read-only — never carries
    the system-prompt body, resolved handoff schemas, or credentials (SR-1)."""

    agentId: str
    persona: str
    label: str
    modelClass: str
    packName: str
    packVersion: str
    toolAllowlist: list[str]
    hasHandoffSchemas: bool
    description: str | None = None
    memoryShape: dict[str, bool] | None = None
    confidenceThreshold: float | None = None
    # RFC 0072 §C — optional capability tiers this host does not satisfy, inert here.
    degraded: list[str] | None = None


# ── RFC 0054 run diff (run-diff-response.schema.json) ───────────────────


@dataclass(frozen=True)
class RunDiffEventDiff:
    """One per-event entry in a :class:`RunDiffResponse`. ``aEvent`` is absent
    when ``op == 'added'``; ``bEvent`` is absent when ``op == 'removed'``."""

    seq: int
    op: Literal["added", "removed", "changed"]
    aEvent: dict[str, Any] | None = None
    bEvent: dict[str, Any] | None = None


@dataclass(frozen=True)
class RunDiffResponse:
    """RFC 0054 — response from ``GET /v1/runs/{runId}:diff?against={otherRunId}``
    (``run-diff-response.schema.json``). Deterministic, replay-aware structured
    diff of two runs' event sequences + terminal states. ``divergedAtSeq`` is
    ``None`` and ``eventDiffs`` is empty when the two logs are identical."""

    a: str
    b: str
    divergedAtSeq: int | None
    eventDiffs: list[RunDiffEventDiff]
    stateDiff: dict[str, Any]
    truncated: bool | None = None


# ── RFC 0078 portable tool catalog (tool-descriptor.schema.json) ────────


@dataclass(frozen=True)
class ToolDescriptor:
    """RFC 0078 §B — a portable tool descriptor as projected onto the host's
    ``GET /v1/tools`` catalog (``tool-descriptor.schema.json``). Source-agnostic;
    ``safetyTier`` / ``egress`` / ``approval`` let a caller reason about a tool's
    blast radius before invoking it."""

    toolId: str
    source: Literal["node-pack", "workflow", "mcp", "connector", "host-extension"]
    safetyTier: Literal["pure", "read", "write", "exec"]
    title: str | None = None
    description: str | None = None
    inputSchema: dict[str, Any] | None = None
    outputSchema: dict[str, Any] | None = None
    auth: dict[str, Any] | None = None
    egress: Literal["none", "safe-fetch", "host-mediated", "host-owned"] | None = None
    approval: Literal["never", "conditional", "always"] | None = None
    replayPolicy: (
        Literal["deterministic", "idempotent", "non-deterministic"] | None
    ) = None
    costHint: str | None = None
    latencyHint: str | None = None


# ── RFC 0112 compact tool catalog (tool-descriptor.schema.json) ─────────


class CompactToolDescriptor(TypedDict, total=False):
    """RFC 0112 — a compact, model-facing projection of :class:`ToolDescriptor`,
    returned by ``GET /v1/tools?view=compact`` (envelope ``{tools: [...]}``) +
    ``GET /v1/tools/{toolId}?view=compact`` when the host advertises
    ``capabilities.toolCatalog.compactView``. The heavy descriptor fields
    (``outputSchema``/``auth``/``egress``/``approval``/``replayPolicy``/
    ``costHint``/``latencyHint``) are dropped, and any ``inputSchema`` is bounded
    to the compact structural subset. Required: ``toolId``, ``source``,
    ``safetyTier``. Optional: ``title``, ``description``, ``inputSchema``."""

    toolId: str
    source: str
    safetyTier: str
    title: str
    description: str
    inputSchema: dict[str, Any]


# ── RFC 0082 agent deployment lifecycle ─────────────────────────────────

DeploymentState = Literal[
    "draft",
    "test",
    "staged",
    "active",
    "paused",
    "deprecated",
    "rolled-back",
]
"""The seven-state deployment lifecycle (RFC 0082 §C)."""


@dataclass(frozen=True)
class AgentDeployment:
    """RFC 0082 §C — a per-(agentId, version) deployment record, returned by
    ``agents_list_deployments`` / ``agents_transition_deployment``
    (``agent-deployment.schema.json``). Host-runtime state distinct from the
    immutable manifest and the registry's published tags."""

    agentId: str
    version: str
    state: DeploymentState
    canaryPercent: float | None = None
    rollbackPointer: str | None = None
    channels: list[str] | None = None
    evalRunId: str | None = None
    approvalGateId: str | None = None


@dataclass
class AgentDeploymentTransition:
    """RFC 0082 §E — the ``agents_transition_deployment`` request body
    (``agent-deployment-transition.schema.json``). The host authorizes it
    fail-closed (RFC 0049 ``deploy:*``), runs any RFC 0051 approvalGate, and
    enforces RFC 0081 ``requiredEval`` before emitting ``deployment.promoted``."""

    version: str
    transition: Literal["promote", "pause", "deprecate", "rollback", "adjust-canary"]
    toState: DeploymentState | None = None
    channel: str | None = None
    canaryPercent: float | None = None
    evalRunId: str | None = None
    reason: str | None = None


# ── RFC 0086 standing agent roster (agent-roster-*.schema.json) ──────────


@dataclass(frozen=True)
class AgentRosterEntry:
    """RFC 0086 §A — a standing agent INSTANCE: a ``host:<id>`` AgentRef that
    references a manifest/deployment and owns a workflow portfolio
    (``agent-roster-entry.schema.json``)."""

    rosterId: str
    persona: str
    agentRef: dict[str, Any]
    owner: dict[str, Any]
    workflows: list[str] | None = None
    enabled: bool | None = None
    label: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class AgentRosterResponse:
    """Response for ``GET /v1/agents/roster`` (RFC 0086 §B,
    ``agent-roster-response.schema.json``)."""

    roster: list[AgentRosterEntry]
    total: int


# ── RFC 0087 agent org-chart (agent-org-chart.schema.json) ──────────────


@dataclass(frozen=True)
class OrgChartDepartment:
    """RFC 0087 §A — an org-chart department (a tree node via
    ``parentDepartmentId``)."""

    departmentId: str
    name: str
    parentDepartmentId: str | None
    roles: list[dict[str, str]]


@dataclass(frozen=True)
class OrgChartMember:
    """RFC 0087 §A — an org-chart member (a roster instance placed in a
    dept/role)."""

    rosterId: str
    departmentId: str
    roleId: str
    reportsTo: str | None


@dataclass(frozen=True)
class AgentOrgChart:
    """RFC 0087 §A — the descriptive org-chart over roster members
    (``agent-org-chart.schema.json``). Carries no authority-bearing field by
    design (§B ``org-position-no-authority-escalation``)."""

    owner: dict[str, Any]
    departments: list[OrgChartDepartment]
    members: list[OrgChartMember]


@dataclass(frozen=True)
class OrgChartResponsibilityView:
    """Response for ``GET /v1/agents/org-chart/{departmentId}`` (RFC 0087 §D,
    ``org-chart-responsibility-view.schema.json``) — the department subtree +
    the responsibility roll-up (union of member portfolios)."""

    department: OrgChartDepartment
    members: list[OrgChartMember]
    responsibilities: list[str]


# ── RFC 0081 agent evaluation (eval-summary.schema.json) ────────────────

AgentModelClass = Literal[
    "reasoning",
    "writing",
    "coding",
    "research",
    "classification",
    "general",
]
"""Abstract model class (RFC 0002 / RFC 0003 manifest vocabulary)."""


@dataclass(frozen=True)
class EvalSafetyFinding:
    """A redaction-safe safety finding ({kind, severity} descriptor — never
    excerpted content)."""

    kind: str
    severity: Literal["low", "medium", "high", "critical"]


@dataclass(frozen=True)
class EvalTaskResult:
    """Per-task result on an :class:`EvalSummary` (content-free: scores +
    scalars + ids)."""

    taskId: str
    score: float
    passed: bool
    costUsd: float | None = None
    latencyMs: float | None = None
    schemaValid: bool | None = None
    safetyFindings: list[EvalSafetyFinding] | None = None


@dataclass(frozen=True)
class EvalRegression:
    """The regression block on an :class:`EvalSummary` (RFC 0081 §D
    ``regression`` mode)."""

    baselineRunId: str
    scoreDelta: float
    diffRef: str | None = None


@dataclass(frozen=True)
class EvalSummary:
    """RFC 0081 §C — the terminal scorecard of an eval run, read via
    ``runs_eval_summary(runId)`` (``eval-summary.schema.json``). Content-free:
    scores, scalars, ids, and redaction-safe safety descriptors only
    (``eval-summary-no-content-leak``)."""

    suiteId: str
    suiteVersion: str
    aggregateScore: float
    passed: bool
    taskCount: int
    passedCount: int
    tasks: list[EvalTaskResult]
    evaluatedModelClass: AgentModelClass | None = None
    totalCostUsd: float | None = None
    regression: EvalRegression | None = None


# ── RFC 0027 / RFC 0028 prompt library (prompt-template.schema.json) ────

PromptKind = Literal["system", "user", "few-shot", "schema-hint"]
"""Role a PromptTemplate plays when composed into an LLM call
(``prompt-kind.schema.json``)."""


@dataclass
class PromptVariable:
    """Typed interpolation slot in a :class:`PromptTemplate`
    (``prompt-template.schema.json#/$defs/PromptVariable``)."""

    name: str
    type: Literal["string", "number", "boolean", "array", "object"]
    required: bool
    source: Literal["input", "variable", "secret", "context"] | None = None
    extractPath: str | None = None
    defaultValue: Any | None = None
    description: str | None = None


@dataclass
class PromptTemplate:
    """RFC 0027 / RFC 0028 — named, versioned, variable-bound prompt body
    (``prompt-template.schema.json``). Used as both request body
    (``create``/``update``) and 2xx response shape."""

    templateId: str
    version: str
    kind: PromptKind
    text: str
    name: str | None = None
    description: str | None = None
    variables: list[PromptVariable] | None = None
    modelHints: dict[str, Any] | None = None
    tags: list[str] | None = None
    meta: dict[str, Any] | None = None


@dataclass
class ListPromptsRequest:
    """Filter set for ``prompts_list(...)`` per RFC 0028 §A."""

    kind: PromptKind | None = None
    tag: str | None = None
    modelClass: str | None = None
    source: Literal["host", "pack", "user"] | None = None
    cursor: str | None = None
    limit: int | None = None


@dataclass(frozen=True)
class ListPromptsResponse:
    """Response for ``prompts_list(...)`` — the 200 body of
    ``GET /v1/prompts``."""

    items: list[PromptTemplate]
    nextCursor: str | None = None


@dataclass
class RenderPromptRequest:
    """Request shape for ``prompts_render(...)`` per RFC 0028 §A. ``ref`` is a
    ``prompt-ref.schema.json`` value — the stringy ``prompt:<id>[@<ver>]`` form
    or the structured object form. Secret-source bindings MUST carry
    ``[REDACTED:<credentialRef>]`` markers (SR-1)."""

    ref: str | dict[str, Any]
    variables: dict[str, Any]
    contentTrust: Literal["trusted", "untrusted"] | None = None


@dataclass(frozen=True)
class RenderPromptResponse:
    """Response for ``prompts_render(...)``. ``hash`` / ``variableHashes`` are
    always present; ``composed`` populates only under
    ``capabilities.prompts.observability: "full"``."""

    hash: str
    refs: list[str]
    variableHashes: dict[str, str]
    composed: str | None = None
    contentTrust: Literal["trusted", "untrusted"] | None = None


# ── RFC 0103 Localized content surface (spec/v1/localized-content.md) ─────
# Mirror schemas/localized-content-*.schema.json. Host-defined structured
# content (`data`, `localizations`, `seo`) stays open (dict[str, Any]) per the
# schemas (additionalProperties: true) — it is the host's content model.

LocalizedContentStatus = Literal["draft", "published"]


@dataclass(frozen=True)
class LocalizedContentPage:
    """A content page record (`schemas/localized-content-page.schema.json`)."""

    pageId: str
    slug: str
    name: str
    status: LocalizedContentStatus
    sectionOrder: list[str]
    seo: dict[str, Any] | None = None


@dataclass(frozen=True)
class LocalizedContentSection:
    """A content section record (`schemas/localized-content-section.schema.json`):
    a base ``data`` payload + a sparse ``localizations`` map (BCP-47 keys,
    never the base locale)."""

    sectionId: str
    sectionType: str
    data: dict[str, Any]
    localizations: dict[str, dict[str, Any]]
    status: LocalizedContentStatus
    enabled: bool
    order: int


@dataclass(frozen=True)
class LocalizedContentPageResponse:
    """Public delivery response for ``GET /v1/content/pages/{slug}`` — the
    negotiated locale's resolved page + sections (the RFC 0103 ``resolveSection``
    merge is applied host-side: exact → language-family → base)."""

    version: str
    generatedAt: str
    locale: str
    slug: str
    page: LocalizedContentPage
    sections: list[LocalizedContentSection]


@dataclass(frozen=True)
class LocalizedContentLanguageSettings:
    """Language settings
    (`schemas/localized-content-language-settings.schema.json`)."""

    baseLocale: str
    supportedLocales: list[str]
    autoTranslateOnPublish: bool


@dataclass(frozen=True)
class PutContentSectionRequest:
    """Body for ``PUT /v1/content/pages/{pageId}/sections/{sectionId}``. The
    baseLocale upserts ``data``; any other locale upserts
    ``localizations[locale]``."""

    locale: str
    data: dict[str, Any]


# ── RFC 0099 Trigger subscription registration (trigger-bridge.md §F) ─────


@dataclass(frozen=True)
class TriggerSubscriptionRegistration:
    """Registration body for ``POST /v1/trigger-subscriptions``
    (`schemas/trigger-subscription-registration.schema.json`)."""

    source: dict[str, Any]
    workflowId: str
    dedupEnabled: bool | None = None
    inputMapping: dict[str, Any] | None = None
    retryPolicy: dict[str, Any] | None = None
    verification: dict[str, Any] | None = None


@dataclass(frozen=True)
class CreateTriggerSubscriptionResponse:
    """``201`` response for ``POST /v1/trigger-subscriptions``. ``binding``
    carries the source-specific wiring the caller needs; the secret is returned
    ONCE at creation (SR-1) — persist it, it is not retrievable again."""

    subscription: dict[str, Any]
    binding: dict[str, Any]


# ── AI Envelope surface (spec/v1/ai-envelope.md) ──────────────────────────
# Inbound LLM-emission envelope + per-kind payloads. Mirrors the TypeScript
# SDK's envelope surface (previously TS-only; see sdk/PARITY.md). Distinct from
# RunEventDoc (outbound event log) and ErrorEnvelope (host HTTP error response).

EnvelopeStrictness = Literal["warn", "strict"]


@dataclass(frozen=True)
class EnvelopeMeta:
    """Wire metadata on every AI Envelope (`ai-envelope.md`)."""

    source: Literal["ai-generation", "user", "system"]
    ts: str  # ISO 8601 UTC
    # Mirrors RunEventDoc.contentTrust; hosts MUST set "untrusted" for MCP/A2A origin.
    contentTrust: Literal["trusted", "untrusted"] | None = None
    traceparent: str | None = None
    label: str | None = None


@dataclass(frozen=True)
class PartialInfo:
    """Present when an envelope is one fragment of a streamed emission."""

    isPartial: bool
    index: int
    total: int  # -1 when unknown (streaming without precount)


@dataclass(frozen=True)
class AIEnvelope:
    """Canonical inbound LLM-emission wire shape (`ai-envelope.md`). The payload
    shape is selected by ``type``; it is kept as ``Any`` here (the consumer
    narrows per kind, using the payload TypedDicts/dataclasses below)."""

    type: str
    envelopeId: str
    correlationId: str
    payload: Any
    meta: EnvelopeMeta
    schemaVersion: int | None = None
    nodeId: str | None = None
    partial: PartialInfo | None = None


@dataclass(frozen=True)
class EnvelopeContract:
    """Per-typeId envelope-kind permission set (`ai-envelope.md` §"Envelope Contract")."""

    accepts: list[str]
    refusalMode: Literal["fail-node", "discard-and-warn"]


@dataclass(frozen=True)
class EnvelopeContractRefusal:
    refusedType: str
    acceptedTypes: list[str]
    refusalMode: Literal["fail-node", "discard-and-warn"]


@dataclass(frozen=True)
class ValidationDetail:
    path: str
    message: str


@dataclass(frozen=True)
class EnvelopeOutcome:
    """Result of the engine's ``acceptEnvelope`` path. ``status`` discriminates
    which optional fields are set (mirrors the TS discriminated union)."""

    status: Literal["accepted", "gated", "invalid", "breached"]
    recordedEventIds: list[str] | None = None  # status == "accepted"
    reason: str | None = None  # gated / invalid / breached
    gate: EnvelopeContractRefusal | None = None  # status == "gated"
    details: list[ValidationDetail] | None = None  # status == "invalid"
    capKind: Literal["envelopes", "schema", "clarification"] | None = None  # breached


@dataclass(frozen=True)
class EnvelopeContractsCapability:
    """Optional capability advertisement (`ai-envelope.md`)."""

    advertised: bool


@dataclass(frozen=True)
class ClarificationRequestQuestion:
    id: str
    question: str
    schema: dict[str, Any] | None = None


@dataclass(frozen=True)
class ClarificationRequestPayload:
    """Payload of the universal ``clarification.request`` envelope kind."""

    questions: list[ClarificationRequestQuestion]
    contextType: str | None = None


@dataclass(frozen=True)
class SchemaRequestPayload:
    """Payload of the universal ``schema.request`` envelope kind."""

    envelopeType: str
    reason: str | None = None


@dataclass(frozen=True)
class SchemaResponsePayload:
    """Payload of the universal ``schema.response`` envelope kind (LLM ack)."""

    envelopeType: str
    ack: Literal[True] = True


@dataclass(frozen=True)
class AIEnvelopeErrorPayload:
    """Payload of the universal ``error`` envelope kind (the LLM's deliberate
    error report). Distinct from :class:`ErrorEnvelope` (host HTTP error)."""

    code: str
    message: str
    details: dict[str, Any] | None = None


@dataclass(frozen=True)
class A2UISurfacePayload:
    """Payload of the core ``ui.a2ui-surface`` envelope kind (RFC 0102). A
    declarative interactive UI a consumer renders with native widgets, routing
    user actions back WITHOUT executing agent-supplied code. ``catalogVersion``
    is a host-enumerated, growing set (currently "0.9.1"; a consumer MUST refuse
    an unknown/higher version with ``unknown_schema_version``) — typed ``str``
    for forward-compat. ``surface`` is the closed component tree, kept
    structural (rendered by a dedicated A2UI renderer the SDK does not ship)."""

    catalogVersion: str
    surface: dict[str, Any]
    reasoning: str | None = None


# ── RFC 0114 A2UI surface delta transport (a2ui-surface-delta-frame.schema.json) ─
# Host-side TRANSPORT frames — NOT a recorded run-event or envelope shape. A
# delta rides the run event stream ONLY to a subscriber that negotiated
# ?a2uiDelta=1; every other consumer receives the materialized full surface.
# No guard: these are stream frames, not RunEventDoc payloads.


# RFC 6902 uses the reserved word ``from`` as a key (source pointer for
# move/copy), so :class:`A2uiSurfacePatchOp` is declared via the functional
# TypedDict form. ``test`` is deliberately EXCLUDED from ``op`` by RFC 0114 (a
# fire-and-forget transport frame cannot act on a failed conditional);
# ``move``/``copy`` are permitted but OPTIONAL for a host to emit. Required:
# ``op``, ``path``. Optional: ``from``, ``value`` (for ``add``/``replace``).
A2uiSurfacePatchOp = TypedDict(
    "A2uiSurfacePatchOp",
    {
        "op": Literal["add", "remove", "replace", "move", "copy"],
        "path": str,
        "from": str,
        "value": Any,
    },
    total=False,
)
"""RFC 0114 — a single RFC 6902 (JSON-Patch) operation inside an
:class:`A2uiSurfaceDeltaFrame`."""


class A2uiSurfaceDeltaFrame(TypedDict, total=False):
    """RFC 0114 — a HOST-SIDE TRANSPORT frame carrying an RFC 6902 delta over a
    recorded ``ui.a2ui-surface`` envelope (:class:`A2UISurfacePayload`).
    Delivered ONLY over the run event stream to a subscriber that negotiated
    ``?a2uiDelta=1``; every other consumer (the event-log read, replay,
    ``:fork``, any non-negotiating subscriber) receives the materialized FULL
    surface. NOT a recorded-envelope shape — the recorded ``ui.a2ui-surface``
    payload is unchanged and always full. The consumer applies ``patch`` to the
    surface last delivered under ``surfaceRef``, re-validates against the closed
    ``catalogVersion`` catalog, and falls back fail-closed (host re-materializes
    the full surface) on any apply/validation failure. A host advertises support
    via ``capabilities.a2uiSurface.deltaTransport``. Required: ``surfaceRef``,
    ``catalogVersion``, ``patch``."""

    surfaceRef: str
    catalogVersion: str
    patch: list[A2uiSurfacePatchOp]
