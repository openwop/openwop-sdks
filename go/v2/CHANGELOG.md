# `openwopclient` v2 Changelog

The v1 module's history lives in [`go/CHANGELOG.md`](../CHANGELOG.md); this is a new v2-ONLY major module at `github.com/openwop/openwop-sdks/go/v2` (tags `go/v2.Y.Z`).

## [Unreleased] — corpus `v2.46.37`: the AI Envelope is deleted from v2 (RFC 0255)

- **BREAKING (type surface): the AI Envelope types are removed (RFC 0255).** RFC 0255 deleted the AI Envelope from the v2 protocol, so this v2-only module no longer declares `AIEnvelope`, `EnvelopeMeta`, `PartialInfo`, `EnvelopeContract`, `EnvelopeContractRefusal`, `EnvelopeOutcome`, `EnvelopeContractsCapability`, `ValidationDetail`, `ClarificationRequestQuestion`, `ClarificationRequestPayload`, `SchemaRequestPayload`, `SchemaResponsePayload`, `AIEnvelopeErrorPayload`, `A2UISurfacePayload`, `A2UISurfacePatchOp` or `A2UISurfaceDeltaFrame`. None of them crossed a client method. `PromptModelHints.EnvelopeType` is removed (deleted from `prompt-template.schema.json`). `ErrorCodes` and `CapabilityFamilyKeys` shrink as listed below.
- **Re-vendored on corpus `v2.46.37`** (was `v2.46.32`): `api/v2/openapi.yaml`, `api/v2/asyncapi.yaml`, `spec/v2/errors.json` and 11 `schemas/v2` files; `schemas/v2/interrupt-form.schema.json` is new; `schemas/v2/ai-envelope.schema.json`, `schemas/v2/envelopes/` (8 files) and `schemas/v2/a2ui-surface-delta-frame.schema.json` are removed, as the corpus removed them. The error-code registry loses `envelope_correlation_conflict`, `unknown_envelope_kind` and `unknown_schema_version` and gains `deployment_state_conflict` (RFC 0254), 124 codes in all; the capability-family registry loses `aiEnvelope`, `supportedEnvelopes`, `schemaVersions`, `envelopeStrictness`, `envelopeContracts`, `envelopes` and `a2uiSurface` (68 families; `a2uiSurface` was never a v2 root key, so it was not in this registry). `generated.go` regenerated. `CorpusVersion` becomes `2.46.37`, so `OpenWOP-Client-Version` now sends `2.46.37`. The RFC 0254 deployment changes (`AgentDeployment.transitionRunId`, the `202` gated and `409 deployment_state_conflict` transition answers) are vendored but not yet typed beyond the error code.

## [2.7.0] — 2026-10-26 — corpus `v2.46.32`: eval fixtures from a recorded run (RFC 0252), eval baseline selection (RFC 0251), proposals, connection providers, plugin frame + RPC

- **`CreateRun` recorded fixtures (RFC 0252).** `CreateRunRequest` gains `FixtureRuns map[string]string` (`omitempty`; `taskId` → source run id), sent at the body root. Only with `Mode` `"eval"`, and only to a host advertising `agents.evalSuite.recordedFixtures` (a client MUST NOT send it otherwise); an unusable source run is refused `400 validation_error`, identically whatever the reason. The host echoes the accepted map on `eval.started` `fixtureRuns`.
- **Re-vendored on corpus `v2.46.32`** (was `v2.46.28`): `api/v2/openapi.yaml` (createRun `fixtureRuns`), `api/v2/asyncapi.yaml`, `schemas/v2/capabilities.schema.json` (`agents.evalSuite.recordedFixtures`), `schemas/v2/run-event-payloads.schema.json` (`eval.started` `fixtureRuns`). No error code or capability family changes. `generated.go` regenerated; `CorpusVersion` becomes `2.46.32`. so `OpenWOP-Client-Version` now sends `2.46.32`.
- **`CreateRun` eval selection (RFC 0251 §B).** `CreateRunRequest` gains `EvalModes []EvalMode` and `BaselineRunID string` (`omitempty`), sent at the body root beside `EvalSuiteRef`. Only with `Mode` `"eval"`, and only to a host advertising `agents.evalSuite.baselineSelection` (§A: a client MUST NOT send either otherwise). `BaselineRunID` requires `EvalModeRegression` in `EvalModes`; an unusable baseline is refused `400 validation_error`, identically whatever the reason. New `EvalMode` type with `EvalModeGolden`, `EvalModeRubric`, `EvalModeAdversarial`, `EvalModeRegression`, `EvalModeLiveShadow`.
- **Proposals** (RFC 0249, gated on `agents.proposals`): `ListProposals`, `SubmitProposal`, `GetProposal`, `ReviseProposal`, `ArchiveProposal`, `ApplyProposal` (→ `ApplyProposalResult`: the applied `Proposal`, or `GateRunID` for an approval-gate run), `RejectProposal`.
- **Connection providers** (gated on `connections.providerRead`): `ListConnectionProviders`, `ResolveConnectionProvider(ctx, id, pack)`.
- **`EmitTestHostEvent`** — `POST /host/events/test` (RFC 0250).
- **`GetUiPluginFrame`** returns the frame HTML verbatim; **`DispatchUiPluginRequest`** runs one `ui-plugin/1` request (`UiPluginRequest` / `UiPluginResponse`). Gated on `uiPlugins.served`.
- Pinned by `corpus_2_46_operations_test.go`.
- **Re-vendored on corpus `v2.46.28`** (was `v2.45.10`): 29 drifted artifacts plus 8 new `schemas/v2` files (`proposal-submit`, `proposal-revise`, `proposal-apply`, `proposal-list-response`, `connection-provider-registry`, `host-event`, `artifact`, `webhook-verification`). `generated.go` regenerated: the error-code registry gains 6 codes (126 in all: `proposal_stale`, `proposal_state_conflict`, `proposal_install_conflict`, `host_event_resync_required`, `conversation_roster_exceeded`, `conversation_speaker_not_participant`); capability families gain `hostEvents` (74). ``CorpusVersion`` becomes `2.46.28`, so `OpenWOP-Client-Version` now sends `2.46.28`. The v2 manifest grows from 56 to 68 operations, each typed above.

## [2.6.0] — 2026-10-16 — corpus `v2.45.10`: resumable SSE streams (RFC 0247), trigger dead letters

- **Resumable SSE streams (RFC 0247).** `StreamEvents` and `StreamHostEvents` now send `resumable=true` and, when a stream ends before the run's terminal event (a host's bounded close, a platform or proxy timeout, a dropped connection), reconnect with `Last-Event-ID` set to the last `id:` received and keep sending on the same channel. New `ReconnectOptions` on both option structs; its zero value enables the loop. The host's `retry:` field sets the delay (default 1 s); failed or empty reconnects back off exponentially to 30 s and stop after 10 in a row; `429`/`502`/`503`/`504` are retried (honouring `Retry-After`), any other non-2xx stops the stream. `ReconnectOptions.OnError` receives the error that ended a reconnecting stream. A run-event `Sequence` at or below the last one sent is never re-sent. A resume on a terminal run that closes at once without a frame (events.md) closes the channel, as does a terminal `state.snapshot` in `values` mode. The first connect still returns its error synchronously. **Behaviour change:** the `StreamHostEvents` channel no longer closes when one connection does; call cleanup or cancel ctx, or set `Reconnect: ReconnectOptions{Disabled: true}` for the 2.5.0 single-connection behaviour (no query flag). Pinned by `sse_resume_test.go`.
- **`(*OpenwopClient).ListTriggerDeadLetters(ctx, subscriptionID, limit, cursor)`** — `GET /trigger-subscriptions/{subscriptionId}/dead-letters` (RFC 0232 §B, corpus 2.45.10+), gated on `triggerBridge.deadLetter`. Returns one `TriggerDeadLetterPage`, newest first; each `DeadLetteredTriggerDelivery` is content-free, with `attempt` (the dead-lettered `trigger.delivery-attempted` payload's fields) and, when the dead-lettering changed the subscription's state, `stateChange`. The subscription id travels projected (`identity.md` §5). Pinned by `v2_wire_test.go`.
- **Re-vendored on corpus `v2.45.10`** (was `v2.43.0`): 25 artifacts. `generated.go` regenerated: the error-code registry gains 12 codes (120 in all, among them `budget_exhausted`, `egress_denied`, `storage_limit_exceeded`, `service_unavailable`, `upstream_unavailable`); capability families are unchanged (73). `CorpusVersion` becomes `2.45.10`, so `OpenWOP-Client-Version` now sends `2.45.10`.

## [2.5.0] — 2026-09-28 — corpus `v2.43.0`: `OpenWOP-Client-Version` on every request (RFC 0219)

### Added

- **`OpenWOP-Client-Version` on every request** (RFC 0219) — the JSON request path and the SSE subscribe (`StreamEvents`, `StreamHostEvents`) send it next to `OpenWOP-Version`. The value is the **corpus release** the module is built against, derived from `CORPUS_TAG` by `scripts/generate.py` into the exported const `CorpusVersion` (`2.43.0`), never the module version; a pre-release tag yields `<major>.<minor>`. Read it with `ClientVersion()`; it is not configurable. `generate.py --check` fails when it drifts from `CORPUS_TAG`. Pinned by `client_version_test.go`.
- **Upgrade note for hosts serving browsers cross-origin.** A browser sends a CORS preflight for this new request header. A host whose `Access-Control-Allow-Headers` is an explicit list MUST add `OpenWOP-Client-Version` to it before its browser clients take this release. Otherwise every cross-origin request fails the preflight, as omitting `OpenWOP-Version` once did. Same-origin and server-side callers are unaffected.

## [2.4.0] — 2026-09-28 — corpus `v2.43.0`: `DELETE /content/pages/{pageId}`, projected tenant-bound ids

### Added

- **`DeleteContentPage(ctx, pageID)`** — `DELETE /content/pages/{pageId}` (admin, `content.write`; `localized-content.md` §D). Returns nil on `204` and a `*WopError` otherwise (`404` for an id absent in the caller's tenant). The segment is the page's `pageId`, not its slug. The module now covers all 55 manifest operations.
- **`ProjectID(id)` / `UnprojectID(wire)`** — the tenant-bound id wire form (`spec/v2/core/identity.md` §5): every UTF-8 byte outside `[A-Za-z0-9._-]` becomes `~` + two uppercase hex digits (`acme/r-9f3c` ↔ `acme~2Fr-9f3c`). `UnprojectID` accepts the projected and the percent form.
- **`RotateWebhookSecret`** and **`ListWebhookDeadLetters`** — RFC 0201 §E.18 and RFC 0188 §A.1, with `RotateWebhookSecretRequest` / `RotateWebhookSecretResponse` / `WebhookDeadLetterPage` / `DeadLetteredDelivery`.

### Changed

- **Corpus pin `v2.3.3` → `v2.43.0`** (`CORPUS_TAG`, via unpublished re-vendors at `v2.4.1`, `v2.37.0` and `v2.38.0`). `v2.43.0` brings `DELETE /content/pages/{pageId}` into `spec/v2/path-manifest.json` (55 operations), two error codes (`approval_rejected`, `replay_context_summary_unavailable`; 108 codes) and the `meaning` column in `spec/v2/errors.json`; v1 `unregisterWebhook` declares its required `tenantId` query parameter (`v2.38.0`), and `v2.37.0` was the first tag carrying `rotateWebhookSecret`.

### Fixed

- **`GetRun` / `ListRuns` failed to decode every conformant snapshot.** `RunOwner.Subject` was typed `string`, but `schemas/v2/run-snapshot.schema.json` makes `owner.subject` the RFC 0170 Subject object, so `json.Unmarshal` returned an error and the client surfaced it as `invalid_json`. Found by a live smoke against `examples/hosts/v2-reference`. `Subject` is now a struct (`Issuer`, `SubjectID`, `Tenant`, `Lane`, `Kind`, `KeyClass`, `Actor *Subject`). This changes the field's type; code that read it as a string never received a decodable value.
- **`AuditVerifyAnomaly` gains `Kind`, `Checkpoint` and `Detail`** (RFC 0218 §C, corpus 2.43.0). `Kind` is `""` when the host omits it, which means `chain-break`; `ExpectedPrevHash` / `ActualPrevHash` stay `string` (a JSON `null` at the genesis entry reads as `""`), so no existing field changes type.
- **Tenant-bound path segments are sent in the projected form.** Every `runID` / `subscriptionID` path segment (runs, interrupts-by-run, webhooks, `StreamEvents`) and `DiffRun`'s `against` query value travel as `acme~2Fr-9f3c` (identity.md §5 "Wire form"), where 2.3.0 sent `acme%2Fr-9f3c` via `url.PathEscape`. Hosts must accept both; an id that is already a wire form is decoded first and never double-escaped.

## [2.3.0] — 2026-09-17 — corpus `v2.3.3`

### Changed

- Re-published on corpus `v2.3.3` with the TypeScript package (one tag, three packages). Generated registries re-synced (`payload_unprojectable`, 98 codes). Typed event payloads land here in a later cut.

## [v2.2.0] — 2026-09-17 (tag `go/v2.2.0`) — corpus `v2.3.0`: RFC 0184–0186 vendored

- `CORPUS_TAG` `v2.1.0` → `v2.3.0`; vendored artifacts re-synced. No exported symbol added.

## [v2.1.0] — 2026-09-11 (tag `go/v2.1.0`) — `ListRuns` (RFC 0182) on corpus `v2.1.0`

**Added:** `ListRuns(ctx, ListRunsOptions{Limit, Cursor, WorkflowID, Status}) (*RunListResponse, error)` — `GET /runs` (RFC 0182): one page of the caller's runs as full `RunSnapshot`s, newest first, tenant-scoped with every `runId` bound; walk `NextCursor`; `(nil, nil)` on 404 (the `runList` family is not advertised); a cursor the host did not mint is `400 validation_error` and is returned as an error. New types `RunListResponse`, `ListRunsOptions`.

**Re-vendored** from corpus `v2.1.0`: `run-list-response.schema.json` added; manifest 52 operations (parity 52/52); `ErrorCodes` regenerated (94 → 97); capabilities schema gains `runList` and the 2.0.10 corrections. No breaking change.

## [v2.0.0] — 2026-09-10 (tag `go/v2.0.0`) — GA on the published corpus (`v2.0.8`)

No client-surface change from rc.1. The rc.1 vendored tree predated `v2.0.0`
and eight 2.0.x corpus patches; re-vendored from the corpus at `v2.0.8` (27
schemas added, 24 refreshed); `go vet` / `go test` clean; the v2 parity gate
passes 51/51 against the current `spec/v2/path-manifest.json`.

The tag is `go/v2.0.0`. Go derives a nested module's tag prefix from the
module path *minus* its major suffix — `…/go/v2` → `go/` — and reads the
source from the major subdirectory `go/v2/` because that is where `go.mod`
lives. This entry first said the opposite (`go/v2/v2.0.0`, "the workflow
rejects `go/v2.0.0` outright"): that tag was pushed on 2026-09-10 and
proxy.golang.org answered `unknown revision go/v2.0.0` — it resolved to no
module at all, while the publish job passed because its discoverability step
only echoed a warm-up hint. Corrected the same day; the workflow now polls the
proxy and rejects the `go/v2/*` form. The v1 module at
`github.com/openwop/openwop-sdks/go` is not retired; a caller on `/v1/…` keeps
it through the overlap.

## [v2.0.0-rc.1] — 2026-09-03 — the v2 client (corpus `v2.0.0-rc.1`; RFC 0168 §D SDK 2 expectations)

No Go tag was ever pushed for rc.1 (the remote carries none under `go/`); the
proxy served the module as an untagged pseudo-version at the time. `v2.0.0`
above is the first Go tag for this module.

**Breaking — the wire (RFC 0172 §A, RFC 0171 §C.1):**

- Every path is an unversioned key on a bare origin. No `/v1` literal remains in the module.
- `OpenWOP-Version: <Major>.0` on every request — REST and SSE, authenticated or not. New `OpenwopClient.Major` field (zero = `SDKProtocolMajor` = 2), `ProtocolVersion()`, `ProtocolVersionHeader(major)`.
- Header renames per `spec/v2/core/headers.md`: `X-Dedup` → `OpenWOP-Dedup`. Webhook deliveries are read from the `OpenWOP-*` family (`X-openwop-*` accepted through the overlap); the SDK-only `openwop-Webhook-*` names and the `v1=<hex>` value form are gone; an unrecognized `OpenWOP-Signature-Algorithm` is rejected (`VerifyReasonUnsupportedAlgorithm`). `ReadWebhookHeaders` now also returns the algorithm; `WebhookDeliveryHeaders` is new.
- `PollRunEventsOptions{AfterSequence}` replaces `LastSequence`; `PollEventsResponse` is the closed `{RunID, Events, LastSequence, Status, IsTerminal}`.

**Breaking — types:**

- `Capabilities` is the closed v2 root: `ProtocolVersions` + `PreferredVersion` required; `Families map[string]CapabilityRecord` decoded through a custom `UnmarshalJSON` keyed on the generated `CapabilityFamilyKeys`. The v1 `Capabilities*` sub-structs are removed.
- `ErrorCodes` (94), `ErrorCodeHTTPStatus`, `RetriableErrorCodes`, `IsErrorCode`, `IsRetriableErrorCode`, `IsVendorErrorCode` are generated from `spec/v2/errors.json` (`generated.go`); `HTTPErrorCodes` / `IsHTTPErrorCode` are the 1.x names for the same registry; the `HTTPError*` constants are gone.
- `RunSnapshot` gains the required `Owner` (`RunOwner`) and `EventLogSchemaVersion`; `RunEventDoc.SchemaVersion` is a required `int` and `EngineVersion` is `*int`. `RunConfigurable` is the closed nested `{Version, Run, AI, Distillation, Budget, Extensions}` (a zero `Version` marshals as 1).

**Removed (not v2 operations):** `ListWorkspaceFiles` / `GetWorkspaceFile` / `PutWorkspaceFile` / `DeleteWorkspaceFile`, `GetDebugBundle`, `RegistryClient`.

**Added:** `GetRunCompensation`, `GetRunEffects`, `GetEffectSeamManifest`, `StreamHostEvents` (RFC 0173 + the `hostEvents` channel); `CapabilityFamilyKeys` / `CapabilityMetadataKeys`; `scripts/generate.py` (`--check` in the gate).
