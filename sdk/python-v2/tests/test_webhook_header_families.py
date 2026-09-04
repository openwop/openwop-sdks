"""webhooks.md §Headers / §Verification / §Dual emission — the v2 helpers sign
and verify ``sha256=<hex>`` under the ``OpenWOP-*`` family, accept the
``X-openwop-*`` twins through the overlap, reject an unrecognized
``OpenWOP-Signature-Algorithm``, and no longer know the SDK-only
``openwop-Webhook-*`` names or the ``v1=<hex>`` value form."""

import hashlib
import hmac
import unittest

from openwop_client.webhook_helpers import (
    WEBHOOK_HEADER_FAMILIES,
    VerifyInvalid,
    VerifyValid,
    WebhookHeaderRead,
    parse_signature_value,
    read_webhook_headers,
    sign_webhook_delivery,
    verify_webhook_signature,
    webhook_delivery_headers,
)

SECRET = "s3cret"
BODY = b'{"runId":"r1","event":{"type":"run.completed"}}'
TS = 1_760_000_000
HEX = hmac.new(SECRET.encode(), f"{TS}.".encode() + BODY, hashlib.sha256).hexdigest()


class VerifyTests(unittest.TestCase):
    def test_sha256_form_verifies(self) -> None:
        out = verify_webhook_signature(SECRET, f"sha256={HEX}", str(TS), BODY, now_seconds=TS)
        self.assertEqual(out, VerifyValid())

    def test_removed_v1_form_bare_hex_and_unknown_prefix_are_malformed(self) -> None:
        for value in (f"v1={HEX}", HEX, f"md5={HEX}"):
            with self.subTest(value=value):
                out = verify_webhook_signature(SECRET, value, str(TS), BODY, now_seconds=TS)
                self.assertEqual(out, VerifyInvalid(reason="malformed_signature_header"))

    def test_unrecognized_algorithm_rejected_v1_accepted(self) -> None:
        bad = verify_webhook_signature(
            SECRET, f"sha256={HEX}", str(TS), BODY, now_seconds=TS, algorithm_header="v2"
        )
        self.assertEqual(bad, VerifyInvalid(reason="unsupported_signature_algorithm"))
        ok = verify_webhook_signature(
            SECRET, f"sha256={HEX}", str(TS), BODY, now_seconds=TS, algorithm_header="v1"
        )
        self.assertEqual(ok, VerifyValid())

    def test_freshness_window(self) -> None:
        late = verify_webhook_signature(SECRET, f"sha256={HEX}", str(TS), BODY, now_seconds=TS + 301)
        self.assertEqual(late, VerifyInvalid(reason="timestamp_expired"))
        early = verify_webhook_signature(SECRET, f"sha256={HEX}", str(TS), BODY, now_seconds=TS - 301)
        self.assertEqual(early, VerifyInvalid(reason="timestamp_too_far_in_future"))

    def test_parse_signature_value(self) -> None:
        self.assertEqual(parse_signature_value(f"sha256={HEX}"), HEX)
        self.assertIsNone(parse_signature_value(f"v1={HEX}"))
        self.assertIsNone(parse_signature_value("sha256=zz"))
        self.assertIsNone(parse_signature_value(""))


class SignTests(unittest.TestCase):
    def test_sign_emits_sha256_form(self) -> None:
        sig, ts = sign_webhook_delivery(SECRET, TS, BODY)
        self.assertEqual(sig, f"sha256={HEX}")
        self.assertEqual(ts, str(TS))
        self.assertEqual(verify_webhook_signature(SECRET, sig, ts, BODY, now_seconds=TS), VerifyValid())

    def test_delivery_headers_carry_openwop_family_and_overlap_twins_only(self) -> None:
        headers = webhook_delivery_headers(SECRET, TS, BODY)
        self.assertEqual(headers["OpenWOP-Signature"], f"sha256={HEX}")
        self.assertEqual(headers["OpenWOP-Timestamp"], str(TS))
        self.assertEqual(headers["OpenWOP-Signature-Algorithm"], "v1")
        self.assertEqual(headers["X-openwop-Signature"], f"sha256={HEX}")
        self.assertFalse(any(k.lower().startswith("openwop-webhook-") for k in headers))
        self.assertFalse(any(v.startswith("v1=") for v in headers.values()))


class ReadTests(unittest.TestCase):
    def test_exactly_two_families_in_spec_order(self) -> None:
        self.assertEqual([f[3] for f in WEBHOOK_HEADER_FAMILIES], ["openwop", "x-openwop"])

    def test_openwop_wins_case_insensitively_with_algorithm(self) -> None:
        read = read_webhook_headers(
            {
                "x-openwop-signature": "a",
                "x-openwop-timestamp": "1",
                "OpenWOP-Signature": "b",
                "openwop-timestamp": "2",
                "OPENWOP-SIGNATURE-ALGORITHM": "v1",
            }
        )
        self.assertEqual(read, WebhookHeaderRead(signature="b", timestamp="2", family="openwop", algorithm="v1"))

    def test_x_openwop_accepted_through_the_overlap(self) -> None:
        read = read_webhook_headers({"X-OPENWOP-SIGNATURE": "a", "X-openwop-Timestamp": "1"})
        self.assertEqual(read, WebhookHeaderRead(signature="a", timestamp="1", family="x-openwop"))

    def test_legacy_family_not_read_and_incomplete_skipped(self) -> None:
        self.assertIsNone(
            read_webhook_headers({"openwop-webhook-signature": "c", "openwop-webhook-timestamp": "3"})
        )
        read = read_webhook_headers(
            {"OpenWOP-Signature": "b", "X-openwop-Signature": "a", "X-openwop-Timestamp": "1"}
        )
        self.assertEqual(read, WebhookHeaderRead(signature="a", timestamp="1", family="x-openwop"))
        self.assertIsNone(read_webhook_headers({"Content-Type": "application/json"}))


if __name__ == "__main__":
    unittest.main()
