# `@openwop/openwop` 2.x Changelog

The 1.x line's history lives in [`sdk/typescript/CHANGELOG.md`](../typescript/CHANGELOG.md); this package is a new v2-ONLY major published from `sdk/typescript-v2/`.

## [2.0.0] — 2026-09-03 — the v2 client (corpus `v2.0.0-rc.0`; RFC 0168 §D SDK 2 expectations)

**Breaking — the wire (RFC 0172 §A, RFC 0171 §C.1):**

- Every path is an unversioned key on a bare origin (`/runs`, `/.well-known/openwop`, …). No `/v1` literal remains in the package.
- `OpenWOP-Version: <major>.0` is sent on every request — REST and SSE, authenticated or not. New ctor option `major` (default `2`, exported as `SDK_PROTOCOL_MAJOR`); `client.protocolVersion` reads the value sent.
- Header renames per `spec/v2/core/headers.md`: `X-Dedup` → `OpenWOP-Dedup`. Webhook deliveries are read from the `OpenWOP-*` family (the `X-openwop-*` twins are accepted through the overlap); the SDK-only `openwop-Webhook-*` names and the `v1=<hex>` value form are gone, and an unrecognized `OpenWOP-Signature-Algorithm` is rejected (`unsupported_signature_algorithm`).
- `runs.pollEvents({ afterSequence })` replaces `lastSequence`; `PollEventsResponse` is the closed `{ runId, events, lastSequence, status, isTerminal }` (events.md §Poll).

**Breaking — types:**

- `Capabilities` is the closed v2 root: `protocolVersions[]` + `preferredVersion` REQUIRED; every family key carries a `CapabilityRecord` `{ status, since, until?, witness, …facets }`. The 1.x `*Capability` shapes with `supported: boolean` are removed.
- `ErrorEnvelope.error` is `ErrorCode | VendorErrorCode`; `ErrorCode` is the 92-member union generated from `spec/v2/errors.json`. `HTTP_ERROR_CODES` is now that registry; `isErrorCode`, `isRetriableErrorCode`, `isVendorErrorCode`, `ERROR_CODE_HTTP_STATUS`, `RETRIABLE_ERROR_CODES` are new.
- `RunSnapshot` gains the REQUIRED `owner { tenant, workspace?, subject }` and `eventLogSchemaVersion`; `RunEventDoc.schemaVersion` is REQUIRED and `engineVersion` is an integer. `RunConfigurable` is the closed, nested, versioned `{ version: 1, run?, ai?, distillation?, budget?, extensions? }`.

**Removed (not v2 operations):** `workspace.listFiles/getFile/putFile/deleteFile`, `runs.debugBundle`, `userAgents.*` (host-sample seams), `RegistryClient` (the registry is resolved through `.well-known/openwop-registry.json` `endpoints`, packs.md). The barrel no longer re-exports the `node:crypto` webhook verifiers — import `@openwop/openwop/webhooks`.

**Added:** `runs.compensation` (`GET /runs/{runId}/compensation`), `runs.effects` (`GET /runs/{runId}/effects`), `host.effectSeams` (`GET /host/effect-seams`), `host.events` (`GET /host/events` SSE) — RFC 0173; `streamHostEvents`; `CAPABILITY_FAMILY_KEYS` / `CAPABILITY_METADATA_KEYS`; `scripts/generate.mjs` (`--check` in the gate).
