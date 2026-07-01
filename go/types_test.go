package openwopclient

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestIsHTTPErrorCode(t *testing.T) {
	if !IsHTTPErrorCode(HTTPErrorRateLimited) {
		t.Fatalf("expected %q to be recognized", HTTPErrorRateLimited)
	}

	if IsHTTPErrorCode("host_extension_error") {
		t.Fatalf("expected unknown extension code to remain unrecognized")
	}
}

// TestCapabilitiesClientSurfaceRoundTrip round-trips the RFC 0111–0120 client
// capability blocks: absent blocks stay nil (omitempty), present blocks
// preserve their fields, and the vendor open-string isolation value survives.
func TestCapabilitiesClientSurfaceRoundTrip(t *testing.T) {
	// Absent blocks: the base wire object omits the new keys entirely.
	var bare Capabilities
	if err := json.Unmarshal([]byte(`{"protocolVersion":"1.0"}`), &bare); err != nil {
		t.Fatalf("unmarshal bare: %v", err)
	}
	if bare.Memory != nil || bare.RestTransport != nil || bare.ToolCatalog != nil ||
		bare.A2UISurface != nil || bare.UIPlugins != nil || bare.Dispatch != nil {
		t.Fatal("absent capability blocks must decode to nil")
	}
	out, err := json.Marshal(bare)
	if err != nil {
		t.Fatalf("marshal bare: %v", err)
	}
	for _, key := range []string{"memory", "restTransport", "toolCatalog", "a2uiSurface", "uiPlugins", "dispatch"} {
		if strings.Contains(string(out), `"`+key+`"`) {
			t.Errorf("nil %q block must be omitted from JSON", key)
		}
	}

	// Present blocks round-trip their fields.
	raw := `{
		"protocolVersion":"1.0",
		"memory":{"injectionBudget":{"supported":true,"tokenCounter":"chars"}},
		"restTransport":{"conditionalRunGet":true,"contentEncodings":["gzip","zstd"]},
		"toolCatalog":{"compactView":true},
		"a2uiSurface":{"deltaTransport":true},
		"uiPlugins":{"supported":true,"isolation":"x-host-acme-nano","surfaces":["route"],"hostApi":["host.toast"],"maxEntryBytes":4096},
		"dispatch":{"supported":true,"fanOutSupported":true,"fanOutPolicies":["parallel"],"joinModes":["wait-all"],"maxFanOut":8},
		"aiProviders":{"promptPrefixCache":{"supported":true,"providers":["anthropic"]}}
	}`
	var caps Capabilities
	if err := json.Unmarshal([]byte(raw), &caps); err != nil {
		t.Fatalf("unmarshal full: %v", err)
	}
	if caps.Memory == nil || caps.Memory.InjectionBudget == nil ||
		!caps.Memory.InjectionBudget.Supported ||
		caps.Memory.InjectionBudget.TokenCounter == nil ||
		*caps.Memory.InjectionBudget.TokenCounter != "chars" {
		t.Errorf("memory.injectionBudget round-trip failed: %+v", caps.Memory)
	}
	if caps.RestTransport == nil || caps.RestTransport.ConditionalRunGet == nil ||
		!*caps.RestTransport.ConditionalRunGet ||
		len(caps.RestTransport.ContentEncodings) != 2 {
		t.Errorf("restTransport round-trip failed: %+v", caps.RestTransport)
	}
	if caps.ToolCatalog == nil || caps.ToolCatalog.CompactView == nil || !*caps.ToolCatalog.CompactView {
		t.Errorf("toolCatalog round-trip failed: %+v", caps.ToolCatalog)
	}
	if caps.A2UISurface == nil || caps.A2UISurface.DeltaTransport == nil || !*caps.A2UISurface.DeltaTransport {
		t.Errorf("a2uiSurface round-trip failed: %+v", caps.A2UISurface)
	}
	if caps.UIPlugins == nil || !caps.UIPlugins.Supported ||
		caps.UIPlugins.Isolation == nil || *caps.UIPlugins.Isolation != "x-host-acme-nano" ||
		caps.UIPlugins.MaxEntryBytes == nil || *caps.UIPlugins.MaxEntryBytes != 4096 {
		t.Errorf("uiPlugins round-trip (incl. vendor isolation) failed: %+v", caps.UIPlugins)
	}
	if caps.Dispatch == nil || caps.Dispatch.Supported == nil || !*caps.Dispatch.Supported ||
		len(caps.Dispatch.FanOutPolicies) != 1 || caps.Dispatch.MaxFanOut == nil || *caps.Dispatch.MaxFanOut != 8 {
		t.Errorf("dispatch round-trip failed: %+v", caps.Dispatch)
	}
	if caps.AIProviders == nil || caps.AIProviders.PromptPrefixCache == nil ||
		!caps.AIProviders.PromptPrefixCache.Supported ||
		len(caps.AIProviders.PromptPrefixCache.Providers) != 1 {
		t.Errorf("aiProviders.promptPrefixCache round-trip failed: %+v", caps.AIProviders)
	}
}

func TestHTTPErrorCodesIncludesCanonicalCodes(t *testing.T) {
	for _, code := range []string{
		HTTPErrorUnauthenticated,
		HTTPErrorForbidden,
		HTTPErrorValidationError,
		HTTPErrorRateLimited,
		HTTPErrorUnsupportedStreamMode,
		HTTPErrorCredentialForbidden,
		HTTPErrorInternalError,
	} {
		if !IsHTTPErrorCode(code) {
			t.Fatalf("expected canonical code %q in HTTPErrorCodes", code)
		}
	}
}
