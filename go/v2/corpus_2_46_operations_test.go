package openwopclient

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
)

// Corpus v2.46.28: RFC 0251 eval-run baseline selection on CreateRun, and the
// operations added to spec/v2/path-manifest.json since v2.45.10.

type bodyRequest struct {
	Method  string
	RawPath string
	Query   string
	Header  http.Header
	Body    map[string]any
}

func newBodyServer(t *testing.T, respond func(r *http.Request) (int, string, string)) (*OpenwopClient, *[]bodyRequest) {
	t.Helper()
	captured := &[]bodyRequest{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &body)
		}
		*captured = append(*captured, bodyRequest{Method: r.Method, RawPath: r.URL.EscapedPath(), Query: r.URL.RawQuery, Header: r.Header.Clone(), Body: body})
		status, contentType, out := respond(r)
		w.Header().Set("Content-Type", contentType)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(out))
	}))
	t.Cleanup(srv.Close)
	c, err := NewClient(srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}
	return c, captured
}

func jsonReply(body string) func(*http.Request) (int, string, string) {
	return func(*http.Request) (int, string, string) { return 200, "application/json", body }
}

func TestCreateRunEvalBaselineSelection(t *testing.T) {
	c, captured := newBodyServer(t, jsonReply(`{"runId":"t/r2","status":"pending","eventsUrl":""}`))
	ctx := context.Background()
	if _, err := c.CreateRun(ctx, CreateRunRequest{
		Mode: "eval", EvalSuiteRef: "suite://s", AgentID: "a",
		EvalModes:     []EvalMode{EvalModeGolden, EvalModeRegression},
		BaselineRunID: "t/r1",
	}, MutationOptions{}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.CreateRun(ctx, CreateRunRequest{Mode: "eval", EvalSuiteRef: "suite://s", AgentID: "a"}, MutationOptions{}); err != nil {
		t.Fatal(err)
	}
	got := (*captured)[0].Body
	if !reflect.DeepEqual(got["evalModes"], []any{"golden", "regression"}) || got["baselineRunId"] != "t/r1" {
		t.Fatalf("eval selection body = %v", got)
	}
	if _, ok := (*captured)[1].Body["evalModes"]; ok {
		t.Fatal("evalModes sent when absent")
	}
	if _, ok := (*captured)[1].Body["baselineRunId"]; ok {
		t.Fatal("baselineRunId sent when absent")
	}
}

func TestProposalOperations(t *testing.T) {
	proposal := `{"id":"p1","kind":"prompt-template","state":"draft","artifact":{},"provenance":{"sourceRunIds":[]},"owner":{"tenant":"t"},"createdAt":"2026-10-26T00:00:00Z"}`
	c, captured := newBodyServer(t, func(r *http.Request) (int, string, string) {
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/proposals":
			return 200, "application/json", `{"items":[` + proposal + `],"nextCursor":"c2"}`
		case r.URL.Path == "/proposals/p1:apply":
			return 202, "application/json", `{"runId":"t/gate"}`
		}
		return 200, "application/json", proposal
	})
	ctx := context.Background()
	page, err := c.ListProposals(ctx, ListProposalsOptions{State: "draft", Kind: "prompt-template", Limit: 5, Cursor: "c"})
	if err != nil || page.Items[0].ID != "p1" || page.NextCursor != "c2" {
		t.Fatalf("list = %+v, %v", page, err)
	}
	if _, err := c.SubmitProposal(ctx, SubmitProposalRequest{Kind: "prompt-template", Artifact: map[string]any{"templateId": "x"}}, MutationOptions{IdempotencyKey: "i1"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetProposal(ctx, "p/1"); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ReviseProposal(ctx, "p1", ReviseProposalRequest{Title: "t"}); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ArchiveProposal(ctx, "p1"); err != nil {
		t.Fatal(err)
	}
	applied, err := c.ApplyProposal(ctx, "p1", "sha256:ab", MutationOptions{IdempotencyKey: "i2"})
	if err != nil || applied.GateRunID != "t/gate" || applied.Proposal != nil {
		t.Fatalf("apply = %+v, %v", applied, err)
	}
	if _, err := c.RejectProposal(ctx, "p1", "no"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"GET /proposals?cursor=c&kind=prompt-template&limit=5&state=draft",
		"POST /proposals",
		"GET /proposals/p%2F1",
		"PATCH /proposals/p1",
		"DELETE /proposals/p1",
		"POST /proposals/p1:apply",
		"POST /proposals/p1:reject",
	}
	for i, req := range *captured {
		got := req.Method + " " + req.RawPath
		if req.Query != "" {
			got += "?" + req.Query
		}
		if got != want[i] {
			t.Errorf("request %d = %q, want %q", i, got, want[i])
		}
	}
	if (*captured)[1].Header.Get("Idempotency-Key") != "i1" || (*captured)[5].Header.Get("Idempotency-Key") != "i2" {
		t.Error("Idempotency-Key not sent")
	}
	if (*captured)[5].Body["artifactDigest"] != "sha256:ab" || (*captured)[6].Body["reason"] != "no" {
		t.Errorf("apply/reject bodies = %v / %v", (*captured)[5].Body, (*captured)[6].Body)
	}
}

func TestConnectionProviders(t *testing.T) {
	c, captured := newBodyServer(t, func(r *http.Request) (int, string, string) {
		if r.URL.Path == "/connection-providers" {
			return 200, "application/json", `{"providers":[{"id":"slack","source":"pack","packName":"@acme/slack"}],"refusals":[{"packName":"@b/slack","providerId":"slack","code":"connection_provider_conflict","heldBy":"@acme/slack"}]}`
		}
		return 200, "application/json", `{"id":"slack","source":"builtin"}`
	})
	ctx := context.Background()
	reg, err := c.ListConnectionProviders(ctx)
	if err != nil || reg.Providers[0].PackName != "@acme/slack" || reg.Refusals[0].HeldBy != "@acme/slack" {
		t.Fatalf("list = %+v, %v", reg, err)
	}
	if _, err := c.ResolveConnectionProvider(ctx, "slack", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := c.ResolveConnectionProvider(ctx, "slack", "@acme/slack"); err != nil {
		t.Fatal(err)
	}
	if q := (*captured)[1].Query; q != "" {
		t.Errorf("bare resolve query = %q", q)
	}
	if q := (*captured)[2].Query; q != "pack=%40acme%2Fslack" {
		t.Errorf("qualified resolve query = %q", q)
	}
}

func TestHostTestEventAndUiPlugins(t *testing.T) {
	html := "<!doctype html><title>p</title>"
	c, captured := newBodyServer(t, func(r *http.Request) (int, string, string) {
		switch {
		case r.URL.Path == "/host/events/test":
			return 202, "application/json", `{"eventId":"e1","type":"host-test.durable-triggered"}`
		case r.Method == http.MethodGet:
			return 200, "text/html", html
		}
		return 200, "application/json", `{"openwop":"ui-plugin/1","type":"response","id":1,"ok":false,"error":{"code":"method_not_allowed"}}`
	})
	ctx := context.Background()
	ev, err := c.EmitTestHostEvent(ctx, EmitTestHostEventRequest{Delivery: "durable"}, MutationOptions{IdempotencyKey: "k1"})
	if err != nil || ev.Type != "host-test.durable-triggered" {
		t.Fatalf("emit = %+v, %v", ev, err)
	}
	if (*captured)[0].Body["delivery"] != "durable" || (*captured)[0].Header.Get("Idempotency-Key") != "k1" {
		t.Errorf("emit request = %+v", (*captured)[0])
	}
	frame, err := c.GetUiPluginFrame(ctx, "@acme/editor", "main")
	if err != nil || frame != html {
		t.Fatalf("frame = %q, %v", frame, err)
	}
	if (*captured)[1].Header.Get("Accept") != "text/html" || (*captured)[1].RawPath != "/host/ui-plugins/@acme%2Feditor/main/frame" {
		t.Errorf("frame request = %+v", (*captured)[1])
	}
	res, err := c.DispatchUiPluginRequest(ctx, "@acme/editor", "main", UiPluginRequest{ID: 1, Method: "host.toast"})
	if err != nil || res.OK || res.Error["code"] != "method_not_allowed" {
		t.Fatalf("rpc = %+v, %v", res, err)
	}
	msg, _ := (*captured)[2].Body["message"].(map[string]any)
	if msg["openwop"] != "ui-plugin/1" || msg["type"] != "request" || msg["method"] != "host.toast" {
		t.Errorf("rpc message = %v", msg)
	}
}
