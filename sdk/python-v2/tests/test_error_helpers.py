import unittest

from openwop_client import ERROR_CODES, HTTP_ERROR_CODES, is_error_code, is_http_error_code


class HTTPErrorHelperTests(unittest.TestCase):
    def test_is_http_error_code_accepts_canonical_codes(self) -> None:
        for code in (
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
        ):
            with self.subTest(code=code):
                self.assertTrue(is_http_error_code(code))
                self.assertTrue(is_error_code(code))

    def test_is_http_error_code_rejects_unknown_or_non_string_values(self) -> None:
        self.assertFalse(is_http_error_code("host_extension_error"))
        self.assertFalse(is_http_error_code(None))

    def test_exported_code_set_is_the_generated_registry(self) -> None:
        self.assertIsInstance(HTTP_ERROR_CODES, frozenset)
        self.assertIs(HTTP_ERROR_CODES, ERROR_CODES)
        # 1.x-only codes that are not rows in spec/v2/errors.json
        self.assertFalse(is_http_error_code("key_expired"))


if __name__ == "__main__":
    unittest.main()
