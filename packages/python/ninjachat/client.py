"""Synchronous, typed NinjaChat API v1 client."""

from __future__ import annotations

import json as _json
import random
import time
import uuid
from typing import Any, Dict, Iterator, List, Optional, Union
from urllib.parse import quote

import requests as http_requests
from typing_extensions import Unpack

from .errors import NinjaChatError
from .types import ChatCompletionParams, ImageGenerateParams, ResponseCreateParams, SearchParams, VideoGenerateParams

DEFAULT_BASE_URL = "https://www.ninjachat.ai/api/v1"
DEFAULT_MAX_RETRIES = 2
MAX_BACKOFF_SECONDS = 30.0
RETRIABLE_STATUSES = {429, 500, 502, 503, 504}


def _retry_delay(response: Optional[http_requests.Response], attempt: int) -> float:
    if response is not None:
        retry_after = response.headers.get("retry-after")
        if retry_after:
            try:
                return min(max(float(retry_after), 0.0), MAX_BACKOFF_SECONDS)
            except ValueError:
                pass
    base = 0.5 * (2**attempt)
    return min(base + random.random() * base, MAX_BACKOFF_SECONDS)


def _iterate_sse(response: http_requests.Response) -> Iterator[Dict[str, Any]]:
    try:
        for raw in response.iter_lines(decode_unicode=True):
            if not raw or not raw.startswith("data:"):
                continue
            data = raw[5:].lstrip()
            if data == "[DONE]":
                return
            try:
                event = _json.loads(data)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            nested = event.get("error") if isinstance(event.get("error"), dict) else None
            if nested is not None or event.get("type") == "error":
                error = nested or event
                raise NinjaChatError(
                    str(error.get("message") or "Stream failed."),
                    status=response.status_code,
                    code=str(error.get("code") or "stream_error"),
                    type=error.get("type"),
                    body=event,
                )
            yield event
    finally:
        response.close()


class NinjaChat:
    """Client for the canonical NinjaChat API v1 surface."""

    def __init__(
        self,
        api_key: str,
        base_url: str = DEFAULT_BASE_URL,
        *,
        max_retries: int = DEFAULT_MAX_RETRIES,
        timeout: float = 120.0,
        session: Optional[http_requests.Session] = None,
    ) -> None:
        if not api_key:
            raise NinjaChatError(
                "Missing api_key. Create one at https://www.ninjachat.ai/developers/keys",
                code="missing_api_key",
            )
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.max_retries = max_retries
        self.timeout = timeout
        self._session = session or http_requests.Session()
        self.responses = _Responses(self)
        self.chat = _Chat(self)
        self.models = _Models(self)
        self.images = _Images(self)
        self.videos = _Videos(self)
        self.search = _Search(self)
        self.requests = _Requests(self)
        self.webhooks = _Webhooks(self)

    def balance(self) -> Dict[str, Any]:
        return self._request("GET", "/balance", idempotent_method=True)

    def usage(self, period: str = "7d") -> Dict[str, Any]:
        return self._request("GET", "/usage", params={"period": period}, idempotent_method=True)

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, str]] = None,
        supports_idempotency: bool = False,
        idempotent_method: bool = False,
        idempotency_key: Optional[str] = None,
        max_retries: Optional[int] = None,
        stream: bool = False,
        timeout: Optional[float] = None,
    ) -> Any:
        retries = self.max_retries if max_retries is None else max_retries
        if supports_idempotency and idempotency_key is None and retries > 0:
            idempotency_key = str(uuid.uuid4())
        retriable = idempotent_method or idempotency_key is not None
        attempts = retries + 1 if retriable else 1
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Accept": "text/event-stream" if stream else "application/json",
        }
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        url = self.base_url + path
        last_error: Optional[NinjaChatError] = None
        for attempt in range(attempts):
            try:
                response = self._session.request(
                    method, url, json=json, params=params, headers=headers,
                    stream=stream, timeout=timeout or self.timeout,
                )
            except http_requests.RequestException as exc:
                last_error = NinjaChatError(f"Network error: {exc}", code="network_error")
                if attempt == attempts - 1:
                    raise last_error from exc
                time.sleep(_retry_delay(None, attempt))
                continue
            if response.ok:
                return response if stream else response.json()
            try:
                body = response.json()
            except ValueError:
                body = None
            error = NinjaChatError.from_response(response.status_code, body, response.headers.get("x-request-id"))
            last_error = error
            in_flight = response.status_code == 409 and error.code == "request_in_flight" and idempotency_key is not None
            if not (retriable and attempt < attempts - 1 and (response.status_code in RETRIABLE_STATUSES or in_flight)):
                raise error
            time.sleep(_retry_delay(response, attempt))
        raise last_error or NinjaChatError("Request failed.")


class _Responses:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
        **params: Unpack[ResponseCreateParams],
    ) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        response = self._client._request(
            "POST", "/responses", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries,
            stream=bool(params.get("stream")),
        )
        return _iterate_sse(response) if params.get("stream") else response


class _Chat:
    def __init__(self, client: NinjaChat) -> None:
        self.completions = _ChatCompletions(client)


class _ChatCompletions:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
        **params: Unpack[ChatCompletionParams],
    ) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        response = self._client._request(
            "POST", "/chat/completions", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries,
            stream=bool(params.get("stream")),
        )
        return _iterate_sse(response) if params.get("stream") else response


class _Models:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def list(self) -> Dict[str, Any]:
        return self._client._request("GET", "/models", idempotent_method=True)

    def retrieve(self, model_id: str) -> Dict[str, Any]:
        return self._client._request("GET", f"/models/{quote(model_id, safe='')}", idempotent_method=True)


class _Images:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def generate(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
        **params: Unpack[ImageGenerateParams],
    ) -> Dict[str, Any]:
        return self._client._request(
            "POST", "/images/generations", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=300.0,
        )


class _Videos:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def generate(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
        **params: Unpack[VideoGenerateParams],
    ) -> Dict[str, Any]:
        return self._client._request(
            "POST", "/videos", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=300.0,
        )

    def retrieve(self, video_id: str) -> Dict[str, Any]:
        return self._client._request("GET", f"/videos/{quote(video_id, safe='')}", idempotent_method=True)

    def wait_for(self, video_id: str, *, poll_seconds: float = 5.0, timeout_seconds: float = 600.0) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        while True:
            result = self.retrieve(video_id)
            if result.get("status") == "completed":
                return result
            if result.get("status") == "failed":
                raise NinjaChatError(str(result.get("error") or "Video generation failed."), status=200, code="generation_failed", request_id=video_id, body=result)
            if time.monotonic() + poll_seconds > deadline:
                raise NinjaChatError(f"Timed out waiting for video job {video_id}.", code="poll_timeout", request_id=video_id)
            time.sleep(poll_seconds)


class _Search:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def query(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
        **params: Unpack[SearchParams],
    ) -> Dict[str, Any]:
        return self._client._request(
            "POST", "/search", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries,
        )


class _Requests:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def get(self, request_id: str) -> Dict[str, Any]:
        return self._client._request("GET", f"/requests/{quote(request_id, safe='')}", idempotent_method=True)


class _Webhooks:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def list(self) -> List[Dict[str, Any]]:
        return self._client._request("GET", "/webhooks", idempotent_method=True)["endpoints"]

    def create(self, *, url: str, events: Optional[List[str]] = None) -> Dict[str, Any]:
        body: Dict[str, Any] = {"url": url}
        if events is not None:
            body["events"] = events
        return self._client._request("POST", "/webhooks", json=body, max_retries=0)

    def delete(self, endpoint_id: str) -> Dict[str, Any]:
        return self._client._request("DELETE", "/webhooks", params={"id": endpoint_id}, idempotent_method=True)

    def list_deliveries(self, *, endpoint_id: Optional[str] = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        params: Dict[str, str] = {}
        if endpoint_id is not None:
            params["endpoint_id"] = endpoint_id
        if limit is not None:
            params["limit"] = str(limit)
        return self._client._request("GET", "/webhooks/deliveries", params=params, idempotent_method=True)["deliveries"]

    def test(self, endpoint_id: str) -> Dict[str, Any]:
        return self._client._request("POST", "/webhooks/test", json={"endpoint_id": endpoint_id}, max_retries=0)
