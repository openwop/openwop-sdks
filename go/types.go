// Package openwopclient implements a Go client for OpenWOP-compliant servers.
//
// Types mirror the OpenAPI 3.1 spec (../../api/openapi.yaml) and JSON
// Schemas (../schemas/). Hand-authored — see README.md §rationale.
package openwopclient

import "encoding/json"

// RunStatus values per `RunSnapshot.status`.
type RunStatus string

const (
	StatusPending         RunStatus = "pending"
	StatusRunning         RunStatus = "running"
	StatusPaused          RunStatus = "paused"
	StatusWaitingApproval RunStatus = "waiting-approval"
	StatusWaitingInput    RunStatus = "waiting-input"
	// StatusWaitingExternal distinguishes external-event waits from HITL
	// waits at the wire level (interrupt-profiles.md
	// §openwop-interrupt-external-event). Active (non-terminal).
	StatusWaitingExternal RunStatus = "waiting-external"
	StatusCompleted       RunStatus = "completed"
	StatusFailed          RunStatus = "failed"
	// StatusCancelling (RFC 0094 §B) is the transitional state between a
	// cancel request being accepted and the terminal "cancelled". Active
	// (non-terminal): a snapshot read during the cancel cascade carries it.
	StatusCancelling RunStatus = "cancelling"
	StatusCancelled  RunStatus = "cancelled"
)

// StreamMode values per `?streamMode=` on the events SSE endpoint.
type StreamMode string

const (
	StreamModeValues   StreamMode = "values"
	StreamModeUpdates  StreamMode = "updates"
	StreamModeMessages StreamMode = "messages"
	StreamModeDebug    StreamMode = "debug"
)

// CapabilitiesLimits holds the engine-enforced caps.
type CapabilitiesLimits struct {
	ClarificationRounds int  `json:"clarificationRounds"`
	SchemaRounds        int  `json:"schemaRounds"`
	EnvelopesPerTurn    int  `json:"envelopesPerTurn"`
	MaxNodeExecutions   *int `json:"maxNodeExecutions,omitempty"`
	MaxRunDurationMs    *int `json:"maxRunDurationMs,omitempty"`  // RFC 0058
	MaxLoopIterations   *int `json:"maxLoopIterations,omitempty"` // RFC 0058
	// MaxRequestBodyBytes is the maximum REST request body size (bytes) the
	// host accepts (RFC 0094 §H). Hosts that advertise it MUST enforce it.
	MaxRequestBodyBytes *int `json:"maxRequestBodyBytes,omitempty"`
}

// CapabilitiesGRPC is the RFC 0094 §H gRPC transport advertisement per
// grpc-transport.md §"Capability advertisement". Absent from Capabilities ⇒
// the host exposes no gRPC transport. A host that exposes the gRPC surface
// advertises this block AND includes "grpc" in SupportedTransports. REST +
// SSE remain exposed regardless.
type CapabilitiesGRPC struct {
	// Supported toggles — true when the gRPC surface is live.
	Supported bool `json:"supported"`
	// Endpoint is a full URI: grpc:// (cleartext, intra-trusted-network
	// only) OR grpcs:// (TLS). Hosts SHOULD require TLS in production.
	Endpoint string `json:"endpoint,omitempty"`
	// Service is the canonical service name; v1 hosts MUST use
	// "openwop.v1.Engine".
	Service string `json:"service"`
	// TLS posture: "required" | "optional" | "disabled". Production hosts
	// MUST set "required".
	TLS string `json:"tls"`
}

// CapabilitiesMultiPartyConversation is the RFC 0101 multi-party
// group-conversation advertisement. Absent from Capabilities ⇒ the host does
// not support N agents co-participating in one shared transcript (the single
// user + single driving agent shape of RFC 0005 remains). When Supported is
// true, the host honors the additive participants ([]AgentRef) roster on
// conversation.opened and the conditionally-required per-turn speakerId on
// role:"agent" conversation turns.
type CapabilitiesMultiPartyConversation struct {
	// Supported toggles — true when the host supports multi-party conversations.
	Supported bool `json:"supported"`
	// MaxParticipants is the upper bound on participants[] the host accepts;
	// nil ⇒ host-defined / unbounded.
	MaxParticipants *int `json:"maxParticipants,omitempty"`
}

// CapabilitiesRealtimeVoice is the RFC 0106 real-time voice profile
// (capability advertisement). Absent from CapabilitiesAIProviders ⇒ no live
// voice. The host enforces that TurnDetection / BargeIn require Transcription.
// The ctx.* voice methods are host-side and not modeled in this client SDK.
type CapabilitiesRealtimeVoice struct {
	// Transcription is "streaming" when the host exposes streaming STT.
	Transcription string `json:"transcription,omitempty"`
	// Synthesis is "streaming" when ctx.callSpeechSynthesizer honors stream:true.
	Synthesis string `json:"synthesis,omitempty"`
	// TurnDetection is "vad" | "semantic"; requires Transcription.
	TurnDetection string `json:"turnDetection,omitempty"`
	// BargeIn is "supported" when the host emits voice.barge_in/voice.cancelled.
	BargeIn string `json:"bargeIn,omitempty"`
}

// CapabilitiesAIProviders is the host AI-proxy advertisement (aiProviders in
// capabilities.md). Every field is optional per capabilities.schema.json (the
// block declares no required fields). The wire object MAY carry additional
// fields (input, authModes, maxInlineMediaBytes) not modeled here.
type CapabilitiesAIProviders struct {
	// Supported lists provider ids the host's AI-proxy can route to.
	Supported []string `json:"supported,omitempty"`
	// BYOK is the subset of Supported for which BYOK is permitted.
	BYOK []string `json:"byok,omitempty"`
	// Policies is the optional 4-mode policy advertisement (opaque here).
	Policies map[string]any `json:"policies,omitempty"`
	// SelfHosted (RFC 0108) is the subset of Supported that are operator-/
	// tenant-configured OpenAI-compatible endpoints. The id is an OPAQUE label
	// that MUST NOT encode the endpoint location, and a client MUST NOT infer
	// model capabilities from it (RFC 0108 §A.3/§B).
	SelfHosted []string `json:"selfHosted,omitempty"`
	// SpeechSynthesis (RFC 0105) is "supported" when the host exposes speech
	// synthesis (host-side ctx.callSpeechSynthesizer). Empty ⇒ no TTS.
	SpeechSynthesis string `json:"speechSynthesis,omitempty"`
	// RealtimeVoice (RFC 0106) is the real-time voice profile; nil ⇒ no live voice.
	RealtimeVoice *CapabilitiesRealtimeVoice `json:"realtimeVoice,omitempty"`
	// PromptPrefixCache (RFC 0116) advertises that the host honors the
	// AI-envelope generate request's optional cachePrefixId routing hint; nil ⇒
	// the host ignores cachePrefixId (no error).
	PromptPrefixCache *CapabilitiesPromptPrefixCache `json:"promptPrefixCache,omitempty"`
}

// CapabilitiesPromptPrefixCache is the RFC 0116 provider-scoped advertisement
// that the host honors the AI-envelope generate request's optional
// cachePrefixId (a tenant-namespaced, secret-free label) as a routing hint into
// the routed provider's server-side context cache. The cache MUST be keyed by
// (resolved tenant, cachePrefixId) (SECURITY invariant
// prompt-prefix-cache-cross-tenant-isolation) and a hit/miss MUST NOT change the
// recorded envelope or provider.usage token counts (replay-invariant).
type CapabilitiesPromptPrefixCache struct {
	// Supported toggles — true when the host honors cachePrefixId.
	Supported bool `json:"supported"`
	// Providers is the subset of the routed providers for which cachePrefixId is
	// honored; a request whose routed provider is not listed has cachePrefixId
	// ignored. nil ⇒ not provider-scoped.
	Providers []string `json:"providers,omitempty"`
}

// CapabilitiesA2A is the RFC 0100 A2A (Agent2Agent) advertisement. Supported
// alone ⇒ the synchronous message/send → poll tasks/get round-trip. The
// optional flags gate the RFC 0100 async/durable additions. Absent from
// Capabilities ⇒ no A2A advertisement.
type CapabilitiesA2A struct {
	// Supported toggles — true when the host exposes itself as an A2A agent.
	Supported bool `json:"supported"`
	// AgentCardURL is the A2A 0.3 well-known agent card URL
	// (/.well-known/agent-card.json).
	AgentCardURL string `json:"agentCardUrl"`
	// Streaming gates message/stream + tasks/resubscribe (RFC 0100 §3).
	Streaming *bool `json:"streaming,omitempty"`
	// PushNotifications gates A2A push-notification config (RFC 0100 §4); a
	// caller-supplied pushConfig.url is SSRF-validated (a2a-push-egress-ssrf).
	PushNotifications *bool `json:"pushNotifications,omitempty"`
	// DurableTasks (RFC 0100 §2) ⇒ the host persists the projected A2ATaskState;
	// tasks/get returns live state after disconnect. nil/false ⇒ synchronous only.
	DurableTasks *bool `json:"durableTasks,omitempty"`
}

// CapabilitiesConversationTurnModelProvenance is the RFC 0109 advertisement:
// the host stamps the optional non-secret agent.model ({provider, model}) on
// role:"agent" conversation turns, read verbatim on :fork. Absent ⇒ no
// provenance.
type CapabilitiesConversationTurnModelProvenance struct {
	// Supported toggles — true when the host stamps agent.model.
	Supported bool `json:"supported"`
}

// CapabilitiesChannelPresence is the RFC 0110 advertisement: the host emits the
// ephemeral channel.presence RunEvent (online + per-member typing) for
// type:"channel" conversations. Presence is live state — never persisted to the
// replayable log, never affects replay/:fork, and membership-gated
// (default-deny). Absent ⇒ no presence.
type CapabilitiesChannelPresence struct {
	// Supported toggles — true when the host emits channel.presence.
	Supported bool `json:"supported"`
}

// CapabilitiesApproverRouting is the RFC 0104 portable HITL approver-routing
// advertisement. When Supported, the host honors the OPTIONAL advisory
// approverGroupRefs / approverRoleRefs / audience fields on the kind:"approval"
// interrupt payload (the SDK carries the interrupt payload opaquely, so those
// advisory fields ride that opaque object), resolves the advertised RefKinds
// against its own RBAC, and enforces eligibility at resolve time.
type CapabilitiesApproverRouting struct {
	// Supported toggles — true when the host honors the approver-routing fields.
	Supported bool `json:"supported"`
	// RefKinds the host resolves: "group" ⇒ approverGroupRefs,
	// "role" ⇒ approverRoleRefs. nil ⇒ advisory-only passthrough.
	RefKinds []string `json:"refKinds,omitempty"`
	// Audience — host honors the audience notification-targeting override;
	// nil/false ⇒ notifies the resolved eligible union.
	Audience *bool `json:"audience,omitempty"`
}

// CapabilitiesInterrupt is the RFC 0104 interrupt capability block. nil ⇒ the
// host advertises no interrupt-level options.
type CapabilitiesInterrupt struct {
	ApproverRouting *CapabilitiesApproverRouting `json:"approverRouting,omitempty"`
}

// CapabilitiesMemoryInjectionBudget is the RFC 0113 injection-budget descriptor:
// the host honors MemoryListOptions.tokenBudget (a token-bounded prefix of the
// ranked, SR-1-redacted, single-tenant entry list).
type CapabilitiesMemoryInjectionBudget struct {
	// Supported toggles — true when the host honors a supplied tokenBudget;
	// absent/false ⇒ tokenBudget is ignored (today's limit/tag behavior).
	Supported bool `json:"supported"`
	// TokenCounter is the unit tokenBudget is denominated in:
	// "o200k_base" | "cl100k_base" | "chars" | "host-defined". "chars" counts
	// UTF-8/Unicode characters of the entry content (tokenizer-free). nil ⇒
	// host-defined default. Kept an open string for forward-compat.
	TokenCounter *string `json:"tokenCounter,omitempty"`
}

// CapabilitiesMemory is the RFC 0113 agent-memory capability block. The wire
// memory block MAY carry other descriptors (e.g. search) not modeled here;
// nil ⇒ a supplied tokenBudget is ignored.
type CapabilitiesMemory struct {
	// InjectionBudget advertises that the host honors
	// MemoryListOptions.tokenBudget; nil ⇒ not advertised.
	InjectionBudget *CapabilitiesMemoryInjectionBudget `json:"injectionBudget,omitempty"`
}

// CapabilitiesRestTransport is the RFC 0115 advertisement of conditional-GET +
// Content-Encoding negotiation on run reads (GET /v1/runs/{runId}). Absent ⇒ the
// host returns today's 200 + identity body. Distinct from the file-egress
// fileHandling.transport sub-capability — this advertises HTTP-layer poll economy
// on the run-read REST surface.
type CapabilitiesRestTransport struct {
	// ConditionalRunGet — the host emits a strong, event-log-sequence-derived
	// ETag on GET /v1/runs/{runId} and honors If-None-Match with a 304 Not
	// Modified (empty body) when the validator matches the current state.
	ConditionalRunGet *bool `json:"conditionalRunGet,omitempty"`
	// ContentEncodings the host will negotiate on run reads: "gzip" is the
	// baseline; "br"/"zstd" are optional. For each advertised value the decoded
	// body is byte-identical to the identity body.
	ContentEncodings []string `json:"contentEncodings,omitempty"`
}

// CapabilitiesToolCatalog is the RFC 0112 advertisement of the compact,
// model-facing tool-catalog projection served by GET /v1/tools?view=compact;
// nil ⇒ the host serves no compact view.
type CapabilitiesToolCatalog struct {
	// CompactView — the host serves the compact CompactToolDescriptor projection
	// on GET /v1/tools?view=compact (+ the by-id variant); nil/false ⇒ unsupported.
	CompactView *bool `json:"compactView,omitempty"`
}

// CapabilitiesA2UISurface is the RFC 0114 advertisement that the host emits
// RFC 6902 (JSON-Patch) delta frames (A2UISurfaceDeltaFrame) over a recorded
// ui.a2ui-surface envelope to subscribers that negotiate ?a2uiDelta=1; nil ⇒ the
// host always delivers the materialized full surface.
type CapabilitiesA2UISurface struct {
	// DeltaTransport — the host emits A2UISurfaceDeltaFrame over the run event
	// stream to negotiating subscribers; nil/false ⇒ full-surface only.
	DeltaTransport *bool `json:"deltaTransport,omitempty"`
}

// CapabilitiesUIPlugins is the RFC 0117 (amended by RFC 0119) discovery block
// (capabilities.md §uiPlugins): the host loads signed kind:"frontend-plugin"
// packs in an origin/execution-isolated sandbox and serves the closed
// ui-plugin/1 host-RPC boundary. Absent ⇒ the host loads no plugin packs
// (graceful degradation to RFC 0071 host rendering). The SDK models only this
// discovery block — NOT the ui-plugin/1 RPC envelope or the frontend-plugin
// manifest (a renderer/registry concern).
type CapabilitiesUIPlugins struct {
	// Supported — the host loads frontend-plugin packs in an isolated sandbox
	// and serves the ui-plugin/1 boundary; false ⇒ it rejects such packs at
	// registration and renders no plugin surface.
	Supported bool `json:"supported"`
	// Isolation is the categorical isolation MECHANISM the host enforces:
	// "cross-origin-iframe" (default) | "wasm" | "process" | "container" | "vm",
	// plus a vendor "x-host-<host>-<key>" form. ALL values denote the SAME
	// mandatory isolation property; the field names the mechanism, never relaxes
	// the property. Open string for the vendor form; nil ⇒ "cross-origin-iframe".
	Isolation *string `json:"isolation,omitempty"`
	// Surfaces are the plugin surfaces this host renders:
	// "artifact-viewer" | "route" | "settings-panel". A pack surface not in this
	// set is installable-but-inert (graceful degradation).
	Surfaces []string `json:"surfaces,omitempty"`
	// HostAPI is the ui-plugin/1 host-RPC methods this host honors:
	// "artifact.read" | "artifact.write" | "host.toast" | "host.navigate". A call
	// to a method not in this set is rejected with method_not_allowed (SECURITY
	// invariant frontend-plugin-rpc-allowlist).
	HostAPI []string `json:"hostApi,omitempty"`
	// MaxEntryBytes is the per-plugin entry-bundle byte ceiling the host loads;
	// nil ⇒ host-defined / unbounded.
	MaxEntryBytes *int `json:"maxEntryBytes,omitempty"`
}

// CapabilitiesDispatch is the RFC 0007 + RFC 0118 top-level core.dispatch
// capability descriptors (capabilities.md §dispatch) — the discovery surface for
// parallel sub-workflow fan-out and join. All fields OPTIONAL + read-only; absent
// descriptors carry conservative defaults (a host that omits JoinModes implements
// no parallel join; one that omits OnChildFailureModes accepts only "collect").
// The SDK does NOT model the authoring-side DispatchConfig.
type CapabilitiesDispatch struct {
	// Supported — the host implements the core.dispatch Core typeId.
	Supported *bool `json:"supported,omitempty"`
	// FanOutSupported — the host honors nextWorkerIds.length > 1; since RFC 0118
	// ALSO the gate for accepting fanOutPolicy:"parallel" at registration.
	FanOutSupported *bool `json:"fanOutSupported,omitempty"`
	// FanOutPolicies are the fanOutPolicy values the host accepts:
	// "sequential" | "reject" | "parallel". Absent ⇒ ["sequential","reject"].
	FanOutPolicies []string `json:"fanOutPolicies,omitempty"`
	// JoinModes are the joinPolicy.mode values the host implements for
	// fanOutPolicy:"parallel": "wait-all" | "quorum" | "first" | "race".
	// Absent ⇒ no parallel join.
	JoinModes []string `json:"joinModes,omitempty"`
	// OnChildFailureModes are the joinPolicy.onChildFailure error-aggregation
	// values the host accepts: "collect" | "fail-fast" | "absorb". Absent ⇒
	// ["collect"] only.
	OnChildFailureModes []string `json:"onChildFailureModes,omitempty"`
	// MaxFanOut is the host's hard concurrency/breadth ceiling for a parallel
	// fan-out; nil ⇒ unbounded (treat as "unknown, may be capped").
	MaxFanOut *int `json:"maxFanOut,omitempty"`
}

// CapBreachedKind is the `kind` discriminator on a cap.breached event payload
// (run-event-payloads.schema.json#capBreached): the four engine kinds, the
// RFC 0008 §K wasm-* runtime caps, and the RFC 0058 run-scoped bounds.
type CapBreachedKind string

const (
	CapBreachedClarification  CapBreachedKind = "clarification"
	CapBreachedSchema         CapBreachedKind = "schema"
	CapBreachedEnvelopes      CapBreachedKind = "envelopes"
	CapBreachedNodeExecutions CapBreachedKind = "node-executions"
	CapBreachedWasmMemory     CapBreachedKind = "wasm-memory"
	CapBreachedWasmFuel       CapBreachedKind = "wasm-fuel"
	CapBreachedWasmExecTime   CapBreachedKind = "wasm-execution-time"
	CapBreachedRunDuration    CapBreachedKind = "run-duration"
	CapBreachedLoopIterations CapBreachedKind = "loop-iterations"
)

// Capabilities mirrors `schemas/capabilities.schema.json`.
type Capabilities struct {
	ProtocolVersion       string             `json:"protocolVersion"`
	SupportedEnvelopes    []string           `json:"supportedEnvelopes"`
	SchemaVersions        map[string]int     `json:"schemaVersions"`
	Limits                CapabilitiesLimits `json:"limits"`
	Extensions            map[string]any     `json:"extensions,omitempty"`
	Implementation        map[string]any     `json:"implementation,omitempty"`
	EngineVersion         *int               `json:"engineVersion,omitempty"`
	EventLogSchemaVersion *int               `json:"eventLogSchemaVersion,omitempty"`
	SupportedTransports   []string           `json:"supportedTransports,omitempty"`
	Configurable          map[string]any     `json:"configurable,omitempty"`
	Observability         map[string]any     `json:"observability,omitempty"`
	MinClientVersion      *string            `json:"minClientVersion,omitempty"`
	// GRPC is the RFC 0094 §H gRPC transport advertisement; nil ⇒ the host
	// exposes no gRPC transport.
	GRPC *CapabilitiesGRPC `json:"grpc,omitempty"`
	// MultiPartyConversation is the RFC 0101 multi-party group-conversation
	// advertisement; nil ⇒ the host does not support multi-party conversations.
	MultiPartyConversation *CapabilitiesMultiPartyConversation `json:"multiPartyConversation,omitempty"`
	// AIProviders is the host AI-proxy advertisement; the RFC 0105/0106/0108
	// self-hosted / speech / real-time-voice flags live here. nil ⇒ no AI-proxy.
	AIProviders *CapabilitiesAIProviders `json:"aiProviders,omitempty"`
	// A2A is the RFC 0100 A2A advertisement; nil ⇒ no A2A advertisement.
	A2A *CapabilitiesA2A `json:"a2a,omitempty"`
	// ConversationTurnModelProvenance is the RFC 0109 advertisement; nil ⇒ no
	// model provenance.
	ConversationTurnModelProvenance *CapabilitiesConversationTurnModelProvenance `json:"conversationTurnModelProvenance,omitempty"`
	// ChannelPresence is the RFC 0110 advertisement; nil ⇒ no presence.
	ChannelPresence *CapabilitiesChannelPresence `json:"channelPresence,omitempty"`
	// Interrupt is the RFC 0104 interrupt capability block (approver routing);
	// nil ⇒ no interrupt-level options advertised.
	Interrupt *CapabilitiesInterrupt `json:"interrupt,omitempty"`
	// Memory is the RFC 0113 agent-memory capability block (injection budget);
	// nil ⇒ a supplied tokenBudget is ignored.
	Memory *CapabilitiesMemory `json:"memory,omitempty"`
	// RestTransport is the RFC 0115 conditional-GET + Content-Encoding
	// advertisement on run reads; nil ⇒ 200 + identity body only.
	RestTransport *CapabilitiesRestTransport `json:"restTransport,omitempty"`
	// ToolCatalog is the RFC 0112 compact tool-catalog advertisement; nil ⇒ no
	// compact view.
	ToolCatalog *CapabilitiesToolCatalog `json:"toolCatalog,omitempty"`
	// A2UISurface is the RFC 0114 A2UI delta-transport advertisement; nil ⇒
	// full-surface delivery only.
	A2UISurface *CapabilitiesA2UISurface `json:"a2uiSurface,omitempty"`
	// UIPlugins is the RFC 0117 (amended by RFC 0119) front-end plugin discovery
	// block; nil ⇒ the host loads no plugin packs.
	UIPlugins *CapabilitiesUIPlugins `json:"uiPlugins,omitempty"`
	// Dispatch is the RFC 0007 + RFC 0118 top-level core.dispatch fan-out/join
	// descriptors; nil ⇒ no top-level dispatch descriptors.
	Dispatch *CapabilitiesDispatch `json:"dispatch,omitempty"`
}

// RunSnapshotError mirrors `RunSnapshot.error`.
type RunSnapshotError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// RunSnapshot mirrors `schemas/run-snapshot.schema.json`.
type RunSnapshot struct {
	RunID                 string            `json:"runId"`
	WorkflowID            string            `json:"workflowId"`
	Status                RunStatus         `json:"status"`
	CurrentNodeID         string            `json:"currentNodeId,omitempty"`
	StartedAt             string            `json:"startedAt,omitempty"`
	CompletedAt           string            `json:"completedAt,omitempty"`
	NodeStates            map[string]any    `json:"nodeStates,omitempty"`
	Variables             map[string]any    `json:"variables,omitempty"`
	Channels              map[string]any    `json:"channels,omitempty"`
	Error                 *RunSnapshotError `json:"error,omitempty"`
	EngineVersion         string            `json:"engineVersion,omitempty"`
	EventLogSchemaVersion *int              `json:"eventLogSchemaVersion,omitempty"`
	Tags                  []string          `json:"tags,omitempty"`
	Metadata              map[string]any    `json:"metadata,omitempty"`
	Configurable          map[string]any    `json:"configurable,omitempty"`
}

// RunConfigurable carries per-run overrides. Reserved keys are typed;
// unknown keys live in `Extras`. See run-options.md.
type RunConfigurable struct {
	RecursionLimit    *int              `json:"recursionLimit,omitempty"`
	RunTimeoutMs      *int              `json:"runTimeoutMs,omitempty"`      // RFC 0058
	MaxLoopIterations *int              `json:"maxLoopIterations,omitempty"` // RFC 0058
	Model             string            `json:"model,omitempty"`
	Temperature       *float64          `json:"temperature,omitempty"`
	MaxTokens         *int              `json:"maxTokens,omitempty"`
	PromptOverrides   map[string]string `json:"promptOverrides,omitempty"`
	Extras            map[string]any    `json:"-"`
}

// MarshalJSON folds Extras into the same JSON object so the wire shape
// matches the spec (a flat map of reserved + unknown keys).
func (c RunConfigurable) MarshalJSON() ([]byte, error) {
	out := make(map[string]any, 5+len(c.Extras))
	if c.RecursionLimit != nil {
		out["recursionLimit"] = *c.RecursionLimit
	}
	if c.RunTimeoutMs != nil {
		out["runTimeoutMs"] = *c.RunTimeoutMs
	}
	if c.MaxLoopIterations != nil {
		out["maxLoopIterations"] = *c.MaxLoopIterations
	}
	if c.Model != "" {
		out["model"] = c.Model
	}
	if c.Temperature != nil {
		out["temperature"] = *c.Temperature
	}
	if c.MaxTokens != nil {
		out["maxTokens"] = *c.MaxTokens
	}
	if c.PromptOverrides != nil {
		out["promptOverrides"] = c.PromptOverrides
	}
	for k, v := range c.Extras {
		out[k] = v
	}
	return json.Marshal(out)
}

// CreateRunRequest mirrors POST /v1/runs body.
type CreateRunRequest struct {
	WorkflowID   string           `json:"workflowId"`
	Inputs       map[string]any   `json:"inputs,omitempty"`
	TenantID     string           `json:"tenantId,omitempty"`
	ScopeID      string           `json:"scopeId,omitempty"`
	CallbackURL  string           `json:"callbackUrl,omitempty"`
	Configurable *RunConfigurable `json:"configurable,omitempty"`
	Tags         []string         `json:"tags,omitempty"`
	Metadata     map[string]any   `json:"metadata,omitempty"`
}

// CreateRunResponse mirrors the 201 payload.
type CreateRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"`
	EventsURL string    `json:"eventsUrl"`
	StatusURL string    `json:"statusUrl,omitempty"`
}

// CancelRunRequest is the optional body for POST /v1/runs/{id}/cancel.
type CancelRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// CancelRunResponse mirrors the cancel response.
type CancelRunResponse struct {
	RunID  string `json:"runId"`
	Status string `json:"status"` // "cancelled" | "cancelling"
}

// DebugBundle is the portable JSON diagnostic export per
// spec/v1/debug-bundle.md + schemas/debug-bundle.schema.json.
// Hosts MAY omit non-required fields. Consumers MUST treat
// masked/omitted/hashed values as the spec-canonical content per
// RedactionMode — they are NOT placeholders for missing data.
type DebugBundle struct {
	BundleVersion    string           `json:"bundleVersion"`
	GeneratedAt      string           `json:"generatedAt"`
	Host             map[string]any   `json:"host"`
	Run              map[string]any   `json:"run"`
	Events           []map[string]any `json:"events"`
	RedactionApplied bool             `json:"redactionApplied"`
	// RedactionMode is one of "mask" / "omit" / "hash" / "passthrough".
	RedactionMode   string `json:"redactionMode"`
	Truncated       bool   `json:"truncated,omitempty"`
	TruncatedReason string `json:"truncatedReason,omitempty"`
}

// DebugBundleOptions carries query parameters for GetDebugBundle.
// MaxEvents is a host-extension parameter (the SQLite reference
// convention); zero means "use host default". Spec-canonical hosts
// MAY ignore it. Non-zero values lower the host's size cap for
// testing the truncation path without driving the bundle past 8 MB.
type DebugBundleOptions struct {
	MaxEvents int
}

// PauseRunRequest is the optional body for POST /v1/runs/{id}:pause.
type PauseRunRequest struct {
	Reason      string `json:"reason,omitempty"`
	DrainPolicy string `json:"drainPolicy,omitempty"` // "immediate" | "drain-current-node"
}

// PauseRunResponse mirrors the 202 pause payload.
type PauseRunResponse struct {
	RunID    string    `json:"runId"`
	Status   RunStatus `json:"status"` // "paused"
	PausedAt string    `json:"pausedAt,omitempty"`
}

// ResumeRunRequest is the optional body for POST /v1/runs/{id}:resume.
type ResumeRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// ResumeRunResponse mirrors the 202 resume payload.
type ResumeRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"` // "running"
	ResumedAt string    `json:"resumedAt,omitempty"`
}

// BulkCancelRunsRequest mirrors POST /v1/runs:bulk-cancel body
// per rest-endpoints.md §"POST /v1/runs:bulk-cancel" (closes R1).
type BulkCancelRunsRequest struct {
	RunIDs []string `json:"runIds"`
	Reason string   `json:"reason,omitempty"`
}

// BulkCancelRunResult is the per-id outcome inside BulkCancelRunsResponse.Results.
type BulkCancelRunResult struct {
	RunID  string         `json:"runId"`
	OK     bool           `json:"ok"`
	Status string         `json:"status,omitempty"`
	Error  *ErrorEnvelope `json:"error,omitempty"`
}

// BulkCancelRunsResponse mirrors the 200 bulk-cancel payload.
type BulkCancelRunsResponse struct {
	Results []BulkCancelRunResult `json:"results"`
}

// RegisterWebhookRequest is the body for POST /v1/webhooks per
// spec/v1/webhooks.md.
type RegisterWebhookRequest struct {
	URL    string   `json:"url"`
	Events []string `json:"events"`
	// Secret is optional; if omitted the host generates one and
	// returns it in the response.
	Secret string `json:"secret,omitempty"`
	// Tags filters delivery to runs carrying these tags.
	Tags []string `json:"tags,omitempty"`
}

// RegisterWebhookResponse mirrors the 201 register-webhook payload.
// Secret is returned ONCE on registration — store it server-side for
// HMAC verification; the host cannot recover it.
type RegisterWebhookResponse struct {
	SubscriptionID string   `json:"subscriptionId"`
	URL            string   `json:"url"`
	Secret         string   `json:"secret"`
	EventTypes     []string `json:"eventTypes"`
	CreatedAt      string   `json:"createdAt"`
}

// AuditVerifyCheckpoint is one entry in AuditVerifyResult.Checkpoints
// per auth-profiles.md §"openwop-audit-log-integrity" §4.
type AuditVerifyCheckpoint struct {
	Checkpoint string `json:"checkpoint"`
	AtSequence int64  `json:"atSequence"`
	MerkleRoot string `json:"merkleRoot"`
	Signature  string `json:"signature"`
}

// AuditVerifyAnomaly is one entry in AuditVerifyResult.Anomalies.
type AuditVerifyAnomaly struct {
	AtSeq            int64  `json:"atSeq"`
	ExpectedPrevHash string `json:"expectedPrevHash"`
	ActualPrevHash   string `json:"actualPrevHash"`
}

// AuditVerifyResult is the response shape from GET /v1/audit/verify.
type AuditVerifyResult struct {
	FromSeq          int64                   `json:"fromSeq"`
	ToSeq            int64                   `json:"toSeq"`
	ChainValid       bool                    `json:"chainValid"`
	CheckpointsValid *bool                   `json:"checkpointsValid,omitempty"`
	Checkpoints      []AuditVerifyCheckpoint `json:"checkpoints"`
	Anomalies        []AuditVerifyAnomaly    `json:"anomalies"`
}

// ForkRunRequest mirrors POST /v1/runs/{id}:fork body.
type ForkRunRequest struct {
	FromSeq           int            `json:"fromSeq"`
	Mode              string         `json:"mode"` // "replay" | "branch"
	RunOptionsOverlay map[string]any `json:"runOptionsOverlay,omitempty"`
}

// ForkRunResponse mirrors the 201 fork payload.
type ForkRunResponse struct {
	RunID       string    `json:"runId"`
	SourceRunID string    `json:"sourceRunId"`
	Mode        string    `json:"mode"`
	Status      RunStatus `json:"status"`
	EventsURL   string    `json:"eventsUrl"`
	FromSeq     *int      `json:"fromSeq,omitempty"`
}

// Annotation mirrors annotation.schema.json (RFC 0056) — a non-blocking
// quality signal recorded against a run, event, or node. Target and actor
// are flat string maps; signal carries mixed-type fields (kind, rating,
// label, correction) so it is map[string]any.
type Annotation struct {
	AnnotationID string            `json:"annotationId"`
	Target       map[string]string `json:"target"`
	Signal       map[string]any    `json:"signal"`
	Actor        map[string]string `json:"actor"`
	CreatedAt    string            `json:"createdAt"`
	Note         *string           `json:"note,omitempty"`
}

// CreateAnnotationRequest is the POST /v1/runs/{runID}/annotations body per
// annotation-create.schema.json (RFC 0056). The host assigns annotationId,
// createdAt, and actor; target.runId is path-bound and omitted here.
type CreateAnnotationRequest struct {
	Signal map[string]any    `json:"signal"`
	Target map[string]string `json:"target,omitempty"`
	Note   *string           `json:"note,omitempty"`
}

// ListAnnotationsResponse mirrors the 200 listAnnotations payload.
type ListAnnotationsResponse struct {
	Annotations []Annotation `json:"annotations"`
}

// WorkspaceFile mirrors workspace-file.schema.json (RFC 0059) — a versioned,
// tenant·workspace-scoped ground-truth file. The list endpoint returns this
// shape minus Content (metadata only).
type WorkspaceFile struct {
	Path        string `json:"path"`
	Content     string `json:"content"`
	ContentType string `json:"contentType,omitempty"`
	Version     int    `json:"version"`
	ETag        string `json:"etag,omitempty"`
	UpdatedAt   string `json:"updatedAt"`
}

// PutWorkspaceFileRequest is the PUT /v1/host/workspace/files/{path} body per
// workspace-file-create.schema.json (RFC 0059). Path is URL-bound; the host
// assigns version/etag/updatedAt. Optimistic concurrency is expressed via the
// If-Match header (PutWorkspaceFileOptions.IfMatch), not a body field.
type PutWorkspaceFileRequest struct {
	Content     string `json:"content"`
	ContentType string `json:"contentType,omitempty"`
}

// ListWorkspaceFilesResponse mirrors the 200 listWorkspaceFiles payload.
type ListWorkspaceFilesResponse struct {
	Files []WorkspaceFile `json:"files"`
}

// RunAncestryParent is the populated branch of RunAncestryResponse.Parent —
// names the run's immediate dispatcher per RFC 0040 §C. WellKnownURL is
// set only when the parent is on a different host (callers walk the
// chain by following it one hop at a time).
type RunAncestryParent struct {
	RunID        string `json:"runId"`
	HostID       string `json:"hostId"`
	Cause        string `json:"cause"` // "mcp-tool-call" | "a2a-message" | "core.subWorkflow" | "core.dispatch"
	WellKnownURL string `json:"wellKnownUrl,omitempty"`
}

// RunAncestryResponse mirrors GET /v1/runs/{id}/ancestry per RFC 0040 §C
// (schemas/run-ancestry-response.schema.json). Parent is nil for
// top-level runs (not dispatched from any other run). Capability-gated
// on capabilities.multiAgent.executionModel.crossHostCausation
// .ancestryEndpointSupported; hosts not advertising return 404 and the
// SDK surfaces that as (nil, nil) via OpenwopClient.RunAncestry.
type RunAncestryResponse struct {
	RunID  string             `json:"runId"`
	HostID string             `json:"hostId"`
	Parent *RunAncestryParent `json:"parent"`
}

// ResolveInterruptRequest mirrors the body for either resolve endpoint.
type ResolveInterruptRequest struct {
	ResumeValue any `json:"resumeValue"`
}

// ResolveInterruptResponse mirrors the run-scoped resolve response.
type ResolveInterruptResponse struct {
	RunID  string    `json:"runId"`
	NodeID string    `json:"nodeId"`
	Status RunStatus `json:"status"`
}

// InterruptByTokenInspection mirrors GET /v1/interrupts/{token} —
// see suspend-request.schema.json (InterruptPayload).
type InterruptByTokenInspection struct {
	// Kind is the interrupt discriminator. One of "approval" |
	// "clarification" | "external-event" | "custom" | "conversation.start" |
	// "conversation.exchange" | "conversation.close" | "low-confidence"
	// (the Multi-Agent Shift Phase 4 conversation kinds + the Phase 1
	// low-confidence escalation kind). Kept as an open string for
	// forward-compat.
	Kind         string         `json:"kind"`
	Key          string         `json:"key"`
	Data         any            `json:"data"`
	ResumeSchema map[string]any `json:"resumeSchema,omitempty"`
	TimeoutMs    *int           `json:"timeoutMs,omitempty"`
}

// RunEventDoc mirrors `schemas/run-event.schema.json` — top-level shape.
// Per-event payload schemas live in run-event-payloads.schema.json;
// callers needing strict payload validation should layer that themselves.
type RunEventDoc struct {
	EventID       string `json:"eventId"`
	RunID         string `json:"runId"`
	Type          string `json:"type"`
	Payload       any    `json:"payload"`
	Timestamp     string `json:"timestamp"`
	Sequence      int    `json:"sequence"`
	NodeID        string `json:"nodeId,omitempty"`
	SchemaVersion *int   `json:"schemaVersion,omitempty"`
	EngineVersion string `json:"engineVersion,omitempty"`
	CausationID   string `json:"causationId,omitempty"`
}

// PollEventsResponse mirrors the events/poll response.
type PollEventsResponse struct {
	Events     []RunEventDoc `json:"events"`
	IsComplete bool          `json:"isComplete"`
}

// ErrorEnvelope mirrors `schemas/error-envelope.schema.json`.
type ErrorEnvelope struct {
	Error   string         `json:"error"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// HTTP error-envelope codes from auth.md, rest-endpoints.md, and adjacent
// v1 specs. ErrorEnvelope.Error remains string-typed for forward
// compatibility; use IsHTTPErrorCode for common branching.
const (
	HTTPErrorUnauthenticated             = "unauthenticated"
	HTTPErrorForbidden                   = "forbidden"
	HTTPErrorKeyExpired                  = "key_expired"
	HTTPErrorKeyRevoked                  = "key_revoked"
	HTTPErrorValidationError             = "validation_error"
	HTTPErrorNotFound                    = "not_found"
	HTTPErrorRateLimited                 = "rate_limited"
	HTTPErrorRunAlreadyActive            = "run_already_active"
	HTTPErrorIdempotencyInFlight         = "idempotency_in_flight"
	HTTPErrorIdempotencyKeyMismatch      = "idempotency_key_mismatch"
	HTTPErrorUnsupportedStreamMode       = "unsupported_stream_mode"
	HTTPErrorForceEngineVersionForbidden = "force_engine_version_forbidden"
	HTTPErrorMockProviderForbidden       = "mock_provider_forbidden"
	HTTPErrorCapabilityNotProvided       = "capability_not_provided"
	HTTPErrorCapabilityRequired          = "capability_required"
	HTTPErrorCredentialRequired          = "credential_required"
	HTTPErrorCredentialForbidden         = "credential_forbidden"
	HTTPErrorCredentialUnavailable       = "credential_unavailable"
	// Node-pack lifecycle (registry + lockfile) per node-packs.md §"Dependency resolution + lockfile".
	HTTPErrorPackIntegrityMismatch     = "pack_integrity_mismatch"
	HTTPErrorPackSignatureInvalid      = "pack_signature_invalid"
	HTTPErrorPackPeerDependencyMissing = "pack_peer_dependency_missing"
	HTTPErrorPackLockfileIncomplete    = "pack_lockfile_incomplete"
	HTTPErrorPackVersionNotFound       = "pack_version_not_found"
	HTTPErrorInterruptNotFound         = "interrupt_not_found"
	HTTPErrorApprovalTokenInvalid      = "approval_token_invalid"
	HTTPErrorApprovalTokenExpired      = "approval_token_expired"
	HTTPErrorApprovalTokenConsumed     = "approval_token_consumed"
	// Phase H.1″ — AI provider policy enforcement per capabilities.md §"aiProviders.policies".
	HTTPErrorProviderPolicyDenied = "provider_policy_denied"
	// Phase H.2 — MCP client.
	HTTPErrorMcpServerNotConfigured = "mcp_server_not_configured"
	HTTPErrorMcpTimeout             = "mcp_timeout"
	HTTPErrorMcpNetworkError        = "mcp_network_error"
	HTTPErrorMcpServerError         = "mcp_server_error"
	HTTPErrorMcpProtocolError       = "mcp_protocol_error"
	HTTPErrorMcpToolError           = "mcp_tool_error"
	// Phase H.3 — HTTP client.
	HTTPErrorHttpUrlRejected      = "http_url_rejected"
	HTTPErrorHttpTimeout          = "http_timeout"
	HTTPErrorHttpNetworkError     = "http_network_error"
	HTTPErrorHttpUnexpectedStatus = "http_unexpected_status"
	// Phase H webhook codes (spec-de-facto per webhook-negative.test.ts).
	HTTPErrorWebhookUrlRejected   = "webhook_url_rejected"
	HTTPErrorSubscriptionNotFound = "subscription_not_found"
	HTTPErrorInternalError        = "internal_error"
)

// HTTPErrorCodes lists canonical ErrorEnvelope.Error codes for common
// branching. Treat it as read-only.
var HTTPErrorCodes = []string{
	HTTPErrorUnauthenticated,
	HTTPErrorForbidden,
	HTTPErrorKeyExpired,
	HTTPErrorKeyRevoked,
	HTTPErrorValidationError,
	HTTPErrorNotFound,
	HTTPErrorRateLimited,
	HTTPErrorRunAlreadyActive,
	HTTPErrorIdempotencyInFlight,
	HTTPErrorIdempotencyKeyMismatch,
	HTTPErrorUnsupportedStreamMode,
	HTTPErrorForceEngineVersionForbidden,
	HTTPErrorMockProviderForbidden,
	HTTPErrorCapabilityNotProvided,
	HTTPErrorCapabilityRequired,
	HTTPErrorCredentialRequired,
	HTTPErrorCredentialForbidden,
	HTTPErrorCredentialUnavailable,
	HTTPErrorPackIntegrityMismatch,
	HTTPErrorPackSignatureInvalid,
	HTTPErrorPackPeerDependencyMissing,
	HTTPErrorPackLockfileIncomplete,
	HTTPErrorPackVersionNotFound,
	HTTPErrorInterruptNotFound,
	HTTPErrorApprovalTokenInvalid,
	HTTPErrorApprovalTokenExpired,
	HTTPErrorApprovalTokenConsumed,
	HTTPErrorProviderPolicyDenied,
	HTTPErrorMcpServerNotConfigured,
	HTTPErrorMcpTimeout,
	HTTPErrorMcpNetworkError,
	HTTPErrorMcpServerError,
	HTTPErrorMcpProtocolError,
	HTTPErrorMcpToolError,
	HTTPErrorHttpUrlRejected,
	HTTPErrorHttpTimeout,
	HTTPErrorHttpNetworkError,
	HTTPErrorHttpUnexpectedStatus,
	HTTPErrorWebhookUrlRejected,
	HTTPErrorSubscriptionNotFound,
	HTTPErrorInternalError,
}

// IsHTTPErrorCode returns true when value is a known canonical HTTP error
// envelope code. It returns false for host extensions and future additions.
func IsHTTPErrorCode(value string) bool {
	for _, code := range HTTPErrorCodes {
		if value == code {
			return true
		}
	}
	return false
}

// ─── Run statuses (forward-compatible) ──────────────────────────────────

// ActiveRunStatuses lists run statuses considered active — the run MAY
// still transition. Hosts MAY emit additional terminal values per the
// schema's forward-compat clause; readers MUST treat unknown statuses as
// terminal-unknown, NOT as still-active. Use IsTerminalRunStatus for
// forward-compatible checks. Mirrors the TypeScript SDK's
// ACTIVE_RUN_STATUSES constant + isTerminalRunStatus predicate.
var ActiveRunStatuses = []string{
	"pending",
	"running",
	"paused",
	"waiting-approval",
	"waiting-input",
	"waiting-external",
	// RFC 0094 §B — transitional state during the cancel cascade; the run
	// WILL still transition (to terminal "cancelled"), so it is active.
	"cancelling",
}

// TerminalRunStatuses lists the spec-known terminal statuses. Hosts MAY
// emit additional terminal values (e.g., "timed-out", "interrupted"); use
// IsTerminalRunStatus for forward-compat checks instead of literal-set
// membership.
var TerminalRunStatuses = []string{
	"completed",
	"failed",
	"cancelled",
}

// IsTerminalRunStatus returns true when status indicates the run will not
// transition further. Implemented as a negative check against
// ActiveRunStatuses: any value NOT in the spec's known-active set is
// treated as terminal. This implements the schema's forward-compat clause
// — the alternative (positive check against TerminalRunStatuses) would
// loop polling forever on any unknown value.
func IsTerminalRunStatus(status string) bool {
	for _, active := range ActiveRunStatuses {
		if status == active {
			return false
		}
	}
	return true
}

// ─── Run-document error codes ───────────────────────────────────────────

// RunErrorCodes lists canonical RunSnapshot.Error.Code identifiers used
// when a run reaches `failed`. Distinct from HTTPErrorCodes, which describe
// HTTP-level request failures (a request can fail with `unauthenticated`
// before a run exists; a run can fail later with `node_execution_failed`).
// Mirrors the TypeScript SDK's RUN_ERROR_CODES constant.
var RunErrorCodes = []string{
	// Authorization / access
	"auth_required",
	"forbidden",
	"workspace_not_found",

	// Run-state conflicts
	"run_already_active",
	"run_not_found",
	"run_terminal",
	"engine_version_mismatch",

	// Validation
	"invalid_workflow_definition",
	"invalid_trigger_input",
	"node_type_not_found",
	"config_validation_failed",

	// Quota / budget
	"token_budget_exceeded",
	"concurrent_run_limit_reached",
	"rate_limited",

	// Execution
	"node_timeout",
	"global_timeout",
	"node_execution_failed",
	"external_call_failed",
	"recursion_limit_exceeded",
	"run_timeout",
	"loop_limit_exceeded",
	"capability_not_provided",

	// Approval
	"approval_timeout",
	"approval_token_invalid",
	"approval_token_expired",
	"approval_token_consumed",

	// Persistence
	"persistence_failed",
	"doc_budget_exceeded",
}

// IsRunErrorCode returns true when value is a known canonical
// RunSnapshot.Error.Code. Returns false for unknown / malformed values
// rather than panicking — SDK consumers usually want to display a fallback
// for unknown codes.
func IsRunErrorCode(value string) bool {
	for _, code := range RunErrorCodes {
		if value == code {
			return true
		}
	}
	return false
}

// AgentInventoryEntry is one installed manifest agent as projected by
// GET /v1/agents / GET /v1/agents/{agentId} (RFC 0072 §A). Read-only — never
// carries the system-prompt body, resolved handoff schemas, or credentials (SR-1).
type AgentInventoryEntry struct {
	AgentID             string   `json:"agentId"`
	Persona             string   `json:"persona"`
	Label               string   `json:"label"`
	Description         string   `json:"description,omitempty"`
	ModelClass          string   `json:"modelClass"`
	PackName            string   `json:"packName"`
	PackVersion         string   `json:"packVersion"`
	ToolAllowlist       []string `json:"toolAllowlist"`
	HasHandoffSchemas   bool     `json:"hasHandoffSchemas"`
	ConfidenceThreshold *float64 `json:"confidenceThreshold,omitempty"`
	// Degraded lists optional capability tiers this host does not satisfy (RFC 0072 §C).
	Degraded []string `json:"degraded,omitempty"`
}

// AgentInventoryResponse is the GET /v1/agents body (RFC 0072 §A).
type AgentInventoryResponse struct {
	Agents []AgentInventoryEntry `json:"agents"`
	Total  int                   `json:"total"`
}

// ── RFC 0078 — Portable tool catalog (spec/v1/tool-catalog.md) ─────────────

// ToolDescriptor is a portable tool descriptor as projected onto the host's
// GET /v1/tools catalog (RFC 0078 §B). Source-agnostic (node-pack / workflow /
// mcp / connector / host-extension); SafetyTier, Egress, and Approval let a
// caller reason about a tool's blast radius before invoking it.
type ToolDescriptor struct {
	ToolID       string         `json:"toolId"`
	Source       string         `json:"source"`
	Title        string         `json:"title,omitempty"`
	Description  string         `json:"description,omitempty"`
	InputSchema  map[string]any `json:"inputSchema,omitempty"`
	OutputSchema map[string]any `json:"outputSchema,omitempty"`
	Auth         map[string]any `json:"auth,omitempty"`
	Egress       string         `json:"egress,omitempty"`
	Approval     string         `json:"approval,omitempty"`
	ReplayPolicy string         `json:"replayPolicy,omitempty"`
	SafetyTier   string         `json:"safetyTier"`
	CostHint     string         `json:"costHint,omitempty"`
	LatencyHint  string         `json:"latencyHint,omitempty"`
}

// CompactToolDescriptor is the RFC 0112 compact, model-facing projection of
// ToolDescriptor, returned by GET /v1/tools?view=compact (envelope
// {tools: CompactToolDescriptor[]}) + GET /v1/tools/{toolId}?view=compact when
// the host advertises capabilities.toolCatalog.compactView. The heavy descriptor
// fields (outputSchema / auth / egress / approval / replayPolicy / costHint /
// latencyHint) are dropped, and any InputSchema is bounded to the compact
// structural subset (top-level type:"object" with properties; no
// $ref/oneOf/allOf/anyOf/not/patternProperties/dependentSchemas).
type CompactToolDescriptor struct {
	ToolID      string         `json:"toolId"`
	Source      string         `json:"source"`
	SafetyTier  string         `json:"safetyTier"`
	Title       string         `json:"title,omitempty"`
	Description string         `json:"description,omitempty"`
	InputSchema map[string]any `json:"inputSchema,omitempty"`
}

// ── RFC 0082 — Agent deployment lifecycle ──────────────────────────────────

// AgentDeployment is a per-(agentId, version) deployment record, returned by
// ListAgentDeployments / TransitionAgentDeployment (RFC 0082 §C). Host-runtime
// state distinct from the immutable manifest and the registry's published tags.
type AgentDeployment struct {
	AgentID         string   `json:"agentId"`
	Version         string   `json:"version"`
	State           string   `json:"state"`
	CanaryPercent   *float64 `json:"canaryPercent,omitempty"`
	RollbackPointer string   `json:"rollbackPointer,omitempty"`
	Channels        []string `json:"channels,omitempty"`
	EvalRunID       string   `json:"evalRunId,omitempty"`
	ApprovalGateID  string   `json:"approvalGateId,omitempty"`
}

// AgentDeploymentTransition is the TransitionAgentDeployment request body
// (RFC 0082 §E). The host authorizes it fail-closed (RFC 0049 deploy:*), runs
// any RFC 0051 approvalGate, and enforces RFC 0081 requiredEval before emitting
// deployment.promoted.
type AgentDeploymentTransition struct {
	Version       string   `json:"version"`
	Transition    string   `json:"transition"`
	ToState       string   `json:"toState,omitempty"`
	Channel       string   `json:"channel,omitempty"`
	CanaryPercent *float64 `json:"canaryPercent,omitempty"`
	EvalRunID     string   `json:"evalRunId,omitempty"`
	Reason        string   `json:"reason,omitempty"`
}

// ── RFC 0086 / 0087 — Standing agent roster + org-chart ────────────────────

// AgentRef references a manifest/deployment from a roster entry (RFC 0086 §A).
type AgentRef struct {
	AgentID string `json:"agentId"`
	Version string `json:"version,omitempty"`
	Channel string `json:"channel,omitempty"`
}

// AgentRosterOwner is the {tenant, workspace} owner of a roster entry / org-chart.
type AgentRosterOwner struct {
	TenantID    string `json:"tenantId"`
	WorkspaceID string `json:"workspaceId,omitempty"`
}

// AgentRosterEntry is a standing agent INSTANCE: a host:<id> AgentRef that
// references a manifest/deployment and owns a workflow portfolio (RFC 0086 §A).
type AgentRosterEntry struct {
	RosterID    string           `json:"rosterId"`
	Persona     string           `json:"persona"`
	AgentRef    AgentRef         `json:"agentRef"`
	Workflows   []string         `json:"workflows,omitempty"`
	Owner       AgentRosterOwner `json:"owner"`
	Enabled     *bool            `json:"enabled,omitempty"`
	Label       string           `json:"label,omitempty"`
	Description string           `json:"description,omitempty"`
}

// AgentRosterResponse is the GET /v1/agents/roster body (RFC 0086 §B).
type AgentRosterResponse struct {
	Roster []AgentRosterEntry `json:"roster"`
	Total  int                `json:"total"`
}

// OrgChartRole is a role within an org-chart department (RFC 0087 §A).
type OrgChartRole struct {
	RoleID string `json:"roleId"`
	Name   string `json:"name"`
}

// OrgChartDepartment is an org-chart department (a tree node via
// ParentDepartmentID) (RFC 0087 §A).
type OrgChartDepartment struct {
	DepartmentID       string         `json:"departmentId"`
	Name               string         `json:"name"`
	ParentDepartmentID *string        `json:"parentDepartmentId"`
	Roles              []OrgChartRole `json:"roles"`
}

// OrgChartMember is a roster instance placed in a department/role (RFC 0087 §A).
type OrgChartMember struct {
	RosterID     string  `json:"rosterId"`
	DepartmentID string  `json:"departmentId"`
	RoleID       string  `json:"roleId"`
	ReportsTo    *string `json:"reportsTo"`
}

// AgentOrgChart is the descriptive org-chart over roster members (RFC 0087 §A).
// Carries no authority-bearing field by design (§B
// org-position-no-authority-escalation).
type AgentOrgChart struct {
	Owner       AgentRosterOwner     `json:"owner"`
	Departments []OrgChartDepartment `json:"departments"`
	Members     []OrgChartMember     `json:"members"`
}

// OrgChartResponsibilityView is the GET /v1/agents/org-chart/{departmentId} body
// (RFC 0087 §D) — the department subtree + the responsibility roll-up (union of
// member portfolios).
type OrgChartResponsibilityView struct {
	Department       OrgChartDepartment `json:"department"`
	Members          []OrgChartMember   `json:"members"`
	Responsibilities []string           `json:"responsibilities"`
}

// ── RFC 0081 — Eval summary (spec/v1/agent-eval-suite.md) ──────────────────

// EvalSafetyFinding is a redaction-safe safety finding ({kind, severity}
// descriptor — never excerpted content).
type EvalSafetyFinding struct {
	Kind     string `json:"kind"`
	Severity string `json:"severity"`
}

// EvalTaskResult is a per-task result on an EvalSummary (content-free: scores +
// scalars + ids).
type EvalTaskResult struct {
	TaskID         string              `json:"taskId"`
	Score          float64             `json:"score"`
	Passed         bool                `json:"passed"`
	CostUsd        *float64            `json:"costUsd,omitempty"`
	LatencyMs      *int                `json:"latencyMs,omitempty"`
	SchemaValid    *bool               `json:"schemaValid,omitempty"`
	SafetyFindings []EvalSafetyFinding `json:"safetyFindings,omitempty"`
}

// EvalRegression is the regression block on an EvalSummary (RFC 0081 §D
// regression mode).
type EvalRegression struct {
	BaselineRunID string  `json:"baselineRunId"`
	ScoreDelta    float64 `json:"scoreDelta"`
	DiffRef       string  `json:"diffRef,omitempty"`
}

// EvalSummary is the terminal scorecard of an eval run, read via GetEvalSummary
// (RFC 0081 §C). Content-free: scores, scalars, ids, and redaction-safe safety
// descriptors only (eval-summary-no-content-leak).
type EvalSummary struct {
	SuiteID             string           `json:"suiteId"`
	SuiteVersion        string           `json:"suiteVersion"`
	EvaluatedModelClass string           `json:"evaluatedModelClass,omitempty"`
	AggregateScore      float64          `json:"aggregateScore"`
	Passed              bool             `json:"passed"`
	TaskCount           int              `json:"taskCount"`
	PassedCount         int              `json:"passedCount"`
	TotalCostUsd        *float64         `json:"totalCostUsd,omitempty"`
	Tasks               []EvalTaskResult `json:"tasks"`
	Regression          *EvalRegression  `json:"regression,omitempty"`
}

// ── RFC 0054 — Run diff (spec/v1/rest-endpoints.md §GET /v1/runs/{runId}:diff) ─

// RunDiffEventDiff is one event-level diff entry on a RunDiffResponse.
type RunDiffEventDiff struct {
	Op       string       `json:"op"`
	Sequence int          `json:"sequence"`
	AEvent   *RunEventDoc `json:"aEvent,omitempty"`
	BEvent   *RunEventDoc `json:"bEvent,omitempty"`
}

// RunDiffResponse is the deterministic, replay-aware structured diff of two runs
// (RFC 0054). DivergedAtSeq is nil + EventDiffs empty when the two logs are
// identical.
type RunDiffResponse struct {
	A             string             `json:"a"`
	B             string             `json:"b"`
	DivergedAtSeq *int               `json:"divergedAtSeq"`
	EventDiffs    []RunDiffEventDiff `json:"eventDiffs"`
	StateDiff     map[string]any     `json:"stateDiff"`
	Truncated     *bool              `json:"truncated,omitempty"`
}

// ── RFC 0027 + RFC 0028 — Prompt library (spec/v1/prompts.md) ──────────────

// PromptVariable is a typed interpolation slot in a PromptTemplate. Bindings are
// validated against this declaration before composition.
type PromptVariable struct {
	Name         string `json:"name"`
	Type         string `json:"type"`
	Required     bool   `json:"required"`
	Source       string `json:"source,omitempty"`
	ExtractPath  string `json:"extractPath,omitempty"`
	DefaultValue any    `json:"defaultValue,omitempty"`
	Description  string `json:"description,omitempty"`
}

// PromptModelHints carries optional per-template model hints.
type PromptModelHints struct {
	ModelClass   string   `json:"modelClass,omitempty"`
	Temperature  *float64 `json:"temperature,omitempty"`
	MaxTokens    *int     `json:"maxTokens,omitempty"`
	EnvelopeType string   `json:"envelopeType,omitempty"`
}

// PromptMeta carries provenance metadata for a PromptTemplate. PackName +
// PackVersion are required when Source == "pack" (RFC 0028 §C).
type PromptMeta struct {
	Author      string `json:"author,omitempty"`
	CreatedAt   string `json:"createdAt,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	Source      string `json:"source,omitempty"`
	PackName    string `json:"packName,omitempty"`
	PackVersion string `json:"packVersion,omitempty"`
}

// PromptTemplate is a named, versioned, variable-bound prompt body (RFC 0028 §A;
// schemas/prompt-template.schema.json).
type PromptTemplate struct {
	TemplateID  string            `json:"templateId"`
	Version     string            `json:"version"`
	Kind        string            `json:"kind"`
	Text        string            `json:"text"`
	Name        string            `json:"name,omitempty"`
	Description string            `json:"description,omitempty"`
	Variables   []PromptVariable  `json:"variables,omitempty"`
	ModelHints  *PromptModelHints `json:"modelHints,omitempty"`
	Tags        []string          `json:"tags,omitempty"`
	Meta        *PromptMeta       `json:"meta,omitempty"`
}

// ListPromptTemplatesOptions is the filter set for ListPromptTemplates (RFC 0028 §A).
type ListPromptTemplatesOptions struct {
	Kind       string
	Tag        string
	ModelClass string
	Source     string
	Cursor     string
	// Limit caps entries per page; zero = host default.
	Limit int
}

// ListPromptTemplatesResponse is the GET /v1/prompts body (RFC 0028 §A).
type ListPromptTemplatesResponse struct {
	Items      []PromptTemplate `json:"items"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

// GetPromptTemplateOptions disambiguates a GetPromptTemplate read (RFC 0028 §A).
type GetPromptTemplateOptions struct {
	// Version pins to a SemVer version; latest when empty.
	Version string
	// LibraryID disambiguates when multiple installed packs ship the same templateId.
	LibraryID string
}

// RenderPromptTemplateRequest is the POST /v1/prompts:render request body
// (RFC 0028 §A). Secret-source bindings carry [REDACTED:<credentialRef>] markers;
// the host resolves the real value internally and never echoes it.
type RenderPromptTemplateRequest struct {
	// Ref is a PromptRef — the stringy prompt:<templateId>[@<version>] form or the
	// structured object form (schemas/prompt-ref.schema.json). Modeled as any to
	// admit both wire shapes.
	Ref          any            `json:"ref"`
	Variables    map[string]any `json:"variables"`
	ContentTrust string         `json:"contentTrust,omitempty"`
}

// RenderPromptTemplateResponse is the POST /v1/prompts:render response (RFC 0028 §A).
// Hash + Refs + VariableHashes are always present; Composed populates only under
// capabilities.prompts.observability: "full".
type RenderPromptTemplateResponse struct {
	Hash           string            `json:"hash"`
	Refs           []string          `json:"refs"`
	VariableHashes map[string]string `json:"variableHashes"`
	Composed       string            `json:"composed,omitempty"`
	ContentTrust   string            `json:"contentTrust,omitempty"`
}

// ── RFC 0103 Localized content surface (spec/v1/localized-content.md) ─────
// Mirror schemas/localized-content-*.schema.json. Host-defined structured
// content (Data, Localizations, SEO) stays open (map[string]any) per the
// schemas (additionalProperties: true) — it is the host's content model.

// LocalizedContentPage is a content page record
// (schemas/localized-content-page.schema.json). Status is "draft" | "published".
type LocalizedContentPage struct {
	PageID       string         `json:"pageId"`
	Slug         string         `json:"slug"`
	Name         string         `json:"name"`
	Status       string         `json:"status"`
	SectionOrder []string       `json:"sectionOrder"`
	SEO          map[string]any `json:"seo,omitempty"`
}

// LocalizedContentSection is a content section record
// (schemas/localized-content-section.schema.json): a base Data payload + a
// sparse Localizations map (BCP-47 keys, never the base locale).
type LocalizedContentSection struct {
	SectionID     string                    `json:"sectionId"`
	SectionType   string                    `json:"sectionType"`
	Data          map[string]any            `json:"data"`
	Localizations map[string]map[string]any `json:"localizations"`
	Status        string                    `json:"status"`
	Enabled       bool                      `json:"enabled"`
	Order         int                       `json:"order"`
}

// LocalizedContentPageResponse is the public delivery response for
// GET /v1/content/pages/{slug} — the negotiated locale's resolved page +
// sections (the RFC 0103 resolveSection merge is applied host-side).
type LocalizedContentPageResponse struct {
	Version     string                    `json:"version"`
	GeneratedAt string                    `json:"generatedAt"`
	Locale      string                    `json:"locale"`
	Slug        string                    `json:"slug"`
	Page        LocalizedContentPage      `json:"page"`
	Sections    []LocalizedContentSection `json:"sections"`
}

// LocalizedContentLanguageSettings mirrors
// schemas/localized-content-language-settings.schema.json.
type LocalizedContentLanguageSettings struct {
	BaseLocale             string   `json:"baseLocale"`
	SupportedLocales       []string `json:"supportedLocales"`
	AutoTranslateOnPublish bool     `json:"autoTranslateOnPublish"`
}

// PutContentSectionRequest is the body for
// PUT /v1/content/pages/{pageId}/sections/{sectionId}. The baseLocale upserts
// Data; any other Locale upserts localizations[locale].
type PutContentSectionRequest struct {
	Locale string         `json:"locale"`
	Data   map[string]any `json:"data"`
}

// ── RFC 0099 Trigger subscription registration (trigger-bridge.md §F) ─────

// TriggerSubscriptionRegistration is the registration body for
// POST /v1/trigger-subscriptions
// (schemas/trigger-subscription-registration.schema.json).
type TriggerSubscriptionRegistration struct {
	Source       map[string]any `json:"source"`
	WorkflowID   string         `json:"workflowId"`
	DedupEnabled *bool          `json:"dedupEnabled,omitempty"`
	InputMapping map[string]any `json:"inputMapping,omitempty"`
	RetryPolicy  map[string]any `json:"retryPolicy,omitempty"`
	Verification map[string]any `json:"verification,omitempty"`
}

// CreateTriggerSubscriptionResponse is the 201 response for
// POST /v1/trigger-subscriptions. Binding carries the source-specific wiring
// the caller needs; the secret is returned ONCE at creation (SR-1) — persist
// it, it is not retrievable again.
type CreateTriggerSubscriptionResponse struct {
	Subscription map[string]any `json:"subscription"`
	Binding      map[string]any `json:"binding"`
}

// ── AI Envelope surface (spec/v1/ai-envelope.md) ──────────────────────────
// Inbound LLM-emission envelope + per-kind payloads. Mirrors the TypeScript
// SDK's envelope surface (previously TS-only; see sdk/PARITY.md). Distinct from
// RunEventDoc (outbound event log) and ErrorEnvelope (host HTTP error response).

// EnvelopeMeta is the wire metadata on every AI Envelope.
type EnvelopeMeta struct {
	// Source: "ai-generation" | "user" | "system".
	Source string `json:"source"`
	// Ts is an ISO 8601 UTC timestamp.
	Ts string `json:"ts"`
	// ContentTrust mirrors RunEventDoc.contentTrust ("trusted"|"untrusted");
	// hosts MUST set "untrusted" for MCP/A2A origin.
	ContentTrust string `json:"contentTrust,omitempty"`
	Traceparent  string `json:"traceparent,omitempty"`
	Label        string `json:"label,omitempty"`
}

// PartialInfo is present when an envelope is one fragment of a streamed emission.
type PartialInfo struct {
	IsPartial bool `json:"isPartial"`
	Index     int  `json:"index"`
	// Total is -1 when unknown (streaming without precount).
	Total int `json:"total"`
}

// AIEnvelope is the canonical inbound LLM-emission wire shape. The payload
// shape is selected by Type; it is kept as `any` here (consumers narrow per
// kind, unmarshaling into the payload structs below).
type AIEnvelope struct {
	Type          string       `json:"type"`
	EnvelopeID    string       `json:"envelopeId"`
	CorrelationID string       `json:"correlationId"`
	Payload       any          `json:"payload"`
	Meta          EnvelopeMeta `json:"meta"`
	SchemaVersion *int         `json:"schemaVersion,omitempty"`
	NodeID        string       `json:"nodeId,omitempty"`
	Partial       *PartialInfo `json:"partial,omitempty"`
}

// EnvelopeContract is the per-typeId envelope-kind permission set.
type EnvelopeContract struct {
	Accepts []string `json:"accepts"`
	// RefusalMode: "fail-node" | "discard-and-warn".
	RefusalMode string `json:"refusalMode"`
}

// EnvelopeContractRefusal describes a refused envelope kind.
type EnvelopeContractRefusal struct {
	RefusedType   string   `json:"refusedType"`
	AcceptedTypes []string `json:"acceptedTypes"`
	RefusalMode   string   `json:"refusalMode"`
}

// ValidationDetail is one schema-validation failure.
type ValidationDetail struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// EnvelopeOutcome is the result of the engine's acceptEnvelope path. Status
// ("accepted"|"gated"|"invalid"|"breached") discriminates which optional
// fields are set (Go has no sum types; this mirrors the TS discriminated union).
type EnvelopeOutcome struct {
	Status           string                   `json:"status"`
	RecordedEventIDs []string                 `json:"recordedEventIds,omitempty"` // accepted
	Reason           string                   `json:"reason,omitempty"`           // gated/invalid/breached
	Gate             *EnvelopeContractRefusal `json:"gate,omitempty"`             // gated
	Details          []ValidationDetail       `json:"details,omitempty"`          // invalid
	CapKind          string                   `json:"capKind,omitempty"`          // breached
}

// EnvelopeContractsCapability is the optional capability advertisement.
type EnvelopeContractsCapability struct {
	Advertised bool `json:"advertised"`
}

// ClarificationRequestQuestion is one question in a clarification.request payload.
type ClarificationRequestQuestion struct {
	ID       string         `json:"id"`
	Question string         `json:"question"`
	Schema   map[string]any `json:"schema,omitempty"`
}

// ClarificationRequestPayload is the universal clarification.request kind payload.
type ClarificationRequestPayload struct {
	Questions   []ClarificationRequestQuestion `json:"questions"`
	ContextType string                         `json:"contextType,omitempty"`
}

// SchemaRequestPayload is the universal schema.request kind payload.
type SchemaRequestPayload struct {
	EnvelopeType string `json:"envelopeType"`
	Reason       string `json:"reason,omitempty"`
}

// SchemaResponsePayload is the universal schema.response kind payload (LLM ack).
type SchemaResponsePayload struct {
	EnvelopeType string `json:"envelopeType"`
	// Ack is always true.
	Ack bool `json:"ack"`
}

// AIEnvelopeErrorPayload is the universal error kind payload (the LLM's
// deliberate error report). Distinct from ErrorEnvelope (host HTTP error).
type AIEnvelopeErrorPayload struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// A2UISurfacePayload is the core ui.a2ui-surface envelope kind payload (RFC
// 0102). CatalogVersion is a host-enumerated growing set (currently "0.9.1";
// a consumer MUST refuse an unknown/higher version) — typed string for
// forward-compat. Surface is the closed component tree, kept structural
// (rendered by a dedicated A2UI renderer the SDK does not ship).
type A2UISurfacePayload struct {
	CatalogVersion string         `json:"catalogVersion"`
	Surface        map[string]any `json:"surface"`
	Reasoning      string         `json:"reasoning,omitempty"`
}

// A2UISurfacePatchOp is a single RFC 6902 (JSON-Patch) operation inside an
// A2UISurfaceDeltaFrame (RFC 0114). The "test" op is deliberately EXCLUDED (a
// fire-and-forget transport frame cannot act on a failed conditional);
// "move"/"copy" are permitted but OPTIONAL for a host to emit.
type A2UISurfacePatchOp struct {
	// Op is the RFC 6902 operation: "add" | "remove" | "replace" | "move" |
	// "copy" ("test" is excluded by RFC 0114).
	Op string `json:"op"`
	// Path is an RFC 6901 JSON-Pointer into the target surface.
	Path string `json:"path"`
	// From is the RFC 6901 JSON-Pointer source for "move"/"copy".
	From string `json:"from,omitempty"`
	// Value is the value for "add"/"replace"; walked by the SR-1 redaction
	// harness exactly like a full-surface value.
	Value any `json:"value,omitempty"`
}

// A2UISurfaceDeltaFrame is a HOST-SIDE TRANSPORT frame carrying an RFC 6902
// delta over a recorded ui.a2ui-surface envelope (A2UISurfacePayload) (RFC 0114).
// Delivered ONLY over the run event stream (GET /v1/runs/{runId}/events) to a
// subscriber that negotiated ?a2uiDelta=1; every other consumer (event-log read,
// replay, :fork, any non-negotiating subscriber) receives the materialized FULL
// surface. This is NOT a recorded-envelope shape — the recorded ui.a2ui-surface
// payload is unchanged and always full. The consumer applies Patch to the
// surface last delivered under SurfaceRef, re-validates against the closed
// CatalogVersion catalog, and falls back fail-closed (host re-materializes the
// full surface) on any apply/validation failure. Per
// schemas/a2ui-surface-delta-frame.schema.json; gated by the RFC 0114
// a2uiSurface.deltaTransport capability flag.
type A2UISurfaceDeltaFrame struct {
	// SurfaceRef is the recorded ui.a2ui-surface envelope id this delta patches.
	SurfaceRef string `json:"surfaceRef"`
	// CatalogVersion MUST equal the referenced full surface's catalogVersion; a
	// catalog-version change MUST start from a fresh full surface.
	CatalogVersion string `json:"catalogVersion"`
	// Patch is a non-empty RFC 6902 document applied over the surface last
	// delivered under SurfaceRef.
	Patch []A2UISurfacePatchOp `json:"patch"`
}
