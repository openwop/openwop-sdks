"""``trigger_dead_letters`` maps to ``GET /v1/trigger-subscriptions/{id}/dead-letters``
(RFC 0232 §B; ``api/openapi.yaml`` ``listTriggerDeadLetters``, corpus 2.45.10+).

Patches ``urlopen`` to capture the outgoing request — tests the wire
mapping, not a live runtime.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from openwop_client import OpenwopClient

_PAGE = {
    "deliveries": [
        {
            "subscriptionId": "sub/1",
            "attemptEventId": "ev1",
            "attempt": {"subscriptionId": "sub/1", "dedupKey": "k1", "attempt": 1, "outcome": "dead-lettered"},
            "reason": "verification_failed",
            "deadLetteredAt": "2026-10-03T00:00:00Z",
            "expiresAt": "2026-10-10T00:00:00Z",
        }
    ],
    "nextCursor": "c2",
}


class _Resp:
    headers: dict[str, str] = {}

    def read(self) -> bytes:
        return json.dumps(_PAGE).encode()

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        return None


class TriggerDeadLettersTest(unittest.TestCase):
    def test_path_query_and_page(self) -> None:
        captured = []

        def fake_urlopen(req, timeout=None):  # noqa: ANN001
            captured.append(req)
            return _Resp()

        client = OpenwopClient("https://test.example", "k")
        with mock.patch("openwop_client.client.urlopen", fake_urlopen):
            page = client.trigger_dead_letters("sub/1", limit=10, cursor="c1")
        self.assertEqual(captured[0].get_method(), "GET")
        parts = urlsplit(captured[0].full_url)
        self.assertEqual(parts.path, "/v1/trigger-subscriptions/sub%2F1/dead-letters")
        self.assertEqual(parse_qs(parts.query), {"limit": ["10"], "cursor": ["c1"]})
        self.assertEqual(page.deliveries[0].reason, "verification_failed")
        self.assertIsNone(page.deliveries[0].stateChange)
        self.assertEqual(page.nextCursor, "c2")


if __name__ == "__main__":
    unittest.main()
