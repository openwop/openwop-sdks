"""RFC 0219 — ``OpenWOP-Client-Version`` names the corpus release this SDK is
built against (CORPUS_TAG), never the package version, and rides every
request: the JSON path and the SSE subscribe. ``urlopen`` is stubbed in both
the client and the SSE module; nothing touches the network.
"""

from __future__ import annotations

import io
import re
import unittest
from pathlib import Path
from typing import Any
from unittest import mock

import openwop_client.client as client_module
import openwop_client.sse as sse_module
from openwop_client import CORPUS_VERSION, OpenwopClient, __version__

REPO = Path(__file__).resolve().parents[3]
GRAMMAR = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$")
# urllib.request.Request stores header names str.capitalize()d.
HEADER = "Openwop-client-version"


def _expected_from_corpus_tag() -> str:
    tag = (REPO / "CORPUS_TAG").read_text().strip()
    m = re.match(r"^(?:openwop-conformance/)?v?(\d+)\.(\d+)\.(\d+)(-.+)?$", tag)
    assert m, f"unparseable CORPUS_TAG {tag!r}"
    return f"{m[1]}.{m[2]}" if m[4] else f"{m[1]}.{m[2]}.{m[3]}"


class _Resp(io.BytesIO):
    def __init__(self, body: bytes) -> None:
        super().__init__(body)
        self.headers: dict[str, str] = {}
        self.status = 200

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class ClientVersionTests(unittest.TestCase):
    def test_constant_matches_grammar_and_corpus_tag(self) -> None:
        self.assertRegex(CORPUS_VERSION, GRAMMAR)
        self.assertEqual(CORPUS_VERSION, _expected_from_corpus_tag())
        self.assertNotEqual(CORPUS_VERSION, __version__)

    def test_sent_on_json_request_and_sse_subscribe(self) -> None:
        seen: list[Any] = []

        def urlopen(req: Any, timeout: float = 0) -> Any:
            seen.append(req)
            if req.get_header("Accept") == "text/event-stream":
                return _Resp(
                    b'event: heartbeat.evaluated\ndata: {"type":"heartbeat.evaluated","payload":{}}\n\n'
                )
            return _Resp(b"{}")

        client = OpenwopClient(base_url="https://host.example", api_key="k")
        self.assertEqual(client.client_version, CORPUS_VERSION)
        with (
            mock.patch.object(client_module, "urlopen", urlopen),
            mock.patch.object(sse_module, "urlopen", urlopen),
        ):
            client.discovery_openapi()
            list(client.host_events())
            list(client.runs_events("t/r1"))

        self.assertEqual(len(seen), 3)
        for req in seen:
            self.assertEqual(req.get_header(HEADER), _expected_from_corpus_tag())


if __name__ == "__main__":
    unittest.main()
