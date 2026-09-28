package openwopclient

import (
	"context"
	"testing"
)

// VerifyAuditLog reads every RFC 0218 §C anomaly shape.
func TestVerifyAuditLogAnomalyKinds(t *testing.T) {
	srv, _ := newWireServer(t, 200, `{"fromSeq":0,"toSeq":9,"chainValid":false,"checkpoints":[],"anomalies":[{"atSeq":0,"expectedPrevHash":null,"actualPrevHash":"ab"},{"atSeq":8,"kind":"merkle-mismatch","checkpoint":"cp-1","detail":"root differs"},{"atSeq":3,"kind":"missing-entry"}]}`, nil)
	client, _ := NewClient(srv.URL, "k")
	res, err := client.VerifyAuditLog(context.Background(), 0, 9)
	if err != nil {
		t.Fatal(err)
	}
	a := res.Anomalies
	if len(a) != 3 || a[0].Kind != "" || a[0].ExpectedPrevHash != "" || a[0].ActualPrevHash != "ab" {
		t.Fatalf("genesis chain-break: %+v", a)
	}
	if a[1].Kind != "merkle-mismatch" || a[1].Checkpoint != "cp-1" || a[1].Detail != "root differs" {
		t.Fatalf("merkle-mismatch: %+v", a[1])
	}
	if a[2].Kind != "missing-entry" || a[2].AtSeq != 3 {
		t.Fatalf("missing-entry: %+v", a[2])
	}
}
