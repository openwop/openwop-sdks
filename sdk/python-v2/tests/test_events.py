"""Typed agent.* event helper tests (RFC 0002 + RFC 0024).

Parallel to `sdk/typescript/src/__tests__/event-helpers.test.ts`:
predicate true/positive matrix, typed extractor returns `None` on
miss, schema-mirror sanity check that the TypedDict required fields
match the canonical JSON schema $defs.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from openwop_client import (
    RunEventDoc,
    agent_decided_payload,
    agent_handoff_payload,
    agent_reasoned_payload,
    agent_reasoning_delta_payload,
    agent_tool_called_payload,
    is_agent_decided,
    is_agent_handoff,
    is_agent_reasoned,
    is_agent_reasoning_delta,
    is_agent_tool_called,
    is_agent_tool_returned,
)

SCHEMA_PATH = (
    Path(__file__).resolve().parent.parent.parent.parent
    / "schemas"
    / "v2"
    / "run-event-payloads.schema.json"
)


def _ev(event_type: str, payload: object) -> RunEventDoc:
    return RunEventDoc(
        eventId="evt-x",
        runId="run-x",
        type=event_type,
        payload=payload,
        timestamp="2026-05-19T00:00:00Z",
        sequence=0,
        schemaVersion=1,
    )


class AgentEventTypeGuardsTrue(unittest.TestCase):
    def test_is_agent_reasoned_matches_well_formed(self) -> None:
        ev = _ev("agent.reasoned", {"agentId": "asst-1", "reasoning": "thinking…", "verbosity": "full"})
        self.assertTrue(is_agent_reasoned(ev))
        payload = agent_reasoned_payload(ev)
        assert payload is not None
        self.assertEqual(payload["reasoning"], "thinking…")
        self.assertEqual(payload["verbosity"], "full")

    def test_is_agent_reasoning_delta_matches_well_formed(self) -> None:
        ev = _ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "step 1", "sequence": 0})
        self.assertTrue(is_agent_reasoning_delta(ev))
        payload = agent_reasoning_delta_payload(ev)
        assert payload is not None
        self.assertEqual(payload["delta"], "step 1")
        self.assertEqual(payload["sequence"], 0)

    def test_is_agent_tool_called_matches_well_formed(self) -> None:
        ev = _ev("agent.toolCalled", {"agentId": "asst-1", "toolName": "echo", "callId": "c-1", "inputs": {"x": 1}})
        self.assertTrue(is_agent_tool_called(ev))

    def test_is_agent_tool_returned_matches_well_formed(self) -> None:
        ev = _ev("agent.toolReturned", {"agentId": "asst-1", "toolName": "echo", "callId": "c-1", "outcome": {"x": 1}})
        self.assertTrue(is_agent_tool_returned(ev))

    def test_is_agent_handoff_matches_distinct_field_names(self) -> None:
        # Note: agent.handoff uses fromAgentId / toAgentId, NOT a single agentId.
        ev = _ev("agent.handoff", {"fromAgentId": "asst-1", "toAgentId": "researcher", "reason": "specialist"})
        self.assertTrue(is_agent_handoff(ev))
        payload = agent_handoff_payload(ev)
        assert payload is not None
        self.assertEqual(payload["fromAgentId"], "asst-1")
        self.assertEqual(payload["toAgentId"], "researcher")

    def test_is_agent_decided_matches_well_formed(self) -> None:
        ev = _ev("agent.decided", {"agentId": "asst-1", "decision": {"next": "done"}, "confidence": 0.95})
        self.assertTrue(is_agent_decided(ev))


class AgentEventTypeGuardsFalse(unittest.TestCase):
    def test_wrong_type_discriminator_rejected(self) -> None:
        ev = _ev("node.message", {"agentId": "asst-1", "reasoning": "x"})
        self.assertFalse(is_agent_reasoned(ev))
        self.assertFalse(is_agent_reasoning_delta(ev))

    def test_missing_required_fields_rejected(self) -> None:
        # agent.reasoned without `reasoning`
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", {"agentId": "asst-1"})))
        # agent.reasoning.delta without `delta`
        self.assertFalse(is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "sequence": 0})))
        # agent.reasoning.delta with negative sequence
        self.assertFalse(
            is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "x", "sequence": -1}))
        )
        # agent.reasoning.delta with float sequence (must be int)
        self.assertFalse(
            is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "x", "sequence": 1.5}))
        )
        # agent.reasoning.delta with bool sequence (bool subclasses int in Python — must reject)
        self.assertFalse(
            is_agent_reasoning_delta(_ev("agent.reasoning.delta", {"agentId": "asst-1", "delta": "x", "sequence": True}))
        )
        # agent.handoff with wrong field names (single agentId)
        self.assertFalse(is_agent_handoff(_ev("agent.handoff", {"agentId": "asst-1", "toAgentId": "x"})))
        # agent.toolReturned without callId
        self.assertFalse(is_agent_tool_returned(_ev("agent.toolReturned", {"agentId": "asst-1", "toolName": "t"})))

    def test_non_dict_payload_rejected(self) -> None:
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", None)))
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", "string-payload")))
        self.assertFalse(is_agent_reasoned(_ev("agent.reasoned", 42)))

    def test_unknown_event_type_returns_false_not_exception(self) -> None:
        # Forward-compat per COMPATIBILITY.md §2.1 — unknown types must
        # be tolerated, not crash the consumer.
        ev = _ev("vendor.future.event", {"stuff": "x"})
        self.assertFalse(is_agent_reasoned(ev))
        self.assertFalse(is_agent_reasoning_delta(ev))
        self.assertFalse(is_agent_tool_called(ev))
        self.assertFalse(is_agent_tool_returned(ev))
        self.assertFalse(is_agent_handoff(ev))
        self.assertFalse(is_agent_decided(ev))


class AgentEventExtractorsReturnNone(unittest.TestCase):
    def test_extractor_returns_none_on_miss(self) -> None:
        ev = _ev("agent.reasoned", {"agentId": "asst-1"})  # missing reasoning
        self.assertIsNone(agent_reasoned_payload(ev))

    def test_extractor_returns_payload_on_match(self) -> None:
        ev = _ev("agent.toolCalled", {
            "agentId": "asst-1",
            "toolName": "echo",
            "callId": "c-1",
        })
        payload = agent_tool_called_payload(ev)
        assert payload is not None
        self.assertEqual(payload["toolName"], "echo")

    def test_decided_extractor_works(self) -> None:
        ev = _ev("agent.decided", {"agentId": "asst-1", "decision": "x"})
        payload = agent_decided_payload(ev)
        assert payload is not None
        self.assertEqual(payload["decision"], "x")


class AgentEventSchemaMirrorSanity(unittest.TestCase):
    """Catch drift between TypedDict declarations and the canonical
    schema $defs. If either side adds a required field without the
    other, this test fails."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))

    def _check(self, def_name: str, expected_required: list[str]) -> None:
        defs = self.schema["$defs"]
        self.assertIn(def_name, defs, f"$def.{def_name} present")
        self.assertEqual(sorted(defs[def_name].get("required", [])), sorted(expected_required))

    def test_agent_reasoned_required_matches(self) -> None:
        self._check("agentReasoned", ["agentId", "reasoning"])

    def test_agent_reasoning_delta_required_matches(self) -> None:
        self._check("agentReasoningDelta", ["agentId", "delta", "sequence"])

    def test_agent_tool_called_required_matches(self) -> None:
        self._check("agentToolCalled", ["agentId", "toolName", "callId"])

    def test_agent_tool_returned_required_matches(self) -> None:
        self._check("agentToolReturned", ["agentId", "toolName", "callId"])

    def test_agent_handoff_required_matches(self) -> None:
        self._check("agentHandoff", ["fromAgentId", "toAgentId"])

    def test_agent_decided_required_matches(self) -> None:
        self._check("agentDecided", ["agentId", "decision"])


class VoiceAndPresenceGuards(unittest.TestCase):
    """RFC 0106 voice.* + RFC 0110 channel.presence guards (phase 2)."""

    def test_voice_speech_start(self) -> None:
        from openwop_client import is_voice_speech_start

        self.assertTrue(is_voice_speech_start(_ev("voice.speech_start", {"atMs": 0})))
        self.assertFalse(is_voice_speech_start(_ev("voice.speech_start", {})))
        self.assertFalse(is_voice_speech_start(_ev("voice.transcript", {"atMs": 0})))

    def test_voice_transcript_requires_untrusted_content_trust(self) -> None:
        from openwop_client import is_voice_transcript, voice_transcript_payload

        good = _ev(
            "voice.transcript",
            {"text": "transfer information", "isFinal": True, "atMs": 1200, "contentTrust": "untrusted"},
        )
        self.assertTrue(is_voice_transcript(good))
        self.assertEqual(voice_transcript_payload(good)["contentTrust"], "untrusted")
        # missing contentTrust → no match
        self.assertFalse(
            is_voice_transcript(_ev("voice.transcript", {"text": "x", "isFinal": False, "atMs": 1}))
        )
        # contentTrust must be 'untrusted', not 'trusted'
        self.assertFalse(
            is_voice_transcript(
                _ev("voice.transcript", {"text": "x", "isFinal": False, "atMs": 1, "contentTrust": "trusted"})
            )
        )
        # bool atMs must not satisfy the numeric check (bool is an int subclass)
        self.assertFalse(
            is_voice_transcript(
                _ev("voice.transcript", {"text": "x", "isFinal": True, "atMs": True, "contentTrust": "untrusted"})
            )
        )

    def test_voice_turn_commit_and_synthesis_chunk(self) -> None:
        from openwop_client import is_voice_synthesis_chunk, is_voice_turn_commit

        self.assertTrue(is_voice_turn_commit(_ev("voice.turn_commit", {"atMs": 9, "finalText": "done"})))
        self.assertFalse(is_voice_turn_commit(_ev("voice.turn_commit", {"atMs": 9})))
        self.assertTrue(
            is_voice_synthesis_chunk(_ev("voice.synthesis_chunk", {"seq": 0, "mimeType": "audio/mpeg"}))
        )
        self.assertFalse(is_voice_synthesis_chunk(_ev("voice.synthesis_chunk", {"seq": 0})))

    def test_voice_endpoint_barge_cancel(self) -> None:
        from openwop_client import (
            is_voice_barge_in,
            is_voice_cancelled,
            is_voice_endpoint_candidate,
        )

        self.assertTrue(is_voice_endpoint_candidate(_ev("voice.endpoint_candidate", {"atMs": 5})))
        self.assertTrue(is_voice_barge_in(_ev("voice.barge_in", {"atMs": 5})))
        self.assertTrue(is_voice_cancelled(_ev("voice.cancelled", {"atMs": 5, "reason": "barge-in"})))

    def test_channel_presence(self) -> None:
        from openwop_client import channel_presence_payload, is_channel_presence

        ev = _ev("channel.presence", {"conversationId": "conv-1", "present": ["user:a", "agent:b"], "typing": ["user:a"]})
        self.assertTrue(is_channel_presence(ev))
        self.assertEqual(channel_presence_payload(ev)["present"], ["user:a", "agent:b"])
        self.assertFalse(is_channel_presence(_ev("channel.presence", {"conversationId": "conv-1"})))
        self.assertFalse(
            is_channel_presence(_ev("conversation.exchanged", {"conversationId": "c", "present": []}))
        )


if __name__ == "__main__":
    unittest.main()
