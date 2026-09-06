"""Native asyncio client. Shares request schemas and wire policy with the sync client."""
from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any, AsyncIterator, Awaitable, Dict, List, Optional, TypeVar, Union
from urllib.parse import quote

import httpx

try:
    from typing import Unpack
except ImportError:
    from typing_extensions import Unpack

from .client import DEFAULT_BASE_URL, RETRIABLE_STATUSES
from .errors import NinjaChatError
from .async_management import AsyncManagement
from .transport import SSEDecoder, decode_event, normalize_base_url, retry_delay, validate_options
from .types import (
    RerankCreateParams, SpeechCreateParams,
    MessageCreateParams,
    BatchParams, ChatCompletionParams, CompareParams, EmbeddingCreateParams, EstimateParams,
    ImageGenerateParams, PipelineCreateParams, PresetChatCompletionParams,
    ResponseCreateParams, SearchParams, VideoGenerateParams,
)


_T = TypeVar("_T")


async def _with_timeout(awaitable: Awaitable[_T], seconds: float) -> _T:
    # asyncio.wait_for on Python 3.10 can swallow caller cancellation when
    # the inner task completes concurrently. wait preserves that cancellation.
    task = asyncio.ensure_future(awaitable)
    try:
        done, _ = await asyncio.wait({task}, timeout=seconds)
        if not done:
            raise asyncio.TimeoutError()
        return task.result()
    except BaseException:
        task.cancel()
        result = (await asyncio.gather(task, return_exceptions=True))[0]
        # Headers may have arrived just as the caller cancelled. No caller
        # received this response, so this helper owns closing its connection.
        if isinstance(result, httpx.Response):
            await result.aclose()
        raise


async def _iterate_sse(response: httpx.Response, kind: Optional[str] = None) -> AsyncIterator[Dict[str, Any]]:
    decoder = SSEDecoder(kind)
    try:
        async for line in response.aiter_lines():
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
        await response.aclose()


class AsyncStream:
    """Closable stream with a total deadline, including when the caller pauses reading."""
    def __init__(self, response: httpx.Response, deadline: float, kind: Optional[str] = None) -> None:
        self._response = response
        self._events = _iterate_sse(response, kind)
        self._deadline = deadline
        self._closed = False
        self._pending: Optional[asyncio.Task] = None

    def __aiter__(self) -> AsyncStream:
        return self

    async def __anext__(self) -> Dict[str, Any]:
        if self._closed:
            raise StopAsyncIteration
        if self._pending is not None:
            raise RuntimeError("A stream supports only one pending read at a time.")
        try:
            remaining = self._deadline - time.monotonic()
            if remaining <= 0:
                raise asyncio.TimeoutError()
            self._pending = asyncio.create_task(anext(self._events))
            return await _with_timeout(self._pending, remaining)
        except asyncio.TimeoutError as cause:
            await self.aclose()
            raise NinjaChatError("Stream timed out.", code="timeout") from cause
        except BaseException:
            await self.aclose()
            raise
        finally:
            self._pending = None

    async def aclose(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._pending is not None and not self._pending.done():
            self._pending.cancel()
            await asyncio.gather(self._pending, return_exceptions=True)
        try:
            await self._events.aclose()
        finally:
            await self._response.aclose()

    async def __aenter__(self) -> AsyncStream:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.aclose()


class AsyncNinjaChat:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, *, max_retries: int = 2,
                 timeout: float = 120.0, http_client: Optional[httpx.AsyncClient] = None) -> None:
        if not api_key:
            raise NinjaChatError("Missing api_key.", code="missing_api_key")
        self.base_url = normalize_base_url(base_url)
        validate_options(max_retries, timeout)
        self._api_key = api_key
        self.max_retries = max_retries
        self.timeout = timeout
        self._owns_client = http_client is None
        self._http = http_client or httpx.AsyncClient()
        self.chat = _Chat(self)
        self.messages = _Messages(self)
        self.sessions = _Sessions(self)
        self.responses = _Responses(self)
        self.presets = _Presets(self)
        self.models = _Models(self)
        self.pricing = _Pricing(self)
        self.images = _Images(self)
        self.videos = _Videos(self)
        self.embeddings = _Embeddings(self)
        self.rerank = _Rerank(self)
        self.audio = _Audio(self)
        self.search = _Search(self)
        self.compare = _Compare(self)
        self.batch = _Batch(self)
        self.estimate = _Estimate(self)
        self.pipelines = _Pipelines(self)
        self.requests = _Requests(self)
        self.webhooks = _Webhooks(self)
        self.management = AsyncManagement(self)
        self.battles = _Battles(self)

    async def close(self) -> None:
        if self._owns_client:
            await self._http.aclose()

    async def __aenter__(self) -> AsyncNinjaChat:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def balance(self) -> Dict[str, Any]:
        return await self._request("GET", "/balance", idempotent=True)

    async def usage(self, period: str = "7d") -> Dict[str, Any]:
        return await self._request("GET", "/usage", query={"period": period}, idempotent=True)

    async def health(self) -> Dict[str, Any]:
        return await self._request("GET", "/health", idempotent=True)

    async def network(self) -> Dict[str, Any]:
        return await self._request("GET", "/network", idempotent=True)

    async def _request(self, method: str, path: str, *, body: Optional[Dict[str, Any]] = None,
                       query: Optional[Dict[str, Any]] = None, billed: bool = False, idempotent: bool = False,
                       idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                       timeout: Optional[float] = None, stream: bool = False, response_text: bool = False, response_bytes: bool = False) -> Any:
        retries = self.max_retries if max_retries is None else max_retries
        deadline = self.timeout if timeout is None else timeout
        validate_options(retries, deadline)
        if billed and not idempotency_key and retries:
            idempotency_key = str(uuid.uuid4())
        safe = idempotent or (billed and bool(idempotency_key))
        attempts = retries + 1 if safe else 1
        headers = {"Authorization": f"Bearer {self._api_key}", "Accept": "text/event-stream" if stream else "application/json"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        for attempt in range(attempts):
            started = time.monotonic()
            response = None
            try:
                request = self._http.build_request(method, self.base_url + path, json=body, params=query,
                                                   headers=headers, timeout=deadline)
                # httpx timeouts bound individual network operations, not a
                # response whose body keeps trickling. Own the streamed body so
                # one wall-clock deadline covers headers and body and cleanup.
                response = await _with_timeout(self._http.send(request, stream=True), deadline)
                if not (response.is_success and stream):
                    await _with_timeout(response.aread(), max(0, started + deadline - time.monotonic()))
                if response.is_success:
                    if stream:
                        kind = "messages" if path == "/messages" else "responses" if path == "/responses" else "chat" if path.endswith("/chat/completions") else None
                        return AsyncStream(response, started + deadline, kind)
                    try:
                        if response_bytes:
                            return response.content
                        if response_text:
                            return response.text
                        return response.json()
                    finally:
                        await response.aclose()
                await response.aread()
                try:
                    payload = response.json()
                except ValueError:
                    payload = None
                error = NinjaChatError.from_response(response.status_code, payload, response.headers.get("x-request-id"))
                await response.aclose()
                in_flight = response.status_code == 409 and error.code == "request_in_flight"
                if attempt + 1 == attempts or error.retryable is False or not (response.status_code in RETRIABLE_STATUSES or in_flight):
                    raise error
            except (httpx.TransportError, asyncio.TimeoutError) as cause:
                if response is not None:
                    await response.aclose()
                if attempt + 1 == attempts:
                    timed_out = isinstance(cause, (httpx.TimeoutException, asyncio.TimeoutError))
                    raise NinjaChatError("Request timed out." if timed_out else str(cause), code="timeout" if timed_out else "network_error") from cause
            except BaseException:
                if response is not None:
                    await response.aclose()
                raise
            await asyncio.sleep(retry_delay(response.headers if response is not None else None, attempt))
        raise NinjaChatError("Request failed.")


class _Rerank:
    def __init__(self, client: AsyncNinjaChat) -> None:
        self._client = client

    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None, **params: Unpack[RerankCreateParams]) -> Dict[str, Any]:
        return await self._client._request("POST", "/rerank", body=dict(params), billed=True, idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout)


class _Audio:
    def __init__(self, client: AsyncNinjaChat) -> None:
        self.speech = _Speech(client)


class _Speech:
    def __init__(self, client: AsyncNinjaChat) -> None:
        self._client = client

    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None, **params: Unpack[SpeechCreateParams]) -> bytes:
        return await self._client._request("POST", "/audio/speech", body=dict(params), billed=True, response_bytes=True, idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout)


class _Messages:
    def __init__(self, client: AsyncNinjaChat) -> None:
        self._client = client

    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None, timeout: Optional[float] = None,
                     **params: Unpack["MessageCreateParams"]) -> Union[Dict[str, Any], AsyncStream]:
        return await self._client._request("POST", "/messages", body=dict(params), billed=True, idempotency_key=idempotency_key,
                    max_retries=max_retries, timeout=timeout, stream=bool(params.get("stream")))


class _Sessions:
    def __init__(self, client: AsyncNinjaChat) -> None:
        self._client = client

    async def create(self, id: Optional[str] = None) -> Dict[str, Any]:
        return await self._client._request("POST", "/sessions", body={} if id is None else {"session_id": id})

    async def retrieve(self, id: str) -> Dict[str, Any]:
        return await self._client._request("GET", f"/sessions/{quote(id, safe='')}", idempotent=True)

    async def delete(self, id: str) -> Dict[str, Any]:
        return await self._client._request("DELETE", f"/sessions/{quote(id, safe='')}")

    async def export(self, id: str, format: str = "json") -> Union[Dict[str, Any], str]:
        if format not in {"json", "markdown"}:
            raise NinjaChatError("format must be json or markdown.", code="invalid_options")
        return await self._client._request("GET", f"/sessions/{quote(id, safe='')}/export", query={"format": format}, idempotent=True, response_text=format == "markdown")


class _Resource:
    def __init__(self, client: AsyncNinjaChat) -> None:
        self._client = client

    async def _post(self, path: str, params: Dict[str, Any], options: Dict[str, Any]) -> Any:
        return await self._client._request("POST", path, body=params, billed=True,
                                          stream=bool(params.get("stream")), **options)


class _Battles(_Resource):
    async def list(self, type: str = "leaderboard") -> Dict[str, Any]:
        return await self._client._request("GET", "/battles", query={"type": type}, idempotent=True)

    async def create(self, *, ranked_models: List[str], compare_request_id: str, prompt_snippet: Optional[str] = None,
                     rank_by: Optional[str] = None, category: Optional[str] = None) -> Dict[str, Any]:
        body = {key: value for key, value in dict(ranked_models=ranked_models, compare_request_id=compare_request_id,
                prompt_snippet=prompt_snippet, rank_by=rank_by, category=category).items() if value is not None}
        return await self._client._request("POST", "/battles", body=body, max_retries=0)


class _Chat(_Resource):
    def __init__(self, client: AsyncNinjaChat) -> None:
        super().__init__(client)
        self.completions = _ChatCompletions(client)


class _ChatCompletions(_Resource):
    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                     timeout: Optional[float] = None, **params: Unpack[ChatCompletionParams]) -> Union[Dict[str, Any], AsyncIterator[Dict[str, Any]]]:
        return await self._post("/chat/completions", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Responses(_Resource):
    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                     timeout: Optional[float] = None, **params: Unpack[ResponseCreateParams]) -> Union[Dict[str, Any], AsyncIterator[Dict[str, Any]]]:
        return await self._post("/responses", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Presets(_Resource):
    async def run(self, slug: str, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                  timeout: Optional[float] = None, **params: Unpack[PresetChatCompletionParams]) -> Union[Dict[str, Any], AsyncIterator[Dict[str, Any]]]:
        return await self._post(f"/presets/{quote(slug, safe='')}/chat/completions", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Models(_Resource):
    async def list(self) -> Dict[str, Any]:
        return await self._client._request("GET", "/models", idempotent=True)

    async def retrieve(self, model_id: str) -> Dict[str, Any]:
        return await self._client._request("GET", f"/models/{quote(model_id, safe='')}", idempotent=True)


class _Pricing(_Resource):
    async def retrieve(self) -> Dict[str, Any]:
        return await self._client._request("GET", "/pricing", idempotent=True)


class _Images(_Resource):
    async def generate(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                       timeout: float = 300.0, **params: Unpack[ImageGenerateParams]) -> Dict[str, Any]:
        return await self._post("/images/generations", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Pollable(_Resource):
    path: str

    async def retrieve(self, job_id: str) -> Dict[str, Any]:
        return await self._client._request("GET", f"{self.path}/{quote(job_id, safe='')}", idempotent=True)

    async def wait_for(self, job_id: str, *, poll_seconds: float = 5.0, timeout_seconds: float = 600.0) -> Dict[str, Any]:
        if poll_seconds < 0 or timeout_seconds <= 0:
            raise NinjaChatError("Invalid polling interval or timeout.", code="invalid_options")
        async def poll() -> Dict[str, Any]:
            while True:
                result = await self.retrieve(job_id)
                if result.get("status") == "completed":
                    return result
                if result.get("status") in {"failed", "cancelled"}:
                    raise NinjaChatError(str(result.get("error") or "Generation failed."), code="generation_failed", request_id=job_id, body=result)
                await asyncio.sleep(poll_seconds)
        try:
            return await _with_timeout(poll(), timeout_seconds)
        except asyncio.TimeoutError as cause:
            raise NinjaChatError("Polling timed out; the server job may still complete.", code="poll_timeout", request_id=job_id) from cause


class _Videos(_Pollable):
    path = "/videos"

    async def generate(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                       timeout: float = 300.0, **params: Unpack[VideoGenerateParams]) -> Dict[str, Any]:
        return await self._post(self.path, dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Pipelines(_Pollable):
    path = "/pipelines"

    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                     timeout: Optional[float] = None, **params: Unpack[PipelineCreateParams]) -> Dict[str, Any]:
        return await self._post(self.path, dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Embeddings(_Resource):
    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                     timeout: Optional[float] = None, **params: Unpack[EmbeddingCreateParams]) -> Dict[str, Any]:
        return await self._post("/embeddings", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Search(_Resource):
    async def query(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                    timeout: Optional[float] = None, **params: Unpack[SearchParams]) -> Dict[str, Any]:
        return await self._post("/search", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Compare(_Resource):
    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                     timeout: Optional[float] = None, **params: Unpack[CompareParams]) -> Union[Dict[str, Any], AsyncIterator[Dict[str, Any]]]:
        return await self._post("/compare", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Batch(_Resource):
    async def create(self, *, idempotency_key: Optional[str] = None, max_retries: Optional[int] = None,
                     timeout: float = 300.0, **params: Unpack[BatchParams]) -> Union[Dict[str, Any], AsyncIterator[Dict[str, Any]]]:
        return await self._post("/batch", dict(params), dict(idempotency_key=idempotency_key, max_retries=max_retries, timeout=timeout))


class _Estimate(_Resource):
    async def create(self, **params: Unpack[EstimateParams]) -> Dict[str, Any]:
        return await self._client._request("POST", "/estimate", body=dict(params), idempotent=True)


class _Requests(_Resource):
    async def get(self, request_id: str) -> Dict[str, Any]:
        return await self._client._request("GET", f"/requests/{quote(request_id, safe='')}", idempotent=True)


class _Webhooks(_Resource):
    async def list(self) -> List[Dict[str, Any]]:
        return (await self._client._request("GET", "/webhooks", idempotent=True))["endpoints"]

    async def create(self, *, url: str, events: Optional[List[str]] = None) -> Dict[str, Any]:
        return await self._client._request("POST", "/webhooks", body={"url": url, **({"events": events} if events is not None else {})})

    async def delete(self, endpoint_id: str) -> Dict[str, Any]:
        return await self._client._request("DELETE", "/webhooks", query={"id": endpoint_id}, idempotent=True)

    async def list_deliveries(self, *, endpoint_id: Optional[str] = None, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        query = {k: v for k, v in {"endpoint_id": endpoint_id, "limit": limit}.items() if v is not None}
        return (await self._client._request("GET", "/webhooks/deliveries", query=query, idempotent=True))["deliveries"]

    async def test(self, endpoint_id: str) -> Dict[str, Any]:
        return await self._client._request("POST", "/webhooks/test", body={"endpoint_id": endpoint_id})
