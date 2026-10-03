package openwopclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ListTriggerDeadLetters maps to GET /v1/trigger-subscriptions/{id}/dead-letters
// (RFC 0232 §B; api/openapi.yaml listTriggerDeadLetters, corpus 2.45.10+).
func TestListTriggerDeadLetters(t *testing.T) {
	var gotMethod, gotEscapedPath, gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotEscapedPath = r.URL.EscapedPath()
		gotQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"deliveries":[{"subscriptionId":"sub/1","attemptEventId":"ev1","attempt":{"subscriptionId":"sub/1","dedupKey":"k1","attempt":1,"outcome":"dead-lettered"},"reason":"retries_exhausted","deadLetteredAt":"2026-10-03T00:00:00Z","expiresAt":"2026-10-10T00:00:00Z"}]}`))
	}))
	defer srv.Close()

	c, err := NewClient(srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}
	page, err := c.ListTriggerDeadLetters(context.Background(), "sub/1", 5, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotMethod != http.MethodGet || gotEscapedPath != "/v1/trigger-subscriptions/sub%2F1/dead-letters" || gotQuery != "limit=5" {
		t.Fatalf("request = %s %s ?%s", gotMethod, gotEscapedPath, gotQuery)
	}
	if len(page.Deliveries) != 1 || page.Deliveries[0].Reason != "retries_exhausted" || page.NextCursor != "" {
		t.Fatalf("page = %+v", page)
	}
}
