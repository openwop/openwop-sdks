# `openwop-client` 2.x Python Quickstart

Install the SDK, boot the v2 reference host on your laptop, and run a workflow end to end against the v2 wire (`spec/v2/`). No external services.

> Using a v1 host? That is the 1.x line — [`sdk/python/QUICKSTART.md`](../python/QUICKSTART.md), installed with `pip install "openwop-client<2"`.

## Prerequisites

- Python 3.10+
- Node 20+ (only to run the reference host; the SDK has zero runtime deps)
- A clone of [`github.com/openwop/openwop-examples`](https://github.com/openwop/openwop-examples)

## Install

```bash
pip install "openwop-client>=2,<3"
```

The SDK is stdlib-only at runtime: `urllib.request` for HTTP, no `requests` / `httpx` / `pydantic`.

## Boot the v2 reference host

In one terminal:

```bash
cd examples/hosts/v2-reference
npm install --legacy-peer-deps
npm start
# → openwop-host-v2-reference listening on http://127.0.0.1:3838 (…)   default api key: openwop-v2-dev-key
```

The host serves the conformance fixtures (`conformance-noop` and friends), so the example below has a workflow to run.

## Walkthrough

Create `quickstart.py`:

```python
import time

from openwop_client import CreateRunRequest, OpenwopClient, is_terminal_run_status

client = OpenwopClient("http://127.0.0.1:3838", "openwop-v2-dev-key")  # sends OpenWOP-Version: 2.0

# 1. Discovery: the closed v2 root.
caps = client.discovery_capabilities()
print("protocol versions:", caps.protocolVersions)

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

Run it with `python quickstart.py`. The run id is tenant-bound (`<tenant>/<opaque>`); the SDK puts it on the wire as one projected path segment (`<tenant>~2F<opaque>`, identity.md §5), so pass it back exactly as the host returned it.

## What you exercised

| Step | SDK method | Operation |
|---|---|---|
| Discovery | `client.discovery_capabilities()` | `GET /.well-known/openwop` |
| Create run | `client.runs_create(CreateRunRequest)` | `POST /runs` |
| Poll snapshot | `client.runs_get(run_id)` | `GET /runs/{runId}` |
| Read events | `client.runs_poll_events(run_id, after_sequence=...)` | `GET /runs/{runId}/events/poll` |

Every `OpenwopClient` method maps 1:1 to an operation in `spec/v2/path-manifest.json` (55 operations); see [`README.md`](./README.md) and [`sdk/PARITY.md`](../PARITY.md) §v2.

## Streaming events (live SSE)

```python
for event in client.runs_events(run.runId):
    print(event.sequence, event.type)
```

`runs_events` is a generator over the SSE stream, pure stdlib. It ends when the host closes the stream after a terminal event.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `WopError` with status `0` (connection refused) | The host isn't running | `npm start` in `examples/hosts/v2-reference/` first |
| `401` | API key mismatch | The host's default key is `openwop-v2-dev-key` (`OPENWOP_API_KEY` overrides it) |
| `406 protocol_version_unsupported` | The host does not serve major 2 | Point the client at a v2 host, or use the 1.x SDK for a v1 host |
