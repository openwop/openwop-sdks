package openwopclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// OpenwopClient is a synchronous HTTP client for any OpenWOP-compliant server.
//
// Construct with NewClient(baseURL, apiKey). The zero value is NOT
// usable — apiKey is required.
//
// Threadsafe — methods are safe to call concurrently from multiple
// goroutines (net/http.Client is itself threadsafe and that's all
// the client wraps).
type OpenwopClient struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client // optional; nil = default with 30s timeout
	// Major is the protocol major to negotiate (RFC 0172 §A.3): every request
	// carries `OpenWOP-Version: <Major>.0`. Zero means SDKProtocolMajor.
	Major int
}

// SDKProtocolMajor is the protocol major this SDK implements; the default
// for OpenwopClient.Major.
const SDKProtocolMajor = 2

// ProtocolVersionHeader renders the OpenWOP-Version request value for a
// major: "<major>.0" (the OpenAPI grammar is <major>.<minor>).
func ProtocolVersionHeader(major int) string {
	return strconv.Itoa(major) + ".0"
}

// ProtocolVersion is the OpenWOP-Version value this client sends on every
// request.
func (c *OpenwopClient) ProtocolVersion() string {
	major := c.Major
	if major <= 0 {
		major = SDKProtocolMajor
	}
	return ProtocolVersionHeader(major)
}

// NewClient constructs a OpenwopClient with the canonical defaults.
// Returns an error if baseURL or apiKey is empty.
func NewClient(baseURL, apiKey string) (*OpenwopClient, error) {
	if baseURL == "" {
		return nil, errors.New("openwopclient: baseURL is required")
	}
	if apiKey == "" {
		return nil, errors.New("openwopclient: apiKey is required")
	}
	return &OpenwopClient{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		APIKey:     apiKey,
		HTTPClient: &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *OpenwopClient) httpClient() *http.Client {
	if c.HTTPClient != nil {
		return c.HTTPClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// MutationOptions controls per-mutation headers: Idempotency-Key
// (idempotency.md Layer 1) and `OpenWOP-Dedup: enforce` (the host rejects a
// duplicate (tenantId, scopeId) with 409 run_already_active; runs.md §Create).
type MutationOptions struct {
	IdempotencyKey string
	Dedup          bool
}

func (m MutationOptions) headers() map[string]string {
	h := map[string]string{}
	if m.IdempotencyKey != "" {
		h["Idempotency-Key"] = m.IdempotencyKey
	}
	if m.Dedup {
		h["OpenWOP-Dedup"] = "enforce"
	}
	return h
}

// ── Discovery ──────────────────────────────────────────────────────────

// GetCapabilities calls GET /.well-known/openwop. Unauthenticated.
func (c *OpenwopClient) GetCapabilities(ctx context.Context) (*Capabilities, error) {
	var out Capabilities
	if err := c.requestJSON(ctx, http.MethodGet, "/.well-known/openwop", nil, nil, false, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetOpenAPI calls GET /openapi.json. Unauthenticated. Returns the
// raw OpenAPI document as a generic map (the SDK doesn't model the
// OpenAPI spec itself — leave that to the caller's tooling).
func (c *OpenwopClient) GetOpenAPI(ctx context.Context) (map[string]any, error) {
	var out map[string]any
	if err := c.requestJSON(ctx, http.MethodGet, "/openapi.json", nil, nil, false, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ── Workflows ──────────────────────────────────────────────────────────

// GetWorkflow calls GET /workflows/{workflowID}.
func (c *OpenwopClient) GetWorkflow(ctx context.Context, workflowID string) (map[string]any, error) {
	var out map[string]any
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/workflows/"+url.PathEscape(workflowID),
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return out, nil
}

// ── Runs ───────────────────────────────────────────────────────────────

// CreateRun calls POST /runs.
func (c *OpenwopClient) CreateRun(
	ctx context.Context,
	body CreateRunRequest,
	opts MutationOptions,
) (*CreateRunResponse, error) {
	var out CreateRunResponse
	if err := c.requestJSON(ctx, http.MethodPost, "/runs", body, opts.headers(), true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetRun calls GET /runs/{runID}.
func (c *OpenwopClient) GetRun(ctx context.Context, runID string) (*RunSnapshot, error) {
	var out RunSnapshot
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID),
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// CancelRun calls POST /runs/{runID}/cancel.
func (c *OpenwopClient) CancelRun(
	ctx context.Context,
	runID string,
	body CancelRunRequest,
	opts MutationOptions,
) (*CancelRunResponse, error) {
	var out CancelRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/runs/"+url.PathEscape(runID)+"/cancel",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// PauseRun calls POST /runs/{runID}:pause.
func (c *OpenwopClient) PauseRun(
	ctx context.Context,
	runID string,
	body PauseRunRequest,
	opts MutationOptions,
) (*PauseRunResponse, error) {
	var out PauseRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/runs/"+url.PathEscape(runID)+":pause",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ResumeRun calls POST /runs/{runID}:resume.
func (c *OpenwopClient) ResumeRun(
	ctx context.Context,
	runID string,
	body ResumeRunRequest,
	opts MutationOptions,
) (*ResumeRunResponse, error) {
	var out ResumeRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/runs/"+url.PathEscape(runID)+":resume",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// BulkCancelRuns calls POST /runs:bulk-cancel.
//
// Per rest-endpoints.md §"POST /runs:bulk-cancel" (closes R1). The
// top-level call returns 200 + per-id results whenever the request
// reaches the host; partial failures surface inside the array (each
// entry carries OK + optional Error). Host-defined cap on RunIDs
// length (RECOMMENDED 100); over-cap returns 400 validation_error.
func (c *OpenwopClient) BulkCancelRuns(
	ctx context.Context,
	body BulkCancelRunsRequest,
	opts MutationOptions,
) (*BulkCancelRunsResponse, error) {
	var out BulkCancelRunsResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/runs:bulk-cancel",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// RegisterWebhook calls POST /webhooks per spec/v2/core/webhooks.md.
// The Secret field on the response is returned ONCE — store it
// server-side for HMAC verification; the host cannot recover it.
func (c *OpenwopClient) RegisterWebhook(
	ctx context.Context,
	body RegisterWebhookRequest,
	opts MutationOptions,
) (*RegisterWebhookResponse, error) {
	var out RegisterWebhookResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/webhooks",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// UnregisterWebhook calls DELETE /webhooks/{subscriptionID}.
// Returns nil on success; an unknown subscription surfaces as a
// WopError with code "subscription_not_found".
func (c *OpenwopClient) UnregisterWebhook(
	ctx context.Context,
	subscriptionID string,
) error {
	return c.requestJSON(
		ctx, http.MethodDelete,
		"/webhooks/"+url.PathEscape(subscriptionID),
		nil, nil, true, nil,
	)
}

// VerifyAuditLog calls GET /audit/verify?fromSeq=&toSeq= per
// auth-profiles.md §"openwop-audit-log-integrity" §4. Requires the
// audit:read scope on the API key. Hosts that do NOT advertise the
// profile return 404 (surfaced as a WopError).
func (c *OpenwopClient) VerifyAuditLog(
	ctx context.Context,
	fromSeq int64,
	toSeq int64,
) (*AuditVerifyResult, error) {
	var out AuditVerifyResult
	q := url.Values{}
	q.Set("fromSeq", strconv.FormatInt(fromSeq, 10))
	q.Set("toSeq", strconv.FormatInt(toSeq, 10))
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/audit/verify?"+q.Encode(),
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ForkRun calls POST /runs/{runID}:fork.
func (c *OpenwopClient) ForkRun(
	ctx context.Context,
	runID string,
	body ForkRunRequest,
	opts MutationOptions,
) (*ForkRunResponse, error) {
	var out ForkRunResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/runs/"+url.PathEscape(runID)+":fork",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateAnnotation calls POST /runs/{runID}/annotations per RFC 0056 —
// records a non-blocking quality annotation on a run. Returns a *WopError
// with Status 501 when the host doesn't advertise
// capabilities.feedback.supported.
func (c *OpenwopClient) CreateAnnotation(
	ctx context.Context,
	runID string,
	body CreateAnnotationRequest,
	opts MutationOptions,
) (*Annotation, error) {
	var out Annotation
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/runs/"+url.PathEscape(runID)+"/annotations",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ListAnnotations calls GET /runs/{runID}/annotations per RFC 0056.
// Returns (nil, nil) when the host doesn't advertise capabilities.feedback
// (endpoint returns 404 or 501 in that case), so callers can branch on
// capability discovery without unwrapping the error envelope.
func (c *OpenwopClient) ListAnnotations(
	ctx context.Context,
	runID string,
) ([]Annotation, error) {
	var out ListAnnotationsResponse
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+"/annotations",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return out.Annotations, nil
}

// ── RFC 0103 Localized content surface (capabilities.content) ─────────────

// ListContentPages calls GET /content/pages — lists page records. Returns
// (nil, nil) when the host doesn't advertise capabilities.content (501).
func (c *OpenwopClient) ListContentPages(ctx context.Context) ([]LocalizedContentPage, error) {
	var out []LocalizedContentPage
	if err := c.requestJSON(ctx, http.MethodGet, "/content/pages", nil, nil, true, &out); err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 501 {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// GetContentPage calls GET /content/pages/{slug} — the negotiated locale's
// resolved page + sections. acceptLanguage rides the Accept-Language header
// (the Stable i18n.md negotiation; no ?locale=); empty ⇒ omit it. Returns
// (nil, nil) on 404 (no such published page) or 501 (uncapable).
func (c *OpenwopClient) GetContentPage(
	ctx context.Context, slug, acceptLanguage string,
) (*LocalizedContentPageResponse, error) {
	var headers map[string]string
	if acceptLanguage != "" {
		headers = map[string]string{"Accept-Language": acceptLanguage}
	}
	var out LocalizedContentPageResponse
	if err := c.requestJSON(
		ctx, http.MethodGet, "/content/pages/"+url.PathEscape(slug), nil, headers, true, &out,
	); err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// CreateContentPage calls POST /content/pages — create a page record
// (admin). Returns a *WopError on non-2xx (400/401/403).
func (c *OpenwopClient) CreateContentPage(
	ctx context.Context, page LocalizedContentPage,
) (*LocalizedContentPage, error) {
	var out LocalizedContentPage
	if err := c.requestJSON(ctx, http.MethodPost, "/content/pages", page, nil, true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// PutContentSection calls PUT /content/pages/{pageID}/sections/{sectionID} —
// upsert a section's field overlay for a locale (admin).
func (c *OpenwopClient) PutContentSection(
	ctx context.Context, pageID, sectionID string, body PutContentSectionRequest,
) (*LocalizedContentSection, error) {
	var out LocalizedContentSection
	path := "/content/pages/" + url.PathEscape(pageID) + "/sections/" + url.PathEscape(sectionID)
	if err := c.requestJSON(ctx, http.MethodPut, path, body, nil, true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetContentSettings calls GET /content/settings — language settings.
// Returns (nil, nil) when the host doesn't advertise capabilities.content (501).
func (c *OpenwopClient) GetContentSettings(ctx context.Context) (*LocalizedContentLanguageSettings, error) {
	var out LocalizedContentLanguageSettings
	if err := c.requestJSON(ctx, http.MethodGet, "/content/settings", nil, nil, true, &out); err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 501 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// PutContentSettings calls PUT /content/settings — replace language settings
// (admin).
func (c *OpenwopClient) PutContentSettings(
	ctx context.Context, settings LocalizedContentLanguageSettings,
) (*LocalizedContentLanguageSettings, error) {
	var out LocalizedContentLanguageSettings
	if err := c.requestJSON(ctx, http.MethodPut, "/content/settings", settings, nil, true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── RFC 0099 Trigger subscriptions (capabilities.triggerBridge) ───────────

// CreateTriggerSubscription calls POST /trigger-subscriptions — register an
// external-event trigger. The Binding secret is returned ONCE at creation
// (SR-1); persist it. Returns a *WopError on non-2xx (400/401/403, or 501 when
// the host doesn't advertise the trigger-bridge ingestion surface).
func (c *OpenwopClient) CreateTriggerSubscription(
	ctx context.Context, registration TriggerSubscriptionRegistration,
) (*CreateTriggerSubscriptionResponse, error) {
	var out CreateTriggerSubscriptionResponse
	if err := c.requestJSON(ctx, http.MethodPost, "/trigger-subscriptions", registration, nil, true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// RunAncestry calls GET /runs/{runID}/ancestry per RFC 0040 §C and
// spec/v2/core/multi-agent-execution.md §"GET /runs/{runId}/ancestry".
//
// Returns (nil, nil) when the host doesn't advertise
// capabilities.multiAgent.executionModel.crossHostCausation
// .ancestryEndpointSupported: true (endpoint returns 404 in that case);
// callers can branch on capability discovery without unwrapping the
// error envelope. On 200, RunAncestryResponse.Parent is nil for
// top-level runs; when set, Parent.WellKnownURL identifies the parent
// host's discovery URL so callers walk the chain one hop at a time.
func (c *OpenwopClient) RunAncestry(
	ctx context.Context,
	runID string,
) (*RunAncestryResponse, error) {
	var out RunAncestryResponse
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+"/ancestry",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// PollRunEventsOptions controls the GET /runs/{runID}/events/poll query
// (events.md §Poll). AfterSequence returns events with sequence >
// AfterSequence; nil means from the first event.
type PollRunEventsOptions struct {
	AfterSequence  *int
	TimeoutSeconds *int
}

// PollRunEvents calls GET /runs/{runID}/events/poll — the long-poll fallback.
// Feed the response's LastSequence back as the next AfterSequence.
func (c *OpenwopClient) PollRunEvents(
	ctx context.Context,
	runID string,
	opts PollRunEventsOptions,
) (*PollEventsResponse, error) {
	q := url.Values{}
	if opts.AfterSequence != nil {
		q.Set("afterSequence", strconv.Itoa(*opts.AfterSequence))
	}
	if opts.TimeoutSeconds != nil {
		q.Set("timeout", strconv.Itoa(*opts.TimeoutSeconds))
	}
	qs := ""
	if encoded := q.Encode(); encoded != "" {
		qs = "?" + encoded
	}
	var out PollEventsResponse
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+"/events/poll"+qs,
		nil, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// GetRunCompensation calls GET /runs/{runID}/compensation (RFC 0173 §C.1) —
// the compensation plan and attempts. Gated on `compensation`; returns
// (nil, nil) on 404 so callers can branch on capability discovery.
func (c *OpenwopClient) GetRunCompensation(
	ctx context.Context,
	runID string,
) (*CompensationProjection, error) {
	var out CompensationProjection
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+"/compensation",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetRunEffects calls GET /runs/{runID}/effects (RFC 0173 §C.2) — the
// Layer-2 effect ledger, business-identity keyed. Gated on `idempotency`;
// returns (nil, nil) on 404.
func (c *OpenwopClient) GetRunEffects(
	ctx context.Context,
	runID string,
) (*EffectLedgerProjection, error) {
	var out EffectLedgerProjection
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+"/effects",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── Host ───────────────────────────────────────────────────────────────

// GetEffectSeamManifest calls GET /host/effect-seams (RFC 0173 §C) — every
// outbound effect seam replay suppression covers.
func (c *OpenwopClient) GetEffectSeamManifest(ctx context.Context) (*EffectSeamManifest, error) {
	var out EffectSeamManifest
	if err := c.requestJSON(ctx, http.MethodGet, "/host/effect-seams", nil, nil, true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── HITL interrupts (run-scoped + signed-token) ────────────────────────

// ResolveInterruptByRun calls POST /runs/{runID}/interrupts/{nodeID}.
func (c *OpenwopClient) ResolveInterruptByRun(
	ctx context.Context,
	runID, nodeID string,
	body ResolveInterruptRequest,
	opts MutationOptions,
) (*ResolveInterruptResponse, error) {
	var out ResolveInterruptResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/runs/"+url.PathEscape(runID)+"/interrupts/"+url.PathEscape(nodeID),
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// InspectInterruptByToken calls GET /interrupts/{token}. Unauthenticated
// (the signed token IS the auth).
func (c *OpenwopClient) InspectInterruptByToken(
	ctx context.Context,
	token string,
) (*InterruptByTokenInspection, error) {
	var out InterruptByTokenInspection
	if err := c.requestJSON(
		ctx, http.MethodGet,
		"/interrupts/"+url.PathEscape(token),
		nil, nil, false, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ResolveInterruptByToken calls POST /interrupts/{token}.
// Unauthenticated.
func (c *OpenwopClient) ResolveInterruptByToken(
	ctx context.Context,
	token string,
	body ResolveInterruptRequest,
	opts MutationOptions,
) (map[string]any, error) {
	var out map[string]any
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/interrupts/"+url.PathEscape(token),
		body, opts.headers(), false, &out,
	); err != nil {
		return nil, err
	}
	return out, nil
}

// ── Internals ──────────────────────────────────────────────────────────

func (c *OpenwopClient) requestJSON(
	ctx context.Context,
	method, path string,
	body any,
	extraHeaders map[string]string,
	authenticated bool,
	out any,
) error {
	endpoint := c.BaseURL + path

	var bodyReader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("openwopclient: encode body: %w", err)
		}
		bodyReader = bytes.NewReader(raw)
	}

	req, err := http.NewRequestWithContext(ctx, method, endpoint, bodyReader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	// RFC 0172 §A.3 — on every request, authenticated or not.
	req.Header.Set("OpenWOP-Version", c.ProtocolVersion())
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authenticated {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}

	resp, err := c.httpClient().Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	rawBody, _ := io.ReadAll(resp.Body)
	traceparent := resp.Header.Get("Traceparent")

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newWopError(resp.StatusCode, string(rawBody), parseEnvelope(rawBody), traceparent)
	}

	if len(rawBody) == 0 {
		return nil
	}
	if err := json.Unmarshal(rawBody, out); err != nil {
		return newWopError(
			resp.StatusCode,
			string(rawBody),
			&ErrorEnvelope{Error: "invalid_json", Message: "Server returned non-JSON body for a 2xx response"},
			traceparent,
		)
	}
	return nil
}

// parseEnvelope best-effort decodes a non-2xx body into ErrorEnvelope.
// Returns nil for unparseable / non-conforming bodies.
func parseEnvelope(raw []byte) *ErrorEnvelope {
	if len(raw) == 0 {
		return nil
	}
	var env ErrorEnvelope
	if err := json.Unmarshal(raw, &env); err != nil {
		return nil
	}
	if env.Error == "" || env.Message == "" {
		return nil
	}
	return &env
}

// ListAgents returns the manifest agents this host has installed (RFC 0072 §A).
// Read-only; returns (nil, nil) when the host doesn't advertise
// capabilities.agents.manifestRuntime (the endpoint 404s). Dispatch is not here:
// a manifest agent runs as a CreateRun whose workflow node pins it via
// WorkflowNode.agent (RFC 0072 §B).
func (c *OpenwopClient) ListAgents(ctx context.Context) (*AgentInventoryResponse, error) {
	var out AgentInventoryResponse
	err := c.requestJSON(ctx, http.MethodGet, "/agents", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgent returns one installed manifest agent's inventory entry, or (nil, nil)
// when absent / the capability is unadvertised (404) (RFC 0072 §A).
func (c *OpenwopClient) GetAgent(ctx context.Context, agentID string) (*AgentInventoryEntry, error) {
	var out AgentInventoryEntry
	err := c.requestJSON(ctx, http.MethodGet, "/agents/"+url.PathEscape(agentID), nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0078 — Portable tool catalog (spec/v2/core/tool-catalog.md) ─────────────

// ListTools calls GET /tools per RFC 0078 §B — lists the portable
// ToolDescriptors visible to the caller. Returns (nil, nil) when the host
// doesn't advertise capabilities.toolCatalog (the endpoint 404s), so callers can
// branch on capability discovery without unwrapping the error envelope.
func (c *OpenwopClient) ListTools(ctx context.Context) ([]ToolDescriptor, error) {
	var out []ToolDescriptor
	err := c.requestJSON(ctx, http.MethodGet, "/tools", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// GetTool calls GET /tools/{toolID} per RFC 0078 §B — returns one
// ToolDescriptor by its stable toolId. Returns (nil, nil) on 404 (no such tool,
// or the capability is unadvertised).
func (c *OpenwopClient) GetTool(ctx context.Context, toolID string) (*ToolDescriptor, error) {
	var out ToolDescriptor
	err := c.requestJSON(ctx, http.MethodGet, "/tools/"+url.PathEscape(toolID), nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ListCompactTools calls GET /tools?view=compact per RFC 0112 — lists the
// compact, model-facing CompactToolDescriptor projection (the heavy descriptor
// fields dropped). Reads the {tools:[...]} envelope. Returns (nil, nil) when the
// host doesn't advertise capabilities.toolCatalog.compactView (the endpoint
// 404s) or doesn't implement the compact view (501), so callers can branch on
// capability discovery without unwrapping the error envelope.
func (c *OpenwopClient) ListCompactTools(ctx context.Context) ([]CompactToolDescriptor, error) {
	var out struct {
		Tools []CompactToolDescriptor `json:"tools"`
	}
	err := c.requestJSON(ctx, http.MethodGet, "/tools?view=compact", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && (werr.Status == 404 || werr.Status == 501) {
			return nil, nil
		}
		return nil, err
	}
	return out.Tools, nil
}

// GetArtifact calls GET /runs/{runID}/artifacts/{artifactID} — reads a
// run-produced artifact by id. The artifact body is implementation-defined per
// the host, so it's returned as a generic map. Returns (nil, nil) on 404 (no
// such artifact, or the host doesn't store artifacts).
func (c *OpenwopClient) GetArtifact(
	ctx context.Context,
	runID, artifactID string,
) (map[string]any, error) {
	var out map[string]any
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+"/artifacts/"+url.PathEscape(artifactID),
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// ── RFC 0082 — Agent deployment lifecycle ──────────────────────────────────

// ListAgentDeployments calls GET /agents/{agentID}/deployments per RFC 0082
// §C/§E — lists a manifest agent's deployment records. Returns (nil, nil) when
// the host doesn't advertise capabilities.agents.deployment (the endpoint 404s).
func (c *OpenwopClient) ListAgentDeployments(
	ctx context.Context,
	agentID string,
) ([]AgentDeployment, error) {
	var out []AgentDeployment
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/agents/"+url.PathEscape(agentID)+"/deployments",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return out, nil
}

// TransitionAgentDeployment calls POST /agents/{agentID}/deployments per
// RFC 0082 §E — requests a deployment state transition (promote / pause /
// deprecate / rollback / adjust-canary). The host authorizes fail-closed against
// the RFC 0049 deploy:* scope, runs any RFC 0051 approvalGate, and enforces
// RFC 0081 requiredEval before emitting deployment.promoted. Returns the updated
// deployment record; a *WopError with Status 403 (fail-closed / eval_gate_unmet)
// or 400 (no_active_deployment / unsupported state) on failure.
func (c *OpenwopClient) TransitionAgentDeployment(
	ctx context.Context,
	agentID string,
	body AgentDeploymentTransition,
	opts MutationOptions,
) (*AgentDeployment, error) {
	var out AgentDeployment
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/agents/"+url.PathEscape(agentID)+"/deployments",
		body, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// ── RFC 0086 / 0087 — Standing agent roster + org-chart ────────────────────

// ListAgentRoster calls GET /agents/roster per RFC 0086 §B — lists the
// standing agent roster (named instances + their workflow portfolios) visible to
// the caller. Returns (nil, nil) when the host doesn't advertise
// capabilities.agents.roster (the endpoint 404s).
func (c *OpenwopClient) ListAgentRoster(ctx context.Context) (*AgentRosterResponse, error) {
	var out AgentRosterResponse
	err := c.requestJSON(ctx, http.MethodGet, "/agents/roster", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgentRosterEntry calls GET /agents/roster/{rosterID} per RFC 0086 §B —
// returns one standing roster entry. Returns (nil, nil) on 404 (no such entry,
// cross-tenant, or the capability is unadvertised).
func (c *OpenwopClient) GetAgentRosterEntry(
	ctx context.Context,
	rosterID string,
) (*AgentRosterEntry, error) {
	var out AgentRosterEntry
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/agents/roster/"+url.PathEscape(rosterID),
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgentOrgChart calls GET /agents/org-chart per RFC 0087 §C — returns the
// caller's agent org-chart (departments + roles + reportsTo over roster members;
// descriptive — confers no authority). Returns (nil, nil) when the host doesn't
// advertise capabilities.agents.orgChart (the endpoint 404s).
func (c *OpenwopClient) GetAgentOrgChart(ctx context.Context) (*AgentOrgChart, error) {
	var out AgentOrgChart
	err := c.requestJSON(ctx, http.MethodGet, "/agents/org-chart", nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// GetAgentOrgChartDepartmentOptions controls the
// GET /agents/org-chart/{departmentID} query.
type GetAgentOrgChartDepartmentOptions struct {
	// Recursive scopes the responsibility roll-up. Defaults to true (recursive);
	// set NonRecursive to scope the roll-up to direct members only.
	NonRecursive bool
}

// GetAgentOrgChartDepartment calls GET /agents/org-chart/{departmentID} per
// RFC 0087 §D — one department's subtree + responsibility roll-up (the union of
// its members' RFC 0086 portfolios). Pass NonRecursive to scope the roll-up to
// direct members. Returns (nil, nil) on 404 (unknown/cross-tenant department, or
// the capability is unadvertised).
func (c *OpenwopClient) GetAgentOrgChartDepartment(
	ctx context.Context,
	departmentID string,
	opts GetAgentOrgChartDepartmentOptions,
) (*OrgChartResponsibilityView, error) {
	path := "/agents/org-chart/" + url.PathEscape(departmentID)
	if opts.NonRecursive {
		path += "?recursive=false"
	}
	var out OrgChartResponsibilityView
	err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0081 — Eval summary ─────────────────────────────────────────────────

// GetEvalSummary calls GET /runs/{runID}/eval-summary per RFC 0081 §C — the
// EvalSummary scorecard for a terminal eval run (one started via
// CreateRun with mode "eval"): aggregate + per-task scores, cost, latency,
// schema-validity, and redaction-safe safety findings. Returns (nil, nil) when
// the host doesn't advertise capabilities.agents.evalSuite or the run isn't an
// eval run (404). A *WopError with Status 409 surfaces while the run is still in
// progress.
func (c *OpenwopClient) GetEvalSummary(
	ctx context.Context,
	runID string,
) (*EvalSummary, error) {
	var out EvalSummary
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+"/eval-summary",
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0054 — Run diff ─────────────────────────────────────────────────────

// DiffRun calls GET /runs/{runID}:diff?against={against} per RFC 0054 — a
// deterministic, replay-aware structured diff of two runs (typically a run and
// its :fork). Requires runs:read on BOTH runID and against. Returns (nil, nil)
// when the host doesn't implement the endpoint (404). DivergedAtSeq is nil +
// EventDiffs empty when the two logs are identical.
func (c *OpenwopClient) DiffRun(
	ctx context.Context,
	runID, against string,
) (*RunDiffResponse, error) {
	q := url.Values{}
	q.Set("against", against)
	var out RunDiffResponse
	err := c.requestJSON(
		ctx, http.MethodGet,
		"/runs/"+url.PathEscape(runID)+":diff?"+q.Encode(),
		nil, nil, true, &out,
	)
	if err != nil {
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// ── RFC 0027 + RFC 0028 — Prompt library (spec/v2/core/prompts.md) ──────────────
//
// Read endpoints (list, get, render) gate on
// capabilities.prompts.endpointsSupported: true. Mutating endpoints (create,
// update, delete) additionally require capabilities.prompts.mutableLibrary: true.
// Hosts that don't advertise the relevant capability return 501
// capability_not_provided, surfaced as a *WopError. Callers SHOULD pre-flight via
// GetCapabilities before calling.

// ListPromptTemplates calls GET /prompts per RFC 0028 §A (operationId
// listPromptTemplates). Supports kind / tag / modelClass / source filters +
// opaque cursor pagination.
func (c *OpenwopClient) ListPromptTemplates(
	ctx context.Context,
	opts ListPromptTemplatesOptions,
) (*ListPromptTemplatesResponse, error) {
	q := url.Values{}
	if opts.Kind != "" {
		q.Set("kind", opts.Kind)
	}
	if opts.Tag != "" {
		q.Set("tag", opts.Tag)
	}
	if opts.ModelClass != "" {
		q.Set("modelClass", opts.ModelClass)
	}
	if opts.Source != "" {
		q.Set("source", opts.Source)
	}
	if opts.Cursor != "" {
		q.Set("cursor", opts.Cursor)
	}
	if opts.Limit > 0 {
		q.Set("limit", strconv.Itoa(opts.Limit))
	}
	path := "/prompts"
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out ListPromptTemplatesResponse
	if err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreatePromptTemplate calls POST /prompts per RFC 0028 §A (operationId
// createPromptTemplate). Mutating endpoint — requires
// capabilities.prompts.mutableLibrary: true. Supports Idempotency-Key via
// MutationOptions. Returns nil on success (201).
func (c *OpenwopClient) CreatePromptTemplate(
	ctx context.Context,
	template PromptTemplate,
	opts MutationOptions,
) error {
	return c.requestJSON(ctx, http.MethodPost, "/prompts", template, opts.headers(), true, nil)
}

// GetPromptTemplate calls GET /prompts/{templateID} per RFC 0028 §A
// (operationId getPromptTemplate). Optionally pin a SemVer Version; supply
// LibraryID to disambiguate when multiple installed packs ship the same
// templateId.
func (c *OpenwopClient) GetPromptTemplate(
	ctx context.Context,
	templateID string,
	opts GetPromptTemplateOptions,
) (*PromptTemplate, error) {
	q := url.Values{}
	if opts.Version != "" {
		q.Set("version", opts.Version)
	}
	if opts.LibraryID != "" {
		q.Set("libraryId", opts.LibraryID)
	}
	path := "/prompts/" + url.PathEscape(templateID)
	if encoded := q.Encode(); encoded != "" {
		path += "?" + encoded
	}
	var out PromptTemplate
	if err := c.requestJSON(ctx, http.MethodGet, path, nil, nil, true, &out); err != nil {
		// Return (nil, nil) on 404 (no such template), consistent with the other
		// Get-by-id methods and the TypeScript/Python SDKs; a 400
		// prompt_ref_ambiguous and other errors still surface so callers can
		// distinguish "not found" from "ambiguous reference".
		var werr *WopError
		if errors.As(err, &werr) && werr.Status == 404 {
			return nil, nil
		}
		return nil, err
	}
	return &out, nil
}

// UpdatePromptTemplate calls PUT /prompts/{templateID} per RFC 0028 §A
// (operationId updatePromptTemplate). Submitted SemVer MUST be strictly greater
// than stored. Mutating endpoint — requires
// capabilities.prompts.mutableLibrary: true. Pack-sourced and host-built-in
// templates are read-only (host returns 403).
func (c *OpenwopClient) UpdatePromptTemplate(
	ctx context.Context,
	templateID string,
	template PromptTemplate,
	opts MutationOptions,
) (*PromptTemplate, error) {
	var out PromptTemplate
	if err := c.requestJSON(
		ctx, http.MethodPut,
		"/prompts/"+url.PathEscape(templateID),
		template, opts.headers(), true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeletePromptTemplate calls DELETE /prompts/{templateID} per RFC 0028 §A
// (operationId deletePromptTemplate). Mutating endpoint — requires
// capabilities.prompts.mutableLibrary: true. Pack-sourced and host-built-in
// templates are read-only (host returns 403). Returns nil on success (204).
func (c *OpenwopClient) DeletePromptTemplate(
	ctx context.Context,
	templateID string,
) error {
	return c.requestJSON(
		ctx, http.MethodDelete,
		"/prompts/"+url.PathEscape(templateID),
		nil, nil, true, nil,
	)
}

// RenderPromptTemplate calls POST /prompts:render per RFC 0028 §A (operationId
// renderPromptTemplate). Returns composed body + sha256 hash + per-variable
// hashes. The deterministic-hash invariant requires Hash to match what a matching
// prompt.composed event would carry at dispatch time. Does NOT dispatch an LLM
// call. Secret-source variable values MUST be supplied as
// [REDACTED:<credentialRef>] markers per SR-1.
func (c *OpenwopClient) RenderPromptTemplate(
	ctx context.Context,
	body RenderPromptTemplateRequest,
) (*RenderPromptTemplateResponse, error) {
	var out RenderPromptTemplateResponse
	if err := c.requestJSON(
		ctx, http.MethodPost,
		"/prompts:render",
		body, nil, true, &out,
	); err != nil {
		return nil, err
	}
	return &out, nil
}
