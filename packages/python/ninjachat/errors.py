"""Typed errors for the NinjaChat SDK.

The API returns an OpenAI-compatible envelope::

    {"error": {"message", "type", "code", "param"}}
"""

from __future__ import annotations

from typing import Any, Dict, Optional


class NinjaChatError(Exception):
    """Raised for every non-2xx API response, network failure, or SDK-level failure.

    Attributes:
        status: HTTP status (0 for network/timeout errors raised before a response).
        code: Machine-readable code (e.g. ``insufficient_credits``, ``rate_limit_exceeded``).
        request_id: The X-Request-ID / request_id, when the server produced one.
        type: OpenAI-style error type (e.g. ``invalid_request_error``).
        param: The offending parameter, when reported.
        body: The full parsed error body (extra fields: balance, retry_after, ...).
    """

    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        code: str = "unknown",
        request_id: Optional[str] = None,
        type: Optional[str] = None,
        param: Optional[str] = None,
        body: Optional[Dict[str, Any]] = None,
        retryable: Optional[bool] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.request_id = request_id
        self.type = type
        self.param = param
        self.body = body or {}
        self.retryable = retryable

    @classmethod
    def from_response(
        cls, status: int, body: Any, header_request_id: Optional[str] = None
    ) -> "NinjaChatError":
        b: Dict[str, Any] = body if isinstance(body, dict) else {}
        nested = b.get("error") if isinstance(b.get("error"), dict) else b
        message = nested.get("message") or f"HTTP {status}"
        code = nested.get("code") or f"http_{status}"
        return cls(
            str(message),
            status=status,
            code=str(code),
            request_id=header_request_id or b.get("request_id"),
            type=nested.get("type"),
            param=nested.get("param"),
            body=b,
            retryable=nested.get("retryable", b.get("retryable")),
        )

    def __repr__(self) -> str:  # pragma: no cover - cosmetic
        return (
            f"NinjaChatError(status={self.status}, code={self.code!r}, "
            f"request_id={self.request_id!r}, message={self.message!r})"
        )
