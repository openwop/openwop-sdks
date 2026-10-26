# `openwop-client` 2.x Changelog

The 1.x line's history lives in [`sdk/python/CHANGELOG.md`](../python/CHANGELOG.md); this package is a new v2-ONLY major (tags `openwop-client/v2.Y.Z` tracking a published corpus tag) published from `sdk/python-v2/` (import name unchanged: `openwop_client`).

## [Unreleased] — corpus `v2.46.32`: eval fixtures from a recorded run (RFC 0252), eval baseline selection (RFC 0251), proposals, connection providers, plugin frame + RPC

- **`runs_create` recorded fixtures (RFC 0252).** `CreateRunRequest` gains `fixtureRuns: dict[str, str] | None` (`taskId` → source run id), sent at the body root and omitted when `None`. Only with `mode="eval"`, and only to a host advertising `agents.evalSuite.recordedFixtures` (a client MUST NOT send it otherwise); an unusable source run is refused `400 validation_error`, identically whatever the reason. The host echoes the accepted map on `eval.started` `fixtureRuns`.
- **Re-vendored on corpus `v2.46.32`** (was `v2.46.28`): `api/v2/openapi.yaml` (createRun `fixtureRuns`), `api/v2/asyncapi.yaml`, `schemas/v2/capabilities.schema.json` (`agents.evalSuite.recordedFixtures`), `schemas/v2/run-event-payloads.schema.json` (`eval.started` `fixtureRuns`). No error code or capability family changes. `_generated.py` regenerated. `CORPUS_VERSION` becomes `2.46.32`, so `OpenWOP-Client-Version` now sends `2.46.32`.
- **`runs_create` eval selection (RFC 0251 §B).** `CreateRunRequest` gains `evalModes: list[EvalMode] | None` and `baselineRunId: str | None`, sent at the body root beside `evalSuiteRef` and omitted when `None`. Only with `mode="eval"`, and only to a host advertising `agents.evalSuite.baselineSelection` (§A: a client MUST NOT send either otherwise). `baselineRunId` requires `"regression"` in `evalModes`; an unusable baseline is refused `400 validation_error`, identically whatever the reason. New exported `EvalMode` Literal.
- **Proposals** (RFC 0249, gated on `agents.proposals`): `proposals_list(*, state, kind, limit, cursor)`, `proposals_submit(body, *, idempotency_key)`, `proposals_get(id)`, `proposals_revise(id, body)`, `proposals_archive(id)`, `proposals_apply(id, *, artifact_digest, idempotency_key)` (→ `Proposal`, or `ApplyProposalGateResponse` for an approval-gate run), `proposals_reject(id, *, reason)`.
- **Connection providers** (gated on `connections.providerRead`): `connection_providers_list()` → `ConnectionProviderRegistry`, `connection_providers_resolve(id, *, pack)` → `ConnectionProvider`.
- **`host_emit_test_event(delivery, *, workspace_id, idempotency_key)`** — `POST /host/events/test` (RFC 0250).
- **`host_ui_plugin_frame(pack_name, plugin_id)`** returns the frame HTML verbatim; **`host_dispatch_ui_plugin_request(pack_name, plugin_id, message)`** runs one `ui-plugin/1` request (`UiPluginRequest` / `UiPluginResponse`). Gated on `uiPlugins.served`.
- Pinned by `tests/test_corpus_2_46_operations.py`.
- **Re-vendored on corpus `v2.46.28`** (was `v2.45.10`): 29 drifted artifacts plus 8 new `schemas/v2` files (`proposal-submit`, `proposal-revise`, `proposal-apply`, `proposal-list-response`, `connection-provider-registry`, `host-event`, `artifact`, `webhook-verification`). `_generated.py` regenerated: the error-code registry gains 6 codes (126 in all: `proposal_stale`, `proposal_state_conflict`, `proposal_install_conflict`, `host_event_resync_required`, `conversation_roster_exceeded`, `conversation_speaker_not_participant`); capability families gain `hostEvents` (74). ``CORPUS_VERSION`` becomes `2.46.28`, so `OpenWOP-Client-Version` now sends `2.46.28`. The v2 manifest grows from 56 to 68 operations, each typed above.

## [2.6.0] — 2026-10-16 — corpus `v2.45.10`: resumable SSE streams (RFC 0247), trigger dead letters

- **Resumable SSE streams (RFC 0247).** `stream_events` / `client.runs_events` and `stream_host_events` / `client.host_events` now send `resumable=true` and, when a stream ends before the run's terminal event (a host's bounded close, a platform or proxy timeout, a dropped or timed-out connection), reconnect with `Last-Event-ID` set to the last `id:` received and keep yielding from the same generator. The host's `retry:` field sets the delay (default 1 s); failed or empty reconnects back off exponentially to 30 s and raise the last error after 10 in a row; `429`/`502`/`503`/`504` are retried (honouring `Retry-After`), any other `HTTPError` is raised. A run-event `sequence` at or below the last one yielded is never re-yielded. A resume on a terminal run that closes at once without a frame (events.md) ends the generator, as does a terminal `state.snapshot` in `values` mode. The first connect still fails fast. **Behaviour change:** `host_events()` no longer ends when one connection does; break out, or pass `reconnect=False`. `reconnect=False` restores the 2.5.0 single-connection behaviour (no query flag); `reconnect_delay_seconds`, `max_reconnect_delay_seconds` and `max_reconnect_attempts` tune it. Pinned by `tests/test_sse_resume.py`.
- **`client.trigger_dead_letters(subscription_id, *, limit=None, cursor=None)`** — `GET /trigger-subscriptions/{subscriptionId}/dead-letters` (RFC 0232 §B, corpus 2.45.10+), gated on `triggerBridge.deadLetter`. Returns one `TriggerDeadLetterPage`, newest first; each `DeadLetteredTriggerDelivery` is content-free, with `attempt` (the dead-lettered `trigger.delivery-attempted` payload's fields) and, when the dead-lettering changed the subscription's state, `stateChange`. The subscription id travels projected (`identity.md` §5). Pinned by `tests/test_v2_wire.py`.
- **Re-vendored on corpus `v2.45.10`** (was `v2.43.0`): 25 artifacts. `_generated.py` regenerated: the error-code registry gains 12 codes (120 in all, among them `budget_exhausted`, `egress_denied`, `storage_limit_exceeded`, `service_unavailable`, `upstream_unavailable`); capability families are unchanged (73). `CORPUS_VERSION` becomes `2.45.10`, so `OpenWOP-Client-Version` now sends `2.45.10`.

## [2.5.0] — 2026-09-28 — corpus `v2.43.0`: `OpenWOP-Client-Version` on every request (RFC 0219)

### Added

- **`OpenWOP-Client-Version` on every request** (RFC 0219) — the JSON request path and the SSE subscribe (`runs_events`, `host_events`, `stream_events`, `stream_host_events`) send it next to `OpenWOP-Version`. The value is the **corpus release** the SDK is built against, derived from `CORPUS_TAG` by `scripts/generate.py` into the exported `CORPUS_VERSION` (`2.43.0`), never the package version; a pre-release tag yields `<major>.<minor>`. Read it as `client.client_version`; it is not configurable. `generate.py --check` fails when it drifts from `CORPUS_TAG`. Pinned by `tests/test_client_version.py`.
- **Upgrade note for hosts serving browsers cross-origin.** A browser sends a CORS preflight for this new request header. A host whose `Access-Control-Allow-Headers` is an explicit list MUST add `OpenWOP-Client-Version` to it before its browser clients take this release. Otherwise every cross-origin request fails the preflight, as omitting `OpenWOP-Version` once did. Same-origin and server-side callers are unaffected.

## [2.4.0] — 2026-09-28 — corpus `v2.43.0`: `DELETE /content/pages/{pageId}`, projected tenant-bound ids

### Added

- **`content_delete_page(page_id)`** — `DELETE /content/pages/{pageId}` (admin, `content.write`; `localized-content.md` §D). Returns `None` on `204` and raises `WopError` otherwise (`404` for an id absent in the caller's tenant). The segment is the page's `pageId`, not its slug. The SDK now covers all 55 manifest operations.
- **`project_id(id)` / `unproject_id(wire)`** (`openwop_client.wire_id`, re-exported) — the tenant-bound id wire form (`spec/v2/core/identity.md` §5): every UTF-8 byte outside `[A-Za-z0-9._-]` becomes `~` + two uppercase hex digits (`acme/r-9f3c` ↔ `acme~2Fr-9f3c`). `unproject_id` accepts the projected and the percent form.
- **`webhooks_rotate_secret(subscription_id, body)`** and **`webhooks_dead_letters(subscription_id, *, limit=None, cursor=None)`** — RFC 0201 §E.18 and RFC 0188 §A.1, with `RotateWebhookSecretRequest` / `RotateWebhookSecretResponse` / `WebhookDeadLetterPage` / `DeadLetteredDelivery`.

### Changed

- **Corpus pin `v2.3.3` → `v2.43.0`** (`CORPUS_TAG`, via unpublished re-vendors at `v2.4.1`, `v2.37.0` and `v2.38.0`). `v2.43.0` brings `DELETE /content/pages/{pageId}` into `spec/v2/path-manifest.json` (55 operations), two error codes (`approval_rejected`, `replay_context_summary_unavailable`; 108 codes) and the `meaning` column in `spec/v2/errors.json`; v1 `unregisterWebhook` declares its required `tenantId` query parameter (`v2.38.0`), and `v2.37.0` was the first tag carrying `rotateWebhookSecret`.

### Fixed

- **`RunSnapshot.owner.subject` was the `str()` of a dict.** `owner.subject` is the RFC 0170 Subject object (`schemas/v2/subject.schema.json`); it is now parsed into the new `Subject` dataclass (`issuer`, `subjectId`, `tenant`, `lane`, `kind`, `keyClass`, `actor`). Pinned by `tests/test_run_owner.py`.
- **`audit_verify` raised `KeyError` on an RFC 0218 §C anomaly** (corpus 2.43.0) — a `merkle-mismatch`, `signature-invalid`, `hash-mismatch` or `missing-entry` entry carries no `expectedPrevHash`. `AuditVerifyAnomaly` gains `kind`, `checkpoint` and `detail`; `expectedPrevHash` / `actualPrevHash` are `str | None` (chain-break only; `None` at the genesis entry). Pinned by `tests/test_audit_anomalies.py`.
- **Tenant-bound path segments are sent in the projected form** (identity.md §5 "Wire form"): `run_id` and `subscription_id` travel as `acme~2Fr-9f3c`. Several methods — `runs_get`, `runs_cancel`, `runs_pause`, `runs_resume`, `runs_fork`, the annotation, ancestry and eval-summary reads, `interrupts_resolve_by_run` and `webhooks_unregister` — interpolated the id raw, so `acme/r-9f3c` became two path segments and could not route on any host. An id that is already a wire form is decoded first and never double-escaped.
- **Every other path parameter is escaped as one segment.** `workflows_get`, `content_get_page`, `content_put_section`, the `agents_*` reads, and the interrupt-token routes interpolated their ids raw; they now use `quote(…, safe='')`, as the rest of the client already did.

## [2.3.0] — 2026-09-17 — corpus `v2.3.3`

### Changed

- Re-published on corpus `v2.3.3` with the TypeScript package (one tag, three packages). Generated registries re-synced (`payload_unprojectable`, 98 codes). Typed event payloads land here in a later cut.

## [2.2.0] — 2026-09-17 — corpus `v2.3.0`: RFC 0184–0186 vendored

- `CORPUS_TAG` `v2.1.0` → `v2.3.0`; vendored artifacts re-synced. No wire method added; payload seats land in vendored schemas the client does not model as typed shapes (pre-existing gap, recorded).

## [2.1.0] — 2026-09-11 — `runs_list` (RFC 0182) on corpus `v2.1.0`

**Added:** `runs_list(*, limit=None, cursor=None, workflow_id=None, status=None) -> RunListResponse | None` — `GET /runs` (RFC 0182): one page of the caller's runs as full `RunSnapshot`s, newest first, tenant-scoped with every `runId` bound; walk `next_cursor`; `None` on 404 (the `runList` family is not advertised); a cursor the host did not mint is `400 validation_error` and raises. New dataclass `RunListResponse`.

**Re-vendored** from corpus `v2.1.0`: `run-list-response.schema.json` added; manifest 52 operations (parity 52/52); `ERROR_CODES` regenerated (94 → 97); capabilities schema gains `runList` and the 2.0.10 corrections. Stdlib-only, unchanged. No breaking change.

## [2.0.0] — 2026-09-10 — GA on the published corpus (`v2.0.8`)

No client-surface change from rc1. The rc1 vendored tree predated `v2.0.0`
and eight 2.0.x corpus patches; re-vendored from the corpus at `v2.0.8` (27
schemas added, 24 refreshed) and the v2 parity gate passes 51/51 against the
current `spec/v2/path-manifest.json`. Stdlib-only, unchanged.

`openwop-client<2` remains the correct pin for a caller on `/v1/…`, which
every host keeps serving through the overlap. A v2 caller should send
`OpenWOP-Version: 2` on every request — MAY on the wire, but absent it a
dual-stack host answers the v1 default.

## [2.0.0rc1] — 2026-09-03 — the v2 client (corpus `v2.0.0-rc.1`; RFC 0168 §D SDK 2 expectations)

**Breaking — the wire (RFC 0172 §A, RFC 0171 §C.1):**

- Every path is an unversioned key on a bare origin. No `/v1` literal remains in the package.
- `OpenWOP-Version: <major>.0` on every request — REST and SSE, authenticated or not. New ctor kwarg `major` (default `2`, `SDK_PROTOCOL_MAJOR`); `client.protocol_version` reads the value sent.
- Header renames per `spec/v2/core/headers.md`: `X-Dedup` → `OpenWOP-Dedup`. Webhook deliveries are read from the `OpenWOP-*` family (`X-openwop-*` accepted through the overlap); the SDK-only `openwop-Webhook-*` names and the `v1=<hex>` value form are gone; an unrecognized `OpenWOP-Signature-Algorithm` is rejected (`unsupported_signature_algorithm`). `read_webhook_headers` returns a `WebhookHeaderRead` dataclass; `webhook_delivery_headers` is new.
- `runs_poll_events(after_sequence=)` replaces `last_sequence`; `PollEventsResponse` is the closed `{ runId, events, lastSequence, status, isTerminal }`.

**Breaking — types:**

- `Capabilities` is the closed v2 root: `protocolVersions` + `preferredVersion` required; `families: dict[str, CapabilityRecord]`. The 1.x `Capabilities*` sub-dataclasses are removed.
- `ErrorCode` (94-member `Literal`), `ERROR_CODES`, `ERROR_CODE_HTTP_STATUS`, `RETRIABLE_ERROR_CODES` are generated from `spec/v2/errors.json` (`_generated.py`); `HTTP_ERROR_CODES` is now that registry; `is_error_code`, `is_retriable_error_code`, `is_vendor_error_code` are new.
- `RunSnapshot` gains the required `owner` (`RunOwner`) and `eventLogSchemaVersion`; `RunEventDoc.schemaVersion` is required and `engineVersion` is an `int`. `RunConfigurable` is the closed nested `{ version: 1, run, ai, distillation, budget, extensions }`.

**Removed (not v2 operations):** `list_workspace_files` / `get_workspace_file` / `put_workspace_file` / `delete_workspace_file`, `runs_debug_bundle`, `RegistryClient`.

**Added:** `runs_compensation`, `runs_effects`, `host_effect_seams`, `host_events` / `stream_host_events` (RFC 0173 + the `hostEvents` channel); `CAPABILITY_FAMILY_KEYS` / `CAPABILITY_METADATA_KEYS`; `scripts/generate.py` (`--check` in the gate).
