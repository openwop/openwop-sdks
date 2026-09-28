package openwopclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// RFC 0219 — OpenWOP-Client-Version names the corpus release this SDK is
// built against (CORPUS_TAG), never the module version, and rides every
// request: the JSON path and the SSE subscribe.

var clientVersionGrammar = regexp.MustCompile(`^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))?$`)

func expectedFromCorpusTag(t *testing.T) string {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "CORPUS_TAG"))
	if err != nil {
		t.Fatal(err)
	}
	tag := strings.TrimSpace(string(raw))
	m := regexp.MustCompile(`^(?:openwop-conformance/)?v?(\d+)\.(\d+)\.(\d+)(-.+)?$`).FindStringSubmatch(tag)
	if m == nil {
		t.Fatalf("unparseable CORPUS_TAG %q", tag)
	}
	if m[4] != "" {
		return m[1] + "." + m[2]
	}
	return m[1] + "." + m[2] + "." + m[3]
}

func TestCorpusVersionMatchesGrammarAndCorpusTag(t *testing.T) {
	if !clientVersionGrammar.MatchString(CorpusVersion) {
		t.Fatalf("CorpusVersion %q does not match the RFC 0219 grammar", CorpusVersion)
	}
	if want := expectedFromCorpusTag(t); CorpusVersion != want {
		t.Fatalf("CorpusVersion %q, CORPUS_TAG derives %q", CorpusVersion, want)
	}
}

func TestClientVersionOnJSONAndSSERequests(t *testing.T) {
	var seen []http.Header
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Header.Clone())
		if r.Header.Get("Accept") == "text/event-stream" {
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = w.Write([]byte("event: heartbeat.evaluated\ndata: {\"type\":\"heartbeat.evaluated\",\"payload\":{}}\n\n"))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()
	client, err := NewClient(srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}
	if client.ClientVersion() != CorpusVersion {
		t.Fatalf("ClientVersion() %q", client.ClientVersion())
	}
	ctx := context.Background()
	if _, err := client.GetOpenAPI(ctx); err != nil {
		t.Fatal(err)
	}
	host, cleanup, err := client.StreamHostEvents(ctx, HostEventsOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for range host {
	}
	cleanup()
	events, cleanup2, err := client.StreamEvents(ctx, "t/r1", StreamEventsOptions{})
	if err != nil {
		t.Fatal(err)
	}
	for range events {
	}
	cleanup2()

	if len(seen) != 3 {
		t.Fatalf("expected 3 requests, got %d", len(seen))
	}
	want := expectedFromCorpusTag(t)
	for i, h := range seen {
		if got := h.Get("OpenWOP-Client-Version"); got != want {
			t.Errorf("request %d: OpenWOP-Client-Version=%q, want %q", i, got, want)
		}
	}
}
