"""
Generator-based SSE consumers for ``GET /runs/{runId}/events`` (the
``runEvents`` channel) and ``GET /host/events`` (the ``hostEvents`` channel)
— ``spec/v2/core/events.md`` §SSE frames. Pure stdlib — ``urllib.request``
for HTTP, manual line parsing for SSE.

Synchronous generators: callers iterate with ``for event in stream_events(...)``.
Break out of the loop to close the connection. For async usage, wrap with
``asyncio.to_thread(...)``.

Resumable (RFC 0247): by default the subscribe sends ``resumable=true``, and
when a stream ends before the run's terminal event (a host's bounded close, a
platform or proxy timeout, a dropped connection) the generator reconnects
with ``Last-Event-ID`` set to the last ``id:`` it received and keeps
yielding. ``reconnect=False`` restores the single-connection behaviour of
2.5.0 and earlier.
"""

from __future__ import annotations

import email.utils
import http.client
import json
import time
from typing import Any, Callable, Iterator, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ._generated import CORPUS_VERSION
from .wire_id import project_id
from .types import HostEventDoc, RunEventDoc, StreamMode, is_terminal_run_status

DEFAULT_HOST_EVENTS_PATH = "/host/events"

_TERMINAL_EVENT_TYPES = frozenset({"run.completed", "run.failed", "run.cancelled"})
# RFC 0247 §A floor: a host does not end an opted-in stream early within this
# long of opening it. A resumed run stream that closes sooner WITHOUT a frame
# is the events.md answer for a terminal run, so the generator ends.
_BOUNDED_CLOSE_FLOOR_S = 15.0
# A host-events connection that closes this fast with no frame is a failed attempt.
_QUICK_CLOSE_S = 1.0
_RETRYABLE_STATUSES = frozenset({429, 502, 503, 504})


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
    reconnect: bool = True,
    reconnect_delay_seconds: float = 1.0,
    max_reconnect_delay_seconds: float = 30.0,
    max_reconnect_attempts: int = 10,
) -> Iterator[RunEventDoc]:
    """Subscribe to a run's SSE event stream and yield decoded events through
    the run's terminal event.

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
        timeout_seconds:   Socket timeout per connect / read. With reconnect
                           on, a read that times out resumes the stream.
        buffer_ms:         Batching hint (0..5000); ``event: batch`` frames are
                           flattened back into per-event yields.
        reconnect:         RFC 0247. ``True`` (default) sends ``resumable=true``
                           and resumes with ``Last-Event-ID`` whenever the stream
                           ends before the terminal event; never re-yields an
                           event. ``False``: one connection, no query flag.
        reconnect_delay_seconds:      Wait before a reconnect when the host sent
                           no ``retry:`` field.
        max_reconnect_delay_seconds:  Backoff ceiling for failed reconnects.
        max_reconnect_attempts:       Consecutive failed reconnects before the
                           last error is raised.

    Yields:
        RunEventDoc for each parseable frame. Non-JSON ``data:`` payloads are
        silently skipped.

    Raises:
        urllib.error.HTTPError: on a non-2xx first connect, or a non-retryable
                                status on a reconnect.
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
    if reconnect:
        params["resumable"] = "true"
    qs = "?" + urlencode(params) if params else ""
    path = f"/runs/{project_id(run_id)}/events{qs}"
    return _stream_sse(
        base_url,
        api_key,
        path,
        _decode_event_doc,
        protocol_version=protocol_version,
        last_event_id=last_event_id,
        timeout_seconds=timeout_seconds,
        run_stream=True,
        policy=_policy(reconnect, reconnect_delay_seconds, max_reconnect_delay_seconds, max_reconnect_attempts),
    )


def stream_host_events(
    base_url: str,
    api_key: str,
    *,
    protocol_version: str = "2.0",
    path: str = DEFAULT_HOST_EVENTS_PATH,
    last_event_id: str | None = None,
    timeout_seconds: float = 30.0,
    reconnect: bool = True,
    reconnect_delay_seconds: float = 1.0,
    max_reconnect_delay_seconds: float = 30.0,
    max_reconnect_attempts: int = 10,
) -> Iterator[HostEventDoc]:
    """Subscribe to the ``hostEvents`` channel (heartbeat messages; content-free
    of run data). ``path`` defaults to ``/host/events``; a host MAY declare
    another under ``heartbeat.deliveryChannel`` (capabilities.md).

    The channel has no terminal event: with ``reconnect`` on (RFC 0247) the
    generator runs until the caller stops iterating or a reconnect fails for
    good. The cursor is the last durable event's ``id:``; ephemeral frames
    carry none and are never redelivered."""
    if reconnect:
        path = f"{path}{'&' if '?' in path else '?'}resumable=true"
    return _stream_sse(
        base_url,
        api_key,
        path,
        _decode_host_event_doc,
        protocol_version=protocol_version,
        last_event_id=last_event_id,
        timeout_seconds=timeout_seconds,
        run_stream=False,
        policy=_policy(reconnect, reconnect_delay_seconds, max_reconnect_delay_seconds, max_reconnect_attempts),
    )


def _policy(enabled: bool, delay: float, max_delay: float, attempts: int) -> tuple[float, float, int] | None:
    return (delay, max_delay, attempts) if enabled else None


def _is_terminal_frame(event: str, raw: Any) -> bool:
    if not isinstance(raw, dict):
        return False
    if raw.get("type") in _TERMINAL_EVENT_TYPES:
        return True
    status = raw.get("status")
    return event == "state.snapshot" and isinstance(status, str) and is_terminal_run_status(status)


def _retry_after_seconds(err: HTTPError) -> float | None:
    raw = err.headers.get("Retry-After") if err.headers is not None else None
    if raw is None:
        return None
    raw = raw.strip()
    if raw.isdigit():
        return float(raw)
    try:
        at = email.utils.parsedate_to_datetime(raw)
    except (TypeError, ValueError):
        return None
    return max(0.0, at.timestamp() - time.time())


def _stream_sse(
    base_url: str,
    api_key: str,
    path: str,
    decode: Callable[[Any], Any],
    *,
    protocol_version: str,
    last_event_id: str | None,
    timeout_seconds: float,
    run_stream: bool,
    policy: tuple[float, float, int] | None,
) -> Iterator[Any]:
    url = f"{base_url.rstrip('/')}{path}"
    cursor = last_event_id
    retry_s = policy[0] if policy else 0.0
    failures = 0
    established = False
    max_sequence = -1  # duplicate guard behind the exclusive cursor

    while True:
        headers = {
            "Accept": "text/event-stream",
            "Authorization": f"Bearer {api_key}",
            "Cache-Control": "no-cache",
            "OpenWOP-Version": protocol_version,
            "OpenWOP-Client-Version": CORPUS_VERSION,
        }
        if cursor:
            headers["Last-Event-ID"] = cursor

        opened = time.monotonic()
        frames = 0
        failure: BaseException | None = None
        retry_after: float | None = None
        try:
            resp = urlopen(Request(url, headers=headers, method="GET"), timeout=timeout_seconds)
        except HTTPError as err:
            if policy is None or not established or err.code not in _RETRYABLE_STATUSES:
                raise
            failure, retry_after = err, _retry_after_seconds(err)
            resp = None
        except (URLError, OSError) as err:
            # The first connect fails fast, exactly as before RFC 0247.
            if policy is None or not established:
                raise
            failure, resp = err, None

        if resp is not None:
            established = True
            try:
                with resp:
                    pending_event = "message"
                    pending_data: list[str] = []
                    pending_id: str | None = None
                    for raw_line in resp:
                        line = raw_line.decode("utf-8", errors="replace").rstrip("\r\n")

                        if line == "":
                            if pending_id is not None:
                                cursor = pending_id
                            terminal = False
                            for raw, ev in _flush_event(pending_event, pending_data, decode):
                                frames += 1
                                seq = raw.get("sequence") if isinstance(raw, dict) else None
                                if run_stream and isinstance(seq, int):
                                    if seq <= max_sequence:
                                        continue  # already yielded on an earlier connection
                                    max_sequence = seq
                                if run_stream and _is_terminal_frame(pending_event, raw):
                                    terminal = True
                                if ev is not None:
                                    yield ev
                            if terminal:
                                return
                            pending_event, pending_data, pending_id = "message", [], None
                            continue

                        if line.startswith(":"):
                            continue  # SSE comment / keep-alive

                        colon = line.find(":")
                        if colon == -1:
                            field, value = line, ""
                        else:
                            field = line[:colon]
                            value = line[colon + 1 :]
                            if value.startswith(" "):
                                value = value[1:]

                        if field == "event":
                            pending_event = value
                        elif field == "data":
                            pending_data.append(value)
                        elif field == "id":
                            if "\0" not in value:
                                pending_id = value
                        elif field == "retry":
                            if value.isdigit():
                                retry_s = int(value) / 1000.0

                    if pending_id is not None:
                        cursor = pending_id
                    terminal = False
                    for raw, ev in _flush_event(pending_event, pending_data, decode):
                        frames += 1
                        if run_stream and _is_terminal_frame(pending_event, raw):
                            terminal = True
                        if ev is not None:
                            yield ev
                    if terminal:
                        return
            except (OSError, http.client.HTTPException) as err:
                if policy is None:
                    raise
                failure = err  # a dropped or stalled connection: resume below

        # The connection ended without the terminal event.
        if policy is None:
            return
        lived = time.monotonic() - opened
        if failure is None and frames == 0:
            if run_stream and lived < _BOUNDED_CLOSE_FLOOR_S:
                return
            if not run_stream and lived < _QUICK_CLOSE_S:
                failure = RuntimeError("SSE stream kept closing without data")
        delay = retry_s
        if failure is None or frames > 0:
            failures = 0
        else:
            failures += 1
            if failures > policy[2]:
                raise failure
            delay = min(policy[1], max(retry_s, 0.001) * 2 ** (failures - 1))
        if retry_after is not None:
            delay = max(delay, retry_after)
        time.sleep(delay)


def _flush_event(
    event: str, data_lines: list[str], decode: Callable[[Any], Any]
) -> list[tuple[Any, Any]]:
    """Decode a buffered SSE frame into ``(raw, decoded)`` pairs: [] when empty /
    non-JSON, one pair for a normal frame, N for an ``event: batch`` frame whose
    ``data:`` is an array. ``decoded`` is None for a document the decoder
    rejects (a ``state.snapshot`` frame, a misshapen event); the raw form still
    drives terminal detection and the duplicate guard."""
    if not data_lines:
        return []
    raw = "\n".join(data_lines)
    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError:
        return []

    if event == "batch" and isinstance(parsed, list):
        return [(item, decode(item)) for item in parsed]

    if not isinstance(parsed, dict):
        return []
    return [(parsed, decode(parsed))]


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
