"""Synchronous, typed NinjaChat API v1 client."""

from __future__ import annotations

import json as _json
import time
import uuid
from typing import Any, Dict, Iterator, List, Optional, Union
from urllib.parse import quote

import requests as http_requests

try:
    from typing import Unpack
except ImportError:  # Python 3.9-3.10
    from typing_extensions import Unpack

from .errors import NinjaChatError
from .management import Management
from .transport import normalize_base_url, validate_options, retry_delay, decode_event, SSEDecoder
from .types import (
    RerankCreateParams, SpeechCreateParams,
    MessageCreateParams,
    BatchParams,
    ChatCompletionParams,
    CompareParams,
    EstimateParams,
    EmbeddingCreateParams,
    ImageGenerateParams,
    PipelineCreateParams,
    PresetChatCompletionParams,
    ResponseCreateParams,
    SearchParams,
    VideoGenerateParams,
)

DEFAULT_BASE_URL = "https://www.ninjachat.ai/api/v1"
DEFAULT_MAX_RETRIES = 2
MAX_BACKOFF_SECONDS = 30.0
RETRIABLE_STATUSES = {429, 500, 502, 503, 504}


def _retry_delay(response: Optional[http_requests.Response], attempt: int) -> float:
    return retry_delay(response.headers if response is not None else None, attempt)


def _sse_events(response: http_requests.Response, kind: Optional[str] = None) -> Iterator[Dict[str, Any]]:
    decoder = SSEDecoder(kind)
    try:
        for raw in response.iter_lines(decode_unicode=True):
            line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
            data = decoder.feed(line)
            if data is None:
                continue
            if data == "[DONE]":
                decoder.finish()
                return
            event = decode_event(data, response.status_code, response.headers.get("x-request-id"))
            if event is not None:
                decoder.observe(event)
                yield event
        decoder.finish()
    finally:
        response.close()


class Stream:
    """Closeable SSE iterator, including before its first event is requested."""
    def __init__(self, response: http_requests.Response, kind: Optional[str] = None) -> None:
        self._response = response
        self._events = _sse_events(response, kind)
        self._closed = False

    def __iter__(self) -> Stream:
        return self

    def __next__(self) -> Dict[str, Any]:
        if self._closed:
            raise StopIteration
        try:
            return next(self._events)
        except BaseException:
            self.close()
            raise

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            try:
                self._events.close()
            finally:
                self._response.close()

    def __enter__(self) -> Stream:
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()


def _iterate_sse(response: http_requests.Response, kind: Optional[str] = None) -> Stream:
    return Stream(response, kind)


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
        self.base_url = normalize_base_url(base_url)
        validate_options(max_retries, timeout)
        self._owns_session = session is None
        self.max_retries = max_retries
        self.timeout = timeout
        self._session = session or http_requests.Session()
        self.responses = _Responses(self)
        self.chat = _Chat(self)
        self.messages = _Messages(self)
        self.sessions = _Sessions(self)
        self.presets = _Presets(self)
        self.models = _Models(self)
        self.pricing = _Pricing(self)
        self.images = _Images(self)
        self.videos = _Videos(self)
        self.search = _Search(self)
        self.embeddings = _Embeddings(self)
        self.rerank = _Rerank(self)
        self.audio = _Audio(self)
        self.compare = _Compare(self)
        self.batch = _Batch(self)
        self.estimate = _Estimate(self)
        self.pipelines = _Pipelines(self)
        self.requests = _Requests(self)
        self.webhooks = _Webhooks(self)
        self.management = Management(self)
        self.battles = _Battles(self)

    def close(self) -> None:
        if self._owns_session:
            self._session.close()

    def __enter__(self) -> NinjaChat:
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    def balance(self) -> Dict[str, Any]:
        return self._request("GET", "/balance", idempotent_method=True)

    def network(self) -> Dict[str, Any]:
        return self._request("GET", "/network", idempotent_method=True)

    def usage(self, period: str = "7d") -> Dict[str, Any]:
        return self._request("GET", "/usage", params={"period": period}, idempotent_method=True)

    def health(self) -> Dict[str, Any]:
        """Return the public measured gateway health and resilience snapshot."""
        return self._request("GET", "/health", idempotent_method=True)

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
        response_text: bool = False,
        response_bytes: bool = False,
    ) -> Any:
        retries = self.max_retries if max_retries is None else max_retries
        if supports_idempotency and idempotency_key is None and retries > 0:
            idempotency_key = str(uuid.uuid4())
        validate_options(retries, timeout if timeout is not None else self.timeout)
        retriable = idempotent_method or (supports_idempotency and idempotency_key is not None)
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
                    stream=stream, timeout=self.timeout if timeout is None else timeout,
                )
            except http_requests.RequestException as exc:
                last_error = NinjaChatError(f"Network error: {exc}", code="network_error")
                if attempt == attempts - 1:
                    raise last_error from exc
                time.sleep(_retry_delay(None, attempt))
                continue
            if response.ok:
                if stream:
                    return response
                try:
                    if response_bytes:
                        return response.content
                    if response_text:
                        return response.text
                    return response.json()
                finally:
                    response.close()
            try:
                body = response.json()
            except ValueError:
                body = None
            error = NinjaChatError.from_response(response.status_code, body, response.headers.get("x-request-id"))
            response.close()
            last_error = error
            in_flight = response.status_code == 409 and error.code == "request_in_flight" and idempotency_key is not None
            if not (retriable and error.retryable is not False and attempt < attempts - 1 and (response.status_code in RETRIABLE_STATUSES or in_flight)):
                raise error
            time.sleep(_retry_delay(response, attempt))
        raise last_error or NinjaChatError("Request failed.")


class _Rerank:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None, **params: Unpack[RerankCreateParams]) -> Dict[str, Any]:
        return self._client._request("POST", "/rerank", json=dict(params), supports_idempotency=True, idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout)


class _Audio:
    def __init__(self, client: NinjaChat) -> None:
        self.speech = _Speech(client)


class _Speech:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None, **params: Unpack[SpeechCreateParams]) -> bytes:
        return self._client._request("POST", "/audio/speech", json=dict(params), supports_idempotency=True, response_bytes=True, idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout)


class _Messages:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
               **params: Unpack["MessageCreateParams"]) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        response = self._client._request("POST", "/messages", json=dict(params), supports_idempotency=True,
                    idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout, stream=bool(params.get("stream")))
        return _iterate_sse(response, "messages") if params.get("stream") else response


class _Sessions:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(self, id: Optional[str] = None) -> Dict[str, Any]:
        return self._client._request("POST", "/sessions", json={} if id is None else {"session_id": id})

    def retrieve(self, id: str) -> Dict[str, Any]:
        return self._client._request("GET", f"/sessions/{quote(id, safe='')}", idempotent_method=True)

    def delete(self, id: str) -> Dict[str, Any]:
        return self._client._request("DELETE", f"/sessions/{quote(id, safe='')}")

    def export(self, id: str, format: str = "json") -> Union[Dict[str, Any], str]:
        if format not in {"json", "markdown"}:
            raise NinjaChatError("format must be json or markdown.", code="invalid_options")
        return self._client._request("GET", f"/sessions/{quote(id, safe='')}/export", params={"format": format}, idempotent_method=True, response_text=format == "markdown")


class _Battles:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def list(self, type: str = "leaderboard") -> Dict[str, Any]:
        return self._client._request("GET", "/battles", params={"type": type}, idempotent_method=True)

    def create(self, *, ranked_models: List[str], compare_request_id: str, prompt_snippet: Optional[str] = None,
               rank_by: Optional[str] = None, category: Optional[str] = None) -> Dict[str, Any]:
        body = {key: value for key, value in dict(ranked_models=ranked_models, compare_request_id=compare_request_id,
                prompt_snippet=prompt_snippet, rank_by=rank_by, category=category).items() if value is not None}
        return self._client._request("POST", "/battles", json=body, max_retries=0)


class _Responses:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[ResponseCreateParams],
    ) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        response = self._client._request(
            "POST", "/responses", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout,
            stream=bool(params.get("stream")),
        )
        return _iterate_sse(response, "responses") if params.get("stream") else response


class _Chat:
    def __init__(self, client: NinjaChat) -> None:
        self.completions = _ChatCompletions(client)


class _ChatCompletions:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[ChatCompletionParams],
    ) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        response = self._client._request(
            "POST", "/chat/completions", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout,
            stream=bool(params.get("stream")),
        )
        return _iterate_sse(response, "chat") if params.get("stream") else response


class _Presets:
    """Saved model + routing bundles applied server-side, so config ships without a redeploy."""

    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def run(
        self, slug: str, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[PresetChatCompletionParams],
    ) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        """Run a preset. Same body as chat.completions.create, but model/models are optional."""
        response = self._client._request(
            "POST", f"/presets/{quote(slug, safe='')}/chat/completions", json=dict(params),
            supports_idempotency=True, idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout,
            stream=bool(params.get("stream")),
        )
        return _iterate_sse(response, "chat") if params.get("stream") else response


class _Models:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def list(self) -> Dict[str, Any]:
        return self._client._request("GET", "/models", idempotent_method=True)

    def retrieve(self, model_id: str) -> Dict[str, Any]:
        return self._client._request("GET", f"/models/{quote(model_id, safe='')}", idempotent_method=True)


class _Pricing:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def retrieve(self) -> Dict[str, Any]:
        """The machine-readable rate sheet billing itself uses. Public; the key is ignored."""
        return self._client._request("GET", "/pricing", idempotent_method=True)


class _Images:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def generate(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[ImageGenerateParams],
    ) -> Dict[str, Any]:
        return self._client._request(
            "POST", "/images/generations", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=300.0 if timeout is None else timeout,
        )


class _Videos:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def generate(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[VideoGenerateParams],
    ) -> Dict[str, Any]:
        return self._client._request(
            "POST", "/videos", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=300.0 if timeout is None else timeout,
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


class _Embeddings:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, **params: Unpack[EmbeddingCreateParams]) -> Dict[str, Any]:
        return self._client._request("POST", "/embeddings", json=dict(params), supports_idempotency=True, idempotency_key=idempotency_key, max_retries=max_retries)


class _Search:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def query(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[SearchParams],
    ) -> Dict[str, Any]:
        return self._client._request(
            "POST", "/search", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout,
        )


class _Compare:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[CompareParams],
    ) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        """Run one prompt across several concrete models, ranked by quality, speed and cost.

        A model that fails costs nothing and arrives in ``failed`` (streaming: a
        ``model_error`` event) — the comparison itself still succeeds.
        """
        response = self._client._request(
            "POST", "/compare", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout,
            stream=bool(params.get("stream")),
        )
        return _iterate_sse(response) if params.get("stream") else response


class _Batch:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[BatchParams],
    ) -> Union[Dict[str, Any], Iterator[Dict[str, Any]]]:
        """Fan up to 20 independent chat requests out in parallel under one hold.

        Each job keeps its own fallback chain, so ``results[i]["model"]`` is the
        model that actually served.
        """
        response = self._client._request(
            "POST", "/batch", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=300.0 if timeout is None else timeout,
            stream=bool(params.get("stream")),
        )
        return _iterate_sse(response) if params.get("stream") else response


class _Estimate:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(self, **params: Unpack[EstimateParams]) -> Dict[str, Any]:
        """Price a request before running it, from the engine that settles real traffic.

        Public endpoint, nothing is deducted, and the call has no side effects —
        so it retries without an idempotency key.
        """
        return self._client._request("POST", "/estimate", json=dict(params), idempotent_method=True)


class _Pipelines:
    def __init__(self, client: NinjaChat) -> None:
        self._client = client

    def create(
        self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
        **params: Unpack[PipelineCreateParams],
    ) -> Dict[str, Any]:
        """Submit up to 5 chat/image/video steps chained by {{stepId.output|url}}.

        The full price is reserved up front; unexecuted steps refund
        automatically. Returns immediately with the id to poll.
        """
        return self._client._request(
            "POST", "/pipelines", json=dict(params), supports_idempotency=True,
            idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout,
        )

    def retrieve(self, pipeline_id: str) -> Dict[str, Any]:
        return self._client._request("GET", f"/pipelines/{quote(pipeline_id, safe='')}", idempotent_method=True)

    def wait_for(self, pipeline_id: str, *, poll_seconds: float = 5.0, timeout_seconds: float = 600.0) -> Dict[str, Any]:
        deadline = time.monotonic() + timeout_seconds
        while True:
            state = self.retrieve(pipeline_id)
            if state.get("status") == "completed":
                return state
            if state.get("status") == "failed":
                error = state.get("error") or {}
                message = (
                    f"Pipeline step \"{error.get('step_id')}\" failed: {error.get('message')}"
                    if error
                    else "Pipeline failed (unexecuted steps refunded)."
                )
                raise NinjaChatError(message, status=200, code="pipeline_failed", request_id=pipeline_id, body=state)
            if time.monotonic() + poll_seconds > deadline:
                raise NinjaChatError(f"Timed out waiting for pipeline {pipeline_id}.", code="poll_timeout", request_id=pipeline_id)
            time.sleep(poll_seconds)


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
