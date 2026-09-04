"""
Request/response types mirroring the OpenAPI 3.1 spec
(`api/v2/openapi.yaml`) and JSON Schemas
(`schemas/v2/`).

Hand-authored rather than codegen'd — see SDK README §rationale.
String-typed enums (Literal aliases) for fields whose spec'd values
may grow over time.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from ._generated import ERROR_CODES, RETRIABLE_ERROR_CODES, VENDOR_ERROR_CODE_PATTERN

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


# ── Discovery: the closed v2 root (capabilities.md; RFC 0169, 0172, 0176) ──

CapabilityStatus = Literal["stable", "experimental", "deprecated"]
"""Maturity of a capability record."""

WitnessClass = Literal[
    "witnessable-unaided",
    "witnessable-gated",
    "seam-gated",
    "claims-check",
    "negative-existence",
]
"""The five wire-legal witness classes (RFC 0168 §B)."""


@dataclass(frozen=True)
class CapabilityRecord:
    """One capability record (RFC 0169 §A). ``status``, ``since`` and ``witness``
    are REQUIRED; ``until`` is REQUIRED when ``status`` is ``experimental`` or
    ``deprecated``. ``supported`` does not exist — presence of the record is the
    claim. ``facets`` carries the family's remaining members verbatim."""

    status: CapabilityStatus
    since: str
    witness: WitnessClass
    until: str | None = None
    facets: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Capabilities:
    """The closed v2 discovery root (``schemas/v2/capabilities.schema.json``).
    ``protocolVersions`` and ``preferredVersion`` are REQUIRED (versioning.md
    §1.1); ``families`` maps each advertised family key
    (:data:`CAPABILITY_FAMILY_KEYS`) to its :class:`CapabilityRecord`; the
    remaining metadata keys (capabilities.md §3.1) are typed below and ``raw``
    keeps the document verbatim."""

    protocolVersions: list[str]
    preferredVersion: str
    families: dict[str, CapabilityRecord] = field(default_factory=dict)
    protocolVersion: str | None = None
    minClientVersion: str | None = None
    engineVersion: int | None = None
    eventLogSchemaVersion: int | None = None
    implementation: dict[str, Any] | None = None
    extensions: dict[str, Any] | None = None
    configurable: dict[str, Any] | None = None
    observability: dict[str, Any] | None = None
    runtimeCapabilities: dict[str, Any] | None = None
    testing: dict[str, Any] | None = None
    conformance: dict[str, Any] | None = None
    fixtures: dict[str, Any] | None = None
    compliance: dict[str, Any] | None = None
    discovery: dict[str, Any] | None = None
    raw: dict[str, Any] = field(default_factory=dict)

    def family(self, key: str) -> CapabilityRecord | None:
        """The record for ``key``, or None when the host does not advertise it."""
        return self.families.get(key)


# ── RunSnapshot ─────────────────────────────────────────────────────────

@dataclass(frozen=True)
class RunSnapshotError:
    code: str
    message: str
    details: dict[str, Any] | None = None


CompensationStatus = Literal[
    "none",
    "pending",
    "running",
    "completed",
    "partial",
    "failed",
    "manual",
]
"""RFC 0151 §D — the run's compensation (unwind) rollup on `RunSnapshot`.

Kept separate from ``RunStatus`` on purpose: ``status`` is the FORWARD
execution state and RFC 0151 forbids reinterpreting it. Capability-gated —
present iff the host advertises ``capabilities.compensation`` (``none`` when
idle). The value is the deterministic fold of the ``compensation.*`` events
defined in ``spec/v2/core/compensation.md`` §"Run rollup: compensationStatus".
"""


@dataclass(frozen=True)
class RunOwner:
    """``RunSnapshot.owner`` — closed; ``subject`` REQUIRED (identity.md)."""

    tenant: str
    subject: str
    workspace: str | None = None


@dataclass(frozen=True)
class RunSnapshot:
    """``schemas/v2/run-snapshot.schema.json`` (runs.md §Snapshot)."""

    runId: str
    workflowId: str
    status: RunStatus
    owner: RunOwner
    eventLogSchemaVersion: int
    compensationStatus: CompensationStatus | None = None
    currentNodeId: str | None = None
    startedAt: str | None = None
    completedAt: str | None = None
    nodeStates: dict[str, Any] | None = None
    variables: dict[str, Any] | None = None
    channels: dict[str, Any] | None = None
    error: RunSnapshotError | None = None
    engineVersion: int | None = None
    tags: list[str] | None = None
    metadata: dict[str, Any] | None = None
    configurable: dict[str, Any] | None = None
    agent: dict[str, Any] | None = None
    runOrchestrator: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    parentRunId: str | None = None
    parentNodeId: str | None = None
    interrupt: dict[str, Any] | None = None


# ── RunOptions / configurable ───────────────────────────────────────────

@dataclass
class RunConfigurable:
    """``schemas/v2/configurable.schema.json`` — closed, nested and versioned
    (RFC 0171 §D.1; runs.md §Run options). ``version`` is REQUIRED and is ``1``.
    Sections: ``run`` (recursionLimit, runTimeoutMs, maxLoopIterations,
    escalationThreshold), ``ai`` (provider, model, temperature, maxTokens,
    credentialRef, promptOverrides, mockProvider, reasoningVerbosity,
    maxRefusals), ``distillation`` (tokenBudget), ``budget`` (the budget policy),
    ``extensions`` (``<org>: {...}``). An unknown or dotted key is rejected with
    ``400 validation_error``."""

    run: dict[str, Any] | None = None
    ai: dict[str, Any] | None = None
    distillation: dict[str, Any] | None = None
    budget: dict[str, Any] | None = None
    extensions: dict[str, dict[str, Any]] | None = None
    version: int = 1

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"version": self.version}
        for key in ("run", "ai", "distillation", "budget", "extensions"):
            value = getattr(self, key)
            if value is not None:
                out[key] = value
        return out


# ── Run lifecycle requests/responses ────────────────────────────────────

@dataclass
class CreateRunRequest:
    """``POST /runs`` body — closed at the composition (runs.md §Create).
    ``workflowId`` is REQUIRED unless ``mode == "eval"`` (then ``evalSuiteRef``
    and ``agentId`` are)."""

    workflowId: str | None = None
    inputs: dict[str, Any] | None = None
    tenantId: str | None = None
    scopeId: str | None = None
    residency: dict[str, Any] | None = None
    callbackUrl: str | None = None
    mode: Literal["eval"] | None = None
    evalSuiteRef: str | None = None
    agentId: str | None = None
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


# spec/v2/core/webhooks.md — webhook subscription register / unregister.
@dataclass
class RegisterWebhookRequest:
    url: str
    events: list[str]
    secret: str | None = None
    tags: list[str] | None = None


@dataclass(frozen=True)
class RegisterWebhookResponse:
    """Response from POST /webhooks.

    The ``secret`` field is returned ONCE on registration — store it
    server-side for HMAC verification. The host cannot recover it.
    """

    subscriptionId: str
    url: str
    secret: str
    eventTypes: list[str]
    createdAt: str


# rest-endpoints.md §"POST /runs:bulk-cancel" (closes R1).
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


# ── RFC 0040 Phase 3 cross-host causation ───────────────────────────────


@dataclass(frozen=True)
class RunAncestryParent:
    runId: str
    hostId: str
    cause: Literal["mcp-tool-call", "a2a-message", "core.subWorkflow", "core.dispatch"]
    wellKnownUrl: str | None = None


@dataclass(frozen=True)
class RunAncestryResponse:
    """RFC 0040 §C response shape — `GET /runs/{runId}/ancestry`.

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
    schemaVersion: int
    nodeId: str | None = None
    engineVersion: int | None = None
    causationId: str | None = None


@dataclass(frozen=True)
class PollEventsResponse:
    """``GET /runs/{runId}/events/poll`` response (events.md §Poll) — closed.
    ``lastSequence`` is the highest sequence in the log at the time of the
    response (``-1`` when empty); feed it back as ``after_sequence``."""

    runId: str
    events: list[RunEventDoc]
    lastSequence: int
    status: RunStatus
    isTerminal: bool


@dataclass(frozen=True)
class HostEventDoc:
    """One frame of the ``hostEvents`` channel (``/host/events``) — content-free
    of run data. ``raw`` keeps the frame verbatim."""

    type: str
    payload: Any
    timestamp: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


# ── RFC 0173 — compensation, effect ledger, effect seams ──────────────────


@dataclass(frozen=True)
class CompensationPlanEntry:
    nodeId: str
    order: int
    policy: dict[str, Any] | None = None
    irreversibleEffect: bool | None = None


@dataclass(frozen=True)
class CompensationAttempt:
    nodeId: str
    attempt: int
    outcome: Literal["succeeded", "failed", "skipped", "manual"]
    at: str
    reason: str | None = None


@dataclass(frozen=True)
class CompensationProjection:
    """``GET /runs/{runId}/compensation`` (``compensation-projection.schema.json``)."""

    runId: str
    status: Literal[
        "none", "pending", "running", "completed", "partial", "failed", "manual-intervention"
    ]
    plan: list[CompensationPlanEntry]
    attempts: list[CompensationAttempt]


@dataclass(frozen=True)
class EffectLedgerEntry:
    effectId: str
    nodeId: str
    attempt: int
    keying: Literal["business-identity", "activity-recipe"]
    state: Literal["claimed", "completed", "released", "escaped"]
    at: str
    invocationId: str | None = None
    providerKey: str | None = None


@dataclass(frozen=True)
class EffectLedgerProjection:
    """``GET /runs/{runId}/effects`` (``effect-ledger-projection.schema.json``)."""

    runId: str
    effects: list[EffectLedgerEntry]


@dataclass(frozen=True)
class EffectSeam:
    seam: str
    kind: Literal["http", "queue", "storage", "provider-sdk", "webhook-fanout"]
    guarded: bool
    guardedBy: str
    branchReFires: bool | None = None
    note: str | None = None


@dataclass(frozen=True)
class EffectSeamManifest:
    """``GET /host/effect-seams`` (``effect-seam-manifest.schema.json``)."""

    manifestVersion: str
    host: dict[str, Any]
    seams: list[EffectSeam]


# ── Error envelope ──────────────────────────────────────────────────────

HTTP_ERROR_CODES: frozenset[str] = ERROR_CODES
"""The v2 error registry (``spec/v2/errors.json``); the 1.x name for
:data:`ERROR_CODES`."""


def is_error_code(value: object) -> bool:
    """Return True when ``value`` is a registered protocol error code."""

    return isinstance(value, str) and value in ERROR_CODES


def is_http_error_code(value: object) -> bool:
    """1.x name for :func:`is_error_code`."""

    return is_error_code(value)


def is_retriable_error_code(value: object) -> bool:
    """True for the registry rows marked ``retriable: true``; retry timing lives
    in ``Retry-After`` only (RFC 0171 §B.2)."""

    return isinstance(value, str) and value in RETRIABLE_ERROR_CODES


def is_vendor_error_code(value: object) -> bool:
    """True for a well-formed vendor code (``<org>.<name>``, ``openwop.``
    reserved); does not check org registration."""

    return isinstance(value, str) and VENDOR_ERROR_CODE_PATTERN.fullmatch(value) is not None

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
        "envelope_refusal",
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
    ``GET /agents`` / ``GET /agents/{agentId}``. Read-only — never carries
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
    """RFC 0054 — response from ``GET /runs/{runId}:diff?against={otherRunId}``
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
    ``GET /tools`` catalog (``tool-descriptor.schema.json``). Source-agnostic;
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
    returned by ``GET /tools?view=compact`` (envelope ``{tools: [...]}``) +
    ``GET /tools/{toolId}?view=compact`` when the host advertises
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
    """Response for ``GET /agents/roster`` (RFC 0086 §B,
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
    """Response for ``GET /agents/org-chart/{departmentId}`` (RFC 0087 §D,
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
    ``GET /prompts``."""

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


# ── RFC 0103 Localized content surface (spec/v2/core/localized-content.md) ─────
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
    """Public delivery response for ``GET /content/pages/{slug}`` — the
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
    """Body for ``PUT /content/pages/{pageId}/sections/{sectionId}``. The
    baseLocale upserts ``data``; any other locale upserts
    ``localizations[locale]``."""

    locale: str
    data: dict[str, Any]


# ── RFC 0099 Trigger subscription registration (trigger-bridge.md §F) ─────


@dataclass(frozen=True)
class TriggerSubscriptionRegistration:
    """Registration body for ``POST /trigger-subscriptions``
    (`schemas/trigger-subscription-registration.schema.json`)."""

    source: dict[str, Any]
    workflowId: str
    dedupEnabled: bool | None = None
    inputMapping: dict[str, Any] | None = None
    retryPolicy: dict[str, Any] | None = None
    verification: dict[str, Any] | None = None


@dataclass(frozen=True)
class CreateTriggerSubscriptionResponse:
    """``201`` response for ``POST /trigger-subscriptions``. ``binding``
    carries the source-specific wiring the caller needs; the secret is returned
    ONCE at creation (SR-1) — persist it, it is not retrievable again."""

    subscription: dict[str, Any]
    binding: dict[str, Any]


# ── AI Envelope surface (spec/v2/core/ai-envelope.md) ──────────────────────────
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
