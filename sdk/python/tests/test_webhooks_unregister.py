"""``webhooks_unregister`` sends the ``tenantId`` query parameter the v1
contract requires (``spec/v1/webhooks.md`` "Unregister"; ``api/openapi.yaml``
``unregisterWebhook``, corpus 2.37.1+). openwop-sdks#50.

Patches ``urlopen`` to capture the outgoing request — tests the wire
mapping, not a live runtime.
"""

from __future__ import annotations

import unittest
import warnings
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from openwop_client import OpenwopClient


class _Resp:
    headers: dict[str, str] = {}

    def read(self) -> bytes:
        return b""

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class WebhooksUnregisterTest(unittest.TestCase):
    def _call(self, *args: str) -> tuple[str, str, list[warnings.WarningMessage]]:
        captured = []

        def fake_urlopen(req, timeout=None):  # noqa: ANN001
            captured.append(req)
            return _Resp()

        client = OpenwopClient("https://test.example", "k")
        with mock.patch("openwop_client.client.urlopen", fake_urlopen), warnings.catch_warnings(
            record=True
        ) as caught:
            warnings.simplefilter("always")
            client.webhooks_unregister(*args)
        self.assertEqual(len(captured), 1)
        return captured[0].get_method(), captured[0].full_url, list(caught)

    def test_sends_tenant_id_query(self) -> None:
        method, url, caught = self._call("sub/1", "tenant a")
        self.assertEqual(method, "DELETE")
        parts = urlsplit(url)
        self.assertEqual(parts.path, "/v1/webhooks/sub%2F1")
        self.assertEqual(parse_qs(parts.query), {"tenantId": ["tenant a"]})
        self.assertFalse([w for w in caught if issubclass(w.category, DeprecationWarning)])

    def test_omitting_tenant_id_is_deprecated_and_sends_no_query(self) -> None:
        method, url, caught = self._call("sub-1")
        self.assertEqual(method, "DELETE")
        parts = urlsplit(url)
        self.assertEqual(parts.path, "/v1/webhooks/sub-1")
        self.assertEqual(parts.query, "")
        self.assertTrue([w for w in caught if issubclass(w.category, DeprecationWarning)])


if __name__ == "__main__":
    unittest.main()
