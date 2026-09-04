// Package openwopclient implements a Go client for OpenWOP v2 hosts.
//
// Types mirror the v2 OpenAPI 3.1 spec (../../api/v2/openapi.yaml) and JSON
// Schemas (../../schemas/v2/). Hand-authored — see README.md §rationale.
package openwopclient

import (
	"encoding/json"
	"fmt"
)

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

// CapabilityStatus is the maturity of a capability record.
type CapabilityStatus string

const (
	CapabilityStable       CapabilityStatus = "stable"
	CapabilityExperimental CapabilityStatus = "experimental"
	CapabilityDeprecated   CapabilityStatus = "deprecated"
)

// WitnessClass is one of the five wire-legal witness classes (RFC 0168 §B);
// "unwitnessable" never appears on the wire.
type WitnessClass string

const (
	WitnessWitnessableUnaided WitnessClass = "witnessable-unaided"
	WitnessWitnessableGated   WitnessClass = "witnessable-gated"
	WitnessSeamGated          WitnessClass = "seam-gated"
	WitnessClaimsCheck        WitnessClass = "claims-check"
	WitnessNegativeExistence  WitnessClass = "negative-existence"
)

// CapabilityRecord is one capability record (RFC 0169 §A). Status, Since and
// Witness are REQUIRED; Until is REQUIRED when Status is experimental or
// deprecated. There is no `supported` — presence of the record is the claim.
type CapabilityRecord struct {
	Status  CapabilityStatus `json:"status"`
	Since   string           `json:"since"`
	Until   string           `json:"until,omitempty"`
	Witness WitnessClass     `json:"witness"`
	// Facets carries the family's remaining members verbatim
	// (spec/v2/facets/<key>.schema.json where hand-decided).
	Facets map[string]any `json:"-"`
}

type capabilityRecordAlias CapabilityRecord

// UnmarshalJSON splits the record into its four required members and Facets.
func (r *CapabilityRecord) UnmarshalJSON(data []byte) error {
	var alias capabilityRecordAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	var raw map[string]any
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	delete(raw, "status")
	delete(raw, "since")
	delete(raw, "until")
	delete(raw, "witness")
	alias.Facets = raw
	*r = CapabilityRecord(alias)
	return nil
}

// MarshalJSON folds Facets back into the record.
func (r CapabilityRecord) MarshalJSON() ([]byte, error) {
	out := make(map[string]any, len(r.Facets)+4)
	for k, v := range r.Facets {
		out[k] = v
	}
	out["status"] = r.Status
	out["since"] = r.Since
	if r.Until != "" {
		out["until"] = r.Until
	}
	out["witness"] = r.Witness
	return json.Marshal(out)
}

// Capabilities is the closed v2 discovery root
// (schemas/v2/capabilities.schema.json, additionalProperties: false).
// ProtocolVersions and PreferredVersion are REQUIRED (versioning.md §1.1);
// the other typed fields are the metadata keys (capabilities.md §3.1); every
// advertised family key (CapabilityFamilyKeys) lands in Families.
type Capabilities struct {
	ProtocolVersions      []string       `json:"protocolVersions"`
	PreferredVersion      string         `json:"preferredVersion"`
	ProtocolVersion       string         `json:"protocolVersion,omitempty"`
	MinClientVersion      string         `json:"minClientVersion,omitempty"`
	EngineVersion         *int           `json:"engineVersion,omitempty"`
	EventLogSchemaVersion *int           `json:"eventLogSchemaVersion,omitempty"`
	Implementation        map[string]any `json:"implementation,omitempty"`
	Extensions            map[string]any `json:"extensions,omitempty"`
	Configurable          map[string]any `json:"configurable,omitempty"`
	Observability         map[string]any `json:"observability,omitempty"`
	RuntimeCapabilities   map[string]any `json:"runtimeCapabilities,omitempty"`
	Testing               map[string]any `json:"testing,omitempty"`
	Conformance           map[string]any `json:"conformance,omitempty"`
	Fixtures              map[string]any `json:"fixtures,omitempty"`
	Compliance            map[string]any `json:"compliance,omitempty"`
	Discovery             map[string]any `json:"discovery,omitempty"`
	// Families maps each advertised family key to its record; a family the
	// host does not advertise is absent.
	Families map[string]CapabilityRecord `json:"-"`
}

type capabilitiesAlias Capabilities

// Family returns the record for key and whether the host advertises it.
func (c *Capabilities) Family(key string) (CapabilityRecord, bool) {
	rec, ok := c.Families[key]
	return rec, ok
}

// UnmarshalJSON decodes the metadata keys into the typed fields and every
// family key (CapabilityFamilyKeys) into Families.
func (c *Capabilities) UnmarshalJSON(data []byte) error {
	var alias capabilitiesAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	families := map[string]CapabilityRecord{}
	for key, value := range raw {
		if !IsCapabilityFamilyKey(key) {
			continue
		}
		var rec CapabilityRecord
		if err := json.Unmarshal(value, &rec); err != nil {
			return fmt.Errorf("openwopclient: capability %q: %w", key, err)
		}
		families[key] = rec
	}
	alias.Families = families
	*c = Capabilities(alias)
	return nil
}

// MarshalJSON folds Families back into the root.
func (c Capabilities) MarshalJSON() ([]byte, error) {
	base, err := json.Marshal(capabilitiesAlias(c))
	if err != nil {
		return nil, err
	}
	if len(c.Families) == 0 {
		return base, nil
	}
	var merged map[string]json.RawMessage
	if err := json.Unmarshal(base, &merged); err != nil {
		return nil, err
	}
	for key, rec := range c.Families {
		encoded, err := json.Marshal(rec)
		if err != nil {
			return nil, err
		}
		merged[key] = encoded
	}
	return json.Marshal(merged)
}

// RunOwner is RunSnapshot.Owner — closed; Subject is REQUIRED (identity.md).
type RunOwner struct {
	Tenant    string `json:"tenant"`
	Workspace string `json:"workspace,omitempty"`
	Subject   string `json:"subject"`
}

// RunSnapshotError mirrors `RunSnapshot.error`.
type RunSnapshotError struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// RunSnapshot mirrors schemas/v2/run-snapshot.schema.json — the fold of the
// event log through the run projection (runs.md §Snapshot). Owner and
// EventLogSchemaVersion are REQUIRED; a v2 host stamps 3 on every run it
// creates.
type RunSnapshot struct {
	RunID                 string            `json:"runId"`
	WorkflowID            string            `json:"workflowId"`
	Status                RunStatus         `json:"status"`
	Owner                 RunOwner          `json:"owner"`
	EventLogSchemaVersion int               `json:"eventLogSchemaVersion"`
	EngineVersion         *int              `json:"engineVersion,omitempty"`
	CompensationStatus    string            `json:"compensationStatus,omitempty"`
	CurrentNodeID         string            `json:"currentNodeId,omitempty"`
	StartedAt             string            `json:"startedAt,omitempty"`
	CompletedAt           string            `json:"completedAt,omitempty"`
	NodeStates            map[string]any    `json:"nodeStates,omitempty"`
	Variables             map[string]any    `json:"variables,omitempty"`
	Channels              map[string]any    `json:"channels,omitempty"`
	Error                 *RunSnapshotError `json:"error,omitempty"`
	Tags                  []string          `json:"tags,omitempty"`
	Metadata              map[string]any    `json:"metadata,omitempty"`
	Configurable          *RunConfigurable  `json:"configurable,omitempty"`
	Agent                 *AgentRef         `json:"agent,omitempty"`
	RunOrchestrator       *AgentRef         `json:"runOrchestrator,omitempty"`
	Metrics               map[string]any    `json:"metrics,omitempty"`
	ParentRunID           string            `json:"parentRunId,omitempty"`
	ParentNodeID          string            `json:"parentNodeId,omitempty"`
	Interrupt             map[string]any    `json:"interrupt,omitempty"`
}

// RunConfigurable mirrors schemas/v2/configurable.schema.json — closed,
// nested and versioned (RFC 0171 §D.1; runs.md §Run options). Version is
// REQUIRED and is 1 (a zero Version marshals as 1). Sections: Run
// (recursionLimit, runTimeoutMs, maxLoopIterations, escalationThreshold), AI
// (provider, model, temperature, maxTokens, credentialRef, promptOverrides,
// mockProvider, reasoningVerbosity, maxRefusals), Distillation (tokenBudget),
// Budget (the budget policy), Extensions (<org>: {...}). An unknown or
// dotted key is rejected with 400 validation_error.
type RunConfigurable struct {
	Version      int                       `json:"version"`
	Run          map[string]any            `json:"run,omitempty"`
	AI           map[string]any            `json:"ai,omitempty"`
	Distillation map[string]any            `json:"distillation,omitempty"`
	Budget       map[string]any            `json:"budget,omitempty"`
	Extensions   map[string]map[string]any `json:"extensions,omitempty"`
}

// MarshalJSON defaults a zero Version to 1 so a literal without it is valid.
func (c RunConfigurable) MarshalJSON() ([]byte, error) {
	type alias RunConfigurable
	if c.Version == 0 {
		c.Version = 1
	}
	return json.Marshal(alias(c))
}

// CreateRunRequest mirrors the POST /runs body — closed at the composition
// (runs.md §Create). WorkflowID is REQUIRED unless Mode is "eval" (then
// EvalSuiteRef and AgentID are).
type CreateRunRequest struct {
	WorkflowID   string           `json:"workflowId,omitempty"`
	Inputs       map[string]any   `json:"inputs,omitempty"`
	TenantID     string           `json:"tenantId,omitempty"`
	ScopeID      string           `json:"scopeId,omitempty"`
	Residency    map[string]any   `json:"residency,omitempty"`
	CallbackURL  string           `json:"callbackUrl,omitempty"`
	Configurable *RunConfigurable `json:"configurable,omitempty"`
	Tags         []string         `json:"tags,omitempty"`
	Metadata     map[string]any   `json:"metadata,omitempty"`
	Mode         string           `json:"mode,omitempty"`
	EvalSuiteRef string           `json:"evalSuiteRef,omitempty"`
	AgentID      string           `json:"agentId,omitempty"`
}

// CreateRunResponse mirrors the 201 payload.
type CreateRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"`
	EventsURL string    `json:"eventsUrl"`
	StatusURL string    `json:"statusUrl,omitempty"`
}

// CancelRunRequest is the optional body for POST /runs/{id}/cancel.
type CancelRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// CancelRunResponse mirrors the cancel response.
type CancelRunResponse struct {
	RunID  string `json:"runId"`
	Status string `json:"status"` // "cancelled" | "cancelling"
}

// PauseRunRequest is the optional body for POST /runs/{id}:pause.
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

// ResumeRunRequest is the optional body for POST /runs/{id}:resume.
type ResumeRunRequest struct {
	Reason string `json:"reason,omitempty"`
}

// ResumeRunResponse mirrors the 202 resume payload.
type ResumeRunResponse struct {
	RunID     string    `json:"runId"`
	Status    RunStatus `json:"status"` // "running"
	ResumedAt string    `json:"resumedAt,omitempty"`
}

// BulkCancelRunsRequest mirrors POST /runs:bulk-cancel body
// per rest-endpoints.md §"POST /runs:bulk-cancel" (closes R1).
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

// RegisterWebhookRequest is the body for POST /webhooks per
// spec/v2/core/webhooks.md.
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

// AuditVerifyResult is the response shape from GET /audit/verify.
type AuditVerifyResult struct {
	FromSeq          int64                   `json:"fromSeq"`
	ToSeq            int64                   `json:"toSeq"`
	ChainValid       bool                    `json:"chainValid"`
	CheckpointsValid *bool                   `json:"checkpointsValid,omitempty"`
	Checkpoints      []AuditVerifyCheckpoint `json:"checkpoints"`
	Anomalies        []AuditVerifyAnomaly    `json:"anomalies"`
}

// ForkRunRequest mirrors POST /runs/{id}:fork body.
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

// CreateAnnotationRequest is the POST /runs/{runID}/annotations body per
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

// RunAncestryResponse mirrors GET /runs/{id}/ancestry per RFC 0040 §C
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

// InterruptByTokenInspection mirrors GET /interrupts/{token} —
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

// RunEventDoc mirrors schemas/v2/run-event.schema.json — the closed envelope
// (events.md). Sequence is the one ordering field; SchemaVersion is REQUIRED;
// EngineVersion is an integer everywhere (RFC 0172 §B).
type RunEventDoc struct {
	EventID       string `json:"eventId"`
	RunID         string `json:"runId"`
	Type          string `json:"type"`
	Payload       any    `json:"payload"`
	Timestamp     string `json:"timestamp"`
	Sequence      int    `json:"sequence"`
	SchemaVersion int    `json:"schemaVersion"`
	NodeID        string `json:"nodeId,omitempty"`
	EngineVersion *int   `json:"engineVersion,omitempty"`
	CausationID   string `json:"causationId,omitempty"`
}

// PollEventsResponse mirrors the GET /runs/{runId}/events/poll response
// (events.md §Poll) — closed. LastSequence is the highest sequence in the log
// at the time of the response (-1 when empty); feed it back as AfterSequence.
type PollEventsResponse struct {
	RunID        string        `json:"runId"`
	Events       []RunEventDoc `json:"events"`
	LastSequence int           `json:"lastSequence"`
	Status       RunStatus     `json:"status"`
	IsTerminal   bool          `json:"isTerminal"`
}

// HostEventDoc is one frame of the hostEvents channel (/host/events) —
// content-free of run data.
type HostEventDoc struct {
	Type      string `json:"type"`
	Payload   any    `json:"payload"`
	Timestamp string `json:"timestamp,omitempty"`
}

// CompensationPlanEntry is one row of CompensationProjection.Plan.
type CompensationPlanEntry struct {
	NodeID             string         `json:"nodeId"`
	Order              int            `json:"order"`
	Policy             map[string]any `json:"policy,omitempty"`
	IrreversibleEffect *bool          `json:"irreversibleEffect,omitempty"`
}

// CompensationAttempt is one row of CompensationProjection.Attempts; Outcome
// is "succeeded" | "failed" | "skipped" | "manual".
type CompensationAttempt struct {
	NodeID  string `json:"nodeId"`
	Attempt int    `json:"attempt"`
	Outcome string `json:"outcome"`
	At      string `json:"at"`
	Reason  string `json:"reason,omitempty"`
}

// CompensationProjection mirrors GET /runs/{runId}/compensation
// (schemas/v2/compensation-projection.schema.json, RFC 0173 §C.1). Status is
// "none" | "pending" | "running" | "completed" | "partial" | "failed" |
// "manual-intervention".
type CompensationProjection struct {
	RunID    string                  `json:"runId"`
	Status   string                  `json:"status"`
	Plan     []CompensationPlanEntry `json:"plan"`
	Attempts []CompensationAttempt   `json:"attempts"`
}

// EffectLedgerEntry is one row of EffectLedgerProjection.Effects; Keying is
// "business-identity" | "activity-recipe", State is "claimed" | "completed" |
// "released" | "escaped". ProviderKey is redaction-safe, never credential
// material.
type EffectLedgerEntry struct {
	EffectID     string `json:"effectId"`
	NodeID       string `json:"nodeId"`
	Attempt      int    `json:"attempt"`
	InvocationID string `json:"invocationId,omitempty"`
	Keying       string `json:"keying"`
	ProviderKey  string `json:"providerKey,omitempty"`
	State        string `json:"state"`
	At           string `json:"at"`
}

// EffectLedgerProjection mirrors GET /runs/{runId}/effects
// (schemas/v2/effect-ledger-projection.schema.json, RFC 0173 §C.2).
type EffectLedgerProjection struct {
	RunID   string              `json:"runId"`
	Effects []EffectLedgerEntry `json:"effects"`
}

// EffectSeamHostBuild identifies the host build; Kind is "image-digest" |
// "commit" | "artifact-sha256".
type EffectSeamHostBuild struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

// EffectSeamHost names the host that declared the manifest.
type EffectSeamHost struct {
	Name  string              `json:"name"`
	Build EffectSeamHostBuild `json:"build"`
}

// EffectSeam is one outbound effect seam replay suppression covers; Kind is
// "http" | "queue" | "storage" | "provider-sdk" | "webhook-fanout".
type EffectSeam struct {
	Seam          string `json:"seam"`
	Kind          string `json:"kind"`
	Guarded       bool   `json:"guarded"`
	GuardedBy     string `json:"guardedBy"`
	BranchReFires *bool  `json:"branchReFires,omitempty"`
	Note          string `json:"note,omitempty"`
}

// EffectSeamManifest mirrors GET /host/effect-seams
// (schemas/v2/effect-seam-manifest.schema.json, RFC 0173 §C).
type EffectSeamManifest struct {
	ManifestVersion string         `json:"manifestVersion"`
	Host            EffectSeamHost `json:"host"`
	Seams           []EffectSeam   `json:"seams"`
}

// ErrorEnvelope mirrors schemas/v2/error-envelope.schema.json —
// { error, message, details? } and nothing else (errors.md). Error is a
// registered code (ErrorCodes) or a vendor code (<org>.<name>).
type ErrorEnvelope struct {
	Error   string         `json:"error"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// HTTPErrorCodes is the 1.x name for ErrorCodes — the v2 error registry
// (spec/v2/errors.json), generated into generated.go.
var HTTPErrorCodes = ErrorCodes

// IsHTTPErrorCode is the 1.x name for IsErrorCode.
func IsHTTPErrorCode(value string) bool {
	return IsErrorCode(value)
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
	"envelope_refusal",
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
// GET /agents / GET /agents/{agentId} (RFC 0072 §A). Read-only — never
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

// AgentInventoryResponse is the GET /agents body (RFC 0072 §A).
type AgentInventoryResponse struct {
	Agents []AgentInventoryEntry `json:"agents"`
	Total  int                   `json:"total"`
}

// ── RFC 0078 — Portable tool catalog (spec/v2/core/tool-catalog.md) ─────────────

// ToolDescriptor is a portable tool descriptor as projected onto the host's
// GET /tools catalog (RFC 0078 §B). Source-agnostic (node-pack / workflow /
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
// ToolDescriptor, returned by GET /tools?view=compact (envelope
// {tools: CompactToolDescriptor[]}) + GET /tools/{toolId}?view=compact when
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

// AgentRosterResponse is the GET /agents/roster body (RFC 0086 §B).
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

// OrgChartResponsibilityView is the GET /agents/org-chart/{departmentId} body
// (RFC 0087 §D) — the department subtree + the responsibility roll-up (union of
// member portfolios).
type OrgChartResponsibilityView struct {
	Department       OrgChartDepartment `json:"department"`
	Members          []OrgChartMember   `json:"members"`
	Responsibilities []string           `json:"responsibilities"`
}

// ── RFC 0081 — Eval summary (spec/v2/core/agent-eval-suite.md) ──────────────────

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

// ── RFC 0054 — Run diff (spec/v2/core/rest-endpoints.md §GET /runs/{runId}:diff) ─

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

// ── RFC 0027 + RFC 0028 — Prompt library (spec/v2/core/prompts.md) ──────────────

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

// ListPromptTemplatesResponse is the GET /prompts body (RFC 0028 §A).
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

// RenderPromptTemplateRequest is the POST /prompts:render request body
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

// RenderPromptTemplateResponse is the POST /prompts:render response (RFC 0028 §A).
// Hash + Refs + VariableHashes are always present; Composed populates only under
// capabilities.prompts.observability: "full".
type RenderPromptTemplateResponse struct {
	Hash           string            `json:"hash"`
	Refs           []string          `json:"refs"`
	VariableHashes map[string]string `json:"variableHashes"`
	Composed       string            `json:"composed,omitempty"`
	ContentTrust   string            `json:"contentTrust,omitempty"`
}

// ── RFC 0103 Localized content surface (spec/v2/core/localized-content.md) ─────
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
// GET /content/pages/{slug} — the negotiated locale's resolved page +
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
// PUT /content/pages/{pageId}/sections/{sectionId}. The baseLocale upserts
// Data; any other Locale upserts localizations[locale].
type PutContentSectionRequest struct {
	Locale string         `json:"locale"`
	Data   map[string]any `json:"data"`
}

// ── RFC 0099 Trigger subscription registration (trigger-bridge.md §F) ─────

// TriggerSubscriptionRegistration is the registration body for
// POST /trigger-subscriptions
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
// POST /trigger-subscriptions. Binding carries the source-specific wiring
// the caller needs; the secret is returned ONCE at creation (SR-1) — persist
// it, it is not retrievable again.
type CreateTriggerSubscriptionResponse struct {
	Subscription map[string]any `json:"subscription"`
	Binding      map[string]any `json:"binding"`
}

// ── AI Envelope surface (spec/v2/core/ai-envelope.md) ──────────────────────────
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
// Delivered ONLY over the run event stream (GET /runs/{runId}/events) to a
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
