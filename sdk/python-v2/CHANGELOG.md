# `openwop-client` 2.x Changelog

The 1.x line's history lives in [`sdk/python/CHANGELOG.md`](../python/CHANGELOG.md); this package is a new v2-ONLY major (release-candidate line, tags `openwop-client/v2.0.0-rc.N` tracking the corpus `v2.0.0-rc.N`) published from `sdk/python-v2/` (import name unchanged: `openwop_client`).

## [2.0.0rc1] — 2026-09-03 — the v2 client (corpus `v2.0.0-rc.0`; RFC 0168 §D SDK 2 expectations)

**Breaking — the wire (RFC 0172 §A, RFC 0171 §C.1):**

- Every path is an unversioned key on a bare origin. No `/v1` literal remains in the package.
- `OpenWOP-Version: <major>.0` on every request — REST and SSE, authenticated or not. New ctor kwarg `major` (default `2`, `SDK_PROTOCOL_MAJOR`); `client.protocol_version` reads the value sent.
- Header renames per `spec/v2/core/headers.md`: `X-Dedup` → `OpenWOP-Dedup`. Webhook deliveries are read from the `OpenWOP-*` family (`X-openwop-*` accepted through the overlap); the SDK-only `openwop-Webhook-*` names and the `v1=<hex>` value form are gone; an unrecognized `OpenWOP-Signature-Algorithm` is rejected (`unsupported_signature_algorithm`). `read_webhook_headers` returns a `WebhookHeaderRead` dataclass; `webhook_delivery_headers` is new.
- `runs_poll_events(after_sequence=)` replaces `last_sequence`; `PollEventsResponse` is the closed `{ runId, events, lastSequence, status, isTerminal }`.

**Breaking — types:**

- `Capabilities` is the closed v2 root: `protocolVersions` + `preferredVersion` required; `families: dict[str, CapabilityRecord]`. The 1.x `Capabilities*` sub-dataclasses are removed.
- `ErrorCode` (92-member `Literal`), `ERROR_CODES`, `ERROR_CODE_HTTP_STATUS`, `RETRIABLE_ERROR_CODES` are generated from `spec/v2/errors.json` (`_generated.py`); `HTTP_ERROR_CODES` is now that registry; `is_error_code`, `is_retriable_error_code`, `is_vendor_error_code` are new.
- `RunSnapshot` gains the required `owner` (`RunOwner`) and `eventLogSchemaVersion`; `RunEventDoc.schemaVersion` is required and `engineVersion` is an `int`. `RunConfigurable` is the closed nested `{ version: 1, run, ai, distillation, budget, extensions }`.

**Removed (not v2 operations):** `list_workspace_files` / `get_workspace_file` / `put_workspace_file` / `delete_workspace_file`, `runs_debug_bundle`, `RegistryClient`.

**Added:** `runs_compensation`, `runs_effects`, `host_effect_seams`, `host_events` / `stream_host_events` (RFC 0173 + the `hostEvents` channel); `CAPABILITY_FAMILY_KEYS` / `CAPABILITY_METADATA_KEYS`; `scripts/generate.py` (`--check` in the gate).
