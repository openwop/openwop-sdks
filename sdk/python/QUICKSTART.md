# `openwop-client` Python Quickstart

5-minute walkthrough: install the SDK, boot the in-memory reference host on your laptop, and run an end-to-end workflow lifecycle. Zero external services required.

> Prefer the wire-level walkthrough? See the top-level [`QUICKSTART.md`](../../QUICKSTART.md) — language-agnostic, curl-based, deeper coverage.

## Prerequisites

- Python 3.10+
- Node 20+ (only to run the in-memory reference host below; the SDK itself has zero runtime deps)
- A clone of [`github.com/openwop/openwop-examples`](https://github.com/openwop/openwop-examples) (the in-memory host lives at `examples/hosts/in-memory`)

## Install

```bash
pip install "openwop-client<2"
```

The SDK is **stdlib-only at runtime** — `urllib.request` for HTTP, no `requests`/`httpx`/`pydantic`.

## Boot the in-memory reference host

In one terminal:

```bash
cd examples/hosts/in-memory
npm install
npm start
# → [openwop-host-in-memory] listening on http://127.0.0.1:3737 (api key: openwop-inmem-dev-key, 46 fixtures loaded)
```

The host loads 46 [conformance fixtures](https://github.com/openwop/openwop/blob/main/conformance/fixtures.md) so the example below has workflows to run against.

## Walkthrough

Create `quickstart.py`:

```python
import time

from openwop_client import CreateRunRequest, OpenwopClient
from openwop_client.types import is_terminal_run_status

client = OpenwopClient("http://127.0.0.1:3737", "openwop-inmem-dev-key")

# 1. Discovery — confirm protocol version + advertised transports.
caps = client.discovery_capabilities()
print(f"protocol: {caps.protocolVersion}")
print(f"transports: {caps.supportedTransports}")

# 2. Create a run against a conformance fixture.
run = client.runs_create(CreateRunRequest(workflowId="conformance-noop", inputs={}))
print(f"created run: {run.runId} (status={run.status})")

# 3. Poll the snapshot until terminal.
while True:
    snap = client.runs_get(run.runId)
    if is_terminal_run_status(snap.status):
        print(f"terminal: {snap.status}")
        break
    time.sleep(0.1)

# 4. Read the event log (long-poll, JSON).
page = client.runs_poll_events(run.runId)
for e in page.events:
    print(f"  {e.sequence:>3}  {e.type}")
```

Run it:

```bash
python quickstart.py
```

Expected output:

```
protocol: 1.0
transports: ['rest']
created run: run-<uuid> (status=pending)
terminal: completed
    0  run.started
    1  node.started
    2  node.completed
    3  run.completed
```

## What you exercised

| Step | SDK method | Spec |
|---|---|---|
| Discovery | `client.discovery_capabilities()` | [`capabilities.md`](https://github.com/openwop/openwop/blob/main/spec/v1/capabilities.md) `GET /.well-known/openwop` |
| Create run | `client.runs_create(CreateRunRequest)` | [`rest-endpoints.md`](https://github.com/openwop/openwop/blob/main/spec/v1/rest-endpoints.md) `POST /v1/runs` |
| Poll snapshot | `client.runs_get(run_id)` | [`rest-endpoints.md`](https://github.com/openwop/openwop/blob/main/spec/v1/rest-endpoints.md) `GET /v1/runs/{runId}` |
| Read events | `client.runs_poll_events(run_id, last_sequence=...)` | [`rest-endpoints.md`](https://github.com/openwop/openwop/blob/main/spec/v1/rest-endpoints.md) `GET /v1/runs/{runId}/events/poll` |

Every method on `OpenwopClient` maps 1:1 to an OpenAPI operation in [`api/openapi.yaml`](https://github.com/openwop/openwop/blob/main/api/openapi.yaml); `sdk/parity-expectations.json` names each one.

## Streaming events (live SSE)

```python
for event in client.runs_events(run.runId):
    print(event.sequence, event.type)
    if event.type in ("run.completed", "run.failed", "run.cancelled"):
        break
```

`runs_events` is a generator over the SSE stream, pure stdlib (`urllib.request` + manual frame parsing). It yields only frames that are full `RunEventDoc`s and skips anything else. The in-memory host's SSE frames are abbreviated (`seq`, no `eventId` / `payload`), so against it this loop yields nothing — use the long-poll above there, and SSE against a full host such as `examples/hosts/sqlite`.

## Next steps

- **Survey the wire surface:** [`README.md`](./README.md) §"Endpoint coverage" lists every method.
- **Auth profiles:** [`auth-profiles.md`](https://github.com/openwop/openwop/blob/main/spec/v1/auth-profiles.md) — API-key rotation, OAuth2 client credentials, OIDC user-bearer, mTLS.
- **Webhooks:** subscribe to run events out-of-band; see [`webhooks.md`](https://github.com/openwop/openwop/blob/main/spec/v1/webhooks.md).
- **Replay:** time-travel debugging via `POST /v1/runs/{runId}:fork`; see [`replay.md`](https://github.com/openwop/openwop/blob/main/spec/v1/replay.md).
- **Build your own host:** [`examples/hosts/sqlite/README.md`](https://github.com/openwop/openwop-examples/blob/main/examples/hosts/sqlite/README.md) doubles as a "Build Your Own Host" walkthrough.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `urllib.error.URLError: <urlopen error [Errno 61] Connection refused>` | The in-memory host isn't running | Boot `npm start` in `examples/hosts/in-memory/` first |
| `401 Unauthorized` from the API | API key mismatch | Set `OPENWOP_API_KEY=openwop-inmem-dev-key` (or pass `api_key=...` explicitly to `OpenwopClient`) |
| Run never reaches terminal, or `runs_create` returns `404` | The workflow id is not one of the host's fixtures | The host prints how many fixtures it loaded at startup; use a `conformance-*` id from [`fixtures.md`](https://github.com/openwop/openwop/blob/main/conformance/fixtures.md) |
