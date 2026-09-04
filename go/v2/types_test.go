package openwopclient

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

func TestIsErrorCodeAndAliases(t *testing.T) {
	for _, code := range []string{
		"unauthenticated",
		"forbidden",
		"validation_error",
		"rate_limited",
		"unsupported_stream_mode",
		"credential_forbidden",
		"internal_error",
		"protocol_version_unsupported",
		"protocol_version_mismatch",
		"client_version_unsupported",
	} {
		if !IsErrorCode(code) || !IsHTTPErrorCode(code) {
			t.Fatalf("expected %q to be a registered code", code)
		}
	}
	if IsErrorCode("host_extension_error") || IsErrorCode("key_expired") {
		t.Fatal("unregistered / 1.x-only codes must not be recognized")
	}
	if !IsRetriableErrorCode("rate_limited") || IsRetriableErrorCode("not_found") {
		t.Fatal("retriable rows mismatch")
	}
	if !IsVendorErrorCode("acme.quota_exceeded") || IsVendorErrorCode("openwop.reserved") || IsVendorErrorCode("not_a_vendor_code") {
		t.Fatal("vendor code grammar mismatch")
	}
	if ErrorCodeHTTPStatus("protocol_version_unsupported") != 406 || ErrorCodeHTTPStatus("nope") != 0 {
		t.Fatal("registered status lookup mismatch")
	}
}

// TestGeneratedRegistriesMatchCorpus pins generated.go to the vendored
// spec/v2/errors.json and schemas/v2/capabilities.schema.json.
func TestGeneratedRegistriesMatchCorpus(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "spec", "v2", "errors.json"))
	if err != nil {
		t.Fatalf("read errors.json: %v", err)
	}
	var registry struct {
		Rows []struct {
			Code       string `json:"code"`
			HTTPStatus int    `json:"httpStatus"`
			Retriable  bool   `json:"retriable"`
		} `json:"rows"`
	}
	if err := json.Unmarshal(raw, &registry); err != nil {
		t.Fatalf("parse errors.json: %v", err)
	}
	if len(registry.Rows) != len(ErrorCodes) || len(ErrorCodes) != 92 {
		t.Fatalf("ErrorCodes has %d entries, registry has %d", len(ErrorCodes), len(registry.Rows))
	}
	retriable := 0
	for _, row := range registry.Rows {
		if !IsErrorCode(row.Code) {
			t.Errorf("registry code %q missing from ErrorCodes", row.Code)
		}
		if ErrorCodeHTTPStatus(row.Code) != row.HTTPStatus {
			t.Errorf("status for %q: got %d want %d", row.Code, ErrorCodeHTTPStatus(row.Code), row.HTTPStatus)
		}
		if row.Retriable {
			retriable++
			if !IsRetriableErrorCode(row.Code) {
				t.Errorf("%q registered retriable but not in RetriableErrorCodes", row.Code)
			}
		}
	}
	if retriable != len(RetriableErrorCodes) {
		t.Fatalf("RetriableErrorCodes has %d entries, registry has %d", len(RetriableErrorCodes), retriable)
	}
	if !sort.StringsAreSorted(ErrorCodes) {
		t.Fatal("ErrorCodes must be sorted")
	}

	schemaRaw, err := os.ReadFile(filepath.Join("..", "..", "schemas", "v2", "capabilities.schema.json"))
	if err != nil {
		t.Fatalf("read capabilities schema: %v", err)
	}
	var schema struct {
		AdditionalProperties *bool               `json:"additionalProperties"`
		Required             []string            `json:"required"`
		Properties           map[string]struct{} `json:"properties"`
	}
	if err := json.Unmarshal(schemaRaw, &schema); err != nil {
		t.Fatalf("parse capabilities schema: %v", err)
	}
	if schema.AdditionalProperties == nil || *schema.AdditionalProperties {
		t.Fatal("the v2 root must be closed")
	}
	all := append(append([]string{}, CapabilityFamilyKeys...), CapabilityMetadataKeys...)
	sort.Strings(all)
	want := make([]string, 0, len(schema.Properties))
	for k := range schema.Properties {
		want = append(want, k)
	}
	sort.Strings(want)
	if strings.Join(all, ",") != strings.Join(want, ",") {
		t.Fatalf("family + metadata keys must partition the root:\n got %v\nwant %v", all, want)
	}
	sort.Strings(schema.Required)
	if strings.Join(schema.Required, ",") != "preferredVersion,protocolVersions" {
		t.Fatalf("unexpected required root keys: %v", schema.Required)
	}
}

// TestCapabilitiesClosedRootRoundTrip decodes the closed v2 root: metadata
// keys into typed fields, family keys into Families (facets preserved), and
// back out again.
func TestCapabilitiesClosedRootRoundTrip(t *testing.T) {
	raw := `{
		"protocolVersions":["1.12","2.0"],
		"preferredVersion":"2.0",
		"engineVersion":7,
		"webhooks":{"status":"stable","since":"2.0","witness":"witnessable-gated","signatureAlgorithms":["v1"]},
		"compensation":{"status":"experimental","since":"2.0","until":"2.3","witness":"seam-gated"},
		"extensions":{"acme.thing":{"x":1}}
	}`
	var caps Capabilities
	if err := json.Unmarshal([]byte(raw), &caps); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if caps.PreferredVersion != "2.0" || len(caps.ProtocolVersions) != 2 || caps.EngineVersion == nil || *caps.EngineVersion != 7 {
		t.Fatalf("metadata mismatch: %+v", caps)
	}
	wh, ok := caps.Family("webhooks")
	if !ok || wh.Status != CapabilityStable || wh.Witness != WitnessWitnessableGated || wh.Until != "" {
		t.Fatalf("webhooks record mismatch: %+v", wh)
	}
	if algs, ok := wh.Facets["signatureAlgorithms"].([]any); !ok || len(algs) != 1 || algs[0] != "v1" {
		t.Fatalf("facets not preserved: %+v", wh.Facets)
	}
	comp, ok := caps.Family("compensation")
	if !ok || comp.Status != CapabilityExperimental || comp.Until != "2.3" || len(comp.Facets) != 0 {
		t.Fatalf("compensation record mismatch: %+v", comp)
	}
	if _, ok := caps.Family("idempotency"); ok {
		t.Fatal("an unadvertised family must be absent")
	}
	if caps.Extensions["acme.thing"] == nil {
		t.Fatal("extensions must decode as metadata")
	}

	out, err := json.Marshal(caps)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var back map[string]json.RawMessage
	if err := json.Unmarshal(out, &back); err != nil {
		t.Fatalf("re-parse: %v", err)
	}
	for _, key := range []string{"protocolVersions", "preferredVersion", "webhooks", "compensation", "extensions"} {
		if _, ok := back[key]; !ok {
			t.Errorf("marshal dropped %q", key)
		}
	}
	if _, ok := back["families"]; ok {
		t.Error("Families must not leak as a wire key")
	}
	if strings.Contains(string(out), `"supported"`) {
		t.Error("a v2 record never carries supported")
	}
}

func TestRunConfigurableDefaultsVersion(t *testing.T) {
	out, err := json.Marshal(RunConfigurable{Run: map[string]any{"runTimeoutMs": 60000}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(out), `"version":1`) {
		t.Fatalf("version must default to 1: %s", out)
	}
}
