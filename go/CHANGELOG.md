# `openwopclient` Changelog

## [Unreleased]

- **RFC 0100/0105/0106/0108/0109/0110 — capability discovery types.** `Capabilities` gains `A2A` (`CapabilitiesA2A`, RFC 0100), `ConversationTurnModelProvenance` (RFC 0109), `ChannelPresence` (RFC 0110), and a typed `AIProviders` (`CapabilitiesAIProviders`) struct carrying the RFC 0108 `SelfHosted`, RFC 0105 `SpeechSynthesis`, and RFC 0106 `RealtimeVoice` (`CapabilitiesRealtimeVoice`) flags. JSON-tag driven (`json.Unmarshal`); pointer fields ⇒ nil when unadvertised. Read-only + additive. Host-side ctx.* voice methods are out of client-SDK scope.

## [1.3.1] — 2026-06-24 — resolvable module path (re-release of the 1.3.0 surface)

_Identical SDK surface to the (unpublished) 1.3.0 tag — this is a layout-only re-release. The `go/v1.3.0` tag was **unresolvable**: the module directory was `sdk/go/` while the declared path `github.com/openwop/openwop-sdks/go` + the `go/v*` tag scheme require `go.mod` at repo-root `/go/`, so `go get …/openwop-sdks/go@v1.3.0` failed with `missing …/go/go.mod`. The directory was moved to `/go/` (the public import path is unchanged); `go/v1.3.0` remains a tombstone (Go module versions are immutable). The Go SDK is therefore one patch ahead of the TypeScript/Python 1.3.0 release; the next coordinated release re-aligns the family.

## [1.3.0] — 2026-06-24 — RFC 0093/0094/0101 type surface (gRPC + multi-party + output-chunk + run-status parity)

_First release from the post-split `openwop-sdks` repo; the three SDK versions are re-aligned to `1.3.0` (TypeScript was `1.2.0`; Python + Go were `1.1.7` — the agent-platform surface content was already at parity, only the version numbers had drifted)._

- **RFC 0101 — multi-party group-conversation capability advertisement.** New `CapabilitiesMultiPartyConversation` struct (`Supported bool` / optional `MaxParticipants *int`) wired as the optional `Capabilities.MultiPartyConversation` pointer field. A host advertises support for N agents co-participating in one shared transcript; when `Supported` is true it honors the additive `participants` (`[]AgentRef`) roster on `conversation.opened` and the conditionally-required per-turn `speakerId` on `role:"agent"` conversation turns. Additive — nil ⇒ the single user + single driving agent shape of RFC 0005 remains. (The SDK does not model the `conversation.opened` payload or a conversation-turn type, so the capability struct is the full SDK surface for this RFC.)
- **RFC 0094 §B + parity — `"cancelling"` and `"waiting-external"` run statuses.** New constants `StatusWaitingExternal` (external-event waits, distinguished from HITL waits at the wire level — the TS SDK already had it; closes a cross-SDK parity gap) and `StatusCancelling` (RFC 0094 §B — the transitional state between a cancel request being accepted and the terminal `"cancelled"`). Both are classified as active (non-terminal): `ActiveRunStatuses` includes them and `IsTerminalRunStatus(...)` returns `false` for both. Additive — mirrors the canonical 10-member enum in `schemas/run-snapshot.schema.json`.
- **RFC 0094 §D — typed streaming-output-chunk payload.** New `OutputChunkPayload` struct mirroring `run-event-payloads.schema.json#$defs/outputChunk` (`NodeID`/`RunID`/`Chunk`/`IsLast` required; `Channel` + loosely-typed `Meta map[string]any` optional), plus the `IsOutputChunk(ev)` predicate and `UnmarshalOutputChunk(ev) (OutputChunkPayload, error)` extractor in `events.go`. The predicate accepts both discriminators (`output.chunk`, the persisted run-event type, and `ai.message.chunk`, the stream-mode `messages` SSE event name); the unmarshaler returns the `ErrNotMatchingEvent` sentinel on a discriminator mismatch, matching the `UnmarshalAgent*` family.
- **RFC 0093 — 8-kind interrupt vocabulary documented.** `InterruptByTokenInspection.Kind` stays an open `string` for forward-compat; its doc comment now enumerates the canonical 8 kinds from `suspend-request.schema.json` (adds the `"conversation.start"` / `"conversation.exchange"` / `"conversation.close"` Multi-Agent Shift Phase 4 interjections and the `"low-confidence"` Phase 1 confidence-escalation kind to the prior 4).
- **RFC 0094 §H — gRPC + request-body-cap capability advertisement.** New `CapabilitiesGRPC` struct (`Supported` / `Service` (`"openwop.v1.Engine"`) / `TLS` (`"required"` | `"optional"` | `"disabled"`) / optional `Endpoint`, per `capabilities.schema.json` + `grpc-transport.md`) wired as the optional `Capabilities.GRPC` pointer field; `CapabilitiesLimits` gains `MaxRequestBodyBytes *int` (maximum REST request body size in bytes; hosts that advertise it MUST enforce it). Additive — nil `GRPC` ⇒ the host exposes no gRPC transport.

## [1.0 — additions] — 2026-05-25 — `memory.written` typed event helper (RFC 0057)

- **New typed event helper.** `IsMemoryWritten(ev)` predicate + `UnmarshalMemoryWritten(ev) (MemoryWrittenPayload, error)` extractor + the `MemoryWrittenPayload` struct (`MemoryRef`/`MemoryID` required; `NodeID`/`AgentID`/`Tags` optional) for the content-free `memory.written` RunEvent. Joins the RFC 0024 `Agent*` event helpers in `events.go`.

## [1.0 — additions] — 2026-05-25 — feedback annotation helpers (RFC 0056)

- **Two new client methods.** `client.CreateAnnotation(ctx, runID, body, opts)` calls `POST /v1/runs/{id}/annotations` to record a non-blocking quality annotation; `client.ListAnnotations(ctx, runID)` calls `GET /v1/runs/{id}/annotations` and returns `(nil, nil)` when the host doesn't advertise `capabilities.feedback` (404/501), so callers branch on capability discovery without unwrapping the error envelope. New types: `Annotation`, `CreateAnnotationRequest`, `ListAnnotationsResponse`.

## [1.0 — additions] — 2026-05-19 — typed `agent.*` event helpers (RFC 0024)

- **New file** `events.go` exposing typed payload structs for the six `agent.*` event types — `AgentReasonedPayload`, `AgentReasoningDeltaPayload`, `AgentToolCalledPayload`, `AgentToolReturnedPayload`, `AgentHandoffPayload`, `AgentDecidedPayload` — mirroring the canonical `schemas/run-event-payloads.schema.json` $defs.
- **Six predicates** `IsAgentReasoned(ev)` / `IsAgentReasoningDelta(ev)` / `IsAgentToolCalled(ev)` / `IsAgentToolReturned(ev)` / `IsAgentHandoff(ev)` / `IsAgentDecided(ev)` — return `true` only when the `Type` discriminator matches AND the payload carries the required wire-contract fields with the right primitive types. `IsAgentReasoningDelta` accepts both `float64` (the default `json.Unmarshal` numeric type) and `int` for the `sequence` field; rejects negatives, non-integer floats, strings, `nil`, and booleans. Required-string-field checks confirm presence + `string` primitive type but do NOT enforce `minLength` (predicates classify wire shape; consumers wanting strict schema validation pin `schemas/run-event-payloads.schema.json` and run Ajv) — matches TS+Python predicate semantics on the same wire payload.
- **Six unmarshaler helpers** `UnmarshalAgent*(ev) (payload, error)` — return the typed payload on a match. Returns the sentinel `ErrNotMatchingEvent` (checkable via `errors.Is`) on a type-discriminator mismatch, or a wrapped JSON-decode error on payload corruption. Internally re-marshals + decodes to preserve forward-compat (unknown JSON keys are silently dropped by the decoder).
- **`ReasoningVerbosity` type** plus three exported constants (`ReasoningVerbosityOff` / `ReasoningVerbositySummary` / `ReasoningVerbosityFull`).
- 9 test functions in `events_test.go` covering true-positives (incl. empty-string `delta` per cross-SDK contract — schema declares no `minLength` on `delta`), true-negatives (bad sequence types incl. `true`/`false` boolean rejection, missing required fields, wrong field names for `agent.handoff`, non-map payloads, unknown event types), `Unmarshal*` error semantics (`ErrNotMatchingEvent` sentinel checkable via `errors.Is`), and a table-driven schema-mirror sanity test reading `schemas/run-event-payloads.schema.json`.
- `go vet` clean; `gofmt -l` clean for `events.go` + `events_test.go`. No new module deps.

## [1.0 — additions] — 2026-05-15 — pause/resume helpers

- **New run-control helpers.** `OpenwopClient.PauseRun(ctx, runID, body, opts)` calls `POST /v1/runs/{id}:pause`; `OpenwopClient.ResumeRun(ctx, runID, body, opts)` calls `POST /v1/runs/{id}:resume`. New types: `PauseRunRequest`, `PauseRunResponse`, `ResumeRunRequest`, `ResumeRunResponse`.

## [1.0 — additions] — 2026-05-12 — Phase B SDK helpers + pack-lockfile error codes

- **New methods for Phase B endpoints.** `OpenwopClient.BulkCancelRuns(ctx, body, opts)` calls `POST /v1/runs:bulk-cancel` per `rest-endpoints.md` (closes R1); `OpenwopClient.VerifyAuditLog(ctx, fromSeq, toSeq)` calls `GET /v1/audit/verify` per `auth-profiles.md` §`openwop-audit-log-integrity`. New types: `BulkCancelRunsRequest`, `BulkCancelRunsResponse`, `BulkCancelRunResult`, `AuditVerifyResult`, `AuditVerifyCheckpoint`, `AuditVerifyAnomaly`.
- **5 new pack-lockfile error constants** added to `HTTPErrorCodes` per `node-packs.md` §"Dependency resolution + lockfile": `HTTPErrorPackIntegrityMismatch`, `HTTPErrorPackSignatureInvalid`, `HTTPErrorPackPeerDependencyMissing`, `HTTPErrorPackLockfileIncomplete`, `HTTPErrorPackVersionNotFound`. `IsHTTPErrorCode()` returns true for all.

## [1.0 — additions] — 2026-05-12 — capability_required error code

- `HTTPErrorCapabilityRequired` constant added to `HTTPErrorCodes` slice per `spec/v1/capabilities.md` §"Unsupported capability — refusal contract" (Phase A close-out). Emitted by hosts that refuse a workflow referencing a capability-gated typeId (`core.conversationGate`, `core.orchestrator.supervisor`, `core.dispatch`) without the advertised gating capability. `IsHTTPErrorCode("capability_required")` returns true.

## [1.0] — 2026-04-27

Aligned with openwop spec v1 final. Pinned to v1.0 alongside the spec corpus tag and the TypeScript + Python reference SDKs.

### What's covered

- All 12 documented REST endpoints have a 1:1 SDK method (discovery, workflows, runs lifecycle, SSE + poll events, cancel, fork, interrupt resolve by run + by token).
- `Idempotency-Key` + `X-Dedup` supported on every mutation method via `MutationOptions{IdempotencyKey, Dedup}`.
- Canonical HTTP error-code helpers: `HTTPErrorCodes`, `HTTPError*` constants, and `IsHTTPErrorCode()` for REST/MCP `ErrorEnvelope.Error` branching.
- Channel-based SSE consumer (`StreamEvents`) accepts `StreamModes []StreamMode` (S4), accepts `BufferMs` query forwarding (S3), and transparently flattens `event: batch` arrays back into per-event channel sends. Buffered with 16 slots; backpressure on slow consumers.
- Trace-ID surfacing — `*WopError` captures W3C `Traceparent` from response headers and exposes `err.TraceID`; `err.Error()` auto-suffixes `(trace=<id>)` per `observability.md` §Trace context propagation.
- Zero external dependencies — pure stdlib Go (`net/http`, `encoding/json`, `bufio`).

### v1.x additions

- Webhook subscription helpers.
- Hosted registry publishing helpers.
- Application-level retry helpers.
- Builder-pattern API.
