import asyncio
import json
import unittest

import httpx

from ninjachat import AsyncNinjaChat, NinjaChatError


class AsyncClientTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_close_interrupts_an_inflight_stream_read(self):
        entered = asyncio.Event()
        class Pending(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                entered.set()
                await asyncio.sleep(10)
                yield b''
            async def aclose(self):
                self.closed = True
        body = Pending()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=body))) as http:
            stream = await AsyncNinjaChat('test', http_client=http).chat.completions.create(model='test', messages=[], stream=True)
            pending = asyncio.create_task(anext(stream))
            await entered.wait()
            try:
                await stream.aclose()
                self.assertTrue(body.closed)
                with self.assertRaises((asyncio.CancelledError, StopAsyncIteration)):
                    await pending
            finally:
                if not pending.done():
                    pending.cancel()
                    try:
                        await pending
                    except asyncio.CancelledError:
                        pass

    async def test_timeout_covers_slow_headers_even_with_custom_transport(self):
        async def handler(request):
            await asyncio.sleep(.15)
            return httpx.Response(200, json={})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with self.assertRaises(NinjaChatError) as caught:
                await AsyncNinjaChat('test', http_client=http, max_retries=0, timeout=.01).models.list()
            self.assertEqual(caught.exception.code, 'timeout')

    async def test_timeout_covers_trickled_json_and_binary_bodies_and_closes_them(self):
        class SlowBody(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                yield b' '
                await asyncio.sleep(.1)
                yield b'{}'
            async def aclose(self):
                self.closed = True
        for speech in [False, True]:
            body = SlowBody()
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=body))) as http:
                client = AsyncNinjaChat('test', http_client=http, max_retries=0, timeout=.01)
                with self.assertRaises(NinjaChatError) as caught:
                    if speech:
                        await client.audio.speech.create(model='tts-1', input='hi', voice='alloy')
                    else:
                        await client.models.list()
                self.assertEqual(caught.exception.code, 'timeout')
                self.assertTrue(body.closed)

    async def test_cancelled_body_is_closed_without_retry(self):
        class PendingBody(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                yield b' '
                await asyncio.sleep(10)
            async def aclose(self):
                self.closed = True
        body = PendingBody()
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, stream=body)
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            task = asyncio.create_task(AsyncNinjaChat('test', http_client=http).models.list())
            await asyncio.sleep(.01)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(body.closed)
            self.assertEqual(len(requests), 1)

    async def test_native_messages_and_legacy_session_exports(self):
        requests = []
        async def handler(request):
            requests.append(request)
            if request.url.path.endswith('/messages'):
                self.assertTrue(request.headers.get('idempotency-key'))
                return httpx.Response(200, content=b'data: {"type":"message_start"}\n\ndata: {"type":"message_stop"}\n\n')
            if request.method == 'POST':
                self.assertNotIn('idempotency-key', request.headers)
                return httpx.Response(200, json={'session_id': 's'})
            return httpx.Response(200, text='# Session')
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = AsyncNinjaChat('test', http_client=http)
            stream = await client.messages.create(model='test', max_tokens=10, messages=[], stream=True)
            self.assertEqual([e['type'] async for e in stream], ['message_start', 'message_stop'])
            self.assertEqual(await client.sessions.create(), {'session_id': 's'})
            self.assertEqual(await client.sessions.export('a/b', 'markdown'), '# Session')
        self.assertTrue(str(requests[-1].url).endswith('/sessions/a%2Fb/export?format=markdown'))

    async def test_messages_rejects_missing_terminal_event(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=b'data: {"type":"message_start"}\n\n'))) as http:
            stream = await AsyncNinjaChat('test', http_client=http).messages.create(model='test', max_tokens=10, messages=[], stream=True)
            with self.assertRaises(NinjaChatError) as caught:
                _ = [event async for event in stream]
            self.assertEqual(caught.exception.code, 'stream_truncated')

    async def test_corrupt_and_truncated_streams_fail_explicitly(self):
        for content, code in [(b'data: {bad}\n\n', 'invalid_stream'), (b'data: []\n\n', 'invalid_stream'),
                              (b'data: {"type":"response.created"}', 'stream_truncated'),
                              (b'data: {"type":"response.created"}\n\ndata: [DONE]\n\n', 'stream_truncated')]:
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=content))) as http:
                stream = await AsyncNinjaChat("test", http_client=http).responses.create(model="test", input="hi", stream=True)
                with self.assertRaises(NinjaChatError) as caught:
                    _ = [event async for event in stream]
                self.assertEqual(caught.exception.code, code)

    async def test_stream_can_be_closed_without_first_read(self):
        class Body(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                yield b'data: {}\n\n'
            async def aclose(self):
                self.closed = True
        body = Body()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=body))) as http:
            stream = await AsyncNinjaChat("test", http_client=http).responses.create(model="test", input="hi", stream=True)
            await stream.aclose()
            self.assertTrue(body.closed)

    async def test_stream_has_total_deadline(self):
        class Body(httpx.AsyncByteStream):
            async def __aiter__(self):
                while True:
                    await asyncio.sleep(0.002)
                    yield b': keepalive\n\n'
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=Body()))) as http:
            stream = await AsyncNinjaChat("test", http_client=http).responses.create(model="test", input="hi", stream=True, timeout=0.015)
            with self.assertRaises(NinjaChatError) as caught:
                await anext(stream)
            self.assertEqual(caught.exception.code, "timeout")

    async def test_parallel_requests_do_not_block_event_loop(self):
        entered = 0
        both = asyncio.Event()

        async def handler(request):
            nonlocal entered
            entered += 1
            if entered == 2:
                both.set()
            await asyncio.wait_for(both.wait(), 1)
            return httpx.Response(200, json={"object": "list", "data": []})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            async with AsyncNinjaChat("test", http_client=http) as client:
                results = await asyncio.gather(client.models.list(), client.models.list())
            self.assertFalse(http.is_closed)
            self.assertEqual(len(results), 2)

    async def test_retries_reuse_idempotency_key(self):
        keys = []

        async def handler(request):
            keys.append(request.headers.get("idempotency-key"))
            if len(keys) == 1:
                return httpx.Response(503, json={"error": {"code": "upstream", "message": "unavailable"}}, headers={"retry-after": "0"})
            return httpx.Response(200, json={"choices": []})

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = AsyncNinjaChat("test", http_client=http)
            await client.chat.completions.create(model="test", messages=[{"role": "user", "content": "hi"}])
        self.assertEqual(len(keys), 2)
        self.assertTrue(keys[0])
        self.assertEqual(keys[0], keys[1])

    async def test_multiline_sse_and_fanout_error_data(self):
        content = b': keepalive\n\ndata: {"type":\ndata: "model_error", "error":"upstream failed"}\n\ndata: [DONE]\n\n'
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=content))) as http:
            client = AsyncNinjaChat("test", http_client=http)
            stream = await client.compare.create(messages=[{"role": "user", "content": "hi"}], stream=True)
            events = [event async for event in stream]
            self.assertEqual(events, [{"type": "model_error", "error": "upstream failed"}])

    async def test_stream_error_preserves_request_id(self):
        content = b'data: {"error":{"message":"failed","code":"upstream_error"}}\n\n'
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, content=content, headers={"x-request-id": "req_test"}))) as http:
            client = AsyncNinjaChat("test", http_client=http)
            stream = await client.responses.create(model="test", input="hi", stream=True)
            with self.assertRaises(NinjaChatError) as caught:
                await anext(stream)
            self.assertEqual(caught.exception.request_id, "req_test")

    async def test_task_cancellation_closes_stream(self):
        class WaitingStream(httpx.AsyncByteStream):
            closed = False
            async def __aiter__(self):
                await asyncio.Event().wait()
                yield b""
            async def aclose(self):
                self.closed = True

        body = WaitingStream()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, stream=body))) as http:
            client = AsyncNinjaChat("test", http_client=http)
            stream = await client.responses.create(model="test", input="hi", stream=True)
            task = asyncio.create_task(anext(stream))
            await asyncio.sleep(0)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(body.closed)

    async def test_cancellation_interrupts_backoff(self):
        entered = asyncio.Event()
        calls = 0
        async def handler(request):
            nonlocal calls
            calls += 1
            entered.set()
            return httpx.Response(503, json={}, headers={"retry-after": "30"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            task = asyncio.create_task(AsyncNinjaChat("test", http_client=http).models.list())
            await entered.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(calls, 1)

    async def test_no_retry_for_webhook_creation(self):
        calls = []
        async def handler(request):
            calls.append(request)
            return httpx.Response(503, json={"error": {"message": "failed"}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with self.assertRaises(NinjaChatError):
                await AsyncNinjaChat("test", http_client=http).webhooks.create(url="https://example.com/hook")
        self.assertEqual(len(calls), 1)

    async def test_explicit_per_call_timeout_is_not_sent_in_body(self):
        seen = []
        async def handler(request):
            seen.append(request)
            return httpx.Response(200, json={})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            await AsyncNinjaChat("test", http_client=http).images.generate(prompt="test", timeout=7)
        self.assertEqual(seen[0].extensions["timeout"]["read"], 7)
        self.assertNotIn("timeout", json.loads(seen[0].content))

    async def test_owned_http_client_closes_with_context(self):
        async with AsyncNinjaChat("test") as client:
            self.assertFalse(client._http.is_closed)
        self.assertTrue(client._http.is_closed)

    async def test_rejects_insecure_url(self):
        with self.assertRaises(NinjaChatError):
            AsyncNinjaChat("test", base_url="http://example.com")
