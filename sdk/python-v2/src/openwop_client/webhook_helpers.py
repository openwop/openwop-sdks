"""Webhook delivery-verification helpers per ``spec/v2/core/webhooks.md``
§Verification.

Receivers MUST verify both the HMAC AND the timestamp freshness before
accepting a delivery — verifying HMAC alone leaves the receiver open to
replay attacks.

The signing recipe (webhooks.md §Headers)::

    hmac = HMAC-SHA256(secret, f"{timestamp}.{rawBody}")
    header OpenWOP-Signature:           sha256=<hmac-hex>
    header OpenWOP-Timestamp:           <unix-seconds>
    header OpenWOP-Signature-Algorithm: v1

A host advertising both majors sends the ``X-openwop-*`` family beside it with
identical values through the overlap; :func:`read_webhook_headers` accepts
either family. The SDK-only ``openwop-Webhook-*`` names and the ``v1=<hex>``
value form were removed in v2 (headers.md §Removed).

Verification:

    1. Parse the ``sha256=<hex>`` value from the signature header.
    2. Reject an unrecognized ``OpenWOP-Signature-Algorithm`` value (MUST).
    3. Reject a timestamp more than ±window from the clock (default 5 minutes).
    4. Recompute ``HMAC-SHA256(f"{timestamp}.{rawBody}", secret)`` and compare
       in constant time (``hmac.compare_digest``).

The HMAC is computed over the raw body bytes; receivers MUST pass the exact
bytes the host POSTed, NOT a re-serialized parsed representation.
"""

from __future__ import annotations

import hmac
import re
import time
from dataclasses import dataclass
from typing import Literal, Mapping, Union

DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS = 300

#: The one signature scheme (``OpenWOP-Signature-Algorithm``): HMAC-SHA256 with
#: the subscription secret.
WEBHOOK_SIGNATURE_ALGORITHMS: frozenset[str] = frozenset({"v1"})

VerifyReason = Literal[
    "signature_mismatch",
    "timestamp_expired",
    "timestamp_too_far_in_future",
    "malformed_signature_header",
    "malformed_timestamp_header",
    "unsupported_signature_algorithm",
]


@dataclass(frozen=True)
class VerifyValid:
    valid: Literal[True] = True


@dataclass(frozen=True)
class VerifyInvalid:
    reason: VerifyReason
    valid: Literal[False] = False


VerifyWebhookOutcome = Union[VerifyValid, VerifyInvalid]


_HEX_RE = re.compile(r"^[0-9a-fA-F]+$")
_SIGNATURE_VALUE_PREFIX = "sha256="


def verify_webhook_signature(
    secret: str,
    signature_header: str,
    timestamp_header: str,
    raw_body: bytes | str,
    *,
    freshness_window_seconds: int = DEFAULT_WEBHOOK_FRESHNESS_WINDOW_SECONDS,
    now_seconds: int | None = None,
    algorithm_header: str | None = None,
) -> VerifyWebhookOutcome:
    """Verify a webhook delivery.

    Returns :class:`VerifyValid` on success, :class:`VerifyInvalid` otherwise
    with a ``reason`` field for diagnostics. ``algorithm_header`` is the
    ``OpenWOP-Signature-Algorithm`` value when the caller read one; an
    unrecognized value is rejected.
    """

    provided_hex = parse_signature_value(signature_header)
    if provided_hex is None:
        return VerifyInvalid(reason="malformed_signature_header")

    if algorithm_header is not None and algorithm_header not in WEBHOOK_SIGNATURE_ALGORITHMS:
        return VerifyInvalid(reason="unsupported_signature_algorithm")

    try:
        timestamp = int(timestamp_header)
    except (ValueError, TypeError):
        return VerifyInvalid(reason="malformed_timestamp_header")
    if timestamp <= 0:
        return VerifyInvalid(reason="malformed_timestamp_header")

    if freshness_window_seconds > 0:
        now = now_seconds if now_seconds is not None else int(time.time())
        delta = now - timestamp
        if delta > freshness_window_seconds:
            return VerifyInvalid(reason="timestamp_expired")
        if delta < -freshness_window_seconds:
            return VerifyInvalid(reason="timestamp_too_far_in_future")

    body_bytes = raw_body if isinstance(raw_body, bytes) else raw_body.encode("utf-8")
    signed = f"{timestamp}.".encode("utf-8") + body_bytes
    expected_hex = hmac.new(secret.encode("utf-8"), signed, "sha256").hexdigest()

    if not hmac.compare_digest(provided_hex.lower(), expected_hex.lower()):
        return VerifyInvalid(reason="signature_mismatch")
    return VerifyValid()


def sign_webhook_delivery(
    secret: str,
    timestamp: int,
    raw_body: bytes | str,
) -> tuple[str, str]:
    """Compute the canonical webhook signature for a payload.

    Returns ``(signature_header, timestamp_header)`` — ``sha256=<hex>`` and the
    timestamp — useful when implementing a host or generating test fixtures.
    See :func:`webhook_delivery_headers` for the full header set.
    """

    body_bytes = raw_body if isinstance(raw_body, bytes) else raw_body.encode("utf-8")
    signed = f"{timestamp}.".encode("utf-8") + body_bytes
    hex_digest = hmac.new(secret.encode("utf-8"), signed, "sha256").hexdigest()
    return f"sha256={hex_digest}", str(timestamp)


def webhook_delivery_headers(
    secret: str,
    timestamp: int,
    raw_body: bytes | str,
) -> dict[str, str]:
    """The signature headers a v2 host sends on a delivery: the ``OpenWOP-*``
    family plus the ``X-openwop-*`` twins a dual-major host emits through the
    overlap (webhooks.md §Dual emission). ``OpenWOP-Webhook-Id`` and
    ``OpenWOP-Event-Type`` are subscription-specific and added by the host."""
    sig, ts = sign_webhook_delivery(secret, timestamp, raw_body)
    return {
        "OpenWOP-Signature": sig,
        "OpenWOP-Timestamp": ts,
        "OpenWOP-Signature-Algorithm": "v1",
        "X-openwop-Signature": sig,
        "X-openwop-Timestamp": ts,
        "X-openwop-Signature-Algorithm": "v1",
    }


def parse_signature_value(value: str) -> str | None:
    """``sha256=<hex>`` -> ``<hex>``; anything else (including the removed
    ``v1=<hex>`` form) -> None."""
    if not value.startswith(_SIGNATURE_VALUE_PREFIX):
        return None
    hex_part = value[len(_SIGNATURE_VALUE_PREFIX):]
    return hex_part if _HEX_RE.fullmatch(hex_part) else None


#: Receiver preference order: the v2 ``OpenWOP-*`` family, then the
#: ``X-openwop-*`` family accepted through the overlap. Each row is
#: ``(signature_header, timestamp_header, algorithm_header, family)``.
#: Lookups are case-insensitive.
WEBHOOK_HEADER_FAMILIES: tuple[tuple[str, str, str, str], ...] = (
    ("OpenWOP-Signature", "OpenWOP-Timestamp", "OpenWOP-Signature-Algorithm", "openwop"),
    ("X-openwop-Signature", "X-openwop-Timestamp", "X-openwop-Signature-Algorithm", "x-openwop"),
)


@dataclass(frozen=True)
class WebhookHeaderRead:
    signature: str
    timestamp: str
    family: Literal["openwop", "x-openwop"]
    #: The ``*-Signature-Algorithm`` value when the delivery carried one.
    algorithm: str | None = None


def read_webhook_headers(headers: "Mapping[str, str]") -> WebhookHeaderRead | None:
    """Return the first complete header family's values, or None. ``headers`` is
    any mapping (case-insensitive or not)."""
    lowered = {k.lower(): v for k, v in headers.items()}
    for sig_name, ts_name, alg_name, family in WEBHOOK_HEADER_FAMILIES:
        sig = lowered.get(sig_name.lower())
        ts = lowered.get(ts_name.lower())
        if sig is not None and ts is not None:
            fam: Literal["openwop", "x-openwop"] = "openwop" if family == "openwop" else "x-openwop"
            return WebhookHeaderRead(
                signature=sig,
                timestamp=ts,
                family=fam,
                algorithm=lowered.get(alg_name.lower()),
            )
    return None
