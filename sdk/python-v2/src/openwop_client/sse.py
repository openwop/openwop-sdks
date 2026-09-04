"""
Generator-based SSE consumers for ``GET /runs/{runId}/events`` (the
``runEvents`` channel) and ``GET /host/events`` (the ``hostEvents`` channel)
— ``spec/v2/core/events.md`` §SSE frames. Pure stdlib — ``urllib.request``
for HTTP, manual line parsing for SSE.

Synchronous generators: callers iterate with ``for event in stream_events(...)``.
The connection is auto-closed when the server closes the stream OR when the
caller breaks out of the loop. Bounded by an absolute timeout so CI never
hangs. For async usage, wrap with ``asyncio.to_thread(...)``.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Iterator, Sequence
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from .types import HostEventDoc, RunEventDoc, StreamMode

DEFAULT_HOST_EVENTS_PATH = "/host/events"


def stream_events(
    base_url: str,
    api_key: str,
    run_id: str,
    *,
    protocol_version: str = "2.0",
    stream_mode: StreamMode | Sequence[StreamMode] | None = None,
    last_event_id: str | None = None,
    timeout_seconds: float = 30.0,
    buffer_ms: int | None = None,
) -> Iterator[RunEventDoc]:
    """Subscribe to a run's SSE event stream and yield decoded events.

    Args:
        base_url:          openwop server base URL (e.g., ``https://api.example.com``).
        api_key:           Bearer-style API key.
        run_id:            Run to subscribe to.
        protocol_version:  The ``OpenWOP-Version`` value sent on the subscribe
                           request (RFC 0172 §A.3). ``OpenwopClient`` passes its own.
        stream_mode:       Single mode (e.g., ``'updates'``) OR a sequence of modes
                           for mixed mode; sequences serialize to the canonical
                           comma-separated query (``?streamMode=updates,messages``).
        last_event_id:     Optional ``Last-Event-ID`` request header — the host
                           resumes at the next sequence.
        timeout_seconds:   Hard upper bound on the read.
        buffer_ms:         Batching hint (0..5000); ``event: batch`` frames are
                           flattened back into per-event yields.

    Yields:
        RunEventDoc for each parseable frame. Non-JSON ``data:`` payloads are
        silently skipped.

    Raises:
        urllib.error.HTTPError: on non-2xx status.
        urllib.error.URLError:  on connection failure.
    """
    params: dict[str, str] = {}
    if stream_mode:
        if isinstance(stream_mode, str):
            params["streamMode"] = stream_mode
        else:
            params["streamMode"] = ",".join(stream_mode)
    if buffer_ms is not None:
        params["bufferMs"] = str(buffer_ms)
    qs = "?" + urlencode(params) if params else ""
    path = f"/runs/{quote(run_id, safe='')}/events{qs}"
    return _stream_sse(
        base_url,
        api_key,
        path,
        _decode_event_doc,
        protocol_version=protocol_version,
        last_event_id=last_event_id,
        timeout_seconds=timeout_seconds,
    )


def stream_host_events(
    base_url: str,
    api_key: str,
    *,
    protocol_version: str = "2.0",
    path: str = DEFAULT_HOST_EVENTS_PATH,
    last_event_id: str | None = None,
    timeout_seconds: float = 30.0,
) -> Iterator[HostEventDoc]:
    """Subscribe to the ``hostEvents`` channel (heartbeat messages; content-free
    of run data). ``path`` defaults to ``/host/events``; a host MAY declare
    another under ``heartbeat.deliveryChannel`` (capabilities.md)."""
    return _stream_sse(
        base_url,
        api_key,
        path,
        _decode_host_event_doc,
        protocol_version=protocol_version,
        last_event_id=last_event_id,
        timeout_seconds=timeout_seconds,
    )


def _stream_sse(
    base_url: str,
    api_key: str,
    path: str,
    decode: Callable[[Any], Any],
    *,
    protocol_version: str,
    last_event_id: str | None,
    timeout_seconds: float,
) -> Iterator[Any]:
    base_url = base_url.rstrip("/")
    url = f"{base_url}{path}"

    headers = {
        "Accept": "text/event-stream",
        "Authorization": f"Bearer {api_key}",
        "Cache-Control": "no-cache",
        "OpenWOP-Version": protocol_version,
    }
    if last_event_id:
        headers["Last-Event-ID"] = last_event_id

    req = Request(url, headers=headers, method="GET")
    with urlopen(req, timeout=timeout_seconds) as resp:
        # urlopen raises on non-2xx, so resp.status is always 2xx here.
        pending_event = "message"
        pending_data: list[str] = []

        for raw_line in resp:
            line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")

            if line == "":
                for ev in _flush_event(pending_event, pending_data, decode):
                    yield ev
                pending_event = "message"
                pending_data = []
                continue

            if line.startswith(":"):
                continue  # SSE comment / keep-alive

            colon = line.find(":")
            if colon == -1:
                field = line
                value = ""
            else:
                field = line[:colon]
                value = line[colon + 1 :]
                if value.startswith(" "):
                    value = value[1:]

            if field == "event":
                pending_event = value
            elif field == "data":
                pending_data.append(value)
            # `id:` is the sequence; the consumer reads it from the document.

        for ev in _flush_event(pending_event, pending_data, decode):
            yield ev


def _flush_event(
    event: str, data_lines: list[str], decode: Callable[[Any], Any]
) -> list[Any]:
    """Decode a buffered SSE frame: [] when empty / non-JSON, one document for a
    normal frame, N for an ``event: batch`` frame whose ``data:`` is an array."""
    if not data_lines:
        return []
    raw = "\n".join(data_lines)
    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError:
        return []

    if event == "batch" and isinstance(parsed, list):
        out: list[Any] = []
        for item in parsed:
            decoded = decode(item)
            if decoded is not None:
                out.append(decoded)
        return out

    if not isinstance(parsed, dict):
        return []
    decoded = decode(parsed)
    return [decoded] if decoded is not None else []


def _decode_event_doc(parsed: Any) -> RunEventDoc | None:
    """Defensive RunEventDoc construction — None on missing/misshapen required
    fields. Forward-compat readers tolerate extras."""
    if not isinstance(parsed, dict):
        return None
    try:
        return RunEventDoc(
            eventId=str(parsed["eventId"]),
            runId=str(parsed["runId"]),
            type=str(parsed["type"]),
            payload=parsed.get("payload"),
            timestamp=str(parsed["timestamp"]),
            sequence=int(parsed["sequence"]),
            schemaVersion=int(parsed["schemaVersion"]),
            nodeId=parsed.get("nodeId"),
            engineVersion=(
                int(parsed["engineVersion"]) if parsed.get("engineVersion") is not None else None
            ),
            causationId=parsed.get("causationId"),
        )
    except (KeyError, ValueError, TypeError):
        return None


def _decode_host_event_doc(parsed: Any) -> HostEventDoc | None:
    if not isinstance(parsed, dict) or not isinstance(parsed.get("type"), str):
        return None
    return HostEventDoc(
        type=parsed["type"],
        payload=parsed.get("payload"),
        timestamp=parsed.get("timestamp"),
        raw=dict(parsed),
    )
