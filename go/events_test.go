// Tests for the typed agent.* event helpers (RFC 0002 + RFC 0024).
//
// Parallel to:
//   - sdk/typescript/src/__tests__/event-helpers.test.ts
//   - sdk/python/tests/test_events.py
//
// Schema-mirror sanity test reads schemas/run-event-payloads.schema.json
// and asserts the required[] arrays for each agent.* $def match the
// hand-authored Go structs in events.go.

package openwopclient

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

func makeEvent(eventType string, payload any) RunEventDoc {
	return RunEventDoc{
		EventID:   "evt-x",
		RunID:     "run-x",
		Type:      eventType,
		Payload:   payload,
		Timestamp: "2026-05-19T00:00:00Z",
		Sequence:  0,
	}
}

func TestIsAgentReasoned_TruePositive(t *testing.T) {
	ev := makeEvent("agent.reasoned", map[string]any{
		"agentId":   "asst-1",
		"reasoning": "thinking…",
		"verbosity": "full",
	})
	if !IsAgentReasoned(ev) {
		t.Fatal("expected IsAgentReasoned to return true for well-formed event")
	}
	p, err := UnmarshalAgentReasoned(ev)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Reasoning != "thinking…" {
		t.Errorf("Reasoning = %q; want \"thinking…\"", p.Reasoning)
	}
	if p.Verbosity != ReasoningVerbosityFull {
		t.Errorf("Verbosity = %q; want %q", p.Verbosity, ReasoningVerbosityFull)
	}
}

func TestIsAgentReasoningDelta_TruePositive(t *testing.T) {
	ev := makeEvent("agent.reasoning.delta", map[string]any{
		"agentId":  "asst-1",
		"delta":    "step 1",
		"sequence": float64(0), // JSON unmarshal yields float64 for numbers
	})
	if !IsAgentReasoningDelta(ev) {
		t.Fatal("expected IsAgentReasoningDelta to return true")
	}
	p, err := UnmarshalAgentReasoningDelta(ev)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.Delta != "step 1" || p.Sequence != 0 {
		t.Errorf("got delta=%q sequence=%d; want \"step 1\" / 0", p.Delta, p.Sequence)
	}
}

func TestIsAgentReasoningDelta_RejectsBadSequence(t *testing.T) {
	cases := []any{
		float64(-1),  // negative
		float64(1.5), // non-integer
		"0",          // string
		nil,          // missing
		true,         // bool — Go's type-switch falls to default; verify
		false,
	}
	for _, seq := range cases {
		ev := makeEvent("agent.reasoning.delta", map[string]any{
			"agentId":  "asst-1",
			"delta":    "x",
			"sequence": seq,
		})
		if IsAgentReasoningDelta(ev) {
			t.Errorf("expected rejection for sequence=%v", seq)
		}
	}
}

func TestIsAgentReasoningDelta_AcceptsEmptyDelta(t *testing.T) {
	// Schema's `delta` field has no minLength constraint — predicate
	// must accept empty-string deltas. Cross-SDK contract: TS and Python
	// also accept this shape.
	ev := makeEvent("agent.reasoning.delta", map[string]any{
		"agentId":  "asst-1",
		"delta":    "",
		"sequence": float64(0),
	})
	if !IsAgentReasoningDelta(ev) {
		t.Fatal("predicate must accept empty-string delta per schema (no minLength)")
	}
}

func TestIsAgentHandoff_DistinctFieldNames(t *testing.T) {
	// Reject events that use single agentId (wrong contract).
	ev := makeEvent("agent.handoff", map[string]any{
		"agentId":   "asst-1",
		"toAgentId": "x",
	})
	if IsAgentHandoff(ev) {
		t.Fatal("agent.handoff with single agentId must be rejected")
	}
	// Accept events with the canonical fromAgentId / toAgentId pair.
	ev2 := makeEvent("agent.handoff", map[string]any{
		"fromAgentId": "asst-1",
		"toAgentId":   "researcher",
		"reason":      "specialist",
	})
	if !IsAgentHandoff(ev2) {
		t.Fatal("agent.handoff with fromAgentId+toAgentId must be accepted")
	}
	p, err := UnmarshalAgentHandoff(ev2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.FromAgentID != "asst-1" || p.ToAgentID != "researcher" {
		t.Errorf("got from=%q to=%q; want asst-1 / researcher", p.FromAgentID, p.ToAgentID)
	}
}

func TestUnmarshalAgent_ReturnsErrNotMatchingEventOnMissedType(t *testing.T) {
	// Wrong type discriminator — Unmarshal MUST return ErrNotMatchingEvent.
	ev := makeEvent("node.message", map[string]any{"agentId": "asst-1", "reasoning": "x"})
	_, err := UnmarshalAgentReasoned(ev)
	if !errors.Is(err, ErrNotMatchingEvent) {
		t.Fatalf("got err=%v; want ErrNotMatchingEvent", err)
	}
}

func TestUnknownEventType_AllPredicatesReturnFalse(t *testing.T) {
	// Forward-compat per COMPATIBILITY.md §2.1 — unknown event types
	// MUST NOT crash; every predicate returns false cleanly.
	ev := makeEvent("vendor.future.event", map[string]any{"stuff": "x"})
	if IsAgentReasoned(ev) || IsAgentReasoningDelta(ev) || IsAgentToolCalled(ev) ||
		IsAgentToolReturned(ev) || IsAgentHandoff(ev) || IsAgentDecided(ev) {
		t.Fatal("unknown event type must not match any agent.* predicate")
	}
}

func TestAgent_NonMapPayload_Rejected(t *testing.T) {
	cases := []any{nil, "string", 42, []any{}, true}
	for _, p := range cases {
		ev := makeEvent("agent.reasoned", p)
		if IsAgentReasoned(ev) {
			t.Errorf("expected rejection for payload=%v (type %T)", p, p)
		}
	}
}

func TestSchemaMirror_AgentDefsMatchExpectedRequired(t *testing.T) {
	// Find the canonical schema. Path: go/ → repo-root/
	// → schemas/run-event-payloads.schema.json.
	schemaPath := filepath.Join("..", "schemas", "run-event-payloads.schema.json")
	raw, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("read schema: %v", err)
	}
	var doc struct {
		Defs map[string]struct {
			Required []string `json:"required"`
		} `json:"$defs"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse schema: %v", err)
	}

	cases := []struct {
		defName  string
		required []string
	}{
		{"agentReasoned", []string{"agentId", "reasoning"}},
		{"agentReasoningDelta", []string{"agentId", "delta", "sequence"}},
		{"agentToolCalled", []string{"agentId", "toolName", "callId"}},
		{"agentToolReturned", []string{"agentId", "toolName", "callId"}},
		{"agentHandoff", []string{"fromAgentId", "toAgentId"}},
		{"agentDecided", []string{"agentId", "decision"}},
	}

	for _, c := range cases {
		t.Run(c.defName, func(t *testing.T) {
			def, ok := doc.Defs[c.defName]
			if !ok {
				t.Fatalf("$def.%s not found in schema", c.defName)
			}
			got := append([]string(nil), def.Required...)
			sort.Strings(got)
			want := append([]string(nil), c.required...)
			sort.Strings(want)
			if !reflect.DeepEqual(got, want) {
				t.Errorf("$def.%s required = %v; want %v", c.defName, got, want)
			}
		})
	}
}

// ── RFC 0106 voice.* + RFC 0110 channel.presence guards (phase 2) ────────

func TestVoiceAndPresenceGuards(t *testing.T) {
	if !IsVoiceSpeechStart(makeEvent("voice.speech_start", map[string]any{"atMs": 0})) {
		t.Error("voice.speech_start with atMs should match")
	}
	if IsVoiceSpeechStart(makeEvent("voice.speech_start", map[string]any{})) {
		t.Error("voice.speech_start without atMs must not match")
	}

	// voice.transcript: requires text+isFinal+atMs+contentTrust=="untrusted"
	good := makeEvent("voice.transcript", map[string]any{
		"text": "transfer information", "isFinal": true, "atMs": 1200, "contentTrust": "untrusted",
	})
	if !IsVoiceTranscript(good) {
		t.Error("well-formed voice.transcript should match")
	}
	p, err := UnmarshalVoiceTranscript(good)
	if err != nil || p.ContentTrust != "untrusted" || p.Text != "transfer information" {
		t.Errorf("UnmarshalVoiceTranscript: %+v err=%v", p, err)
	}
	if IsVoiceTranscript(makeEvent("voice.transcript", map[string]any{"text": "x", "isFinal": false, "atMs": 1})) {
		t.Error("voice.transcript without contentTrust must not match")
	}
	if IsVoiceTranscript(makeEvent("voice.transcript", map[string]any{"text": "x", "isFinal": false, "atMs": 1, "contentTrust": "trusted"})) {
		t.Error("voice.transcript with contentTrust!=untrusted must not match")
	}
	// bool must not satisfy the numeric atMs check
	if IsVoiceTranscript(makeEvent("voice.transcript", map[string]any{"text": "x", "isFinal": true, "atMs": true, "contentTrust": "untrusted"})) {
		t.Error("bool atMs must not satisfy payloadHasNumber")
	}

	if !IsVoiceTurnCommit(makeEvent("voice.turn_commit", map[string]any{"atMs": 9, "finalText": "done"})) {
		t.Error("voice.turn_commit with atMs+finalText should match")
	}
	if IsVoiceTurnCommit(makeEvent("voice.turn_commit", map[string]any{"atMs": 9})) {
		t.Error("voice.turn_commit without finalText must not match")
	}
	if !IsVoiceSynthesisChunk(makeEvent("voice.synthesis_chunk", map[string]any{"seq": 0, "mimeType": "audio/mpeg"})) {
		t.Error("voice.synthesis_chunk with seq+mimeType should match")
	}
	if !IsVoiceEndpointCandidate(makeEvent("voice.endpoint_candidate", map[string]any{"atMs": 5})) {
		t.Error("voice.endpoint_candidate should match")
	}
	if !IsVoiceBargeIn(makeEvent("voice.barge_in", map[string]any{"atMs": 5})) {
		t.Error("voice.barge_in should match")
	}
	if !IsVoiceCancelled(makeEvent("voice.cancelled", map[string]any{"atMs": 5, "reason": "barge-in"})) {
		t.Error("voice.cancelled should match")
	}

	// channel.presence: requires conversationId + present array (test uses []string)
	pres := makeEvent("channel.presence", map[string]any{
		"conversationId": "conv-1", "present": []string{"user:a", "agent:b"}, "typing": []string{"user:a"},
	})
	if !IsChannelPresence(pres) {
		t.Error("well-formed channel.presence should match")
	}
	cp, err := UnmarshalChannelPresence(pres)
	if err != nil || len(cp.Present) != 2 {
		t.Errorf("UnmarshalChannelPresence: %+v err=%v", cp, err)
	}
	// also accepts []any (wire form)
	if !IsChannelPresence(makeEvent("channel.presence", map[string]any{"conversationId": "c", "present": []any{"user:a"}})) {
		t.Error("channel.presence with []any present should match")
	}
	if IsChannelPresence(makeEvent("channel.presence", map[string]any{"conversationId": "conv-1"})) {
		t.Error("channel.presence without present must not match")
	}
}

// ── RFC 0111 context.summarized + RFC 0118 core.dispatch.* guards ─────────

func TestContextSummarizedGuard(t *testing.T) {
	good := makeEvent("context.summarized", map[string]any{
		"iteration":     float64(3),
		"summaryRef":    "artifact-9",
		"replacedTurns": []string{"evt-1", "evt-2"},
		"tokenCounter":  "chars",
		"tokensBefore":  float64(900),
		"tokensAfter":   float64(120),
	})
	if !IsContextSummarized(good) {
		t.Fatal("well-formed context.summarized should match")
	}
	p, err := UnmarshalContextSummarized(good)
	if err != nil || p.SummaryRef != "artifact-9" || p.Iteration != 3 || len(p.ReplacedTurns) != 2 {
		t.Errorf("UnmarshalContextSummarized: %+v err=%v", p, err)
	}
	// Missing numeric iteration must not match.
	if IsContextSummarized(makeEvent("context.summarized", map[string]any{"summaryRef": "a"})) {
		t.Error("context.summarized without iteration must not match")
	}
	// Missing summaryRef string must not match.
	if IsContextSummarized(makeEvent("context.summarized", map[string]any{"iteration": float64(1)})) {
		t.Error("context.summarized without summaryRef must not match")
	}
	// Wrong type discriminator → Unmarshal returns ErrNotMatchingEvent.
	if _, err := UnmarshalContextSummarized(makeEvent("node.message", map[string]any{})); !errors.Is(err, ErrNotMatchingEvent) {
		t.Errorf("expected ErrNotMatchingEvent, got %v", err)
	}
}

func TestDispatchGuards(t *testing.T) {
	// core.dispatch.fanOut: fanOutPolicy pinned to "parallel" + numeric childCount.
	fanOut := makeEvent("core.dispatch.fanOut", map[string]any{
		"fanOutPolicy": "parallel", "childCount": float64(4), "joinMode": "wait-all",
	})
	if !IsDispatchFanOut(fanOut) {
		t.Fatal("well-formed core.dispatch.fanOut should match")
	}
	fp, err := UnmarshalDispatchFanOut(fanOut)
	if err != nil || fp.FanOutPolicy != "parallel" || fp.ChildCount != 4 {
		t.Errorf("UnmarshalDispatchFanOut: %+v err=%v", fp, err)
	}
	// A non-parallel fanOutPolicy must not match (the event fires only on parallel).
	if IsDispatchFanOut(makeEvent("core.dispatch.fanOut", map[string]any{"fanOutPolicy": "sequential", "childCount": float64(4)})) {
		t.Error("core.dispatch.fanOut with fanOutPolicy!=parallel must not match")
	}
	// Missing numeric childCount must not match.
	if IsDispatchFanOut(makeEvent("core.dispatch.fanOut", map[string]any{"fanOutPolicy": "parallel"})) {
		t.Error("core.dispatch.fanOut without childCount must not match")
	}

	// core.dispatch.join: string joinOutcome + mergeOrder array.
	join := makeEvent("core.dispatch.join", map[string]any{
		"joinOutcome": "satisfied", "completedCount": float64(3), "mergeOrder": []string{"r-1", "r-2", "r-3"},
	})
	if !IsDispatchJoin(join) {
		t.Fatal("well-formed core.dispatch.join should match")
	}
	jp, err := UnmarshalDispatchJoin(join)
	if err != nil || jp.JoinOutcome != "satisfied" || len(jp.MergeOrder) != 3 {
		t.Errorf("UnmarshalDispatchJoin: %+v err=%v", jp, err)
	}
	// Missing mergeOrder array must not match.
	if IsDispatchJoin(makeEvent("core.dispatch.join", map[string]any{"joinOutcome": "failed"})) {
		t.Error("core.dispatch.join without mergeOrder must not match")
	}
	// []any wire form for mergeOrder also matches.
	if !IsDispatchJoin(makeEvent("core.dispatch.join", map[string]any{"joinOutcome": "partial", "mergeOrder": []any{"r-1"}})) {
		t.Error("core.dispatch.join with []any mergeOrder should match")
	}
}
