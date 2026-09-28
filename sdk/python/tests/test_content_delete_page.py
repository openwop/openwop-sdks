"""``content_delete_page`` — ``DELETE /v1/content/pages/{pageId}``
(``localized-content.md`` §D; ``api/openapi.yaml`` ``deleteContentPage``,
corpus 2.42.2+). Patches ``urlopen`` — tests the wire mapping, not a live
runtime."""

from __future__ import annotations

import io
import unittest
from unittest import mock
from urllib.error import HTTPError

from openwop_client import OpenwopClient, WopError


class _Resp:
    headers: dict[str, str] = {}

    def read(self) -> bytes:
        return b""

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class ContentDeletePageTest(unittest.TestCase):
    def test_sends_delete_and_returns_none(self) -> None:
        captured = []

        def fake_urlopen(req, timeout=None):  # noqa: ANN001
            captured.append(req)
            return _Resp()

        with mock.patch("openwop_client.client.urlopen", fake_urlopen):
            self.assertIsNone(OpenwopClient("https://test.example", "k").content_delete_page("page 1"))
        self.assertEqual(captured[0].get_method(), "DELETE")
        self.assertEqual(captured[0].full_url, "https://test.example/v1/content/pages/page%201")

    def test_404_raises(self) -> None:
        def fake_urlopen(req, timeout=None):  # noqa: ANN001
            body = io.BytesIO(b'{"error":"not_found","message":"no page"}')
            raise HTTPError(req.full_url, 404, "nf", {}, body)  # type: ignore[arg-type]

        with mock.patch("openwop_client.client.urlopen", fake_urlopen):
            with self.assertRaises(WopError) as ctx:
                OpenwopClient("https://test.example", "k").content_delete_page("gone")
        self.assertEqual(ctx.exception.status, 404)


if __name__ == "__main__":
    unittest.main()
