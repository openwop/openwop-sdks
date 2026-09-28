package openwopclient

import (
	"regexp"
	"strconv"
	"strings"
)

// Tenant-bound id wire form (spec/v2/core/identity.md §5 "Wire form").
//
// A tenant-bound id (runId, interruptId, subscriptionId, deliveryId,
// effectId) is "<tenant>/<opaque>" in bodies but travels as ONE path
// segment, projected: every UTF-8 byte outside [A-Za-z0-9._-] becomes "~"
// plus two uppercase hex digits — "acme/r-9f3c" → "acme~2Fr-9f3c". A host
// emits the projected form in links and accepts both it and the legacy
// percent-encoded "acme%2Fr-9f3c".

var escapedSlash = regexp.MustCompile(`(?i)[~%]2F`)

func isPassthrough(b byte) bool {
	return b >= 'A' && b <= 'Z' || b >= 'a' && b <= 'z' || b >= '0' && b <= '9' ||
		b == '.' || b == '_' || b == '-'
}

// UnprojectID decodes a wire-form id to its bound form, accepting both the
// projected ("~2F") and the percent-encoded ("%2F") escape. Bytes outside an
// escape pass through unchanged.
func UnprojectID(wire string) string {
	var out []byte
	for i := 0; i < len(wire); i++ {
		if c := wire[i]; (c == '~' || c == '%') && i+2 < len(wire) {
			if v, err := strconv.ParseUint(wire[i+1:i+3], 16, 8); err == nil {
				out = append(out, byte(v))
				i += 2
				continue
			}
		}
		out = append(out, wire[i])
	}
	return string(out)
}

// ProjectID projects a tenant-bound id to its one-segment wire form. An id
// that is already a wire form (no "/", but an escaped "/" in either form) is
// decoded first, so passing a link's segment back in never double-escapes.
func ProjectID(id string) string {
	bound := id
	if !strings.Contains(id, "/") && escapedSlash.MatchString(id) {
		bound = UnprojectID(id)
	}
	const hex = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(bound); i++ {
		c := bound[i]
		if isPassthrough(c) {
			b.WriteByte(c)
		} else {
			b.WriteByte('~')
			b.WriteByte(hex[c>>4])
			b.WriteByte(hex[c&0x0F])
		}
	}
	return b.String()
}
