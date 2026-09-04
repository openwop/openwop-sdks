"""The v2 wire contract this package exists for (RFC 0172 §A, RFC 0171 §C.1,
events.md §Poll): bare-origin unversioned paths, ``OpenWOP-Version`` on every
request, the ``OpenWOP-*`` header family, ``afterSequence``, and the generated
error-code registry. ``urllib.request.urlopen`` is stubbed in the client
module so no socket is opened."""

from __future__ import annotations

import io
import json
import unittest
from pathlib import Path
from typing import Any
from unittest import mock
from urllib.error import HTTPError

import openwop_client.client as client_module
from openwop_client import (
    CAPABILITY_FAMILY_KEYS,
    CAPABILITY_METADATA_KEYS,
    ERROR_CODE_HTTP_STATUS,
    ERROR_CODES,
    HTTP_ERROR_CODES,
    RETRIABLE_ERROR_CODES,
    SDK_PROTOCOL_MAJOR,
    CreateRunRequest,
    OpenwopClient,
    WopError,
    is_error_code,
    is_retriable_error_code,
    is_vendor_error_code,
    protocol_version_header,
)

REPO = Path(__file__).resolve().parents[3]


class _Resp(io.BytesIO):
    def __init__(self, body: bytes, headers: dict[str, str] | None = None) -> None:
        super().__init__(body)
        self.headers = headers or {}
        self.status = 200

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _stub(responder: Any) -> tuple[list[Any], Any]:
    seen: list[Any] = []

    def urlopen(req: Any, timeout: float = 0) -> Any:
        seen.append(req)
        status, body = responder(req)
        raw = json.dumps(body).encode() if body is not None else b""
        if status >= 400:
            raise HTTPError(req.full_url, status, "err", {}, io.BytesIO(raw))  # type: ignore[arg-type]
        return _Resp(raw)

    return seen, urlopen


class VersionHeaderTests(unittest.TestCase):
    def test_default_major_and_rendering(self) -> None:
        self.assertEqual(SDK_PROTOCOL_MAJOR, 2)
        self.assertEqual(protocol_version_header(2), "2.0")
        self.assertEqual(protocol_version_header(3), "3.0")
        with self.assertRaises(ValueError):
            protocol_version_header(-1)
        self.assertEqual(OpenwopClient("https://h.example/", "k").protocol_version, "2.0")
        self.assertEqual(OpenwopClient("https://h.example/", "k", major=3).protocol_version, "3.0")

    def test_sent_on_every_request(self) -> None:
        def responder(req: Any) -> tuple[int, Any]:
            if req.full_url.endswith("/.well-known/openwop"):
                return 200, {"protocolVersions": ["2.0"], "preferredVersion": "2.0"}
            if req.full_url.endswith("/runs"):
                return 201, {"runId": "t/r", "status": "pending", "eventsUrl": "/runs/t%2Fr/events"}
            return 200, {}

        seen, urlopen = _stub(responder)
        with mock.patch.object(client_module, "urlopen", urlopen):
            c = OpenwopClient("https://h.example/", "k")
            c.discovery_capabilities()
            c.workflows_get("wf")
            c.discovery_openapi()
            c.runs_create(CreateRunRequest(workflowId="wf"), idempotency_key="idem-1", dedup=True)
        self.assertEqual(len(seen), 4)
        for req in seen:
            self.assertEqual(req.get_header("Openwop-version"), "2.0")
            self.assertNotIn("/v1", req.full_url)
        self.assertIsNone(seen[0].get_header("Authorization"))
        self.assertIsNone(seen[2].get_header("Authorization"))
        self.assertEqual(seen[1].get_header("Authorization"), "Bearer k")

    def test_406_surfaces_typed_code(self) -> None:
        _, urlopen = _stub(
            lambda req: (
                406,
                {"error": "protocol_version_unsupported", "message": "unlisted", "details": {"protocolVersions": ["1.12"]}},
            )
        )
        with mock.patch.object(client_module, "urlopen", urlopen):
            with self.assertRaises(WopError) as ctx:
                OpenwopClient("https://h.example", "k").runs_get("t/r1")
        self.assertEqual(ctx.exception.status, 406)
        assert ctx.exception.envelope is not None
        self.assertEqual(ctx.exception.envelope.error, "protocol_version_unsupported")
        self.assertTrue(is_error_code(ctx.exception.envelope.error))


class HeaderRenameAndPathTests(unittest.TestCase):
    def test_openwop_dedup_replaces_x_dedup(self) -> None:
        seen, urlopen = _stub(lambda req: (201, {"runId": "t/r", "status": "pending", "eventsUrl": "/runs/t%2Fr/events"}))
        with mock.patch.object(client_module, "urlopen", urlopen):
            OpenwopClient("https://h.example", "k").runs_create(
                CreateRunRequest(workflowId="wf"), idempotency_key="idem-1", dedup=True
            )
        req = seen[0]
        self.assertEqual(req.get_header("Openwop-dedup"), "enforce")
        self.assertEqual(req.get_header("Idempotency-key"), "idem-1")
        self.assertIsNone(req.get_header("X-dedup"))
        self.assertEqual(req.full_url, "https://h.example/runs")

    def test_paths_are_unversioned(self) -> None:
        seen, urlopen = _stub(lambda req: (200, {}))
        with mock.patch.object(client_module, "urlopen", urlopen):
            c = OpenwopClient("https://h.example", "k")
            c.discovery_openapi()
            c.workflows_get("wf")
            c.agents_get_org_chart()
            c.tools_list()
            c.prompts_delete("p1")
            c.webhooks_unregister("wh1")
        paths = [req.full_url.replace("https://h.example", "") for req in seen]
        self.assertEqual(
            paths,
            ["/openapi.json", "/workflows/wf", "/agents/org-chart", "/tools", "/prompts/p1", "/webhooks/wh1"],
        )

    def test_rfc0173_reads_and_host_seams(self) -> None:
        def responder(req: Any) -> tuple[int, Any]:
            url = req.full_url
            if url.endswith("/compensation"):
                return 200, {"runId": "t/r1", "status": "none", "plan": [], "attempts": []}
            if url.endswith("/effects"):
                return 404, {"error": "not_found", "message": "no"}
            return 200, {"manifestVersion": "1", "host": {"name": "h", "build": {"kind": "commit", "id": "abc"}}, "seams": [
                {"seam": "http.fetch", "kind": "http", "guarded": True, "guardedBy": "interceptor"}]}

        seen, urlopen = _stub(responder)
        with mock.patch.object(client_module, "urlopen", urlopen):
            c = OpenwopClient("https://h.example", "k")
            comp = c.runs_compensation("t/r1")
            eff = c.runs_effects("t/r1")
            seams = c.host_effect_seams()
        assert comp is not None
        self.assertEqual(comp.status, "none")
        self.assertIsNone(eff)
        self.assertEqual(seams.seams[0].seam, "http.fetch")
        self.assertEqual(
            [req.full_url.replace("https://h.example", "") for req in seen],
            ["/runs/t%2Fr1/compensation", "/runs/t%2Fr1/effects", "/host/effect-seams"],
        )


class PollCursorTests(unittest.TestCase):
    def test_after_sequence_and_closed_response(self) -> None:
        page = {"runId": "t/r1", "events": [], "lastSequence": -1, "status": "running", "isTerminal": False}
        seen, urlopen = _stub(lambda req: (200, page))
        with mock.patch.object(client_module, "urlopen", urlopen):
            res = OpenwopClient("https://h.example", "k").runs_poll_events("t/r1", after_sequence=7, timeout_seconds=5)
        url = seen[0].full_url
        self.assertIn("/runs/t%2Fr1/events/poll?", url)
        self.assertIn("afterSequence=7", url)
        self.assertIn("timeout=5", url)
        self.assertNotIn("lastSequence", url)
        self.assertEqual(res.lastSequence, -1)
        self.assertFalse(res.isTerminal)


class ClosedRootTests(unittest.TestCase):
    def test_capabilities_parse_families_and_metadata(self) -> None:
        doc = {
            "protocolVersions": ["1.12", "2.0"],
            "preferredVersion": "2.0",
            "engineVersion": 7,
            "webhooks": {"status": "stable", "since": "2.0", "witness": "witnessable-gated", "signatureAlgorithms": ["v1"]},
            "extensions": {"acme.thing": {"x": 1}},
        }
        _, urlopen = _stub(lambda req: (200, doc))
        with mock.patch.object(client_module, "urlopen", urlopen):
            caps = OpenwopClient("https://h.example", "k").discovery_capabilities()
        self.assertEqual(caps.preferredVersion, "2.0")
        self.assertEqual(caps.protocolVersions, ["1.12", "2.0"])
        self.assertEqual(caps.engineVersion, 7)
        wh = caps.family("webhooks")
        assert wh is not None
        self.assertEqual(wh.status, "stable")
        self.assertEqual(wh.facets, {"signatureAlgorithms": ["v1"]})
        self.assertIsNone(caps.family("compensation"))
        self.assertEqual(caps.extensions, {"acme.thing": {"x": 1}})

    def test_generated_keys_partition_the_schema(self) -> None:
        schema = json.loads((REPO / "schemas/v2/capabilities.schema.json").read_text())
        self.assertIs(schema["additionalProperties"], False)
        self.assertEqual(sorted(schema["required"]), ["preferredVersion", "protocolVersions"])
        self.assertEqual(sorted(CAPABILITY_FAMILY_KEYS + CAPABILITY_METADATA_KEYS), sorted(schema["properties"]))
        for key in CAPABILITY_FAMILY_KEYS:
            self.assertIn("witness", schema["properties"][key]["required"])


class GeneratedRegistryTests(unittest.TestCase):
    def test_error_codes_match_errors_json(self) -> None:
        registry = json.loads((REPO / "spec/v2/errors.json").read_text())
        codes = {r["code"] for r in registry["rows"]}
        self.assertEqual(ERROR_CODES, frozenset(codes))
        self.assertEqual(len(ERROR_CODES), 92)
        self.assertIs(HTTP_ERROR_CODES, ERROR_CODES)
        for r in registry["rows"]:
            self.assertEqual(ERROR_CODE_HTTP_STATUS[r["code"]], r["httpStatus"])
        self.assertEqual(RETRIABLE_ERROR_CODES, frozenset(r["code"] for r in registry["rows"] if r["retriable"]))
        self.assertTrue(is_retriable_error_code("rate_limited"))
        self.assertFalse(is_retriable_error_code("not_found"))
        self.assertFalse(is_error_code("acme.quota_exceeded"))
        self.assertTrue(is_vendor_error_code("acme.quota_exceeded"))
        self.assertFalse(is_vendor_error_code("openwop.reserved"))


if __name__ == "__main__":
    unittest.main()
