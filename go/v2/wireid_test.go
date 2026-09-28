package openwopclient

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

// Tenant-bound id wire form (spec/v2/core/identity.md §5 "Wire form").

func TestProjectID(t *testing.T) {
	cases := map[string]string{
		"acme/r-9f3c":            "acme~2Fr-9f3c",
		"anon:sess-3f9c/r_1.2":   "anon~3Asess-3f9c~2Fr_1.2",
		"a~b/c":                  "a~7Eb~2Fc",
		"café/r":                 "caf~C3~A9~2Fr",
		"t/😀":                    "t~2F~F0~9F~98~80",
		"acme~2Fr-9f3c":          "acme~2Fr-9f3c", // already projected: never double-escaped
		"acme%2Fr-9f3c":          "acme~2Fr-9f3c",
		"acme%2fr-9f3c":          "acme~2Fr-9f3c",
		"r-9f3c0000000000000000": "r-9f3c0000000000000000",
	}
	for in, want := range cases {
		if got := ProjectID(in); got != want {
			t.Errorf("ProjectID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestUnprojectID(t *testing.T) {
	cases := map[string]string{
		"acme~2Fr-9f3c": "acme/r-9f3c",
		"acme%2Fr-9f3c": "acme/r-9f3c",
		"caf~C3~A9~2Fr": "café/r",
		"acme/r-9f3c":   "acme/r-9f3c",
	}
	for in, want := range cases {
		if got := UnprojectID(in); got != want {
			t.Errorf("UnprojectID(%q) = %q, want %q", in, got, want)
		}
	}
	for _, id := range []string{"acme/r-9f3c", "anon:s/x", "a~b/c", "café/r", "t/😀"} {
		if got := UnprojectID(ProjectID(id)); got != id {
			t.Errorf("round trip %q → %q", id, got)
		}
	}
}

func TestTenantBoundSegmentsAreProjected(t *testing.T) {
	srv, captured := newWireServer(t, 404, `{"error":"not_found","message":"no"}`, nil)
	client, _ := NewClient(srv.URL, "k")
	ctx := context.Background()
	_ = client.UnregisterWebhook(ctx, "acme/sub-1")
	_, _ = client.DiffRun(ctx, "acme/r1", "acme~2Fr2")
	reqs := *captured
	if reqs[0].Path != "/webhooks/acme~2Fsub-1" {
		t.Errorf("webhook path: %q", reqs[0].Path)
	}
	if reqs[1].Path != "/runs/acme~2Fr1:diff" || reqs[1].Query != "against=acme~2Fr2" {
		t.Errorf("diff: %q ? %q", reqs[1].Path, reqs[1].Query)
	}
}

func TestDeleteContentPage(t *testing.T) {
	srv, captured := newWireServer(t, http.StatusNoContent, ``, nil)
	client, _ := NewClient(srv.URL, "k")
	if err := client.DeleteContentPage(context.Background(), "page 1"); err != nil {
		t.Fatal(err)
	}
	req := (*captured)[0]
	if req.Method != http.MethodDelete || req.Path != "/content/pages/page 1" || req.Header.Get("Authorization") != "Bearer k" {
		t.Errorf("delete request mismatch: %+v", req)
	}

	srv404, _ := newWireServer(t, 404, `{"error":"not_found","message":"no page"}`, nil)
	client404, _ := NewClient(srv404.URL, "k")
	err := client404.DeleteContentPage(context.Background(), "gone")
	var werr *WopError
	if !errors.As(err, &werr) || werr.Status != 404 {
		t.Fatalf("expected a 404 WopError, got %v", err)
	}
}
