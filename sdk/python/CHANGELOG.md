# `openwop-client` Changelog

## [1.7.0] — 2026-09-02 — webhook helpers read the spec's headers (RFC 0165 §C.3)

_Python half of the three-SDK change (TypeScript 1.9.0, Python 1.7.0, Go v1.6.0). Additive — existing calls keep working; only the default emitted value changes shape._

- **Verification accepted a header value that appears in no spec file.** The helper required `v1=<hex>` and rejected the spec's `sha256=<hex>` (`webhooks.md` §"Headers") as `malformed_signature_header`, so a conformant host's delivery failed verification outright. Both forms are accepted now.
- **Signing emits the spec form** `sha256=<hex>`.
- **Header families are read in spec order** — `OpenWOP-*` (RFC 0165 §C.1), then `X-openwop-*`, then the legacy `openwop-Webhook-*` names — case-insensitively.


## [1.6.0] — 2026-08-16 — `RunSnapshot.compensation_status` (RFC 0151 §D) + version-stable ruff pin

_Lockstep with TypeScript `1.7.0`; Go unchanged at `1.5.0`. Additive + read-only; stdlib-only._

- **RFC 0151 §D / UQ3** — `CompensationStatus` literal (`none | pending | running | completed | partial | failed | manual`) and the OPTIONAL `RunSnapshot.compensation_status`, present iff the host advertises `capabilities.compensation`; kept separate from `RunStatus` (no `compensating` run status). Sourced from `schemas/run-snapshot.schema.json` (corpus #1007). Exported from the package root.
- **Tooling** — ruff pinned to a version-stable configuration so lint/format results do not drift with the developer's ruff release (#27).

## [1.5.0] — 2026-06-30 — RFC 0111–0120 client-surface parity with TypeScript

_Brings the Python SDK to parity with the TS client surface for the corpus RFC 0111–0120 cycle (spec `v1.2.0`). Additive + read-only; stdlib-only; `ruff check` clean._

- **Capability discovery** — `Capabilities` gains `memory` (RFC 0113 `injectionBudget`), `restTransport` (0115), `toolCatalog` (0112 `compactView`), `a2uiSurface` (0114 `deltaTransport`), `uiPlugins` (0117/0119; open-string `isolation` admits the vendor `x-host-*` form), and `dispatch` (0118 fan-out/join descriptors); `CapabilitiesAIProviders` gains `promptPrefixCache` (0116). Each parsed with the existing `_capabilities_from_dict` idiom.
- **Events** — `ContextSummarizedPayload` (0111 `context.summarized`), `DispatchFanOutPayload` / `DispatchJoinPayload` (0118 `core.dispatch.fanOut` / `.join`), each with an `is_*` guard + payload extractor.
- **Compact tools** — `CompactToolDescriptor` + `OpenwopClient.tools_list_compact()` (`GET /v1/tools?view=compact`, `None` on 404/501); the `A2uiSurfaceDeltaFrame` / `A2uiSurfacePatchOp` stream-frame types (0114).

RFC 0120 (`apiHosts`) has no client surface (registry-manifest-only). Ships in lockstep with Go `1.5.0` and the TS `1.6.1` clobber-restore fix.

## [1.4.1] — 2026-06-24 — AI-envelope surface parity (Python + Go)

- **AI-envelope surface parity.** Adds the full `ai-envelope.md` client surface that was previously TypeScript-only: `AIEnvelope`, `EnvelopeMeta`, `PartialInfo`, `EnvelopeContract`, `EnvelopeContractRefusal`, `ValidationDetail`, `EnvelopeOutcome` (status-tagged), `EnvelopeContractsCapability`, `EnvelopeStrictness`, and the per-kind payloads (`ClarificationRequestPayload`/`Question`, `SchemaRequestPayload`, `SchemaResponsePayload`, `AIEnvelopeErrorPayload`, `A2UISurfacePayload` — RFC 0102). Frozen dataclasses, re-exported from the package root; `AIEnvelope.payload` is `Any` (narrow per `type`). Closes the `PARITY.md` §"Known cross-SDK asymmetry". Additive.

## [1.4.0] — 2026-06-24 — RFC 0099–0110 client-surface catch-up (capabilities, voice/presence events, A2UI, content+trigger REST, approver routing)

_Re-aligns the three SDKs to a common `1.4.0` (TypeScript + Python were `1.3.0`; Go was `1.3.1` after its resolvable-path re-cut). Lands the RFC 0099–0110 client surface the corpus shipped in conformance `1.25.0 → 1.37.0`._

- **RFC 0104 — portable HITL approver-routing capability.** `Capabilities` gains `interrupt` (`CapabilitiesInterrupt` → `CapabilitiesApproverRouting` `{supported, refKinds?, audience?}`), parsed by `discovery_capabilities()` and re-exported. The advisory `approverGroupRefs`/`approverRoleRefs`/`audience` fields ride the SDK's opaque interrupt payload (interrupts stay untyped by convention) — no `ApprovalData` dataclass. Read-only + additive.

- **RFC 0099 + 0103 — typed REST helpers (content + trigger subscriptions).** New methods `content_list_pages()` / `content_get_page(slug, accept_language=...)` / `content_create_page(page)` / `content_put_section(page_id, section_id, body)` / `content_get_settings()` / `content_put_settings(settings)` (RFC 0103; reads return `None` on 404/501) and `create_trigger_subscription(registration)` (RFC 0099). New frozen dataclasses `LocalizedContent{Page,Section,PageResponse,LanguageSettings}` + `PutContentSectionRequest` + `TriggerSubscriptionRegistration`/`CreateTriggerSubscriptionResponse`, re-exported from the package root; host-defined `data`/`localizations`/`seo`/`source`/`binding` kept open (`dict[str, Any]`) per the schemas. Flips 7 ops `excluded` → `typed` (51/56).

- **RFC 0106/0110 — typed event helpers.** Adds the seven `voice.*` payload `TypedDict`s + `is_voice_*` predicates + `voice_*_payload` extractors, and `is_channel_presence` / `channel_presence_payload` (RFC 0110), joining the event-helper family in `openwop_client.events` (re-exported from the package root). `voice.transcript` requires `contentTrust="untrusted"` (`voice-transcript-untrusted`); numeric checks exclude `bool` (an `int` subclass). `channel.presence` is ephemeral — LIVE stream only, absent on replay/`:fork`.

- **RFC 0100/0105/0106/0108/0109/0110 — capability discovery types.** `Capabilities` gains `a2a` (`CapabilitiesA2A`, RFC 0100), `conversationTurnModelProvenance` (`CapabilitiesConversationTurnModelProvenance`, RFC 0109), `channelPresence` (`CapabilitiesChannelPresence`, RFC 0110), and a typed `aiProviders` (`CapabilitiesAIProviders`) block carrying the RFC 0108 `selfHosted`, RFC 0105 `speechSynthesis`, and RFC 0106 `realtimeVoice` (`CapabilitiesRealtimeVoice`) flags. All parsed by `discovery_capabilities()` and re-exported from the package root. Read-only + additive — absent blocks ⇒ `None`. Host-side `ctx.callTranscriber`/`ctx.callSpeechSynthesizer` (node-facing host methods) are out of client-SDK scope.

## [1.3.0] — 2026-06-24 — RFC 0093/0094/0101 type surface (gRPC + multi-party + output-chunk + run-status parity)

_First release from the post-split `openwop-sdks` repo; the three SDK versions are re-aligned to `1.3.0` (TypeScript was `1.2.0`; Python + Go were `1.1.7` — the agent-platform surface content was already at parity, only the version numbers had drifted)._

- **RFC 0101 — multi-party group-conversation capability advertisement.** New frozen dataclass `CapabilitiesMultiPartyConversation` (`supported: bool`, optional `maxParticipants: int | None`) wired as the optional `Capabilities.multiPartyConversation` field and parsed by `_capabilities_from_dict`; re-exported from the package root. A host advertises support for N agents co-participating in one shared transcript; when `supported` is true it honors the additive `participants` (AgentRef list) roster on `conversation.opened` and the conditionally-required per-turn `speakerId` on `role: 'agent'` conversation turns. Additive — absent ⇒ the single user + single driving agent shape of RFC 0005 remains. (The SDK does not model the `conversation.opened` payload or a conversation-turn type, so the capability dataclass is the full SDK surface for this RFC.)
- **RFC 0094 §B + parity — `"cancelling"` and `"waiting-external"` run statuses.** `RunStatus` gains `"waiting-external"` (external-event waits, distinguished from HITL waits at the wire level — the TS SDK already had it; closes a cross-SDK parity gap) and `"cancelling"` (RFC 0094 §B — the transitional state between a cancel request being accepted and the terminal `"cancelled"`). Both are classified as active (non-terminal): `ACTIVE_RUN_STATUSES` includes them and `is_terminal_run_status(...)` returns `False` for both. Additive — mirrors the canonical 10-member enum in `schemas/run-snapshot.schema.json`.
- **RFC 0094 §D — typed streaming-output-chunk payload.** New `OutputChunkPayload` `TypedDict` mirroring `run-event-payloads.schema.json#$defs/outputChunk` (`nodeId`/`runId`/`chunk`/`isLast` required; `channel` + loosely-typed `meta` optional), plus the `is_output_chunk(ev)` predicate and `output_chunk_payload(ev) -> OutputChunkPayload | None` extractor in `openwop_client.events`. The predicate accepts both discriminators (`output.chunk`, the persisted run-event type, and `ai.message.chunk`, the stream-mode `messages` SSE event name). All re-exported from the package root.
- **RFC 0093 — 8-kind interrupt union.** `InterruptByTokenInspection.kind` extends from 4 to the canonical 8 kinds in `suspend-request.schema.json`: adds `"conversation.start"` / `"conversation.exchange"` / `"conversation.close"` (Multi-Agent Shift Phase 4 multi-turn interjections) and `"low-confidence"` (Phase 1 confidence-escalation contract).
- **RFC 0094 §H — gRPC + request-body-cap capability advertisement.** New frozen dataclass `CapabilitiesGrpc` (`supported` / `service: "openwop.v1.Engine"` / `tls: "required" | "optional" | "disabled"` / optional `endpoint`, per `capabilities.schema.json` + `grpc-transport.md`) wired as the optional `Capabilities.grpc` field and parsed by `discovery_capabilities()`; `CapabilitiesLimits` gains `maxRequestBodyBytes` (maximum REST request body size in bytes; hosts that advertise it MUST enforce it). Additive — absent `grpc` ⇒ the host exposes no gRPC transport.

## [1.0 — additions] — 2026-05-25 — `memory.written` typed event helper (RFC 0057)

- **New typed event helper.** `is_memory_written(ev)` predicate + `memory_written_payload(ev) -> MemoryWrittenPayload | None` extractor + the `MemoryWrittenPayload` `TypedDict` (`memoryRef`/`memoryId` required; `nodeId`/`agentId`/`tags` optional) for the content-free `memory.written` RunEvent. Joins the RFC 0024 `agent_*` event helpers in `openwop_client.events`; re-exported from the package root.

## [1.0 — additions] — 2026-05-25 — feedback annotation helpers (RFC 0056)

- **Two new client methods.** `client.create_annotation(run_id, body, idempotency_key=...)` calls `POST /v1/runs/{id}/annotations` to record a non-blocking quality annotation; `client.list_annotations(run_id)` calls `GET /v1/runs/{id}/annotations` and returns `None` when the host doesn't advertise `capabilities.feedback` (404/501). New exported frozen dataclasses: `Annotation`, `CreateAnnotationRequest` (signal carried as `dict[str, Any]` to match the open `annotation.schema.json` signal shape).

## [1.0 — additions] — 2026-05-19 — typed `agent.*` event helpers (RFC 0024)

- **New module** `openwop_client.events` exposing six `TypedDict` payload classes — `AgentReasonedPayload`, `AgentReasoningDeltaPayload`, `AgentToolCalledPayload`, `AgentToolReturnedPayload`, `AgentHandoffPayload`, `AgentDecidedPayload` — mirroring the canonical `schemas/run-event-payloads.schema.json` $defs.
- **Six runtime predicates** `is_agent_reasoned(ev)` / `is_agent_reasoning_delta(ev)` / `is_agent_tool_called(ev)` / `is_agent_tool_returned(ev)` / `is_agent_handoff(ev)` / `is_agent_decided(ev)` — return `True` only when the `type` discriminator matches AND the payload carries the required wire-contract fields with correct primitive types. `is_agent_reasoning_delta` validates `sequence` is a non-negative integer (and rejects `bool` despite Python's `int` subclassing).
- **Six typed extractors** `agent_*_payload(ev)` — return the typed payload on a match, `None` on a miss. Convenience for the `if (p := agent_reasoning_delta_payload(ev)) is not None:` idiom.
- Re-exports for all 19 new public symbols under `openwop_client.__all__`.
- 19 unittest cases in `tests/test_events.py` covering true-positive / true-negative matrix (incl. `bool`-as-`int` sequence rejection — Python's `bool` subclasses `int`), extractor `None`-on-miss, unknown-event-type tolerance per `COMPATIBILITY.md §2.1`, and schema-mirror sanity (reads the canonical JSON schema and asserts required-field parity per $def).
- Stdlib-only (`typing` + `json` + `pathlib` for tests). No third-party deps.

## [1.0 — additions] — 2026-05-15 — pause/resume helpers

- **New run-control helpers.** `OpenwopClient.runs_pause(run_id, body=None, *, idempotency_key=None)` calls `POST /v1/runs/{id}:pause`; `OpenwopClient.runs_resume(run_id, body=None, *, idempotency_key=None)` calls `POST /v1/runs/{id}:resume`. New dataclasses exported: `PauseRunRequest`, `PauseRunResponse`, `ResumeRunRequest`, `ResumeRunResponse`.

## [1.0 — additions] — 2026-05-12 — Phase B SDK helpers + pack-lockfile error codes

- **New methods for Phase B endpoints.** `OpenwopClient.runs_bulk_cancel(body, *, idempotency_key=None)` calls `POST /v1/runs:bulk-cancel` per `rest-endpoints.md` (closes R1); `OpenwopClient.audit_verify(from_seq, to_seq)` calls `GET /v1/audit/verify` per `auth-profiles.md` §`openwop-audit-log-integrity`. New dataclasses exported: `BulkCancelRunsRequest`, `BulkCancelRunsResponse`, `BulkCancelRunResult`, `AuditVerifyResult`, `AuditVerifyCheckpoint`, `AuditVerifyAnomaly`.
- **5 new pack-lockfile error codes** added to `HTTP_ERROR_CODES` per `node-packs.md` §"Dependency resolution + lockfile": `pack_integrity_mismatch`, `pack_signature_invalid`, `pack_peer_dependency_missing`, `pack_lockfile_incomplete`, `pack_version_not_found`. `is_http_error_code()` returns True for all.

## [1.0 — additions] — 2026-05-12 — capability_required error code

- `HTTP_ERROR_CODES` gains `"capability_required"` per `spec/v1/capabilities.md` §"Unsupported capability — refusal contract" (Phase A close-out). Emitted by hosts that refuse a workflow referencing a capability-gated typeId (`core.conversationGate`, `core.orchestrator.supervisor`, `core.dispatch`) without the advertised gating capability. `is_http_error_code("capability_required")` returns True.

## [1.0] — 2026-04-27

Aligned with openwop spec v1 final. Pinned to v1.0 alongside the spec corpus tag and the TypeScript + Go reference SDKs.

### What's covered

- All 12 documented REST endpoints have a 1:1 SDK method (discovery, workflows, runs lifecycle, SSE + poll events, cancel, fork, interrupt resolve by run + by token).
- `Idempotency-Key` supported on every mutation method via the `idempotency_key=` keyword argument.
- Canonical HTTP error-code helpers: `HTTP_ERROR_CODES` and `is_http_error_code()` for REST/MCP `ErrorEnvelope.error` branching.
- Synchronous-generator SSE consumer accepts `stream_mode` as a single value or a sequence (S4), accepts `buffer_ms=` query forwarding (S3), and transparently flattens `event: batch` arrays back into per-event yields.
- Trace-ID surfacing — `WopError` captures W3C `traceparent` from response headers and exposes `error.trace_id`; `str(error)` auto-suffixes `(trace=<id>)` per `observability.md` §Trace context propagation.
- Zero runtime dependencies — pure Python stdlib (`urllib`, `email`, `json`).

### v1.x additions

- Async client (`AsyncOpenwopClient` via `httpx`).
- Webhook subscription helpers.
- Hosted registry publishing helpers.
- Application-level retry helpers.
