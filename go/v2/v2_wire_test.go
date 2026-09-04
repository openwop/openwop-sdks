package openwopclient

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type capturedRequest struct {
	Method string
	Path   string
	Query  string
	Header http.Header
}

// newWireServer records every request and answers with the given status +
// body (or per-path bodies when routes is non-nil).
func newWireServer(t *testing.T, status int, body string, routes map[string]string) (*httptest.Server, *[]capturedRequest) {
	t.Helper()
	captured := &[]capturedRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*captured = append(*captured, capturedRequest{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery, Header: r.Header.Clone()})
		out := body
		code := status
		if routes != nil {
			if b, ok := routes[r.URL.Path]; ok {
				out = b
			}
		}
		if strings.HasPrefix(out, "404:") {
			code = http.StatusNotFound
			out = strings.TrimPrefix(out, "404:")
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_, _ = w.Write([]byte(out))
	}))
	t.Cleanup(srv.Close)
	return srv, captured
}

func TestProtocolVersionHeaderOnEveryRequest(t *testing.T) {
	if SDKProtocolMajor != 2 || ProtocolVersionHeader(2) != "2.0" || ProtocolVersionHeader(3) != "3.0" {
		t.Fatal("major rendering mismatch")
	}
	srv, captured := newWireServer(t, 200, `{}`, map[string]string{
		"/.well-known/openwop": `{"protocolVersions":["2.0"],"preferredVersion":"2.0"}`,
		"/runs":                `{"runId":"t/r","status":"pending","eventsUrl":"/runs/t%2Fr/events"}`,
	})
	client, err := NewClient(srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}
	if client.ProtocolVersion() != "2.0" {
		t.Fatalf("default ProtocolVersion: %q", client.ProtocolVersion())
	}
	ctx := context.Background()
	if _, err := client.GetCapabilities(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetWorkflow(ctx, "wf"); err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetOpenAPI(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := client.CreateRun(ctx, CreateRunRequest{WorkflowID: "wf"}, MutationOptions{IdempotencyKey: "idem-1", Dedup: true}); err != nil {
		t.Fatal(err)
	}
	if len(*captured) != 4 {
		t.Fatalf("expected 4 requests, got %d", len(*captured))
	}
	for _, req := range *captured {
		if req.Header.Get("OpenWOP-Version") != "2.0" {
			t.Errorf("%s %s: OpenWOP-Version=%q", req.Method, req.Path, req.Header.Get("OpenWOP-Version"))
		}
		if strings.Contains(req.Path, "/v1") {
			t.Errorf("%s %s: versioned path", req.Method, req.Path)
		}
	}
	reqs := *captured
	if reqs[0].Header.Get("Authorization") != "" || reqs[2].Header.Get("Authorization") != "" {
		t.Error("discovery + openapi are unauthenticated")
	}
	if reqs[1].Header.Get("Authorization") != "Bearer k" {
		t.Error("workflow read must carry the bearer key")
	}
	create := reqs[3]
	if create.Path != "/runs" || create.Header.Get("OpenWOP-Dedup") != "enforce" || create.Header.Get("Idempotency-Key") != "idem-1" || create.Header.Get("X-Dedup") != "" {
		t.Errorf("create headers/path mismatch: %+v", create)
	}

	client.Major = 3
	if _, err := client.GetWorkflow(ctx, "wf"); err != nil {
		t.Fatal(err)
	}
	if (*captured)[4].Header.Get("OpenWOP-Version") != "3.0" {
		t.Error("Major must drive the header")
	}
}

func TestProtocolVersionUnsupportedSurfacesTypedCode(t *testing.T) {
	srv, _ := newWireServer(t, http.StatusNotAcceptable, `{"error":"protocol_version_unsupported","message":"unlisted","details":{"protocolVersions":["1.12"]}}`, nil)
	client, _ := NewClient(srv.URL, "k")
	_, err := client.GetRun(context.Background(), "t/r1")
	var werr *WopError
	if !errors.As(err, &werr) || werr.Status != 406 || werr.Envelope == nil || werr.Envelope.Error != "protocol_version_unsupported" {
		t.Fatalf("expected a typed 406, got %v", err)
	}
	if !IsErrorCode(werr.Envelope.Error) {
		t.Fatal("protocol_version_unsupported must be a registered code")
	}
}

func TestUnversionedPathsAcrossNamespaces(t *testing.T) {
	// r.URL.Path is the decoded path, so the routes use "/" not "%2F".
	srv, captured := newWireServer(t, 200, `{}`, map[string]string{
		"/runs/t/r1/compensation": `{"runId":"t/r1","status":"none","plan":[],"attempts":[]}`,
		"/runs/t/r1/effects":      `404:{"error":"not_found","message":"no"}`,
		"/host/effect-seams":      `{"manifestVersion":"1","host":{"name":"h","build":{"kind":"commit","id":"abc"}},"seams":[{"seam":"http.fetch","kind":"http","guarded":true,"guardedBy":"interceptor"}]}`,
		"/runs/t/r1/events/poll":  `{"runId":"t/r1","events":[],"lastSequence":-1,"status":"running","isTerminal":false}`,
	})
	client, _ := NewClient(srv.URL, "k")
	ctx := context.Background()
	comp, err := client.GetRunCompensation(ctx, "t/r1")
	if err != nil || comp == nil || comp.Status != "none" {
		t.Fatalf("compensation: %v %+v", err, comp)
	}
	eff, err := client.GetRunEffects(ctx, "t/r1")
	if err != nil || eff != nil {
		t.Fatalf("effects 404 must be (nil, nil): %v %+v", err, eff)
	}
	seams, err := client.GetEffectSeamManifest(ctx)
	if err != nil || len(seams.Seams) != 1 || seams.Seams[0].Seam != "http.fetch" {
		t.Fatalf("seams: %v %+v", err, seams)
	}
	after := 7
	timeout := 5
	page, err := client.PollRunEvents(ctx, "t/r1", PollRunEventsOptions{AfterSequence: &after, TimeoutSeconds: &timeout})
	if err != nil || page.LastSequence != -1 || page.IsTerminal {
		t.Fatalf("poll: %v %+v", err, page)
	}
	if _, err := client.GetAgentOrgChart(ctx); err != nil {
		t.Fatal(err)
	}
	if err := client.DeletePromptTemplate(ctx, "p1"); err != nil {
		t.Fatal(err)
	}
	if err := client.UnregisterWebhook(ctx, "wh1"); err != nil {
		t.Fatal(err)
	}

	reqs := *captured
	want := []string{"/runs/t/r1/compensation", "/runs/t/r1/effects", "/host/effect-seams", "/runs/t/r1/events/poll", "/agents/org-chart", "/prompts/p1", "/webhooks/wh1"}
	if len(reqs) != len(want) {
		t.Fatalf("expected %d requests, got %d", len(want), len(reqs))
	}
	for i, w := range want {
		if reqs[i].Path != w {
			t.Errorf("request %d: path %q want %q", i, reqs[i].Path, w)
		}
	}
	poll := reqs[3].Query
	if !strings.Contains(poll, "afterSequence=7") || !strings.Contains(poll, "timeout=5") || strings.Contains(poll, "lastSequence") {
		t.Errorf("poll query: %q", poll)
	}
}

func TestSSEChannelsCarryTheVersionHeader(t *testing.T) {
	var seen []capturedRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, capturedRequest{Method: r.Method, Path: r.URL.Path, Query: r.URL.RawQuery, Header: r.Header.Clone()})
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(200)
		if r.URL.Path == "/host/events" {
			_, _ = w.Write([]byte(": keep-alive\n\nevent: heartbeat.evaluated\ndata: {\"type\":\"heartbeat.evaluated\",\"payload\":{\"heartbeatId\":\"h1\",\"status\":\"ok\",\"changed\":false}}\n\n"))
			return
		}
		_, _ = w.Write([]byte("id: 1\nevent: batch\ndata: [{\"eventId\":\"e1\",\"runId\":\"t/r1\",\"type\":\"run.started\",\"payload\":{},\"timestamp\":\"t\",\"sequence\":0,\"schemaVersion\":1},{\"eventId\":\"e2\",\"runId\":\"t/r1\",\"type\":\"run.completed\",\"payload\":{},\"timestamp\":\"t\",\"sequence\":1,\"schemaVersion\":1}]\n\n"))
	}))
	defer srv.Close()
	client, _ := NewClient(srv.URL, "k")
	ctx := context.Background()

	events, cleanup, err := client.StreamEvents(ctx, "t/r1", StreamEventsOptions{StreamModes: []StreamMode{StreamModeUpdates, StreamModeMessages}, LastEventID: "0"})
	if err != nil {
		t.Fatal(err)
	}
	var types []string
	for ev := range events {
		types = append(types, ev.Type)
	}
	cleanup()
	if strings.Join(types, ",") != "run.started,run.completed" {
		t.Fatalf("batch frames must flatten: %v", types)
	}

	host, cleanup2, err := client.StreamHostEvents(ctx, HostEventsOptions{})
	if err != nil {
		t.Fatal(err)
	}
	var hostTypes []string
	for ev := range host {
		hostTypes = append(hostTypes, ev.Type)
	}
	cleanup2()
	if strings.Join(hostTypes, ",") != "heartbeat.evaluated" {
		t.Fatalf("host events: %v", hostTypes)
	}

	if len(seen) != 2 || seen[0].Path != "/runs/t/r1/events" || seen[1].Path != "/host/events" {
		t.Fatalf("unexpected subscribe paths: %+v", seen)
	}
	for _, req := range seen {
		if req.Header.Get("OpenWOP-Version") != "2.0" {
			t.Errorf("%s: OpenWOP-Version=%q", req.Path, req.Header.Get("OpenWOP-Version"))
		}
	}
	if !strings.Contains(seen[0].Query, "streamMode=updates%2Cmessages") || seen[0].Header.Get("Last-Event-ID") != "0" {
		t.Errorf("runEvents subscribe: query=%q Last-Event-ID=%q", seen[0].Query, seen[0].Header.Get("Last-Event-ID"))
	}
}
