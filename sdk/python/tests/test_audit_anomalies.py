"""``audit_verify`` reads every RFC 0218 §C anomaly shape: ``kind`` with its
own members, and a genesis ``chain-break`` whose ``expectedPrevHash`` is null.
Before, a ``merkle-mismatch`` entry (no ``expectedPrevHash``) raised KeyError."""

from __future__ import annotations

import io
import unittest
from unittest import mock

from openwop_client import OpenwopClient

BODY = b'{"fromSeq":0,"toSeq":9,"chainValid":false,"checkpoints":[],"anomalies":[{"atSeq":0,"expectedPrevHash":null,"actualPrevHash":"ab"},{"atSeq":8,"kind":"merkle-mismatch","checkpoint":"cp-1","detail":"root differs"},{"atSeq":3,"kind":"missing-entry"}]}'


class _Resp(io.BytesIO):
    headers: dict[str, str] = {}

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class AuditAnomalyTest(unittest.TestCase):
    def test_reads_every_anomaly_kind(self) -> None:
        seen = []

        def fake_urlopen(req, timeout=None):  # noqa: ANN001
            seen.append(req)
            return _Resp(BODY)

        with mock.patch("openwop_client.client.urlopen", fake_urlopen):
            res = OpenwopClient("https://h.example", "k").audit_verify(0, 9)
        self.assertIn("/v1/audit/verify?", seen[0].full_url)
        genesis, merkle, missing = res.anomalies
        self.assertIsNone(genesis.kind)
        self.assertIsNone(genesis.expectedPrevHash)
        self.assertEqual(genesis.actualPrevHash, "ab")
        self.assertEqual((merkle.kind, merkle.checkpoint, merkle.detail), ("merkle-mismatch", "cp-1", "root differs"))
        self.assertIsNone(merkle.expectedPrevHash)
        self.assertEqual((missing.atSeq, missing.kind), (3, "missing-entry"))


if __name__ == "__main__":
    unittest.main()
