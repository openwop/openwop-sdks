# `openwopclient` v2 — Go SDK for OpenWOP v2 hosts

**openwop is an open, wire-level protocol for multi-agent workflow orchestration.** This module is the reference Go client for the **v2 major** (`spec/v2/`, RFC 0168 §D): synchronous, zero runtime deps, one typed method per operation in `spec/v2/path-manifest.json` (51 operations), strongly-typed structs, and channel-based SSE consumers for the run and host event channels.

```bash
go get github.com/openwop/openwop-sdks/go/v2@v2.0.0-rc.1   # tag go/v2/v2.0.0-rc.1 — the corpus release-candidate line
```

```go
import openwop "github.com/openwop/openwop-sdks/go/v2"
```

> **Spec:** [github.com/openwop/openwop](https://github.com/openwop/openwop) · **Corpus tag:** see [`CORPUS_TAG`](../../CORPUS_TAG) · **Mirrors:** [`api/v2/openapi.yaml`](../../api/v2/openapi.yaml), [`schemas/v2/`](../../schemas/v2/), [`spec/v2/errors.json`](../../spec/v2/errors.json) · **Siblings:** [`sdk/typescript-v2/`](../../sdk/typescript-v2/), [`sdk/python-v2/`](../../sdk/python-v2/)
>
> The v1 module (`github.com/openwop/openwop-sdks/go`, this directory's parent) is untouched and keeps publishing for v1 hosts. This is a v2-ONLY client: it never sends a `/v1/…` path. Tags are `go/v2/vX.Y.Z` (Go's major-subdirectory convention).

## What is different from v1 (RFC 0172 / 0171 / 0173)

| v1 module | v2 module |
| --- | --- |
| `/v1/runs`, `/v1/agents`, … | Bare origin, unversioned path keys: `/runs`, `/agents`, … |
| Negotiation by `protocolVersion` | `OpenWOP-Version: <Major>.0` on **every** request (`OpenwopClient.Major`, zero = `SDKProtocolMajor` = 2); `406 protocol_version_unsupported` when the host does not list the major. |
| `MutationOptions{Dedup: true}` → `X-Dedup` | → `OpenWOP-Dedup: enforce`. |
| `PollRunEventsOptions{LastSequence}` | `PollRunEventsOptions{AfterSequence}`; `PollEventsResponse` is the closed `{RunID, Events, LastSequence, Status, IsTerminal}`. |
| `Capabilities` with `supported` sub-structs | The closed v2 root: `ProtocolVersions` + `PreferredVersion` required, `Families map[string]CapabilityRecord` (`Status / Since / Until / Witness / Facets`) via `caps.Family(key)`. `CapabilityFamilyKeys` is generated from the schema. |
| `HTTPErrorCodes` hand-kept | `ErrorCodes` (94) generated from `spec/v2/errors.json`, plus `ErrorCodeHTTPStatus`, `RetriableErrorCodes`, `IsRetriableErrorCode`, `IsVendorErrorCode`. |
| `*WorkspaceFile*` (4), `GetDebugBundle`, `RegistryClient` | Removed — not v2 operations (the registry is resolved through `.well-known/openwop-registry.json` `endpoints`). |
| — | `GetRunCompensation`, `GetRunEffects`, `GetEffectSeamManifest` (RFC 0173), `StreamHostEvents` (the `hostEvents` SSE channel). |
| Webhook `openwop-Webhook-*` names, `v1=<hex>` | `OpenWOP-*` only (`X-openwop-*` accepted through the overlap); `sha256=<hex>`; an unrecognized `OpenWOP-Signature-Algorithm` is rejected. |

## Quickstart

```go
client, _ := openwop.NewClient("https://api.example.com", "hk_test_abc123") // Major 0 ⇒ OpenWOP-Version: 2.0
ctx := context.Background()

caps, _ := client.GetCapabilities(ctx)                       // the closed v2 root
if rec, ok := caps.Family("webhooks"); ok { fmt.Println(caps.PreferredVersion, rec.Status) }

resp, _ := client.CreateRun(ctx, openwop.CreateRunRequest{
	WorkflowID:   "my-workflow",
	Configurable: &openwop.RunConfigurable{Run: map[string]any{"runTimeoutMs": 60000}},
}, openwop.MutationOptions{IdempotencyKey: "idem-1", Dedup: true})

events, cleanup, _ := client.StreamEvents(ctx, resp.RunID, openwop.StreamEventsOptions{StreamModes: []openwop.StreamMode{openwop.StreamModeUpdates}})
defer cleanup()
for ev := range events { fmt.Println(ev.Sequence, ev.Type) }

var cursor *int                                              // long-poll fallback
for {
	page, _ := client.PollRunEvents(ctx, resp.RunID, openwop.PollRunEventsOptions{AfterSequence: cursor})
	last := page.LastSequence
	cursor = &last
	if page.IsTerminal { break }
}

comp, _ := client.GetRunCompensation(ctx, resp.RunID)        // (nil, nil) when `compensation` is unadvertised
_ = comp
```

Webhook receivers:

```go
sig, ts, alg, _, ok := openwop.ReadWebhookHeaders(r.Header.Get)
out := openwop.VerifyWebhookSignature(secret, sig, ts, rawBody, openwop.VerifyWebhookOptions{AlgorithmHeader: alg})
```

## Generated surface

`generated.go` is produced by `scripts/generate.py` (stdlib Python) from the vendored `spec/v2/errors.json` and `schemas/v2/capabilities.schema.json`; `python3 scripts/generate.py --check` (run by `scripts/sdks-check.sh`) fails when it drifts.

## Development

```bash
go vet ./... && go test ./... && test -z "$(gofmt -l .)"
python3 scripts/generate.py --check
```
