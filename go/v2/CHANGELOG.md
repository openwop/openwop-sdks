# `openwopclient` v2 Changelog

The v1 module's history lives in [`go/CHANGELOG.md`](../CHANGELOG.md); this is a new v2-ONLY major module at `github.com/openwop/openwop-sdks/go/v2` (tags `go/v2.Y.Z`).

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
