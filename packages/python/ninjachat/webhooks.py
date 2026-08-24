"""Outbound-webhook signature verification.

NinjaChat signs every delivery with::

    X-Ninja-Signature: hex( HMAC-SHA256( secret, f"{timestamp}.{raw_body}" ) )
    X-Ninja-Timestamp: unix seconds at send time

Verify with the RAW request body bytes exactly as received — re-serializing the
parsed JSON changes the bytes and breaks the signature.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from typing import Optional, Union


def verify_webhook_signature(
    raw_body: Union[str, bytes],
    signature: str,
    timestamp: Union[str, int],
    secret: str,
    *,
    tolerance_seconds: Optional[int] = 300,
) -> bool:
    """Return True iff ``signature`` is a valid signature of ``raw_body``.

    Args:
        raw_body: The raw request body (str or bytes), byte-exact.
        signature: The ``X-Ninja-Signature`` header value (hex).
        timestamp: The ``X-Ninja-Timestamp`` header value (unix seconds).
        secret: The endpoint's signing secret (returned once at creation).
        tolerance_seconds: Reject deliveries whose timestamp is further than
            this many seconds from now (replay protection). Default 300;
            pass ``None`` to skip the check.
    """
    try:
        ts = int(timestamp)
    except (TypeError, ValueError):
        return False

    if tolerance_seconds is not None and abs(time.time() - ts) > tolerance_seconds:
        return False

    body_bytes = raw_body.encode("utf-8") if isinstance(raw_body, str) else raw_body
    signed_payload = f"{ts}.".encode("utf-8") + body_bytes
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())
