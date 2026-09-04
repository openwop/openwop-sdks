package openwopclient

import (
	"net/http"
	"strings"
	"testing"
)

const (
	testSecret = "s3cret"
	testTS     = int64(1_760_000_000)
)

var testBody = []byte(`{"runId":"r1","event":{"type":"run.completed"}}`)

func TestWebhookSignatureRoundtrip(t *testing.T) {
	sig, ts := SignWebhookDelivery(testSecret, testTS, testBody)
	if !strings.HasPrefix(sig, "sha256=") {
		t.Fatalf("signature must be sha256=<hex>, got %q", sig)
	}
	out := VerifyWebhookSignature(testSecret, sig, ts, testBody, VerifyWebhookOptions{NowSeconds: testTS})
	if !out.Valid {
		t.Fatalf("expected valid, got reason=%s", out.Reason)
	}
}

func TestWebhookRemovedFormsAreMalformed(t *testing.T) {
	sig, ts := SignWebhookDelivery(testSecret, testTS, testBody)
	hexOnly := strings.TrimPrefix(sig, "sha256=")
	for _, value := range []string{"v1=" + hexOnly, hexOnly, "md5=" + hexOnly} {
		out := VerifyWebhookSignature(testSecret, value, ts, testBody, VerifyWebhookOptions{NowSeconds: testTS})
		if out.Valid || out.Reason != VerifyReasonMalformedSigHeader {
			t.Fatalf("%q must be malformed, got %+v", value, out)
		}
	}
	if _, ok := ParseSignatureValue("v1=" + hexOnly); ok {
		t.Fatal("the removed v1= form must not parse")
	}
}

func TestWebhookUnrecognizedAlgorithmRejected(t *testing.T) {
	sig, ts := SignWebhookDelivery(testSecret, testTS, testBody)
	bad := VerifyWebhookSignature(testSecret, sig, ts, testBody, VerifyWebhookOptions{NowSeconds: testTS, AlgorithmHeader: "v2"})
	if bad.Valid || bad.Reason != VerifyReasonUnsupportedAlgorithm {
		t.Fatalf("expected unsupported_signature_algorithm, got %+v", bad)
	}
	good := VerifyWebhookSignature(testSecret, sig, ts, testBody, VerifyWebhookOptions{NowSeconds: testTS, AlgorithmHeader: "v1"})
	if !good.Valid {
		t.Fatalf("v1 must be accepted, got %+v", good)
	}
}

func TestWebhookWrongSecretAndTamperedBodyRejected(t *testing.T) {
	sig, ts := SignWebhookDelivery(testSecret, testTS, testBody)
	if out := VerifyWebhookSignature("other", sig, ts, testBody, VerifyWebhookOptions{NowSeconds: testTS}); out.Valid || out.Reason != VerifyReasonSignatureMismatch {
		t.Fatalf("wrong secret must mismatch, got %+v", out)
	}
	tampered := append([]byte{}, testBody...)
	tampered[len(tampered)-2] = 'x'
	if out := VerifyWebhookSignature(testSecret, sig, ts, tampered, VerifyWebhookOptions{NowSeconds: testTS}); out.Valid {
		t.Fatal("tampered body must not verify")
	}
}

func TestWebhookFreshnessWindow(t *testing.T) {
	sig, ts := SignWebhookDelivery(testSecret, testTS, testBody)
	if out := VerifyWebhookSignature(testSecret, sig, ts, testBody, VerifyWebhookOptions{NowSeconds: testTS + 301}); out.Reason != VerifyReasonTimestampExpired {
		t.Fatalf("stale timestamp: got %+v", out)
	}
	if out := VerifyWebhookSignature(testSecret, sig, ts, testBody, VerifyWebhookOptions{NowSeconds: testTS - 301}); out.Reason != VerifyReasonTimestampTooFarInFuture {
		t.Fatalf("future timestamp: got %+v", out)
	}
}

func TestWebhookDeliveryHeadersCarryOpenWOPFamilyOnly(t *testing.T) {
	headers := WebhookDeliveryHeaders(testSecret, testTS, testBody)
	sig, _ := SignWebhookDelivery(testSecret, testTS, testBody)
	if headers["OpenWOP-Signature"] != sig || headers["OpenWOP-Signature-Algorithm"] != "v1" || headers["X-openwop-Signature"] != sig {
		t.Fatalf("unexpected headers: %v", headers)
	}
	for name, value := range headers {
		if strings.HasPrefix(strings.ToLower(name), "openwop-webhook-") || strings.HasPrefix(value, "v1=") {
			t.Fatalf("legacy header/value leaked: %s=%s", name, value)
		}
	}
}

func TestReadWebhookHeadersPrefersSpecOrder(t *testing.T) {
	if len(WebhookHeaderFamilies) != 2 || WebhookHeaderFamilies[0].Family != "openwop" || WebhookHeaderFamilies[1].Family != "x-openwop" {
		t.Fatalf("exactly two families in spec order, got %+v", WebhookHeaderFamilies)
	}
	get := func(m map[string]string) func(string) string {
		h := http.Header{}
		for k, v := range m {
			h.Set(k, v)
		}
		return h.Get
	}
	sig, ts, alg, fam, ok := ReadWebhookHeaders(get(map[string]string{
		"x-openwop-signature": "a", "x-openwop-timestamp": "1",
		"OpenWOP-Signature": "b", "openwop-timestamp": "2", "OPENWOP-SIGNATURE-ALGORITHM": "v1",
	}))
	if !ok || sig != "b" || ts != "2" || alg != "v1" || fam != "openwop" {
		t.Fatalf("OpenWOP-* must win: got %q %q %q %q %v", sig, ts, alg, fam, ok)
	}
	sig, ts, alg, fam, ok = ReadWebhookHeaders(get(map[string]string{"X-OpenWOP-Signature": "a", "X-OPENWOP-TIMESTAMP": "1"}))
	if !ok || sig != "a" || ts != "1" || alg != "" || fam != "x-openwop" {
		t.Fatalf("X-openwop-* must be accepted through the overlap: got %q %q %q %q %v", sig, ts, alg, fam, ok)
	}
	if _, _, _, _, ok = ReadWebhookHeaders(get(map[string]string{"openwop-Webhook-Signature": "c", "openwop-Webhook-Timestamp": "3"})); ok {
		t.Fatal("the legacy family must not be read")
	}
	if _, _, _, _, ok = ReadWebhookHeaders(get(map[string]string{"Content-Type": "application/json"})); ok {
		t.Fatal("no complete family → ok=false")
	}
}
