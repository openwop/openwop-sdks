"""Typed helpers for the `agent.*` event family (RFC 0002 §B + RFC 0024).

The Python SDK keeps `RunEventDoc.payload` as `Any` for forward-compat
per `COMPATIBILITY.md §2.1`. This module adds two layers on top:

  1. **TypedDict payload classes** — structural shape descriptions for
     each `agent.*` event payload (mirrors
     `schemas/run-event-payloads.schema.json` $defs). TypedDict is
     a static-only construct (the runtime sees a plain dict), so
     pair these with the predicate functions below for runtime checks.

  2. **Predicate functions** — `is_agent_reasoning_delta(ev)` etc.
     Return `True` when the event's `type` matches AND its payload
     carries the required wire-contract keys with the right primitive
     types. Use the predicate before treating an event as typed.

  3. **Typed extractors** — `agent_reasoning_delta_payload(ev)` returns
     the payload cast to the TypedDict on a match, or `None` on a miss.
     Convenience over the bare predicate + manual extraction.

Stdlib-only. No third-party deps.

See:
  - schemas/run-event-payloads.schema.json
  - RFCS/0002-agent-identity-and-reasoning-events.md
  - RFCS/0024-agent-reasoning-streaming.md
"""

from __future__ import annotations

from typing import Any, Literal, TypedDict

from .types import ErrorEnvelope, RunEventDoc

ReasoningVerbosity = Literal["off", "summary", "full"]
"""Per-event verbosity mirror of `capabilities.md` §`agents.reasoning`."""


# ── TypedDict payload shapes (one per agent.* $def) ─────────────────────


class AgentReasonedPayload(TypedDict, total=False):
    """`agent.reasoned` payload (RFC 0002 §B). Required: `agentId`,
    `reasoning`. Optional: `verbosity`. Per the schema's
    `additionalProperties: true` (Phase-1 multi-agent-shift carve-out),
    additional keys are tolerated — this TypedDict declares the typed
    fields without forbidding others.
    """

    agentId: str
    reasoning: str
    verbosity: ReasoningVerbosity


class AgentReasoningDeltaPayload(TypedDict, total=False):
    """`agent.reasoning.delta` payload (RFC 0024). Required: `agentId`,
    `delta`, `sequence`. Optional: `verbosity`."""

    agentId: str
    delta: str
    sequence: int
    verbosity: ReasoningVerbosity


class AgentToolCalledPayload(TypedDict, total=False):
    """`agent.toolCalled` payload (RFC 0002 §B). Required: `agentId`,
    `toolName`, `callId`. Optional: `inputs` (host-specific shape)."""

    agentId: str
    toolName: str
    callId: str
    inputs: Any


class AgentToolReturnedPayload(TypedDict, total=False):
    """`agent.toolReturned` payload (RFC 0002 §B). Required: `agentId`,
    `toolName`, `callId`. Mutually-exclusive optionals: `outcome` (on
    success) OR `error` (on failure)."""

    agentId: str
    toolName: str
    callId: str
    outcome: Any
    error: ErrorEnvelope


class AgentHandoffPayload(TypedDict, total=False):
    """`agent.handoff` payload (RFC 0002 §B). Required: `fromAgentId`,
    `toAgentId`. Note distinct field names — NOT a single `agentId`."""

    fromAgentId: str
    toAgentId: str
    reason: str


class AgentDecidedPayload(TypedDict, total=False):
    """`agent.decided` payload (RFC 0002 §B). Required: `agentId`,
    `decision` (host-specific shape). Optional: `confidence` in [0, 1]
    — values below the resolved threshold drive the low-confidence
    escalation contract."""

    agentId: str
    decision: Any
    confidence: float


class MemoryWrittenPayload(TypedDict, total=False):
    """`memory.written` payload (RFC 0057). Required: `memoryRef`,
    `memoryId`. Optional: `nodeId`, `agentId`, `tags`. Content-free —
    identifiers + non-secret tags only; never the entry content."""

    memoryRef: str
    memoryId: str
    nodeId: str
    agentId: str
    tags: list[str]


class OutputChunkPayload(TypedDict, total=False):
    """`output.chunk` / `ai.message.chunk` payload (RFC 0094 §D —
    `run-event-payloads.schema.json#$defs/outputChunk`). Required:
    `nodeId`, `runId`, `chunk`, `isLast`. Optional: `channel`, `meta`
    (tiered metadata per `stream-modes.md §messages`, kept loose)."""

    nodeId: str
    runId: str
    chunk: str
    isLast: bool
    channel: str
    meta: dict[str, Any]


# ── RFC 0106 voice.* + RFC 0110 channel.presence payloads ───────────────
# Mirror run-event-payloads.schema.json. Emitted on the durable event log by
# the host-side ctx.callTranscriber / ctx.callSpeechSynthesizer(stream=True)
# methods (out of client-SDK scope); a client tails them off the run stream.


class VoiceSpeechStartPayload(TypedDict, total=False):
    """`voice.speech_start` payload (RFC 0106). Required: `atMs`."""

    atMs: int


class VoiceTranscriptPayload(TypedDict, total=False):
    """`voice.transcript` payload (RFC 0106). Required: `text`, `isFinal`,
    `atMs`, `contentTrust` (always "untrusted" — voice-transcript-untrusted;
    never promote live transcript to higher authority)."""

    text: str
    isFinal: bool
    atMs: int
    contentTrust: Literal["untrusted"]
    committedPrefix: str
    formatted: str
    stability: float


class VoiceEndpointCandidatePayload(TypedDict, total=False):
    """`voice.endpoint_candidate` payload (RFC 0106). Required: `atMs`."""

    atMs: int
    confidence: float


class VoiceTurnCommitPayload(TypedDict, total=False):
    """`voice.turn_commit` payload (RFC 0106). Required: `atMs`, `finalText`
    (the settled transcript the ctx.callTranscriber Promise resolves with)."""

    atMs: int
    finalText: str


class VoiceSynthesisChunkPayload(TypedDict, total=False):
    """`voice.synthesis_chunk` payload (RFC 0106). Required: `seq`, `mimeType`.
    Bytes ride `url`/`streamRef` (or inline `base64` only under the host cap)."""

    seq: int
    mimeType: str
    url: str
    streamRef: str
    base64: str
    durationMs: int
    final: bool


class VoiceBargeInPayload(TypedDict, total=False):
    """`voice.barge_in` payload (RFC 0106). Required: `atMs`."""

    atMs: int


class VoiceCancelledPayload(TypedDict, total=False):
    """`voice.cancelled` payload (RFC 0106). Required: `atMs`."""

    atMs: int
    reason: str


class ChannelPresencePayload(TypedDict, total=False):
    """`channel.presence` payload (RFC 0110). EPHEMERAL — observable on the
    LIVE event stream only; ABSENT on replay / :fork (the host never persists
    presence to the replayable log). Required: `conversationId`, `present`.
    Membership-gated; opaque RFC 0041 subject refs (non-PII)."""

    conversationId: str
    present: list[str]
    typing: list[str]


# ── RFC 0118 core.dispatch.* + RFC 0111 context.summarized payloads ─────
# Mirror run-event-payloads.schema.json. core.dispatch.fanOut/join are emitted
# by the core.dispatch node on the parallel fan-out/join path; context.summarized
# is emitted when the host summarizes evicted orchestrator-loop transcript turns.


class DispatchFanOutPayload(TypedDict, total=False):
    """`core.dispatch.fanOut` payload (RFC 0118). Emitted ONLY on the
    `fanOutPolicy:'parallel'` path when the wave begins, so the parent stays
    observable while children run concurrently. Required: `fanOutPolicy` (always
    "parallel"), `childCount` (> 1 by construction). Optional: `maxConcurrency`
    (effective concurrency ceiling when bounded), `joinMode` (the joinPolicy.mode
    governing this fan-out)."""

    fanOutPolicy: str
    childCount: int
    maxConcurrency: int
    joinMode: str


class DispatchJoinPayload(TypedDict, total=False):
    """`core.dispatch.join` payload (RFC 0118). Emitted when a parallel join is
    satisfied or fails. `mergeOrder` is the canonical replay-deterministic record
    of the output-merge tiebreak — a replay/:fork MUST re-apply outputMapping in
    `mergeOrder` (the parent host's observed wall-clock terminal order), never in
    nextWorkerIds order. Required: `joinOutcome` ("satisfied"/"failed"/"partial"),
    `completedCount`, `failedCount`, `mergeOrder`. Optional: `cancelledCount`."""

    joinOutcome: str
    completedCount: int
    failedCount: int
    cancelledCount: int
    mergeOrder: list[str]


class ContextSummarizedPayload(TypedDict, total=False):
    """`context.summarized` payload (RFC 0111). Emitted when the host replaces
    older in-window orchestrator-loop transcript turns with a host-produced
    summary to honor a `contextBudget.transcriptTokenBudget`. CONTENT-FREE: the
    summary text never rides the wire — `summaryRef` is an artifactId resolved via
    `GET /v1/runs/{runId}/artifacts/{artifactId}`. On :fork mode:replay the host
    MUST reuse this recorded `summaryRef` and MUST NOT re-summarize. Required:
    `iteration`, `replacedTurns`, `summaryRef`, `tokenCounter`, `tokensBefore`,
    `tokensAfter`."""

    iteration: int
    replacedTurns: list[str]
    summaryRef: str
    tokenCounter: str
    tokensBefore: int
    tokensAfter: int


# ── Predicates ──────────────────────────────────────────────────────────


def _payload_has_str(payload: Any, field: str) -> bool:
    """Internal: payload is a dict-like with `field` set to a string."""
    return isinstance(payload, dict) and isinstance(payload.get(field), str)


def _payload_has_number(payload: Any, field: str) -> bool:
    """Internal: payload is a dict-like with `field` set to a number
    (int/float, excluding bool which is an int subclass in Python)."""
    if not isinstance(payload, dict):
        return False
    v = payload.get(field)
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_agent_reasoned(ev: RunEventDoc) -> bool:
    """`agent.reasoned` discriminator + required-field check."""
    return (
        ev.type == "agent.reasoned"
        and _payload_has_str(ev.payload, "agentId")
        and _payload_has_str(ev.payload, "reasoning")
    )


def is_agent_reasoning_delta(ev: RunEventDoc) -> bool:
    """`agent.reasoning.delta` discriminator + required-field check
    (RFC 0024). Verifies `sequence` is a non-negative integer."""
    if ev.type != "agent.reasoning.delta":
        return False
    if not _payload_has_str(ev.payload, "agentId"):
        return False
    if not _payload_has_str(ev.payload, "delta"):
        return False
    seq = ev.payload.get("sequence") if isinstance(ev.payload, dict) else None
    return isinstance(seq, int) and not isinstance(seq, bool) and seq >= 0


def is_agent_tool_called(ev: RunEventDoc) -> bool:
    """`agent.toolCalled` discriminator + required-field check."""
    return (
        ev.type == "agent.toolCalled"
        and _payload_has_str(ev.payload, "agentId")
        and _payload_has_str(ev.payload, "toolName")
        and _payload_has_str(ev.payload, "callId")
    )


def is_agent_tool_returned(ev: RunEventDoc) -> bool:
    """`agent.toolReturned` discriminator + required-field check."""
    return (
        ev.type == "agent.toolReturned"
        and _payload_has_str(ev.payload, "agentId")
        and _payload_has_str(ev.payload, "toolName")
        and _payload_has_str(ev.payload, "callId")
    )


def is_agent_handoff(ev: RunEventDoc) -> bool:
    """`agent.handoff` discriminator + required-field check. Note the
    distinct field names — `fromAgentId` / `toAgentId`."""
    return (
        ev.type == "agent.handoff"
        and _payload_has_str(ev.payload, "fromAgentId")
        and _payload_has_str(ev.payload, "toAgentId")
    )


def is_agent_decided(ev: RunEventDoc) -> bool:
    """`agent.decided` discriminator + required-field check. `decision`
    is `Any` per the schema; the predicate only confirms its presence."""
    if ev.type != "agent.decided":
        return False
    if not _payload_has_str(ev.payload, "agentId"):
        return False
    return isinstance(ev.payload, dict) and "decision" in ev.payload


def is_memory_written(ev: RunEventDoc) -> bool:
    """`memory.written` discriminator + required-identifier check (RFC 0057)."""
    return (
        ev.type == "memory.written"
        and _payload_has_str(ev.payload, "memoryRef")
        and _payload_has_str(ev.payload, "memoryId")
    )


def is_output_chunk(ev: RunEventDoc) -> bool:
    """`output.chunk` / `ai.message.chunk` discriminator + required-field
    check (RFC 0094 §D). Accepts both discriminators — `output.chunk` is
    the persisted run-event type; `ai.message.chunk` is the stream-mode
    `messages` SSE event name carrying the same payload."""
    if ev.type not in ("output.chunk", "ai.message.chunk"):
        return False
    if not _payload_has_str(ev.payload, "nodeId"):
        return False
    if not _payload_has_str(ev.payload, "runId"):
        return False
    if not _payload_has_str(ev.payload, "chunk"):
        return False
    is_last = ev.payload.get("isLast") if isinstance(ev.payload, dict) else None
    return isinstance(is_last, bool)


# ── Typed extractors ────────────────────────────────────────────────────


def agent_reasoned_payload(ev: RunEventDoc) -> AgentReasonedPayload | None:
    """Return the payload as `AgentReasonedPayload` if the event matches,
    else `None`. Use this when you want a single line:
    `if (p := agent_reasoned_payload(ev)) is not None: ...`."""
    return ev.payload if is_agent_reasoned(ev) else None


def agent_reasoning_delta_payload(ev: RunEventDoc) -> AgentReasoningDeltaPayload | None:
    """Return the payload as `AgentReasoningDeltaPayload` if the event
    matches, else `None`."""
    return ev.payload if is_agent_reasoning_delta(ev) else None


def agent_tool_called_payload(ev: RunEventDoc) -> AgentToolCalledPayload | None:
    """Return the payload as `AgentToolCalledPayload` if matched, else `None`."""
    return ev.payload if is_agent_tool_called(ev) else None


def agent_tool_returned_payload(ev: RunEventDoc) -> AgentToolReturnedPayload | None:
    """Return the payload as `AgentToolReturnedPayload` if matched, else `None`."""
    return ev.payload if is_agent_tool_returned(ev) else None


def agent_handoff_payload(ev: RunEventDoc) -> AgentHandoffPayload | None:
    """Return the payload as `AgentHandoffPayload` if matched, else `None`."""
    return ev.payload if is_agent_handoff(ev) else None


def agent_decided_payload(ev: RunEventDoc) -> AgentDecidedPayload | None:
    """Return the payload as `AgentDecidedPayload` if matched, else `None`."""
    return ev.payload if is_agent_decided(ev) else None


def memory_written_payload(ev: RunEventDoc) -> MemoryWrittenPayload | None:
    """Return the payload as `MemoryWrittenPayload` if matched, else `None`."""
    return ev.payload if is_memory_written(ev) else None


def output_chunk_payload(ev: RunEventDoc) -> OutputChunkPayload | None:
    """Return the payload as `OutputChunkPayload` if matched, else `None`."""
    return ev.payload if is_output_chunk(ev) else None


def is_voice_speech_start(ev: RunEventDoc) -> bool:
    """`voice.speech_start` discriminator + required `atMs` (RFC 0106)."""
    return ev.type == "voice.speech_start" and _payload_has_number(ev.payload, "atMs")


def is_voice_transcript(ev: RunEventDoc) -> bool:
    """`voice.transcript` discriminator + required `text`/`isFinal`/`atMs`/
    `contentTrust` (RFC 0106). `contentTrust` MUST be "untrusted" — live
    transcript is untrusted ingress (`voice-transcript-untrusted`)."""
    if ev.type != "voice.transcript":
        return False
    if not _payload_has_str(ev.payload, "text"):
        return False
    if not isinstance(ev.payload, dict) or not isinstance(ev.payload.get("isFinal"), bool):
        return False
    if not _payload_has_number(ev.payload, "atMs"):
        return False
    return ev.payload.get("contentTrust") == "untrusted"


def is_voice_endpoint_candidate(ev: RunEventDoc) -> bool:
    """`voice.endpoint_candidate` discriminator + required `atMs` (RFC 0106)."""
    return ev.type == "voice.endpoint_candidate" and _payload_has_number(ev.payload, "atMs")


def is_voice_turn_commit(ev: RunEventDoc) -> bool:
    """`voice.turn_commit` discriminator + required `atMs`/`finalText` (RFC 0106)."""
    return (
        ev.type == "voice.turn_commit"
        and _payload_has_number(ev.payload, "atMs")
        and _payload_has_str(ev.payload, "finalText")
    )


def is_voice_synthesis_chunk(ev: RunEventDoc) -> bool:
    """`voice.synthesis_chunk` discriminator + required `seq`/`mimeType` (RFC 0106)."""
    return (
        ev.type == "voice.synthesis_chunk"
        and _payload_has_number(ev.payload, "seq")
        and _payload_has_str(ev.payload, "mimeType")
    )


def is_voice_barge_in(ev: RunEventDoc) -> bool:
    """`voice.barge_in` discriminator + required `atMs` (RFC 0106)."""
    return ev.type == "voice.barge_in" and _payload_has_number(ev.payload, "atMs")


def is_voice_cancelled(ev: RunEventDoc) -> bool:
    """`voice.cancelled` discriminator + required `atMs` (RFC 0106)."""
    return ev.type == "voice.cancelled" and _payload_has_number(ev.payload, "atMs")


def is_channel_presence(ev: RunEventDoc) -> bool:
    """`channel.presence` discriminator + required `conversationId`/`present`
    (RFC 0110). EPHEMERAL — observable on the LIVE stream only; absent on
    replay/:fork."""
    return (
        ev.type == "channel.presence"
        and _payload_has_str(ev.payload, "conversationId")
        and isinstance(ev.payload, dict)
        and isinstance(ev.payload.get("present"), list)
    )


def voice_speech_start_payload(ev: RunEventDoc) -> VoiceSpeechStartPayload | None:
    """Return the payload as `VoiceSpeechStartPayload` if matched, else `None`."""
    return ev.payload if is_voice_speech_start(ev) else None


def voice_transcript_payload(ev: RunEventDoc) -> VoiceTranscriptPayload | None:
    """Return the payload as `VoiceTranscriptPayload` if matched, else `None`."""
    return ev.payload if is_voice_transcript(ev) else None


def voice_endpoint_candidate_payload(
    ev: RunEventDoc,
) -> VoiceEndpointCandidatePayload | None:
    """Return the payload as `VoiceEndpointCandidatePayload` if matched, else `None`."""
    return ev.payload if is_voice_endpoint_candidate(ev) else None


def voice_turn_commit_payload(ev: RunEventDoc) -> VoiceTurnCommitPayload | None:
    """Return the payload as `VoiceTurnCommitPayload` if matched, else `None`."""
    return ev.payload if is_voice_turn_commit(ev) else None


def voice_synthesis_chunk_payload(
    ev: RunEventDoc,
) -> VoiceSynthesisChunkPayload | None:
    """Return the payload as `VoiceSynthesisChunkPayload` if matched, else `None`."""
    return ev.payload if is_voice_synthesis_chunk(ev) else None


def voice_barge_in_payload(ev: RunEventDoc) -> VoiceBargeInPayload | None:
    """Return the payload as `VoiceBargeInPayload` if matched, else `None`."""
    return ev.payload if is_voice_barge_in(ev) else None


def voice_cancelled_payload(ev: RunEventDoc) -> VoiceCancelledPayload | None:
    """Return the payload as `VoiceCancelledPayload` if matched, else `None`."""
    return ev.payload if is_voice_cancelled(ev) else None


def channel_presence_payload(ev: RunEventDoc) -> ChannelPresencePayload | None:
    """Return the payload as `ChannelPresencePayload` if matched, else `None`."""
    return ev.payload if is_channel_presence(ev) else None


def is_dispatch_fan_out(ev: RunEventDoc) -> bool:
    """`core.dispatch.fanOut` discriminator + required-field check (RFC 0118).
    Emitted only on the `fanOutPolicy:'parallel'` path; narrows when the payload
    carries `fanOutPolicy == "parallel"` + a numeric `childCount`."""
    return (
        ev.type == "core.dispatch.fanOut"
        and isinstance(ev.payload, dict)
        and ev.payload.get("fanOutPolicy") == "parallel"
        and _payload_has_number(ev.payload, "childCount")
    )


def is_dispatch_join(ev: RunEventDoc) -> bool:
    """`core.dispatch.join` discriminator + required-field check (RFC 0118).
    Narrows when the payload carries a `joinOutcome` string + the `mergeOrder`
    array (the replay-deterministic merge tiebreak)."""
    return (
        ev.type == "core.dispatch.join"
        and _payload_has_str(ev.payload, "joinOutcome")
        and isinstance(ev.payload, dict)
        and isinstance(ev.payload.get("mergeOrder"), list)
    )


def is_context_summarized(ev: RunEventDoc) -> bool:
    """`context.summarized` discriminator + required-field check (RFC 0111).
    Narrows when the payload carries the `summaryRef` string + a numeric
    `iteration`. The summary text is never inlined (`summaryRef` is an
    artifactId)."""
    return (
        ev.type == "context.summarized"
        and _payload_has_str(ev.payload, "summaryRef")
        and _payload_has_number(ev.payload, "iteration")
    )


def dispatch_fan_out_payload(ev: RunEventDoc) -> DispatchFanOutPayload | None:
    """Return the payload as `DispatchFanOutPayload` if matched, else `None`."""
    return ev.payload if is_dispatch_fan_out(ev) else None


def dispatch_join_payload(ev: RunEventDoc) -> DispatchJoinPayload | None:
    """Return the payload as `DispatchJoinPayload` if matched, else `None`."""
    return ev.payload if is_dispatch_join(ev) else None


def context_summarized_payload(ev: RunEventDoc) -> ContextSummarizedPayload | None:
    """Return the payload as `ContextSummarizedPayload` if matched, else `None`."""
    return ev.payload if is_context_summarized(ev) else None


__all__ = [
    "ReasoningVerbosity",
    "AgentReasonedPayload",
    "AgentReasoningDeltaPayload",
    "AgentToolCalledPayload",
    "AgentToolReturnedPayload",
    "AgentHandoffPayload",
    "AgentDecidedPayload",
    "MemoryWrittenPayload",
    "OutputChunkPayload",
    "VoiceSpeechStartPayload",
    "VoiceTranscriptPayload",
    "VoiceEndpointCandidatePayload",
    "VoiceTurnCommitPayload",
    "VoiceSynthesisChunkPayload",
    "VoiceBargeInPayload",
    "VoiceCancelledPayload",
    "ChannelPresencePayload",
    "DispatchFanOutPayload",
    "DispatchJoinPayload",
    "ContextSummarizedPayload",
    "is_agent_reasoned",
    "is_agent_reasoning_delta",
    "is_agent_tool_called",
    "is_agent_tool_returned",
    "is_agent_handoff",
    "is_agent_decided",
    "is_memory_written",
    "is_output_chunk",
    "is_voice_speech_start",
    "is_voice_transcript",
    "is_voice_endpoint_candidate",
    "is_voice_turn_commit",
    "is_voice_synthesis_chunk",
    "is_voice_barge_in",
    "is_voice_cancelled",
    "is_channel_presence",
    "is_dispatch_fan_out",
    "is_dispatch_join",
    "is_context_summarized",
    "memory_written_payload",
    "output_chunk_payload",
    "voice_speech_start_payload",
    "voice_transcript_payload",
    "voice_endpoint_candidate_payload",
    "voice_turn_commit_payload",
    "voice_synthesis_chunk_payload",
    "voice_barge_in_payload",
    "voice_cancelled_payload",
    "channel_presence_payload",
    "dispatch_fan_out_payload",
    "dispatch_join_payload",
    "context_summarized_payload",
    "agent_reasoned_payload",
    "agent_reasoning_delta_payload",
    "agent_tool_called_payload",
    "agent_tool_returned_payload",
    "agent_handoff_payload",
    "agent_decided_payload",
]
