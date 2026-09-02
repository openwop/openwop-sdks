"""RFC 0165 §C.3 — both signature value forms verify, signing emits the spec
form, and header families are read in spec order."""

import hashlib
import hmac

from openwop_client.webhook_helpers import (
    VerifyInvalid,
    VerifyValid,
    parse_signature_value,
    read_webhook_headers,
    sign_webhook_delivery,
    verify_webhook_signature,
)

SECRET = "s3cret"
BODY = b'{"runId":"r1","event":{"type":"run.completed"}}'
TS = 1_760_000_000
HEX = hmac.new(SECRET.encode(), f"{TS}.".encode() + BODY, hashlib.sha256).hexdigest()


def test_spec_form_sha256_verifies():
    out = verify_webhook_signature(SECRET, f"sha256={HEX}", str(TS), BODY, now_seconds=TS)
    assert out == VerifyValid()


def test_legacy_form_v1_still_verifies():
    out = verify_webhook_signature(SECRET, f"v1={HEX}", str(TS), BODY, now_seconds=TS)
    assert out == VerifyValid()


def test_bare_hex_and_unknown_prefix_are_malformed():
    assert verify_webhook_signature(SECRET, HEX, str(TS), BODY, now_seconds=TS) == VerifyInvalid(reason="malformed_signature_header")
    assert verify_webhook_signature(SECRET, f"md5={HEX}", str(TS), BODY, now_seconds=TS) == VerifyInvalid(reason="malformed_signature_header")


def test_parse_signature_value():
    assert parse_signature_value(f"sha256={HEX}") == HEX
    assert parse_signature_value(f"v1={HEX}") == HEX
    assert parse_signature_value("sha256=zz") is None
    assert parse_signature_value("") is None


def test_sign_emits_spec_form():
    sig, ts = sign_webhook_delivery(SECRET, TS, BODY)
    assert sig == f"sha256={HEX}"
    assert ts == str(TS)
    assert verify_webhook_signature(SECRET, sig, ts, BODY, now_seconds=TS) == VerifyValid()


def test_read_webhook_headers_prefers_spec_order_case_insensitively():
    assert read_webhook_headers({"x-openwop-signature": "a", "x-openwop-timestamp": "1", "OpenWOP-Signature": "b", "openwop-timestamp": "2"}) == ("b", "2", "openwop")
    assert read_webhook_headers({"X-OPENWOP-SIGNATURE": "a", "X-openwop-Timestamp": "1", "openwop-Webhook-Signature": "c", "openwop-Webhook-Timestamp": "3"}) == ("a", "1", "x-openwop")
    assert read_webhook_headers({"openwop-webhook-signature": "c", "openwop-webhook-timestamp": "3"}) == ("c", "3", "legacy")
    assert read_webhook_headers({"OpenWOP-Signature": "b", "X-openwop-Signature": "a", "X-openwop-Timestamp": "1"}) == ("a", "1", "x-openwop")
    assert read_webhook_headers({"Content-Type": "application/json"}) is None
