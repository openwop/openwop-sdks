package openwopclient

import (
	"strings"
	"testing"
	"time"
)

func TestWebhookSignatureRoundtrip(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix()
	body := []byte(`{"runId":"r1","event":"run.completed"}`)

	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	out := VerifyWebhookSignature(secret, sig, tsHeader, body, VerifyWebhookOptions{})
	if !out.Valid {
		t.Fatalf("expected valid, got reason=%s", out.Reason)
	}
}

func TestWebhookSignatureWrongSecretRejected(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix()
	body := []byte(`{"runId":"r1"}`)
	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	out := VerifyWebhookSignature("wrong-secret", sig, tsHeader, body, VerifyWebhookOptions{})
	if out.Valid {
		t.Fatal("expected invalid with wrong secret")
	}
	if out.Reason != VerifyReasonSignatureMismatch {
		t.Fatalf("expected signature_mismatch, got %s", out.Reason)
	}
}

func TestWebhookSignatureStaleTimestampRejected(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix() - 10000
	body := []byte(`{"runId":"r1"}`)
	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	out := VerifyWebhookSignature(secret, sig, tsHeader, body, VerifyWebhookOptions{
		NowSeconds: time.Now().Unix(),
	})
	if out.Valid {
		t.Fatal("expected invalid with stale timestamp")
	}
	if out.Reason != VerifyReasonTimestampExpired {
		t.Fatalf("expected timestamp_expired, got %s", out.Reason)
	}
}

func TestWebhookMalformedSignatureRejected(t *testing.T) {
	out := VerifyWebhookSignature("test-secret", "not-a-v1-header", "1700000000", []byte("{}"), VerifyWebhookOptions{})
	if out.Valid {
		t.Fatal("expected invalid for malformed sig")
	}
	if out.Reason != VerifyReasonMalformedSigHeader {
		t.Fatalf("expected malformed_signature_header, got %s", out.Reason)
	}
}

func TestWebhookTamperedBodyRejected(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix()
	body := []byte(`{"runId":"r1"}`)
	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	// Caller tampers with the body but reuses the signature.
	tampered := []byte(`{"runId":"r2"}`)
	out := VerifyWebhookSignature(secret, sig, tsHeader, tampered, VerifyWebhookOptions{})
	if out.Valid {
		t.Fatal("expected invalid for tampered body")
	}
	if out.Reason != VerifyReasonSignatureMismatch {
		t.Fatalf("expected signature_mismatch, got %s", out.Reason)
	}
}

// RFC 0165 §C.3 — both signature value forms verify, signing emits the spec
// form, and header families are read in spec order.
func TestWebhookSignatureSpecFormSha256Verifies(t *testing.T) {
	secret := "test-secret"
	ts := time.Now().Unix()
	body := []byte(`{"runId":"r1"}`)
	sig, tsHeader := SignWebhookDelivery(secret, ts, body)
	if !strings.HasPrefix(sig, "sha256=") {
		t.Fatalf("SignWebhookDelivery must emit the spec form sha256=<hex>, got %q", sig)
	}
	if out := VerifyWebhookSignature(secret, sig, tsHeader, body, VerifyWebhookOptions{}); !out.Valid {
		t.Fatalf("spec form must verify, got reason=%s", out.Reason)
	}
	legacy := "v1=" + strings.TrimPrefix(sig, "sha256=")
	if out := VerifyWebhookSignature(secret, legacy, tsHeader, body, VerifyWebhookOptions{}); !out.Valid {
		t.Fatalf("legacy v1= form must still verify, got reason=%s", out.Reason)
	}
	bare := strings.TrimPrefix(sig, "sha256=")
	if out := VerifyWebhookSignature(secret, bare, tsHeader, body, VerifyWebhookOptions{}); out.Valid || out.Reason != VerifyReasonMalformedSigHeader {
		t.Fatalf("bare hex must be malformed, got valid=%v reason=%s", out.Valid, out.Reason)
	}
}

func TestReadWebhookHeadersPrefersSpecOrder(t *testing.T) {
	get := func(h map[string]string) func(string) string {
		return func(name string) string {
			for k, v := range h {
				if strings.EqualFold(k, name) {
					return v
				}
			}
			return ""
		}
	}
	sig, ts, fam, ok := ReadWebhookHeaders(get(map[string]string{"x-openwop-signature": "a", "x-openwop-timestamp": "1", "openwop-signature": "b", "openwop-timestamp": "2"}))
	if !ok || sig != "b" || ts != "2" || fam != "openwop" {
		t.Fatalf("OpenWOP-* must win: got %q %q %q %v", sig, ts, fam, ok)
	}
	sig, ts, fam, ok = ReadWebhookHeaders(get(map[string]string{"X-openwop-Signature": "a", "X-openwop-Timestamp": "1", "openwop-Webhook-Signature": "c", "openwop-Webhook-Timestamp": "3"}))
	if !ok || sig != "a" || fam != "x-openwop" {
		t.Fatalf("X-openwop-* must win over legacy: got %q %q %q %v", sig, ts, fam, ok)
	}
	if _, _, _, ok := ReadWebhookHeaders(get(map[string]string{"Content-Type": "application/json"})); ok {
		t.Fatal("no complete family must report ok=false")
	}
}
