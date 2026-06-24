# `@openwop/openwop` Changelog

## [Unreleased]

- **RFC 0104 — portable HITL approver-routing capability.** `Capabilities` gains the `interrupt.approverRouting` block (`{ supported, refKinds?: ('group'|'role')[], audience? }`) so a client can discover whether the host honors the advisory approver-routing fields. The advisory `approverGroupRefs`/`approverRoleRefs`/`audience` fields on the `kind:'approval'` interrupt payload ride the SDK's existing OPAQUE interrupt `data` (the SDK does not type interrupt payloads) — by deliberate convention, so no `ApprovalData` type is introduced. Read-only + additive.

- **RFC 0099 + 0103 — typed REST helpers (content + trigger subscriptions).** New `client.content` namespace — `listPages()` / `getPage(slug, acceptLanguage?)` / `createPage(body)` / `putSection(pageId, sectionId, body)` / `getSettings()` / `putSettings(body)` (RFC 0103 localized content; `getPage` passes `Accept-Language`, reads return `null` on 404/501) — and `client.triggerSubscriptions.create(body)` (RFC 0099; the binding secret is returned once, SR-1). New types `LocalizedContent{Page,Section,PageResponse,LanguageSettings}` + `PutContentSectionRequest` + `TriggerSubscriptionRegistration`/`CreateTriggerSubscriptionResponse` — host-defined `data`/`localizations`/`seo`/`source`/`binding` kept structural per the schemas (`additionalProperties: true`). Flips these 7 ops from `excluded` to `typed` in the parity gate (51/56 typed). The 8th re-vendored op `getA2ATaskState` stays excluded (host-sample seam).

- **RFC 0102 — A2UI surface envelope payload type.** Adds `A2UISurfacePayload` (the `ui.a2ui-surface` core envelope kind) to the AI-envelope payload set: `{ catalogVersion: string, surface: Record<string, unknown>, reasoning?: string }`. `catalogVersion` is typed `string` (forward-compat for the growing host-enumerated set, currently `0.9.1`; the consumer refuses unknown versions at runtime); `surface` is the closed component tree, kept structural (rendered by a dedicated A2UI renderer the SDK does not ship). **TypeScript-only:** the broader AI-envelope surface (`AIEnvelope`/`EnvelopeMeta`/universal payloads) is modeled only in the TS SDK today; Python/Go AI-envelope modeling is a tracked follow-on (see PARITY.md), not part of RFC 0102.

- **RFC 0106/0110 — typed event helpers.** Adds the seven `voice.*` run-event payload types + type guards (`isVoiceSpeechStart`, `isVoiceTranscript`, `isVoiceEndpointCandidate`, `isVoiceTurnCommit`, `isVoiceSynthesisChunk`, `isVoiceBargeIn`, `isVoiceCancelled`) and `isChannelPresence` (RFC 0110), joining the `isXxx` event-helper family. `voice.transcript` surfaces the REQUIRED `contentTrust: 'untrusted'` marker (`voice-transcript-untrusted` — never promote live transcript to higher authority); `channel.presence` is ephemeral — observable on the LIVE stream only, ABSENT on replay/`:fork`.

- **RFC 0100/0105/0106/0108/0109/0110 — capability discovery types.** `Capabilities` gains the `a2a` (RFC 0100: `{supported, agentCardUrl, streaming?, pushNotifications?, durableTasks?}`), `conversationTurnModelProvenance` (RFC 0109), and `channelPresence` (RFC 0110) advertisement blocks, plus a now-wired typed `aiProviders` block carrying the RFC 0108 `selfHosted[]`, RFC 0105 `speechSynthesis`, and RFC 0106 `realtimeVoice` flags (added to the previously-orphan `AIProvidersCapability` interface, whose `supported`/`byok` are now optional to match the schema). Read-only + additive — absent blocks ⇒ the host advertises none of these. Host-side `ctx.callTranscriber`/`ctx.callSpeechSynthesizer` are out of client-SDK scope.

## [1.3.0] — 2026-06-24 — RFC 0093/0094/0101 type surface (gRPC + multi-party + output-chunk + run-status parity)

_First release from the post-split `openwop-sdks` repo; the three SDK versions are re-aligned to `1.3.0` (TypeScript was `1.2.0`; Python + Go were `1.1.7` — the agent-platform surface content was already at parity, only the version numbers had drifted)._

- **RFC 0101 — multi-party group-conversation capability advertisement.** `Capabilities` gains the optional `multiPartyConversation` block (`{supported: boolean, maxParticipants?: number}`) by which a host advertises support for N agents co-participating in one shared transcript. When `supported: true`, the host honors the additive `participants: AgentRef[]` roster on `conversation.opened` and the conditionally-required per-turn `speakerId` on `role: 'agent'` conversation turns. Additive — absent ⇒ the single user + single driving agent shape of RFC 0005 remains. (The SDK does not model the `conversation.opened` payload or a `ConversationTurn` type, so the capability block is the full SDK surface for this RFC.)
- **RFC 0094 §B — `'cancelling'` run status.** `RunStatus` gains `'cancelling'`, the transitional state between a cancel request being accepted and the terminal `'cancelled'` (a snapshot read during the cancel cascade carries it). It is classified as active (non-terminal): `ACTIVE_RUN_STATUSES` includes it and `isTerminalRunStatus('cancelling')` returns `false`. Additive — mirrors the canonical 10-member enum in the re-vendored `schemas/run-snapshot.schema.json`.
- **RFC 0094 §D — typed streaming-output-chunk payload.** New `OutputChunkPayload` interface mirroring `run-event-payloads.schema.json#$defs/outputChunk` (`nodeId`/`runId`/`chunk`/`isLast` required; `channel` + loosely-typed `meta` optional) plus the `isOutputChunk(ev)` type guard in `event-helpers.ts`, which narrows to `TypedRunEvent<OutputChunkPayload>` and accepts both discriminators (`output.chunk`, the persisted run-event type, and `ai.message.chunk`, the stream-mode `messages` SSE event name). Both exported from the package root.
- **RFC 0093 — 8-kind interrupt union.** `InterruptByTokenInspection.kind` extends from 4 to the canonical 8 kinds in `suspend-request.schema.json`: adds `'conversation.start'` / `'conversation.exchange'` / `'conversation.close'` (Multi-Agent Shift Phase 4 multi-turn interjections) and `'low-confidence'` (Phase 1 confidence-escalation contract).
- **RFC 0094 §H — gRPC + request-body-cap capability advertisement.** `Capabilities` gains the optional `grpc` block (`{supported, endpoint?, service: 'openwop.v1.Engine', tls: 'required' | 'optional' | 'disabled'}` per the re-vendored `capabilities.schema.json` / `grpc-transport.md`) and `limits.maxRequestBodyBytes?` (maximum REST request body size in bytes; hosts that advertise it MUST enforce it). Additive — absent `grpc` ⇒ the host exposes no gRPC transport.
- **`waiting-external` is now classified as an active (non-terminal) run status.** `ACTIVE_RUN_STATUSES` (and therefore `isActiveRunStatus`) now includes `'waiting-external'`, and `isTerminalRunStatus('waiting-external')` now returns `false`. This aligns the helpers with the canonical `RunStatus` enum in `schemas/run-snapshot.schema.json` (10 members as of RFC 0094) — a run awaiting an external event MAY still transition, so it is not terminal. Previously the helper set omitted it, so it was misclassified as terminal-unknown. Behavior change for consumers that branch on `isTerminalRunStatus` / `isActiveRunStatus` (e.g. polling loops). No wire-shape change.
- **`client.prompts.get` now returns `PromptTemplate | null`** (was `PromptTemplate`). It resolves to `null` on `404` — consistent with the other get-by-id helpers (`agents.get`, `tools.get`, …) and the Python/Go SDKs — while a `400 prompt_ref_ambiguous` and other errors still throw, so callers can distinguish "not found" from "ambiguous reference." Minor source-compatibility note for TypeScript consumers: a null-check may now be required at the call site.

## [1.1.6] — 2026-05-31 — catch-up republish: agent-platform SDK surface

Republishes the package to bring the npm artifact in line with the agent-platform additions merged to the SDK source since the prior publish (`1.1.5` on npm predates them). All additive — no existing method or type changed; zero new runtime dependencies.

- **User-authored agents (RFC 0072 §A, #314).** New `client.userAgents` namespace wrapping the sample-app host extension: `create()` / `delete()` / pack-registry helpers. New exported types `UserAgentRecord`, `AgentPackSummary`, `CreateUserAgentRequest`. (The published `1.1.5` already carried the `client.agents` inventory surface + `AgentInventoryEntry` from RFC 0072 — this adds the user-authored side.)
- **Agent deployment lifecycle (RFC 0081/0082, #364).** New `client.agents.listDeployments()` + deployment-channel read helpers; new types for the deployment/channel + evaluation/scorecard surface mirroring the OpenAPI additions.
- **Standing roster + org-chart reads (RFC 0086/0087, #382).** New `client.agents.listRoster()` / `getRosterEntry()` / `getOrgChart()` / `getOrgChartDepartment()` (each returns `null` on 404 for capability-absent hosts). New exported types `AgentRosterEntry`, `AgentRosterResponse`, `AgentOrgChart`, `OrgChartDepartment`, `OrgChartMember`, `OrgChartResponsibilityView`.

## [1.0 — additions] — 2026-05-25 — `memory.written` typed event helper (RFC 0057)

- **New typed event helper.** `isMemoryWritten(ev)` type-guard (narrows to `TypedRunEvent<MemoryWrittenPayload>`) + the `MemoryWrittenPayload` interface (`memoryRef`/`memoryId` required; `nodeId`/`agentId`/`tags` optional) for the content-free `memory.written` RunEvent. Joins the RFC 0024 `agent.*` event-helper family in `event-helpers.ts`; exported from the package root.

## [1.0 — additions] — 2026-05-25 — feedback annotation helpers (RFC 0056)

- **Two new run helpers.** `client.runs.createAnnotation(runId, body, opts?)` calls `POST /v1/runs/{id}/annotations` to record a non-blocking quality annotation; `client.runs.listAnnotations(runId)` calls `GET /v1/runs/{id}/annotations` and returns `null` when the host doesn't advertise `capabilities.feedback` (404/501), so callers branch on capability discovery without unwrapping the error envelope. New exported types: `Annotation`, `AnnotationSignal`, `CreateAnnotationRequest`.

## [1.0 — additions] — 2026-05-19 — typed `agent.*` event helpers (RFC 0024)

- **New typed payload interfaces** for the `agent.*` event family in `src/types.ts`: `AgentReasonedPayload`, `AgentReasoningDeltaPayload`, `AgentToolCalledPayload`, `AgentToolReturnedPayload`, `AgentHandoffPayload`, `AgentDecidedPayload`. Each mirrors the corresponding `schemas/run-event-payloads.schema.json` $def exactly. Plus a `TypedRunEvent<T>` generic that pairs a narrowed `RunEventDoc` with a known payload shape.
- **Six type-guard predicates** in `src/event-helpers.ts`: `isAgentReasoned(ev)` / `isAgentReasoningDelta(ev)` / `isAgentToolCalled(ev)` / `isAgentToolReturned(ev)` / `isAgentHandoff(ev)` / `isAgentDecided(ev)`. Each verifies the `type` discriminator AND that required payload fields are present with the correct primitive types; returns `false` (no throw) for malformed or unknown events. Narrows the input via TypeScript's `ev is TypedRunEvent<…>` predicate so the guarded branch gets compile-time-typed payload access.
- **High-level streaming-reasoning helper** `subscribeToAgentReasoning(ctx, runId, callbacks)` that wraps `streamEvents()` and fans out `agent.reasoning.delta` + `agent.reasoned` into typed `onDelta` / `onClosed` callbacks. Callback exceptions surface via `onError` without tearing down the stream; cleanup via the returned `Unsubscribe` thunk aborts the underlying fetch.
- **Capability flag** `capabilities.agents.reasoning.streaming?: boolean` added to `AgentsCapability` (per RFC 0024). Hosts that omit it advertise the existing non-streaming contract.
- 22 unit tests under `src/__tests__/event-helpers.test.ts` covering: true-positive narrowing across all six predicates; true-negative rejections (missing fields, wrong types, malformed payloads, unknown event types); a schema-mirror sanity test that reads the canonical `run-event-payloads.schema.json` and asserts required-field parity per $def; and 6 behavioral tests for `subscribeToAgentReasoning` (arrival-order delta dispatch, single `onClosed` per closed block, handler-exception isolation so one throwing `onDelta` doesn't tear down the stream, `stop()` idempotency, cancellation-vs-error discrimination, and the `streamMode: 'updates'` default per `stream-modes.md`).
- `RunEventDoc.type` stays open `string` — forward-compat per `COMPATIBILITY.md §2.1`.

## [1.0 — additions] — 2026-05-15 — pause/resume helpers

- **New run-control helpers.** `client.runs.pause(runId, body?, opts?)` calls `POST /v1/runs/{id}:pause`; `client.runs.resume(runId, body?, opts?)` calls `POST /v1/runs/{id}:resume`. New exported types: `PauseRunRequest`, `PauseRunResponse`, `ResumeRunRequest`, `ResumeRunResponse`.

## [1.0 — additions] — 2026-05-12 — Phase B SDK helpers + pack-lockfile error codes

- **New helpers for Phase B endpoints.** `client.runs.bulkCancel(body, opts?)` calls `POST /v1/runs:bulk-cancel` per `rest-endpoints.md` (closes R1); `client.audit.verify(fromSeq, toSeq)` calls `GET /v1/audit/verify` per `auth-profiles.md` §`openwop-audit-log-integrity`. New types exported: `BulkCancelRunsRequest`, `BulkCancelRunsResponse`, `BulkCancelRunResult`, `AuditVerifyResult`, `AuditVerifyCheckpoint`, `AuditVerifyAnomaly`.
- **5 new pack-lockfile error codes** added to `HTTP_ERROR_CODES` per `node-packs.md` §"Dependency resolution + lockfile": `pack_integrity_mismatch`, `pack_signature_invalid`, `pack_peer_dependency_missing`, `pack_lockfile_incomplete`, `pack_version_not_found`. `isHttpErrorCode()` narrows correctly.

## [1.0 — additions] — 2026-05-12 — capability_required error code

- `HTTP_ERROR_CODES` gains `'capability_required'` per `spec/v1/capabilities.md` §"Unsupported capability — refusal contract" (Phase A close-out). Emitted by hosts that refuse a workflow referencing a capability-gated typeId (`core.conversationGate`, `core.orchestrator.supervisor`, `core.dispatch`) without the advertised gating capability. `isHttpErrorCode('capability_required')` narrows correctly.

## [1.0] — 2026-04-27

Aligned with openwop spec v1 final. Pinned to v1.0 alongside the spec corpus tag and the Python + Go reference SDKs.

### What's covered

- All 12 documented REST endpoints have a 1:1 SDK method (discovery, workflows, runs lifecycle, SSE + poll events, cancel, fork, interrupt resolve by run + by token).
- `Idempotency-Key` supported on every mutation method via the `idempotencyKey` option.
- Canonical HTTP error-code helpers: `HTTP_ERROR_CODES`, `HttpErrorCode`, and `isHttpErrorCode()` for REST/MCP `ErrorEnvelope.error` branching. `RUN_ERROR_CODES` remains scoped to `RunSnapshot.error.code`.
- Typed `RunConfigurable` surface with reserved keys (`recursionLimit`, `model`, `temperature`, `maxTokens`, `promptOverrides`) plus pass-through for impl extensions.
- SSE consumer accepts `streamMode` as a single value or an array (S4), accepts `bufferMs` query forwarding (S3), and transparently flattens `event: batch` arrays back into per-event yields so existing consumers don't change.
- Trace-ID surfacing — `WopError` captures W3C `traceparent` from response headers and exposes `error.traceId`; `error.toString()` auto-suffixes `(trace=<id>)` per `observability.md` §Trace context propagation.
- Zero runtime dependencies. Hand-authored to mirror the OpenAPI surface 1:1 (rationale in README §rationale).

### v1.x additions

- Webhook subscription helpers.
- Hosted registry publishing helpers.
- Application-level retry helpers.
- Dedicated browser entrypoint (`@openwop/openwop/browser`).
