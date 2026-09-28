"""Tenant-bound id wire form (``spec/v2/core/identity.md`` §5 "Wire form").

A tenant-bound id (``runId``, ``interruptId``, ``subscriptionId``,
``deliveryId``, ``effectId``) is ``<tenant>/<opaque>`` in bodies but travels
as ONE path segment, projected: every UTF-8 byte outside ``[A-Za-z0-9._-]``
becomes ``~`` plus two uppercase hex digits — ``acme/r-9f3c`` →
``acme~2Fr-9f3c``. A host emits the projected form in links and accepts both
it and the legacy percent-encoded ``acme%2Fr-9f3c``.
"""

from __future__ import annotations

import re

_PASSTHROUGH = frozenset(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-")
_ESCAPE = re.compile(r"[~%]([0-9A-Fa-f]{2})")
_ESCAPED_SLASH = re.compile(r"[~%]2F", re.IGNORECASE)


def unproject_id(wire: str) -> str:
    """Decode a wire-form id to its bound form, accepting both the projected
    (``~2F``) and the percent-encoded (``%2F``) escape. Characters outside an
    escape pass through as their UTF-8 bytes."""
    out = bytearray()
    pos = 0
    for m in _ESCAPE.finditer(wire):
        out += wire[pos : m.start()].encode("utf-8")
        out.append(int(m.group(1), 16))
        pos = m.end()
    out += wire[pos:].encode("utf-8")
    return out.decode("utf-8")


def project_id(id_: str) -> str:
    """Project a tenant-bound id to its one-segment wire form. An id that is
    already a wire form (no ``/``, but an escaped ``/`` in either form) is
    decoded first, so passing a link's segment back in never double-escapes."""
    bound = unproject_id(id_) if "/" not in id_ and _ESCAPED_SLASH.search(id_) else id_
    return "".join(chr(b) if b in _PASSTHROUGH else f"~{b:02X}" for b in bound.encode("utf-8"))
