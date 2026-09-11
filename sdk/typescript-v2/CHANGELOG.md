# `@openwop/openwop` 2.x Changelog

The 1.x line's history lives in [`sdk/typescript/CHANGELOG.md`](../typescript/CHANGELOG.md); this package is a new v2-ONLY major (tags `openwop/v2.Y.Z` tracking a published corpus tag) published from `sdk/typescript-v2/`.

## [2.1.0] — 2026-09-11 — `runs.list` (RFC 0182) on corpus `v2.1.0`

**Added:** `runs.list({ limit?, cursor?, workflowId?, status? })` → `RunListResponse | null` — `GET /runs` (RFC 0182): one page of the caller's runs as full `RunSnapshot`s, newest first, tenant-scoped with every `runId` bound; walk `nextCursor`; `null` on `404` (the `runList` family is not advertised); a cursor the host did not mint is `400 validation_error` and throws. New types `RunListResponse`, `ListRunsOptions`.

**Re-vendored** from corpus `v2.1.0` (`CORPUS_TAG`): `run-list-response.schema.json` added; `path-manifest.json` now 52 operations (parity 52/52); `spec/v2/errors.json` grew from 94 to 97 registered codes between 2.0.8 and 2.1.0 (`ErrorCode` regenerated); the capabilities schema gained the `runList` family and the 2.0.10 corrections (`prompts.renderEndpoint` default `/prompts:render`, `/v1/` spellings rewritten to manifest keys in descriptions). No breaking change.

## [2.0.0] — 2026-09-10 — GA on the published corpus (`v2.0.8`)

No client-surface change from rc.1. What changed is what the client was
checked against: the rc.1 vendored tree predated `v2.0.0` and eight 2.0.x
corpus patches, and every parity claim in `sdk/PARITY.md` was a claim about
that stale tree. Re-vendored from the corpus at `v2.0.8` — the tag that is
on npm as `@openwop/spec-artifacts@2.0.8` — which brought in 27 schemas this
repo had never seen and refreshed 24 more; `src/generated.ts` regenerated;
the v2 parity gate (`check:parity:v2`, 51/51 operations) passes against the
current `spec/v2/path-manifest.json`.

`2.0.0` is `latest` on npm. The 1.x client is not retired: `@openwop/openwop@1`
remains the correct pin for a caller on `/v1/…`, which every host keeps
serving through the overlap (`versioning.md` §1.1 — `preferredVersion` stays
`1.x`). A v2 caller should send `OpenWOP-Version: 2` on every request: it is
MAY on the wire, but absent it a dual-stack host answers the v1 default.

## [2.0.0-rc.1] — 2026-09-03 — the v2 client (corpus `v2.0.0-rc.1`; RFC 0168 §D SDK 2 expectations)

**Breaking — the wire (RFC 0172 §A, RFC 0171 §C.1):**

- Every path is an unversioned key on a bare origin (`/runs`, `/.well-known/openwop`, …). No `/v1` literal remains in the package.
- `OpenWOP-Version: <major>.0` is sent on every request — REST and SSE, authenticated or not. New ctor option `major` (default `2`, exported as `SDK_PROTOCOL_MAJOR`); `client.protocolVersion` reads the value sent.
- Header renames per `spec/v2/core/headers.md`: `X-Dedup` → `OpenWOP-Dedup`. Webhook deliveries are read from the `OpenWOP-*` family (the `X-openwop-*` twins are accepted through the overlap); the SDK-only `openwop-Webhook-*` names and the `v1=<hex>` value form are gone, and an unrecognized `OpenWOP-Signature-Algorithm` is rejected (`unsupported_signature_algorithm`).
- `runs.pollEvents({ afterSequence })` replaces `lastSequence`; `PollEventsResponse` is the closed `{ runId, events, lastSequence, status, isTerminal }` (events.md §Poll).

**Breaking — types:**

- `Capabilities` is the closed v2 root: `protocolVersions[]` + `preferredVersion` REQUIRED; every family key carries a `CapabilityRecord` `{ status, since, until?, witness, …facets }`. The 1.x `*Capability` shapes with `supported: boolean` are removed.
- `ErrorEnvelope.error` is `ErrorCode | VendorErrorCode`; `ErrorCode` is the 94-member union generated from `spec/v2/errors.json`. `HTTP_ERROR_CODES` is now that registry; `isErrorCode`, `isRetriableErrorCode`, `isVendorErrorCode`, `ERROR_CODE_HTTP_STATUS`, `RETRIABLE_ERROR_CODES` are new.
- `RunSnapshot` gains the REQUIRED `owner { tenant, workspace?, subject }` and `eventLogSchemaVersion`; `RunEventDoc.schemaVersion` is REQUIRED and `engineVersion` is an integer. `RunConfigurable` is the closed, nested, versioned `{ version: 1, run?, ai?, distillation?, budget?, extensions? }`.

**Removed (not v2 operations):** `workspace.listFiles/getFile/putFile/deleteFile`, `runs.debugBundle`, `userAgents.*` (host-sample seams), `RegistryClient` (the registry is resolved through `.well-known/openwop-registry.json` `endpoints`, packs.md). The barrel no longer re-exports the `node:crypto` webhook verifiers — import `@openwop/openwop/webhooks`.

**Added:** `runs.compensation` (`GET /runs/{runId}/compensation`), `runs.effects` (`GET /runs/{runId}/effects`), `host.effectSeams` (`GET /host/effect-seams`), `host.events` (`GET /host/events` SSE) — RFC 0173; `streamHostEvents`; `CAPABILITY_FAMILY_KEYS` / `CAPABILITY_METADATA_KEYS`; `scripts/generate.mjs` (`--check` in the gate).
