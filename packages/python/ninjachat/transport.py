"""Shared wire policy for synchronous and asynchronous clients."""
from __future__ import annotations

import json
import math
import random
import time
from email.utils import parsedate_to_datetime
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

from .errors import NinjaChatError


def normalize_base_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        if not parsed.netloc or not hostname:
            raise ValueError("missing host")
    except ValueError as exc:
        raise NinjaChatError("base_url must be an absolute URL.", code="invalid_base_url") from exc
    local = hostname.lower() in {"localhost", "127.0.0.1", "::1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise NinjaChatError("base_url must use HTTPS, except on localhost.", code="insecure_base_url")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise NinjaChatError("base_url cannot contain credentials, a query, or a fragment.", code="invalid_base_url")
    return value.rstrip("/")


def validate_options(retries: int, timeout: float) -> None:
    if isinstance(retries, bool) or not isinstance(retries, int) or retries < 0 or not math.isfinite(timeout) or timeout <= 0:
        raise NinjaChatError("max_retries must be a nonnegative integer and timeout must be positive.", code="invalid_options")


def retry_delay(headers: Any, attempt: int) -> float:
    value = headers.get("retry-after") if headers is not None else None
    if isinstance(value, str):
        try:
            delay = float(value)
        except ValueError:
            try:
                delay = parsedate_to_datetime(value).timestamp() - time.time()
            except (ValueError, TypeError, OverflowError):
                delay = float("nan")
        if math.isfinite(delay):
            return min(30.0, max(0.0, delay))
    return min(30.0, 0.5 * 2**attempt * (1 + random.random()))


def decode_event(data: str, status: int, request_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    try:
        event = json.loads(data)
    except ValueError as cause:
        raise NinjaChatError("Stream contained invalid JSON.", code="invalid_stream", request_id=request_id) from cause
    if not isinstance(event, dict):
        raise NinjaChatError("Stream event must be a JSON object.", code="invalid_stream", request_id=request_id)
    nested = event.get("error") if isinstance(event.get("error"), dict) else None
    if nested is not None or event.get("type") == "error" or (isinstance(event.get("error"), str) and event.get("type") not in {"model_error", "result"}):
        error = nested or event
        raise NinjaChatError(str(error.get("message") or event.get("error") or "Stream failed."), status=status,
                            code=str(error.get("code") or "stream_error"), type=error.get("type"),
                            request_id=event.get("request_id") or request_id, body=event)
    return event


class SSEDecoder:
    """Collect data lines until the SSE blank-line boundary (including multiline JSON)."""
    def __init__(self, kind: Optional[str] = None) -> None:
        self.lines: list[str] = []
        self.kind = kind
        self.completed = kind is None

    def observe(self, event: Dict[str, Any]) -> None:
        if self.kind == "messages" and event.get("type") == "message_stop":
            self.completed = True
        if self.kind == "responses" and event.get("type") in {"response.completed", "response.incomplete", "response.failed"}:
            self.completed = True
        if self.kind == "chat" and any(choice.get("finish_reason") is not None for choice in event.get("choices", [])):
            self.completed = True

    def feed(self, line: str) -> Optional[str]:
        if line.startswith("data:"):
            self.lines.append(line[5:].removeprefix(" "))
        elif not line and self.lines:
            data = "\n".join(self.lines)
            self.lines.clear()
            return data
        return None

    def finish(self) -> None:
        if self.lines:
            raise NinjaChatError("Stream ended inside an event.", code="stream_truncated")
        if not self.completed:
            raise NinjaChatError("Stream ended without a terminal event.", code="stream_truncated")
