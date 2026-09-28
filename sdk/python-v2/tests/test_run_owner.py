"""``RunSnapshot.owner.subject`` is the RFC 0170 Subject object
(``schemas/v2/subject.schema.json``), not a string. 2.3.0 stringified the dict."""

from __future__ import annotations

import io
import unittest
from unittest import mock

import openwop_client.client as client_module
from openwop_client import OpenwopClient, Subject

SNAP = b'{"runId":"acme/r-0000000000000001","workflowId":"wf","status":"completed","owner":{"tenant":"acme","subject":{"issuer":"urn:host:api-key","subjectId":"default","tenant":"acme","lane":"api-key","kind":"agent","actor":{"issuer":"urn:host:oidc","subjectId":"u1","tenant":"acme","lane":"oidc","kind":"user"}}},"eventLogSchemaVersion":3,"engineVersion":1,"compensationStatus":"none","variables":{},"startedAt":"t","completedAt":"t"}'


class _Resp(io.BytesIO):
    headers: dict[str, str] = {}

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class RunOwnerTest(unittest.TestCase):
    def test_subject_is_parsed_with_its_actor(self) -> None:
        with mock.patch.object(client_module, "urlopen", lambda req, timeout=0: _Resp(SNAP)):
            snap = OpenwopClient("https://h.example", "k").runs_get("acme/r-0000000000000001")
        subj = snap.owner.subject
        self.assertIsInstance(subj, Subject)
        self.assertEqual((subj.issuer, subj.subjectId, subj.lane, subj.kind), ("urn:host:api-key", "default", "api-key", "agent"))
        assert subj.actor is not None
        self.assertEqual((subj.actor.subjectId, subj.actor.kind, subj.actor.actor), ("u1", "user", None))


if __name__ == "__main__":
    unittest.main()
