// Webhook delivery-verification helpers per spec/v2/core/webhooks.md
// §Verification. Receivers MUST verify both the HMAC AND the timestamp
// freshness before accepting a delivery — verifying HMAC alone leaves the
// receiver open to replay attacks.
//
// The signing recipe (webhooks.md §Headers):
//
//	hmac = HMAC-SHA256(secret, fmt.Sprintf("%d.%s", timestamp, rawBody))
//	header OpenWOP-Signature:           sha256=<hmac-hex>
//	header OpenWOP-Timestamp:           <unix-seconds>
//	header OpenWOP-Signature-Algorithm: v1
//
// A host advertising both majors sends the X-openwop-* family beside it with
// identical values through the overlap; ReadWebhookHeaders accepts either
// family. The SDK-only openwop-Webhook-* names and the v1=<hex> value form
// were removed in v2 (headers.md §Removed).
//
// Verification:
//
//  1. Parse the sha256=<hex> value from the signature header.
//  2. Reject an unrecognized OpenWOP-Signature-Algorithm value (MUST).
//  3. Reject a timestamp more than ±window from the clock (default 5 min).
//  4. Recompute HMAC-SHA256 over "<timestamp>.<rawBody>" and compare with
//     constant-time hmac.Equal.

package openwopclient

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// DefaultWebhookFreshnessWindowSeconds is the default replay-attack
// freshness window per webhooks.md §Verification (±5 minutes).
const DefaultWebhookFreshnessWindowSeconds = 300

// WebhookSignatureAlgorithms lists the recognized OpenWOP-Signature-Algorithm
// values: "v1" is HMAC-SHA256 with the subscription secret.
var WebhookSignatureAlgorithms = []string{"v1"}

// VerifyWebhookOutcome is the result of VerifyWebhookSignature.
// Valid is true on success; Reason carries the failure mode otherwise.
type VerifyWebhookOutcome struct {
	Valid  bool
	Reason VerifyWebhookReason
}

// VerifyWebhookReason names the specific failure mode when Valid is false.
type VerifyWebhookReason string

const (
	VerifyReasonSignatureMismatch       VerifyWebhookReason = "signature_mismatch"
	VerifyReasonTimestampExpired        VerifyWebhookReason = "timestamp_expired"
	VerifyReasonTimestampTooFarInFuture VerifyWebhookReason = "timestamp_too_far_in_future"
	VerifyReasonMalformedSigHeader      VerifyWebhookReason = "malformed_signature_header"
	VerifyReasonMalformedTSHeader       VerifyWebhookReason = "malformed_timestamp_header"
	VerifyReasonUnsupportedAlgorithm    VerifyWebhookReason = "unsupported_signature_algorithm"
)

// VerifyWebhookOptions overrides the freshness window or the wall clock for
// testing, and carries the algorithm header when the caller read one.
// Zero-valued fields use the defaults.
type VerifyWebhookOptions struct {
	// FreshnessWindowSeconds caps the age of accepted deliveries.
	// Zero means "use default" (300 seconds); -1 disables the
	// timestamp check (NOT recommended).
	FreshnessWindowSeconds int
	// NowSeconds overrides time.Now().Unix() for testing.
	NowSeconds int64
	// AlgorithmHeader is the OpenWOP-Signature-Algorithm value the delivery
	// carried (ReadWebhookHeaders returns it). Empty = not checked; an
	// unrecognized value is rejected.
	AlgorithmHeader string
}

// VerifyWebhookSignature verifies a webhook delivery. Returns Valid=true on
// success; otherwise Valid=false with Reason set so callers can log + alert.
//
// Callers MUST pass the raw body bytes — re-serialized parsed JSON will fail
// verification because the host signs exact bytes.
func VerifyWebhookSignature(
	secret string,
	signatureHeader string,
	timestampHeader string,
	rawBody []byte,
	opts VerifyWebhookOptions,
) VerifyWebhookOutcome {
	providedHex, ok := ParseSignatureValue(signatureHeader)
	if !ok {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonMalformedSigHeader}
	}
	providedBytes, err := hex.DecodeString(providedHex)
	if err != nil || len(providedBytes) == 0 {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonMalformedSigHeader}
	}

	if opts.AlgorithmHeader != "" && !isWebhookSignatureAlgorithm(opts.AlgorithmHeader) {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonUnsupportedAlgorithm}
	}

	timestamp, err := strconv.ParseInt(timestampHeader, 10, 64)
	if err != nil || timestamp <= 0 {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonMalformedTSHeader}
	}

	window := opts.FreshnessWindowSeconds
	if window == 0 {
		window = DefaultWebhookFreshnessWindowSeconds
	}
	if window > 0 {
		now := opts.NowSeconds
		if now == 0 {
			now = time.Now().Unix()
		}
		delta := now - timestamp
		if delta > int64(window) {
			return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonTimestampExpired}
		}
		if delta < -int64(window) {
			return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonTimestampTooFarInFuture}
		}
	}

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", timestamp)))
	mac.Write(rawBody)
	expected := mac.Sum(nil)

	if !hmac.Equal(providedBytes, expected) {
		return VerifyWebhookOutcome{Valid: false, Reason: VerifyReasonSignatureMismatch}
	}
	return VerifyWebhookOutcome{Valid: true}
}

func isWebhookSignatureAlgorithm(value string) bool {
	for _, alg := range WebhookSignatureAlgorithms {
		if value == alg {
			return true
		}
	}
	return false
}

// SignWebhookDelivery computes the canonical webhook signature for a
// payload — useful when implementing a host or generating test fixtures.
// Returns (signatureHeader, timestampHeader): "sha256=<hex>" and the
// timestamp. See WebhookDeliveryHeaders for the full header set.
func SignWebhookDelivery(secret string, timestamp int64, rawBody []byte) (string, string) {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(fmt.Sprintf("%d.", timestamp)))
	mac.Write(rawBody)
	return "sha256=" + hex.EncodeToString(mac.Sum(nil)), strconv.FormatInt(timestamp, 10)
}

// WebhookDeliveryHeaders returns the signature headers a v2 host sends on a
// delivery: the OpenWOP-* family plus the X-openwop-* twins a dual-major host
// emits through the overlap (webhooks.md §Dual emission). OpenWOP-Webhook-Id
// and OpenWOP-Event-Type are subscription-specific and added by the host.
func WebhookDeliveryHeaders(secret string, timestamp int64, rawBody []byte) map[string]string {
	sig, ts := SignWebhookDelivery(secret, timestamp, rawBody)
	return map[string]string{
		"OpenWOP-Signature":             sig,
		"OpenWOP-Timestamp":             ts,
		"OpenWOP-Signature-Algorithm":   "v1",
		"X-openwop-Signature":           sig,
		"X-openwop-Timestamp":           ts,
		"X-openwop-Signature-Algorithm": "v1",
	}
}

// ParseSignatureValue accepts the one v2 form "sha256=<hex>" (webhooks.md
// §Headers) and returns the hex digest. Anything else — including the
// removed "v1=<hex>" form — is malformed.
func ParseSignatureValue(value string) (string, bool) {
	const prefix = "sha256="
	if !strings.HasPrefix(value, prefix) {
		return "", false
	}
	h := value[len(prefix):]
	if h == "" {
		return "", false
	}
	if _, err := hex.DecodeString(h); err != nil {
		return "", false
	}
	return h, true
}

// WebhookHeaderFamily names the header triple a delivery carries.
type WebhookHeaderFamily struct {
	Signature string
	Timestamp string
	Algorithm string
	Family    string // "openwop" or "x-openwop"
}

// WebhookHeaderFamilies is the receiver's preference order: the v2 OpenWOP-*
// family, then the X-openwop-* family accepted through the overlap.
var WebhookHeaderFamilies = []WebhookHeaderFamily{
	{Signature: "OpenWOP-Signature", Timestamp: "OpenWOP-Timestamp", Algorithm: "OpenWOP-Signature-Algorithm", Family: "openwop"},
	{Signature: "X-openwop-Signature", Timestamp: "X-openwop-Timestamp", Algorithm: "X-openwop-Signature-Algorithm", Family: "x-openwop"},
}

// ReadWebhookHeaders picks the signature, timestamp and (optional) algorithm
// values from a delivery's headers — first complete family wins; lookups are
// case-insensitive via the getter, e.g. http.Header.Get. ok is false when no
// family is complete.
func ReadWebhookHeaders(get func(name string) string) (signature, timestamp, algorithm, family string, ok bool) {
	for _, f := range WebhookHeaderFamilies {
		sig := get(f.Signature)
		ts := get(f.Timestamp)
		if sig != "" && ts != "" {
			return sig, ts, get(f.Algorithm), f.Family, true
		}
	}
	return "", "", "", "", false
}
