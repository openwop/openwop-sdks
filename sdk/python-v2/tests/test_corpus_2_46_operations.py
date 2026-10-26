"""Corpus v2.46.28: RFC 0251 eval-run baseline selection on ``runs_create``, and
the operations added to ``spec/v2/path-manifest.json`` since v2.45.10 (RFC 0249
proposals, the connection-provider registry, the host test-event emitter, and
the front-end plugin frame + RPC). ``urlopen`` is stubbed; no socket opens."""

from __future__ import annotations

import io
import json
import unittest
from typing import Any
from unittest import mock

import openwop_client.client as client_module
from openwop_client import (
    ApplyProposalGateResponse,
    CreateRunRequest,
    OpenwopClient,
    Proposal,
    ReviseProposalRequest,
    SubmitProposalRequest,
    UiPluginRequest,
)


class _Resp(io.BytesIO):
    def __init__(self, body: bytes) -> None:
        super().__init__(body)
        self.headers: dict[str, str] = {}
        self.status = 200

    def __enter__(self) -> "_Resp":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


def _stub(responder: Any) -> tuple[list[Any], Any]:
    seen: list[Any] = []

    def urlopen(req: Any, timeout: float = 0) -> Any:
        seen.append(req)
        body = responder(req)
        return _Resp(body if isinstance(body, bytes) else json.dumps(body).encode())

    return seen, urlopen


def _body(req: Any) -> Any:
    return json.loads(req.data.decode()) if req.data else None


PROPOSAL = {
    "id": "p1",
    "kind": "prompt-template",
    "state": "draft",
    "artifact": {"templateId": "x"},
    "provenance": {"sourceRunIds": []},
    "owner": {"tenant": "t"},
    "createdAt": "2026-10-26T00:00:00Z",
}


class EvalBaselineSelectionTests(unittest.TestCase):
    def test_both_fields_sent_at_the_root(self) -> None:
        seen, urlopen = _stub(lambda req: {"runId": "t/r2", "status": "pending", "eventsUrl": ""})
        with mock.patch.object(client_module, "urlopen", urlopen):
            OpenwopClient("https://h.example", "k").runs_create(
                CreateRunRequest(
                    mode="eval",
                    evalSuiteRef="suite://s",
                    agentId="a",
                    evalModes=["golden", "regression"],
                    baselineRunId="t/r1",
                )
            )
        self.assertEqual(
            _body(seen[0]),
            {
                "mode": "eval",
                "evalSuiteRef": "suite://s",
                "agentId": "a",
                "evalModes": ["golden", "regression"],
                "baselineRunId": "t/r1",
            },
        )

    def test_omitted_when_absent(self) -> None:
        seen, urlopen = _stub(lambda req: {"runId": "t/r2", "status": "pending", "eventsUrl": ""})
        with mock.patch.object(client_module, "urlopen", urlopen):
            OpenwopClient("https://h.example", "k").runs_create(
                CreateRunRequest(mode="eval", evalSuiteRef="suite://s", agentId="a")
            )
        body = _body(seen[0])
        self.assertNotIn("evalModes", body)
        self.assertNotIn("baselineRunId", body)

    def test_fixture_runs_sent_at_the_root_and_omitted_when_absent(self) -> None:
        seen, urlopen = _stub(lambda req: {"runId": "t/r3", "status": "pending", "eventsUrl": ""})
        with mock.patch.object(client_module, "urlopen", urlopen):
            c = OpenwopClient("https://h.example", "k")
            c.runs_create(
                CreateRunRequest(
                    mode="eval", evalSuiteRef="suite://s", agentId="a", fixtureRuns={"record": "t/r1"}
                )
            )
            c.runs_create(CreateRunRequest(mode="eval", evalSuiteRef="suite://s", agentId="a"))
        self.assertEqual(
            _body(seen[0]),
            {"mode": "eval", "evalSuiteRef": "suite://s", "agentId": "a", "fixtureRuns": {"record": "t/r1"}},
        )
        self.assertNotIn("fixtureRuns", _body(seen[1]))


class ProposalTests(unittest.TestCase):
    def test_each_operation(self) -> None:
        def responder(req: Any) -> Any:
            if req.get_method() == "GET" and "?" in req.full_url:
                return {"items": [PROPOSAL], "nextCursor": "c2"}
            if req.full_url.endswith(":apply"):
                return {"runId": "t/gate"}
            return PROPOSAL

        seen, urlopen = _stub(responder)
        with mock.patch.object(client_module, "urlopen", urlopen):
            c = OpenwopClient("https://h.example", "k")
            page = c.proposals_list(state="draft", kind="prompt-template", limit=5, cursor="c")
            c.proposals_submit(SubmitProposalRequest(kind="prompt-template", artifact={"templateId": "x"}), idempotency_key="i1")
            got = c.proposals_get("p/1")
            c.proposals_revise("p1", ReviseProposalRequest(title="t"))
            c.proposals_archive("p1")
            gate = c.proposals_apply("p1", artifact_digest="sha256:ab", idempotency_key="i2")
            c.proposals_reject("p1", reason="no")
        self.assertEqual(page.items[0].id, "p1")
        self.assertEqual(page.nextCursor, "c2")
        self.assertIsInstance(got, Proposal)
        self.assertEqual(gate, ApplyProposalGateResponse(runId="t/gate"))
        self.assertEqual(
            [f"{r.get_method()} {r.full_url.replace('https://h.example', '')}" for r in seen],
            [
                "GET /proposals?state=draft&kind=prompt-template&limit=5&cursor=c",
                "POST /proposals",
                "GET /proposals/p%2F1",
                "PATCH /proposals/p1",
                "DELETE /proposals/p1",
                "POST /proposals/p1:apply",
                "POST /proposals/p1:reject",
            ],
        )
        self.assertEqual(seen[1].get_header("Idempotency-key"), "i1")
        self.assertEqual(_body(seen[3]), {"title": "t"})
        self.assertEqual(_body(seen[5]), {"artifactDigest": "sha256:ab"})
        self.assertEqual(_body(seen[6]), {"reason": "no"})


class ConnectionProviderTests(unittest.TestCase):
    def test_list_and_resolve(self) -> None:
        def responder(req: Any) -> Any:
            if req.full_url.endswith("/connection-providers"):
                return {
                    "providers": [{"id": "slack", "source": "pack", "packName": "@acme/slack"}],
                    "refusals": [{"packName": "@b/slack", "providerId": "slack", "code": "connection_provider_conflict", "heldBy": "@acme/slack"}],
                }
            return {"id": "slack", "source": "builtin"}

        seen, urlopen = _stub(responder)
        with mock.patch.object(client_module, "urlopen", urlopen):
            c = OpenwopClient("https://h.example", "k")
            reg = c.connection_providers_list()
            c.connection_providers_resolve("slack")
            one = c.connection_providers_resolve("slack", pack="@acme/slack")
        self.assertEqual(reg.providers[0].packName, "@acme/slack")
        self.assertEqual(reg.refusals[0].heldBy, "@acme/slack")
        self.assertEqual(one.source, "builtin")
        self.assertEqual(
            [r.full_url.replace("https://h.example", "") for r in seen],
            ["/connection-providers", "/connection-providers/slack", "/connection-providers/slack?pack=%40acme%2Fslack"],
        )


class HostTestEventAndUiPluginTests(unittest.TestCase):
    def test_emit_test_event(self) -> None:
        seen, urlopen = _stub(lambda req: {"eventId": "e1", "type": "host-test.ephemeral-triggered"})
        with mock.patch.object(client_module, "urlopen", urlopen):
            out = OpenwopClient("https://h.example", "k").host_emit_test_event(
                "ephemeral", workspace_id="w1", idempotency_key="k1"
            )
        self.assertEqual(out.type, "host-test.ephemeral-triggered")
        self.assertEqual(seen[0].full_url, "https://h.example/host/events/test")
        self.assertEqual(_body(seen[0]), {"delivery": "ephemeral", "workspaceId": "w1"})
        self.assertEqual(seen[0].get_header("Idempotency-key"), "k1")

    def test_frame_is_verbatim_html_and_rpc_wraps_the_message(self) -> None:
        html = b"<!doctype html><title>p</title>"

        def responder(req: Any) -> Any:
            if req.get_method() == "GET":
                return html
            return {"openwop": "ui-plugin/1", "type": "response", "id": 1, "ok": False, "error": {"code": "method_not_allowed"}}

        seen, urlopen = _stub(responder)
        with mock.patch.object(client_module, "urlopen", urlopen):
            c = OpenwopClient("https://h.example", "k")
            frame = c.host_ui_plugin_frame("@acme/editor", "main")
            res = c.host_dispatch_ui_plugin_request("@acme/editor", "main", UiPluginRequest(id=1, method="host.toast"))
        self.assertEqual(frame, html.decode())
        self.assertEqual(seen[0].get_header("Accept"), "text/html")
        self.assertEqual(seen[0].full_url, "https://h.example/host/ui-plugins/%40acme%2Feditor/main/frame")
        self.assertFalse(res.ok)
        self.assertEqual(res.error, {"code": "method_not_allowed"})
        self.assertEqual(
            _body(seen[1]),
            {"message": {"id": 1, "method": "host.toast", "openwop": "ui-plugin/1", "type": "request"}},
        )


if __name__ == "__main__":
    unittest.main()
