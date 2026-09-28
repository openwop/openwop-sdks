package openwopclient

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// DeleteContentPage sends DELETE /v1/content/pages/{pageID} (localized-content.md
// §D; api/openapi.yaml deleteContentPage, corpus 2.42.2+).
func TestDeleteContentPage(t *testing.T) {
	var gotMethod, gotEscapedPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotEscapedPath = r.URL.EscapedPath()
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()
	c, _ := NewClient(srv.URL, "k")
	if err := c.DeleteContentPage(context.Background(), "page 1"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gotMethod != http.MethodDelete || gotEscapedPath != "/v1/content/pages/page%201" {
		t.Fatalf("got %s %s", gotMethod, gotEscapedPath)
	}
}

func TestDeleteContentPageNotFound(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"not_found","message":"no page"}`))
	}))
	defer srv.Close()
	c, _ := NewClient(srv.URL, "k")
	var werr *WopError
	if err := c.DeleteContentPage(context.Background(), "gone"); !errors.As(err, &werr) || werr.Status != 404 {
		t.Fatalf("expected a 404 WopError, got %v", err)
	}
}
