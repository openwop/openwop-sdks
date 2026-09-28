# `openwop-client` 2.x Changelog

The 1.x line's history lives in [`sdk/python/CHANGELOG.md`](../python/CHANGELOG.md); this package is a new v2-ONLY major (tags `openwop-client/v2.Y.Z` tracking a published corpus tag) published from `sdk/python-v2/` (import name unchanged: `openwop_client`).

## [Unreleased]

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
