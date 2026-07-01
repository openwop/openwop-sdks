// Typed helpers for the agent.* event family (RFC 0002 §B + RFC 0024).
//
// The Go SDK keeps RunEventDoc.Payload as `any` for forward-compat per
// COMPATIBILITY.md §2.1. This file adds typed payload structs + a
// pair of helpers per agent.* event type:
//
//	IsAgentReasoningDelta(ev)              -> bool      // discriminator + required-field check
//	UnmarshalAgentReasoningDelta(ev)       -> (payload, error)  // typed extraction
//
// The Unmarshal helpers re-marshal the untyped payload to JSON and
// decode into the typed struct so callers don't have to do
// map-of-any spelunking. Returns a non-nil error when the event
// doesn't match the type discriminator OR when payload decoding fails;
// callers check err==nil before consuming the typed payload.
//
// See:
//   - schemas/run-event-payloads.schema.json
//   - RFCS/0002-agent-identity-and-reasoning-events.md
//   - RFCS/0024-agent-reasoning-streaming.md

package openwopclient

import (
	"encoding/json"
	"errors"
	"fmt"
)

// ReasoningVerbosity per capabilities.md §`agents.reasoning`.
type ReasoningVerbosity string

const (
	ReasoningVerbosityOff     ReasoningVerbosity = "off"
	ReasoningVerbositySummary ReasoningVerbosity = "summary"
	ReasoningVerbosityFull    ReasoningVerbosity = "full"
)

// AgentReasonedPayload mirrors `agent.reasoned` (RFC 0002 §B).
// Required: AgentID, Reasoning. Optional: Verbosity. Per the schema's
// `additionalProperties: true` (Phase-1 multi-agent-shift carve-out),
// hosts MAY emit additional keys; this struct declares the typed
// fields without forbidding others (decoder ignores unknown JSON keys).
type AgentReasonedPayload struct {
	AgentID   string             `json:"agentId"`
	Reasoning string             `json:"reasoning"`
	Verbosity ReasoningVerbosity `json:"verbosity,omitempty"`
}

// AgentReasoningDeltaPayload mirrors `agent.reasoning.delta` (RFC 0024).
// Required: AgentID, Delta, Sequence (>= 0). Optional: Verbosity.
type AgentReasoningDeltaPayload struct {
	AgentID   string             `json:"agentId"`
	Delta     string             `json:"delta"`
	Sequence  int                `json:"sequence"`
	Verbosity ReasoningVerbosity `json:"verbosity,omitempty"`
}

// AgentToolCalledPayload mirrors `agent.toolCalled` (RFC 0002 §B).
// Pairs with `agent.toolReturned` via shared CallID; the toolReturned
// event's causationId equals the toolCalled event's eventId.
type AgentToolCalledPayload struct {
	AgentID  string `json:"agentId"`
	ToolName string `json:"toolName"`
	CallID   string `json:"callId"`
	Inputs   any    `json:"inputs,omitempty"`
}

// AgentToolReturnedPayload mirrors `agent.toolReturned` (RFC 0002 §B).
// Outcome and Error are mutually-exclusive; success returns set
// Outcome, failures set Error.
type AgentToolReturnedPayload struct {
	AgentID  string         `json:"agentId"`
	ToolName string         `json:"toolName"`
	CallID   string         `json:"callId"`
	Outcome  any            `json:"outcome,omitempty"`
	Error    *ErrorEnvelope `json:"error,omitempty"`
}

// AgentHandoffPayload mirrors `agent.handoff` (RFC 0002 §B). Note the
// distinct field names — FromAgentID / ToAgentID, NOT a single AgentID.
type AgentHandoffPayload struct {
	FromAgentID string `json:"fromAgentId"`
	ToAgentID   string `json:"toAgentId"`
	Reason      string `json:"reason,omitempty"`
}

// AgentDecidedPayload mirrors `agent.decided` (RFC 0002 §B). Confidence
// in [0, 1] drives the low-confidence escalation contract (host MUST
// suspend with `node.suspended { reason: 'low-confidence' }` when
// below the resolved threshold).
type AgentDecidedPayload struct {
	AgentID    string   `json:"agentId"`
	Decision   any      `json:"decision"`
	Confidence *float64 `json:"confidence,omitempty"`
}

// ErrNotMatchingEvent is returned by the UnmarshalAgent* helpers when
// the event's Type doesn't match the expected discriminator. Callers
// who want to branch on this case use errors.Is(err, ErrNotMatchingEvent).
var ErrNotMatchingEvent = errors.New("openwop: event type does not match")

// ── Predicates ────────────────────────────────────────────────────────

func payloadAsMap(payload any) (map[string]any, bool) {
	m, ok := payload.(map[string]any)
	return m, ok
}

func payloadHasString(payload any, field string) bool {
	m, ok := payloadAsMap(payload)
	if !ok {
		return false
	}
	_, ok = m[field].(string)
	return ok
}

// IsAgentReasoned reports whether the event is a well-formed
// `agent.reasoned` (RFC 0002 §B): correct discriminator + required
// payload fields present with the right primitive types.
func IsAgentReasoned(ev RunEventDoc) bool {
	return ev.Type == "agent.reasoned" &&
		payloadHasString(ev.Payload, "agentId") &&
		payloadHasString(ev.Payload, "reasoning")
}

// IsAgentReasoningDelta reports whether the event is a well-formed
// `agent.reasoning.delta` (RFC 0024). Verifies Sequence is a
// non-negative integer.
func IsAgentReasoningDelta(ev RunEventDoc) bool {
	if ev.Type != "agent.reasoning.delta" {
		return false
	}
	if !payloadHasString(ev.Payload, "agentId") {
		return false
	}
	if !payloadHasString(ev.Payload, "delta") {
		return false
	}
	m, ok := payloadAsMap(ev.Payload)
	if !ok {
		return false
	}
	// JSON unmarshal lands integers in float64; accept either, reject
	// non-integer values and negatives.
	switch seq := m["sequence"].(type) {
	case float64:
		return seq >= 0 && seq == float64(int(seq))
	case int:
		return seq >= 0
	default:
		return false
	}
}

// IsAgentToolCalled reports whether the event is a well-formed
// `agent.toolCalled` (RFC 0002 §B).
func IsAgentToolCalled(ev RunEventDoc) bool {
	return ev.Type == "agent.toolCalled" &&
		payloadHasString(ev.Payload, "agentId") &&
		payloadHasString(ev.Payload, "toolName") &&
		payloadHasString(ev.Payload, "callId")
}

// IsAgentToolReturned reports whether the event is a well-formed
// `agent.toolReturned` (RFC 0002 §B). Doesn't enforce the Outcome /
// Error mutual exclusion; callers inspect after extraction.
func IsAgentToolReturned(ev RunEventDoc) bool {
	return ev.Type == "agent.toolReturned" &&
		payloadHasString(ev.Payload, "agentId") &&
		payloadHasString(ev.Payload, "toolName") &&
		payloadHasString(ev.Payload, "callId")
}

// IsAgentHandoff reports whether the event is a well-formed
// `agent.handoff` (RFC 0002 §B). Note distinct field names —
// FromAgentID / ToAgentID.
func IsAgentHandoff(ev RunEventDoc) bool {
	return ev.Type == "agent.handoff" &&
		payloadHasString(ev.Payload, "fromAgentId") &&
		payloadHasString(ev.Payload, "toAgentId")
}

// IsAgentDecided reports whether the event is a well-formed
// `agent.decided` (RFC 0002 §B). Decision is `any` per the schema;
// predicate only confirms its presence.
func IsAgentDecided(ev RunEventDoc) bool {
	if ev.Type != "agent.decided" || !payloadHasString(ev.Payload, "agentId") {
		return false
	}
	m, ok := payloadAsMap(ev.Payload)
	if !ok {
		return false
	}
	_, present := m["decision"]
	return present
}

// ── Unmarshalers ──────────────────────────────────────────────────────

// reencode marshals the untyped payload then decodes into T. Slower
// than direct deref but avoids the map-of-any spelunking and survives
// future schema additions cleanly (the JSON decoder ignores unknown
// keys, preserving forward-compat).
func reencode[T any](payload any, out *T) error {
	buf, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("openwop: payload marshal: %w", err)
	}
	if err := json.Unmarshal(buf, out); err != nil {
		return fmt.Errorf("openwop: payload decode: %w", err)
	}
	return nil
}

// UnmarshalAgentReasoned extracts the typed payload from an
// `agent.reasoned` event. Returns ErrNotMatchingEvent if the event's
// Type doesn't match the expected discriminator.
func UnmarshalAgentReasoned(ev RunEventDoc) (AgentReasonedPayload, error) {
	var p AgentReasonedPayload
	if !IsAgentReasoned(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentReasoningDelta extracts the typed payload from an
// `agent.reasoning.delta` event (RFC 0024).
func UnmarshalAgentReasoningDelta(ev RunEventDoc) (AgentReasoningDeltaPayload, error) {
	var p AgentReasoningDeltaPayload
	if !IsAgentReasoningDelta(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentToolCalled extracts the typed payload from an
// `agent.toolCalled` event.
func UnmarshalAgentToolCalled(ev RunEventDoc) (AgentToolCalledPayload, error) {
	var p AgentToolCalledPayload
	if !IsAgentToolCalled(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentToolReturned extracts the typed payload from an
// `agent.toolReturned` event.
func UnmarshalAgentToolReturned(ev RunEventDoc) (AgentToolReturnedPayload, error) {
	var p AgentToolReturnedPayload
	if !IsAgentToolReturned(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentHandoff extracts the typed payload from an
// `agent.handoff` event.
func UnmarshalAgentHandoff(ev RunEventDoc) (AgentHandoffPayload, error) {
	var p AgentHandoffPayload
	if !IsAgentHandoff(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalAgentDecided extracts the typed payload from an
// `agent.decided` event.
func UnmarshalAgentDecided(ev RunEventDoc) (AgentDecidedPayload, error) {
	var p AgentDecidedPayload
	if !IsAgentDecided(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// ── RFC 0057 — memory.written ────────────────────────────────────────

// MemoryWrittenPayload mirrors `memory.written` (RFC 0057). Required:
// MemoryRef, MemoryID. Optional: NodeID, AgentID, Tags. Content-free —
// identifiers + non-secret tags only; never the entry content (the read
// side serves that, already SR-1-redacted).
type MemoryWrittenPayload struct {
	MemoryRef string   `json:"memoryRef"`
	MemoryID  string   `json:"memoryId"`
	NodeID    string   `json:"nodeId,omitempty"`
	AgentID   string   `json:"agentId,omitempty"`
	Tags      []string `json:"tags,omitempty"`
}

// IsMemoryWritten reports whether the event is a well-formed
// `memory.written` (RFC 0057) — type discriminator + required
// MemoryRef/MemoryID identifier strings.
func IsMemoryWritten(ev RunEventDoc) bool {
	return ev.Type == "memory.written" &&
		payloadHasString(ev.Payload, "memoryRef") &&
		payloadHasString(ev.Payload, "memoryId")
}

// UnmarshalMemoryWritten extracts the typed payload from a
// `memory.written` event.
func UnmarshalMemoryWritten(ev RunEventDoc) (MemoryWrittenPayload, error) {
	var p MemoryWrittenPayload
	if !IsMemoryWritten(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// ── RFC 0094 §D — output.chunk / ai.message.chunk ────────────────────

// OutputChunkPayload mirrors the `output.chunk` / `ai.message.chunk`
// payload (run-event-payloads.schema.json#$defs/outputChunk, RFC 0094 §D).
// Required: NodeID, RunID, Chunk, IsLast. Optional: Channel, Meta. RunID
// lets multiplexed consumers route chunks without out-of-band context;
// IsLast is true for the final chunk of a given AI node call — consumers
// rely on it for fold termination. Meta carries the tiered metadata per
// stream-modes.md §messages (finishReason, logprobs, toolCalls, model,
// usage, provider pass-through, …) and is kept loose.
type OutputChunkPayload struct {
	NodeID  string         `json:"nodeId"`
	RunID   string         `json:"runId"`
	Chunk   string         `json:"chunk"`
	IsLast  bool           `json:"isLast"`
	Channel string         `json:"channel,omitempty"`
	Meta    map[string]any `json:"meta,omitempty"`
}

// IsOutputChunk reports whether the event is a well-formed streaming
// output chunk (RFC 0094 §D). Accepts both discriminators —
// `output.chunk` is the persisted run-event type; `ai.message.chunk` is
// the stream-mode `messages` SSE event name carrying the same payload.
func IsOutputChunk(ev RunEventDoc) bool {
	if ev.Type != "output.chunk" && ev.Type != "ai.message.chunk" {
		return false
	}
	if !payloadHasString(ev.Payload, "nodeId") ||
		!payloadHasString(ev.Payload, "runId") ||
		!payloadHasString(ev.Payload, "chunk") {
		return false
	}
	m, ok := payloadAsMap(ev.Payload)
	if !ok {
		return false
	}
	_, ok = m["isLast"].(bool)
	return ok
}

// UnmarshalOutputChunk extracts the typed payload from an
// `output.chunk` / `ai.message.chunk` event.
func UnmarshalOutputChunk(ev RunEventDoc) (OutputChunkPayload, error) {
	var p OutputChunkPayload
	if !IsOutputChunk(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// payloadHasNumber reports whether the payload is a map with `field` set to a
// JSON number. Accepts float64 (the wire form via json.Unmarshal into `any`)
// AND the Go int family (in-code map[string]any construction); bool is
// excluded (it is not a number).
func payloadHasNumber(payload any, field string) bool {
	m, ok := payloadAsMap(payload)
	if !ok {
		return false
	}
	switch m[field].(type) {
	case float64, float32,
		int, int8, int16, int32, int64,
		uint, uint8, uint16, uint32, uint64:
		return true
	default:
		return false
	}
}

func payloadHasArray(payload any, field string) bool {
	m, ok := payloadAsMap(payload)
	if !ok {
		return false
	}
	switch m[field].(type) {
	case []any, []string:
		return true
	default:
		return false
	}
}

// ── RFC 0106 voice.* + RFC 0110 channel.presence ─────────────────────────
// Mirror run-event-payloads.schema.json. These events are emitted on the
// durable event log by the host-side ctx.callTranscriber /
// ctx.callSpeechSynthesizer(stream:true) methods (out of client-SDK scope); a
// client tails them off the run event stream.

// VoiceSpeechStartPayload mirrors `voice.speech_start` (RFC 0106).
type VoiceSpeechStartPayload struct {
	AtMs int64 `json:"atMs"`
}

// VoiceTranscriptPayload mirrors `voice.transcript` (RFC 0106). ContentTrust
// is always "untrusted" — live transcript is untrusted ingress
// (voice-transcript-untrusted); never promote it to higher authority.
type VoiceTranscriptPayload struct {
	Text            string  `json:"text"`
	IsFinal         bool    `json:"isFinal"`
	AtMs            int64   `json:"atMs"`
	ContentTrust    string  `json:"contentTrust"`
	CommittedPrefix string  `json:"committedPrefix,omitempty"`
	Formatted       string  `json:"formatted,omitempty"`
	Stability       float64 `json:"stability,omitempty"`
}

// VoiceEndpointCandidatePayload mirrors `voice.endpoint_candidate` (RFC 0106).
type VoiceEndpointCandidatePayload struct {
	AtMs       int64   `json:"atMs"`
	Confidence float64 `json:"confidence,omitempty"`
}

// VoiceTurnCommitPayload mirrors `voice.turn_commit` (RFC 0106). FinalText is
// the settled transcript the ctx.callTranscriber Promise resolves with.
type VoiceTurnCommitPayload struct {
	AtMs      int64  `json:"atMs"`
	FinalText string `json:"finalText"`
}

// VoiceSynthesisChunkPayload mirrors `voice.synthesis_chunk` (RFC 0106). Bytes
// ride URL/StreamRef (or inline Base64 only under the host cap).
type VoiceSynthesisChunkPayload struct {
	Seq        int    `json:"seq"`
	MimeType   string `json:"mimeType"`
	URL        string `json:"url,omitempty"`
	StreamRef  string `json:"streamRef,omitempty"`
	Base64     string `json:"base64,omitempty"`
	DurationMs int64  `json:"durationMs,omitempty"`
	Final      bool   `json:"final,omitempty"`
}

// VoiceBargeInPayload mirrors `voice.barge_in` (RFC 0106).
type VoiceBargeInPayload struct {
	AtMs int64 `json:"atMs"`
}

// VoiceCancelledPayload mirrors `voice.cancelled` (RFC 0106).
type VoiceCancelledPayload struct {
	AtMs   int64  `json:"atMs"`
	Reason string `json:"reason,omitempty"`
}

// ChannelPresencePayload mirrors `channel.presence` (RFC 0110). EPHEMERAL —
// observable on the LIVE event stream only; ABSENT on replay / :fork (the host
// never persists presence to the replayable log). Membership-gated; opaque
// RFC 0041 subject refs (non-PII).
type ChannelPresencePayload struct {
	ConversationID string   `json:"conversationId"`
	Present        []string `json:"present"`
	Typing         []string `json:"typing,omitempty"`
}

// IsVoiceSpeechStart reports whether the event is a well-formed
// `voice.speech_start` (RFC 0106).
func IsVoiceSpeechStart(ev RunEventDoc) bool {
	return ev.Type == "voice.speech_start" && payloadHasNumber(ev.Payload, "atMs")
}

// IsVoiceTranscript reports whether the event is a well-formed
// `voice.transcript` (RFC 0106): type + text/isFinal/atMs + contentTrust
// "untrusted" (voice-transcript-untrusted).
func IsVoiceTranscript(ev RunEventDoc) bool {
	if ev.Type != "voice.transcript" {
		return false
	}
	if !payloadHasString(ev.Payload, "text") || !payloadHasNumber(ev.Payload, "atMs") {
		return false
	}
	m, ok := payloadAsMap(ev.Payload)
	if !ok {
		return false
	}
	if _, ok := m["isFinal"].(bool); !ok {
		return false
	}
	ct, _ := m["contentTrust"].(string)
	return ct == "untrusted"
}

// IsVoiceEndpointCandidate reports whether the event is a well-formed
// `voice.endpoint_candidate` (RFC 0106).
func IsVoiceEndpointCandidate(ev RunEventDoc) bool {
	return ev.Type == "voice.endpoint_candidate" && payloadHasNumber(ev.Payload, "atMs")
}

// IsVoiceTurnCommit reports whether the event is a well-formed
// `voice.turn_commit` (RFC 0106): type + atMs + finalText.
func IsVoiceTurnCommit(ev RunEventDoc) bool {
	return ev.Type == "voice.turn_commit" &&
		payloadHasNumber(ev.Payload, "atMs") &&
		payloadHasString(ev.Payload, "finalText")
}

// IsVoiceSynthesisChunk reports whether the event is a well-formed
// `voice.synthesis_chunk` (RFC 0106): type + seq + mimeType.
func IsVoiceSynthesisChunk(ev RunEventDoc) bool {
	return ev.Type == "voice.synthesis_chunk" &&
		payloadHasNumber(ev.Payload, "seq") &&
		payloadHasString(ev.Payload, "mimeType")
}

// IsVoiceBargeIn reports whether the event is a well-formed `voice.barge_in`
// (RFC 0106).
func IsVoiceBargeIn(ev RunEventDoc) bool {
	return ev.Type == "voice.barge_in" && payloadHasNumber(ev.Payload, "atMs")
}

// IsVoiceCancelled reports whether the event is a well-formed
// `voice.cancelled` (RFC 0106).
func IsVoiceCancelled(ev RunEventDoc) bool {
	return ev.Type == "voice.cancelled" && payloadHasNumber(ev.Payload, "atMs")
}

// IsChannelPresence reports whether the event is a well-formed
// `channel.presence` (RFC 0110). EPHEMERAL — present on the LIVE stream only,
// absent on replay/:fork.
func IsChannelPresence(ev RunEventDoc) bool {
	return ev.Type == "channel.presence" &&
		payloadHasString(ev.Payload, "conversationId") &&
		payloadHasArray(ev.Payload, "present")
}

// UnmarshalVoiceSpeechStart extracts the typed payload from a
// `voice.speech_start` event.
func UnmarshalVoiceSpeechStart(ev RunEventDoc) (VoiceSpeechStartPayload, error) {
	var p VoiceSpeechStartPayload
	if !IsVoiceSpeechStart(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalVoiceTranscript extracts the typed payload from a
// `voice.transcript` event.
func UnmarshalVoiceTranscript(ev RunEventDoc) (VoiceTranscriptPayload, error) {
	var p VoiceTranscriptPayload
	if !IsVoiceTranscript(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalVoiceEndpointCandidate extracts the typed payload from a
// `voice.endpoint_candidate` event.
func UnmarshalVoiceEndpointCandidate(ev RunEventDoc) (VoiceEndpointCandidatePayload, error) {
	var p VoiceEndpointCandidatePayload
	if !IsVoiceEndpointCandidate(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalVoiceTurnCommit extracts the typed payload from a
// `voice.turn_commit` event.
func UnmarshalVoiceTurnCommit(ev RunEventDoc) (VoiceTurnCommitPayload, error) {
	var p VoiceTurnCommitPayload
	if !IsVoiceTurnCommit(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalVoiceSynthesisChunk extracts the typed payload from a
// `voice.synthesis_chunk` event.
func UnmarshalVoiceSynthesisChunk(ev RunEventDoc) (VoiceSynthesisChunkPayload, error) {
	var p VoiceSynthesisChunkPayload
	if !IsVoiceSynthesisChunk(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalVoiceBargeIn extracts the typed payload from a `voice.barge_in`
// event.
func UnmarshalVoiceBargeIn(ev RunEventDoc) (VoiceBargeInPayload, error) {
	var p VoiceBargeInPayload
	if !IsVoiceBargeIn(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalVoiceCancelled extracts the typed payload from a `voice.cancelled`
// event.
func UnmarshalVoiceCancelled(ev RunEventDoc) (VoiceCancelledPayload, error) {
	var p VoiceCancelledPayload
	if !IsVoiceCancelled(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalChannelPresence extracts the typed payload from a
// `channel.presence` event.
func UnmarshalChannelPresence(ev RunEventDoc) (ChannelPresencePayload, error) {
	var p ChannelPresencePayload
	if !IsChannelPresence(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// payloadStringEquals reports whether the payload is a map with `field` set to a
// JSON string equal to want. Used for discriminated event payloads that pin a
// literal enum value (e.g. dispatchFanOut.fanOutPolicy == "parallel").
func payloadStringEquals(payload any, field, want string) bool {
	m, ok := payloadAsMap(payload)
	if !ok {
		return false
	}
	s, ok := m[field].(string)
	return ok && s == want
}

// ── RFC 0111 — context.summarized ────────────────────────────────────────

// ContextSummarizedPayload mirrors `context.summarized` (RFC 0111). Emitted when
// the host replaces older in-window orchestrator-loop transcript turns with a
// host-produced summary to honor
// multiAgent.executionModel.contextBudget.transcriptTokenBudget. CONTENT-FREE:
// the summary text never rides the wire — SummaryRef is an artifactId resolved
// via GET /v1/runs/{runId}/artifacts/{artifactId}. On :fork mode:replay the host
// MUST reuse this recorded SummaryRef and MUST NOT re-summarize. ReplacedTurns
// lists the event ids the summary stands in for, so a replay engine
// reconstructs the exact transcript.
type ContextSummarizedPayload struct {
	// Iteration is the orchestrator-loop iteration whose transcript assembly
	// triggered this.
	Iteration int `json:"iteration"`
	// ReplacedTurns are the event ids the summary stands in for (a contiguous
	// most-recent-replaced range).
	ReplacedTurns []string `json:"replacedTurns"`
	// SummaryRef is the artifactId of the persisted summary (the summary text is
	// NOT inlined).
	SummaryRef string `json:"summaryRef"`
	// TokenCounter is the unit TokensBefore/TokensAfter are denominated in;
	// equals the advertised contextBudget.tokenCounter
	// ("o200k_base" | "cl100k_base" | "chars" | "host-defined").
	TokenCounter string `json:"tokenCounter,omitempty"`
	// TokensBefore is the token count of the replaced range before summarization.
	TokensBefore int `json:"tokensBefore,omitempty"`
	// TokensAfter is the token count of the summary that replaced the range
	// (expected ≤ TokensBefore).
	TokensAfter int `json:"tokensAfter,omitempty"`
}

// IsContextSummarized reports whether the event is a well-formed
// `context.summarized` (RFC 0111): type discriminator + a string SummaryRef and
// a numeric Iteration.
func IsContextSummarized(ev RunEventDoc) bool {
	return ev.Type == "context.summarized" &&
		payloadHasString(ev.Payload, "summaryRef") &&
		payloadHasNumber(ev.Payload, "iteration")
}

// UnmarshalContextSummarized extracts the typed payload from a
// `context.summarized` event.
func UnmarshalContextSummarized(ev RunEventDoc) (ContextSummarizedPayload, error) {
	var p ContextSummarizedPayload
	if !IsContextSummarized(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// ── RFC 0118 — core.dispatch.fanOut / core.dispatch.join ─────────────────

// DispatchFanOutPayload mirrors `core.dispatch.fanOut` (RFC 0118). Emitted by
// core.dispatch when a fanOutPolicy:"parallel" wave BEGINS, so the parent stays
// observable while children run concurrently. Emitted ONLY on the parallel path;
// the envelope's nodeId carries the dispatching node id and causationId is the
// consumed runOrchestrator.decided event.
type DispatchFanOutPayload struct {
	// FanOutPolicy is always "parallel" — this event fires only on the parallel
	// fan-out path.
	FanOutPolicy string `json:"fanOutPolicy"`
	// ChildCount is the number of children dispatched in this fan-out (> 1 by
	// construction).
	ChildCount int `json:"childCount"`
	// MaxConcurrency is the effective concurrency ceiling for the wave, when
	// bounded (min(config.maxConcurrency, capabilities.dispatch.maxFanOut)).
	MaxConcurrency *int `json:"maxConcurrency,omitempty"`
	// JoinMode is the joinPolicy.mode governing this fan-out:
	// "wait-all" | "quorum" | "first" | "race".
	JoinMode string `json:"joinMode,omitempty"`
}

// DispatchJoinPayload mirrors `core.dispatch.join` (RFC 0118). Emitted by
// core.dispatch when a fanOutPolicy:"parallel" join is satisfied (or fails).
// MergeOrder is the canonical replay-deterministic record of the output-merge
// tiebreak — a replay/:fork MUST re-apply outputMapping in MergeOrder (the
// parent host's observed wall-clock terminal order), never in nextWorkerIds
// order.
type DispatchJoinPayload struct {
	// JoinOutcome is "satisfied" (mode met, node did not fail), "failed"
	// (fail-fast tripped or mode unsatisfiable — node fails), or "partial" (mode
	// met but ≥1 child non-completed under collect/absorb — node SUCCEEDS).
	JoinOutcome string `json:"joinOutcome"`
	// CompletedCount is the number of children that reached completed.
	CompletedCount int `json:"completedCount,omitempty"`
	// FailedCount is the number of children that reached failed.
	FailedCount int `json:"failedCount,omitempty"`
	// CancelledCount is the number of children cancelled (e.g. in-flight when a
	// quorum/first/race/fail-fast join short-circuited).
	CancelledCount *int `json:"cancelledCount,omitempty"`
	// MergeOrder is the childRunIds in the parent host's observed wall-clock
	// terminal order — the replay-deterministic tiebreak for colliding
	// outputMapping keys. Recorded at terminal-fold time; never recomputed from
	// child timestamps.
	MergeOrder []string `json:"mergeOrder"`
}

// IsDispatchFanOut reports whether the event is a well-formed
// `core.dispatch.fanOut` (RFC 0118): type discriminator + fanOutPolicy pinned to
// "parallel" (the event fires only on the parallel path) + a numeric ChildCount.
func IsDispatchFanOut(ev RunEventDoc) bool {
	return ev.Type == "core.dispatch.fanOut" &&
		payloadStringEquals(ev.Payload, "fanOutPolicy", "parallel") &&
		payloadHasNumber(ev.Payload, "childCount")
}

// IsDispatchJoin reports whether the event is a well-formed
// `core.dispatch.join` (RFC 0118): type discriminator + a string JoinOutcome and
// a MergeOrder array.
func IsDispatchJoin(ev RunEventDoc) bool {
	return ev.Type == "core.dispatch.join" &&
		payloadHasString(ev.Payload, "joinOutcome") &&
		payloadHasArray(ev.Payload, "mergeOrder")
}

// UnmarshalDispatchFanOut extracts the typed payload from a
// `core.dispatch.fanOut` event.
func UnmarshalDispatchFanOut(ev RunEventDoc) (DispatchFanOutPayload, error) {
	var p DispatchFanOutPayload
	if !IsDispatchFanOut(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}

// UnmarshalDispatchJoin extracts the typed payload from a
// `core.dispatch.join` event.
func UnmarshalDispatchJoin(ev RunEventDoc) (DispatchJoinPayload, error) {
	var p DispatchJoinPayload
	if !IsDispatchJoin(ev) {
		return p, ErrNotMatchingEvent
	}
	if err := reencode(ev.Payload, &p); err != nil {
		return p, err
	}
	return p, nil
}
