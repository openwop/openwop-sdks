package openwopclient

import (
	"context"
	"testing"
)

// RunSnapshot.Owner.Subject is the RFC 0170 Subject object. Through 2.3.0 it
// was typed string, so GetRun failed to decode every conformant snapshot.
func TestGetRunDecodesSubjectOwner(t *testing.T) {
	srv, _ := newWireServer(t, 200, `{"runId":"acme/r-0000000000000001","workflowId":"wf","status":"completed","owner":{"tenant":"acme","subject":{"issuer":"urn:host:api-key","subjectId":"default","tenant":"acme","lane":"api-key","kind":"agent","actor":{"issuer":"urn:host:oidc","subjectId":"u1","tenant":"acme","lane":"oidc","kind":"user"}}},"eventLogSchemaVersion":3,"engineVersion":1,"compensationStatus":"none","variables":{},"startedAt":"t","completedAt":"t"}`, nil)
	client, _ := NewClient(srv.URL, "k")
	snap, err := client.GetRun(context.Background(), "acme/r-0000000000000001")
	if err != nil {
		t.Fatal(err)
	}
	s := snap.Owner.Subject
	if s.Issuer != "urn:host:api-key" || s.SubjectID != "default" || s.Lane != "api-key" || s.Kind != "agent" {
		t.Fatalf("subject: %+v", s)
	}
	if s.Actor == nil || s.Actor.SubjectID != "u1" || s.Actor.Actor != nil {
		t.Fatalf("actor: %+v", s.Actor)
	}
}
