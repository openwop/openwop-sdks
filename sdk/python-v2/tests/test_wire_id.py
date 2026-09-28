"""Tenant-bound id wire form (``spec/v2/core/identity.md`` §5 "Wire form"):
every UTF-8 byte outside ``[A-Za-z0-9._-]`` projects to ``~`` + two uppercase
hex digits; a wire id in either the projected or the percent form decodes back
to the bound id. ``urlopen`` is stubbed so no socket is opened."""

from __future__ import annotations

import io
import json
import unittest
from typing import Any
from unittest import mock
from urllib.error import HTTPError

import openwop_client.client as client_module
from openwop_client import OpenwopClient, WopError, project_id, unproject_id


class ProjectIdTests(unittest.TestCase):
    def test_spec_example_and_anon_prefix(self) -> None:
        self.assertEqual(project_id("acme/r-9f3c"), "acme~2Fr-9f3c")
        self.assertEqual(project_id("anon:sess-3f9c/r_1.2"), "anon~3Asess-3f9c~2Fr_1.2")

    def test_tilde_and_non_ascii_bytes(self) -> None:
        self.assertEqual(project_id("a~b/c"), "a~7Eb~2Fc")
        self.assertEqual(project_id("café/r"), "caf~C3~A9~2Fr")
        self.assertEqual(project_id("t/\U0001f600"), "t~2F~F0~9F~98~80")

    def test_never_double_escapes_a_wire_form(self) -> None:
        self.assertEqual(project_id("acme~2Fr-9f3c"), "acme~2Fr-9f3c")
        self.assertEqual(project_id("acme%2Fr-9f3c"), "acme~2Fr-9f3c")
        self.assertEqual(project_id("acme%2fr-9f3c"), "acme~2Fr-9f3c")

    def test_bare_segment_unchanged(self) -> None:
        self.assertEqual(project_id("r-9f3c0000000000000000"), "r-9f3c0000000000000000")


class UnprojectIdTests(unittest.TestCase):
    def test_accepts_both_forms(self) -> None:
        self.assertEqual(unproject_id("acme~2Fr-9f3c"), "acme/r-9f3c")
        self.assertEqual(unproject_id("acme%2Fr-9f3c"), "acme/r-9f3c")
        self.assertEqual(unproject_id("caf~C3~A9~2Fr"), "café/r")
        self.assertEqual(unproject_id("acme/r-9f3c"), "acme/r-9f3c")

    def test_round_trip(self) -> None:
        for id_ in ["acme/r-9f3c", "anon:s/x", "a~b/c", "café/r", "t/\U0001f600"]:
            self.assertEqual(unproject_id(project_id(id_)), id_)


class _Resp(io.BytesIO):
    headers: dict[str, str] = {}

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _stub(status: int, body: Any = None) -> tuple[list[Any], Any]:
    seen: list[Any] = []

    def urlopen(req: Any, timeout: float = 0) -> Any:
        seen.append(req)
        raw = json.dumps(body).encode() if body is not None else b""
        if status >= 400:
            raise HTTPError(req.full_url, status, "err", {}, io.BytesIO(raw))  # type: ignore[arg-type]
        return _Resp(raw)

    return seen, urlopen


class ClientWireTests(unittest.TestCase):
    def test_tenant_bound_segments_are_projected(self) -> None:
        seen, urlopen = _stub(204)
        with mock.patch.object(client_module, "urlopen", urlopen):
            OpenwopClient("https://h.example", "k").webhooks_unregister("acme/sub-1")
        self.assertEqual(seen[0].full_url, "https://h.example/webhooks/acme~2Fsub-1")
        seen, urlopen = _stub(404, {"error": "not_found", "message": "no"})
        with mock.patch.object(client_module, "urlopen", urlopen):
            OpenwopClient("https://h.example", "k").runs_diff("acme/r1", "acme~2Fr2")
        self.assertEqual(
            seen[0].full_url, "https://h.example/runs/acme~2Fr1:diff?against=acme~2Fr2"
        )

    def test_content_delete_page(self) -> None:
        seen, urlopen = _stub(204)
        with mock.patch.object(client_module, "urlopen", urlopen):
            self.assertIsNone(OpenwopClient("https://h.example", "k").content_delete_page("page 1"))
        self.assertEqual(seen[0].get_method(), "DELETE")
        self.assertEqual(seen[0].full_url, "https://h.example/content/pages/page%201")
        self.assertEqual(seen[0].get_header("Authorization"), "Bearer k")

    def test_content_delete_page_404_raises(self) -> None:
        _, urlopen = _stub(404, {"error": "not_found", "message": "no page"})
        with mock.patch.object(client_module, "urlopen", urlopen):
            with self.assertRaises(WopError) as ctx:
                OpenwopClient("https://h.example", "k").content_delete_page("gone")
        self.assertEqual(ctx.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
