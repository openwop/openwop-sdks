"""RFC 0247 — resumable SSE streams. A host may end an opted-in stream before
the run's terminal event, and platforms end long streams regardless. The SDK
must resume with ``Last-Event-ID`` = the last ``id:`` it received, honour
``retry:``, never re-yield an event, and stop at the terminal event.
``urlopen`` is stubbed in the SSE module with one scripted response per
connect."""

from __future__ import annotations

import io
import json
import time
import unittest
from typing import Any
from unittest import mock
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlparse

from openwop_client import sse as sse_module
from openwop_client.sse import stream_events, stream_host_events


class _Resp(io.BytesIO):
    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _scripted(steps: list[Any]) -> tuple[list[Any], Any]:
    seen: list[Any] = []

    def urlopen(req: Any, timeout: float = 0) -> Any:
        seen.append(req)
        if len(seen) > len(steps):
            raise AssertionError(f"unexpected connect #{len(seen)}")
        step = steps[len(seen) - 1]
        if step == "network-error":
            raise URLError("connection reset")
        if isinstance(step, tuple):
            status, headers = step
            raise HTTPError(req.full_url, status, "err", headers, io.BytesIO(b""))  # type: ignore[arg-type]
        return _Resp(step.encode())

    return seen, urlopen


def _ev(seq: int, typ: str) -> str:
    doc = {
        "eventId": f"e{seq}",
        "runId": "t/r1",
        "type": typ,
        "payload": {},
        "timestamp": "t",
        "sequence": seq,
        "schemaVersion": 1,
    }
    return f"id: {seq}\nevent: {typ}\ndata: {json.dumps(doc)}\n\n"


FAST = {
    "reconnect_delay_seconds": 0.001,
    "max_reconnect_delay_seconds": 0.004,
    "max_reconnect_attempts": 3,
}


def _last_ids(seen: list[Any]) -> list[str | None]:
    return [req.get_header("Last-event-id") for req in seen]


class StreamEventsResumeTests(unittest.TestCase):
    def run_events(self, steps: list[Any], **kw: Any) -> tuple[list[Any], list[Any]]:
        seen, urlopen = _scripted(steps)
        with mock.patch.object(sse_module, "urlopen", urlopen):
            out = list(
                stream_events("https://h.example", "k", "t/r1", **{**FAST, **kw})
            )
        return out, seen

    def test_resumes_with_last_id_honours_retry_no_duplicates_stops_at_terminal(
        self,
    ) -> None:
        started = time.monotonic()
        out, seen = self.run_events(
            [
                "retry: 5\n\n" + _ev(0, "run.started") + _ev(1, "node.started"),
                _ev(1, "node.started")
                + _ev(2, "node.completed"),  # re-sent resumption point is guarded
                _ev(3, "run.completed"),
            ]
        )
        self.assertEqual(
            [(e.sequence, e.type) for e in out],
            [
                (0, "run.started"),
                (1, "node.started"),
                (2, "node.completed"),
                (3, "run.completed"),
            ],
        )
        self.assertEqual(_last_ids(seen), [None, "1", "2"])
        for req in seen:
            self.assertEqual(
                parse_qs(urlparse(req.full_url).query)["resumable"], ["true"]
            )
        self.assertGreaterEqual(
            time.monotonic() - started, 0.009
        )  # two waits of retry: 5

    def test_resumes_from_caller_last_event_id_and_batch_id(self) -> None:
        batch = [
            json.loads(_ev(s, "node.started").split("data: ", 1)[1]) for s in (5, 6)
        ]
        out, seen = self.run_events(
            [
                f"id: 6\nevent: batch\ndata: {json.dumps(batch)}\n\n",
                _ev(7, "run.failed"),
            ],
            last_event_id="4",
        )
        self.assertEqual([e.sequence for e in out], [5, 6, 7])
        self.assertEqual(_last_ids(seen), ["4", "6"])

    def test_resume_on_terminal_run_that_closes_at_once_ends(self) -> None:
        out, seen = self.run_events([_ev(0, "run.started"), ": keep-alive\n\n"])
        self.assertEqual([e.sequence for e in out], [0])
        self.assertEqual(len(seen), 2)

    def test_terminal_state_snapshot_ends_values_mode(self) -> None:
        def snap(st: str) -> str:
            return f"id: 2\nevent: state.snapshot\ndata: {json.dumps({'runId': 't/r1', 'status': st})}\n\n"

        _, seen = self.run_events(
            [snap("running"), snap("completed")], stream_mode="values"
        )
        self.assertEqual(len(seen), 2)

    def test_retries_dropped_connection_and_503(self) -> None:
        out, seen = self.run_events(
            [
                _ev(0, "run.started"),
                "network-error",
                (503, {"Retry-After": "0"}),
                _ev(1, "run.cancelled"),
            ]
        )
        self.assertEqual([e.sequence for e in out], [0, 1])
        self.assertEqual(_last_ids(seen), [None, "0", "0", "0"])

    def test_non_retryable_status_raises(self) -> None:
        seen, urlopen = _scripted([_ev(0, "run.started"), (403, {})])
        out: list[Any] = []
        with (
            mock.patch.object(sse_module, "urlopen", urlopen),
            self.assertRaises(HTTPError) as cm,
        ):
            for e in stream_events("https://h.example", "k", "t/r1", **FAST):
                out.append(e.sequence)
        self.assertEqual(cm.exception.code, 403)
        self.assertEqual(out, [0])
        self.assertEqual(len(seen), 2)

    def test_gives_up_after_max_attempts(self) -> None:
        seen, urlopen = _scripted([_ev(0, "run.started")] + ["network-error"] * 4)
        with (
            mock.patch.object(sse_module, "urlopen", urlopen),
            self.assertRaises(URLError),
        ):
            list(stream_events("https://h.example", "k", "t/r1", **FAST))
        self.assertEqual(len(seen), 5)

    def test_first_connect_fails_fast(self) -> None:
        seen, urlopen = _scripted([(503, {})])
        with (
            mock.patch.object(sse_module, "urlopen", urlopen),
            self.assertRaises(HTTPError),
        ):
            list(stream_events("https://h.example", "k", "t/r1", **FAST))
        self.assertEqual(len(seen), 1)

    def test_reconnect_false_keeps_one_connection_and_no_flag(self) -> None:
        out, seen = self.run_events([_ev(0, "run.started")], reconnect=False)
        self.assertEqual([e.sequence for e in out], [0])
        self.assertEqual(len(seen), 1)
        self.assertNotIn("resumable", urlparse(seen[0].full_url).query)

    def test_breaking_out_stops_reconnecting(self) -> None:
        seen, urlopen = _scripted([_ev(0, "run.started") + _ev(1, "node.started")])
        with mock.patch.object(sse_module, "urlopen", urlopen):
            for _ in stream_events("https://h.example", "k", "t/r1", **FAST):
                break
        self.assertEqual(len(seen), 1)


class StreamHostEventsResumeTests(unittest.TestCase):
    def test_ephemeral_frames_do_not_move_cursor_and_empty_close_backs_off(
        self,
    ) -> None:
        def host(i: str | None, typ: str) -> str:
            return (
                f"id: {i}\n" if i else ""
            ) + f"event: {typ}\ndata: {json.dumps({'type': typ, 'payload': {}})}\n\n"

        seen, urlopen = _scripted(
            [
                host("h-1", "heartbeat.evaluated") + host(None, "host-test.ephemeral"),
                "",
                host("h-2", "heartbeat.stateChanged"),
            ]
        )
        out: list[str] = []
        with mock.patch.object(sse_module, "urlopen", urlopen):
            for e in stream_host_events("https://h.example", "k", **FAST):
                out.append(e.type)
                if len(out) == 3:
                    break
        self.assertEqual(
            out,
            ["heartbeat.evaluated", "host-test.ephemeral", "heartbeat.stateChanged"],
        )
        self.assertEqual(_last_ids(seen), [None, "h-1", "h-1"])
        parsed = urlparse(seen[0].full_url)
        self.assertEqual(parsed.path, "/host/events")
        self.assertEqual(parse_qs(parsed.query)["resumable"], ["true"])


if __name__ == "__main__":
    unittest.main()
