package openwopclient

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

// UnregisterWebhookForTenant sends the tenantId query parameter the v1
// contract requires (spec/v1/webhooks.md §Unregister; api/openapi.yaml
// unregisterWebhook, corpus 2.37.1+). openwop-sdks#50.
func TestUnregisterWebhookForTenantSendsTenantID(t *testing.T) {
	var gotMethod, gotEscapedPath, gotTenant string
	var gotHasTenant bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotEscapedPath = r.URL.EscapedPath()
		_, gotHasTenant = r.URL.Query()["tenantId"]
		gotTenant = r.URL.Query().Get("tenantId")
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c, err := NewClient(srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}
	if err := c.UnregisterWebhookForTenant(context.Background(), "sub/1", "tenant a"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotMethod != http.MethodDelete {
		t.Fatalf("method = %q, want DELETE", gotMethod)
	}
	if gotEscapedPath != "/v1/webhooks/sub%2F1" {
		t.Fatalf("path = %q", gotEscapedPath)
	}
	if !gotHasTenant || gotTenant != "tenant a" {
		t.Fatalf("tenantId query = %q (present=%v), want %q", gotTenant, gotHasTenant, "tenant a")
	}
}

// The deprecated UnregisterWebhook keeps its signature and wire shape.
func TestUnregisterWebhookDeprecatedFormUnchanged(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotQuery = r.URL.RawQuery
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	c, err := NewClient(srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}
	if err := c.UnregisterWebhook(context.Background(), "sub-1"); err != nil { //nolint:staticcheck // exercising the deprecated form on purpose
		t.Fatalf("unexpected error: %v", err)
	}
	if gotQuery != "" {
		t.Fatalf("query = %q, want empty", gotQuery)
	}
}
