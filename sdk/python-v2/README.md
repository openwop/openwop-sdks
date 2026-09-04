# `openwop-client` 2.x — Python SDK for OpenWOP v2 hosts

**openwop is an open, wire-level protocol for multi-agent workflow orchestration.** This package is the reference Python client for the **v2 major** (`spec/v2/`, RFC 0168 §D): synchronous, zero runtime deps, one typed method per operation in `spec/v2/path-manifest.json` (51 operations), typed dataclasses, and pure-stdlib SSE iterators for the run and host event channels.

```bash
pip install "openwop-client>=2,<3"
```

> **Spec:** [github.com/openwop/openwop](https://github.com/openwop/openwop) · **Corpus tag:** see [`CORPUS_TAG`](../../CORPUS_TAG) · **Mirrors:** [`api/v2/openapi.yaml`](../../api/v2/openapi.yaml), [`schemas/v2/`](../../schemas/v2/), [`spec/v2/errors.json`](../../spec/v2/errors.json) · **Sibling:** the TypeScript client at [`sdk/typescript-v2/`](../typescript-v2/)
>
> The 1.x package (`sdk/python/`) is untouched and keeps publishing for v1 hosts. This is a v2-ONLY client: it never sends a `/v1/…` path. The import name stays `openwop_client`.

## What is different from 1.x (RFC 0172 / 0171 / 0173)

| 1.x | 2.x |
| --- | --- |
| `/v1/runs`, `/v1/agents`, … | Bare origin, unversioned path keys: `/runs`, `/agents`, … |
| Negotiation by `protocolVersion` | `OpenWOP-Version: <major>.0` on **every** request (ctor `major=2`); `406 protocol_version_unsupported` when the host does not list the major. |
| `dedup=True` → `X-Dedup` | `dedup=True` → `OpenWOP-Dedup: enforce`. |
| `runs_poll_events(last_sequence=)` | `runs_poll_events(after_sequence=)`; the response is the closed `{ runId, events, lastSequence, status, isTerminal }`. |
| `Capabilities` with `supported` sub-dataclasses | The closed v2 root: `protocolVersions` + `preferredVersion` required, `families: dict[str, CapabilityRecord]` (`status / since / until / witness / facets`). `CAPABILITY_FAMILY_KEYS` is generated from the schema. |
| `HTTP_ERROR_CODES` hand-kept | `ERROR_CODES` / `ErrorCode` (92) generated from `spec/v2/errors.json`, plus `ERROR_CODE_HTTP_STATUS`, `RETRIABLE_ERROR_CODES`, `is_vendor_error_code`. |
| `*_workspace_file` (4), `runs_debug_bundle`, `RegistryClient` | Removed — not v2 operations (the registry is resolved through `.well-known/openwop-registry.json` `endpoints`). |
| — | `runs_compensation`, `runs_effects`, `host_effect_seams` (RFC 0173), `host_events` (the `hostEvents` SSE channel). |
| Webhook `openwop-Webhook-*` names, `v1=<hex>` | `OpenWOP-*` only (`X-openwop-*` accepted through the overlap); `sha256=<hex>`; an unrecognized `OpenWOP-Signature-Algorithm` is rejected. |

## Quickstart

```python
from openwop_client import CreateRunRequest, OpenwopClient, RunConfigurable, WopError, is_terminal_run_status

client = OpenwopClient(base_url="https://api.example.com", api_key="hk_test_abc123")  # major=2 → OpenWOP-Version: 2.0

caps = client.discovery_capabilities()            # the closed v2 root
print(caps.preferredVersion, caps.protocolVersions, "webhooks" in caps.families)

resp = client.runs_create(
    CreateRunRequest(workflowId="my-workflow", inputs={"q": "hello"}, configurable=RunConfigurable(run={"runTimeoutMs": 60_000})),
    idempotency_key="idem-1",
    dedup=True,
)

for event in client.runs_events(resp.runId, stream_mode=("updates", "messages")):
    print(event.sequence, event.type)

cursor = None
while True:                                       # long-poll fallback
    page = client.runs_poll_events(resp.runId, after_sequence=cursor)
    cursor = page.lastSequence
    if page.isTerminal:
        break

comp = client.runs_compensation(resp.runId)       # None when `compensation` is unadvertised

try:
    client.runs_get("tenant/does-not-exist")
except WopError as err:
    if err.envelope and err.envelope.error == "not_found":
        ...
```

Webhook receivers:

```python
from openwop_client import read_webhook_headers, verify_webhook_signature

read = read_webhook_headers(request.headers)
outcome = verify_webhook_signature(secret, read.signature, read.timestamp, raw_body, algorithm_header=read.algorithm) if read else None
```

## Generated surface

`src/openwop_client/_generated.py` is produced by `scripts/generate.py` from the vendored `spec/v2/errors.json` and `schemas/v2/capabilities.schema.json`; `python3 scripts/generate.py --check` (run by `scripts/sdks-check.sh`) fails when it drifts.

## Development

```bash
python3 scripts/generate.py --check
ruff check .
PYTHONPATH=src python3 -m unittest discover -s tests
```
