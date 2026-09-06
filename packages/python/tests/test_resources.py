import json
import unittest
from unittest.mock import Mock

from ninjachat import NinjaChat, NinjaChatError, __version__


def _json_response(body):
    response = Mock()
    response.ok = True
    response.json.return_value = body
    return response


def _sse_response(*events):
    response = Mock()
    response.ok = True
    response.iter_lines.return_value = [line for e in events for line in (f"data: {json.dumps(e)}", "")] + ["data: [DONE]", ""]
    return response


def _client(body):
    """Client whose every call returns the same JSON body, plus the session to assert on.

    Retries stay on (the shipped default) because that is what makes the client
    generate an Idempotency-Key for a billed write.
    """
    session = Mock()
    session.request.return_value = _json_response(body)
    return NinjaChat(api_key="nj_sk_test", session=session), session


class NinjaChatSmokeTest(unittest.TestCase):
    def test_stream_closes_connection_without_first_iteration(self):
        client, session = _client({})
        response = _sse_response({'choices': [{'finish_reason': 'stop'}]})
        session.request.return_value = response
        stream = client.chat.completions.create(model='test', messages=[], stream=True)
        stream.close()
        response.close.assert_called()
        self.assertEqual(list(stream), [])

    def test_native_messages_and_legacy_session_exports(self):
        client, session = _client({})
        response = _sse_response({'type': 'message_start'}, {'type': 'message_stop'})
        session.request.return_value = response
        events = list(client.messages.create(model='test', max_tokens=10, messages=[], stream=True))
        self.assertEqual([event['type'] for event in events], ['message_start', 'message_stop'])
        self.assertIn('Idempotency-Key', session.request.call_args.kwargs['headers'])
        self.assertTrue(session.request.call_args.args[1].endswith('/messages'))
        response.close.assert_called()
        session.request.return_value = _json_response({'session_id': 's'})
        client.sessions.create()
        self.assertNotIn('Idempotency-Key', session.request.call_args.kwargs['headers'])
        response = _json_response({})
        response.text = '# Session'
        session.request.return_value = response
        self.assertEqual(client.sessions.export('a/b', 'markdown'), '# Session')
        self.assertTrue(session.request.call_args.args[1].endswith('/sessions/a%2Fb/export'))
        response.close.assert_called()

    def test_messages_rejects_missing_terminal_event(self):
        client, session = _client({})
        session.request.return_value = _sse_response({'type': 'message_start'})
        with self.assertRaises(NinjaChatError) as caught:
            list(client.messages.create(model='test', max_tokens=10, messages=[], stream=True))
        self.assertEqual(caught.exception.code, 'stream_truncated')

    def test_embeddings_preserve_model_and_retrieval_options(self) -> None:
        client, session = _client({"data": [], "usage": {"total_tokens": 2}})
        client.embeddings.create(model="voyage-4-large", input=["hello"], dimensions=256, input_type="document", truncation=False)
        args, kwargs = session.request.call_args
        self.assertEqual(args[:2], ("POST", "https://www.ninjachat.ai/api/v1/embeddings"))
        self.assertIn("Idempotency-Key", kwargs["headers"])
        self.assertEqual(kwargs["json"], {"model": "voyage-4-large", "input": ["hello"], "dimensions": 256, "input_type": "document", "truncation": False})

    def test_lists_models_with_expected_auth_and_base_url(self) -> None:
        session = Mock()
        response = Mock()
        response.ok = True
        response.json.return_value = {"object": "list", "data": []}
        session.request.return_value = response
        client = NinjaChat(api_key="nj_sk_test", max_retries=0, session=session)

        self.assertEqual(client.models.list(), {"object": "list", "data": []})
        session.request.assert_called_once()
        args, kwargs = session.request.call_args
        self.assertEqual(args[:2], ("GET", "https://www.ninjachat.ai/api/v1/models"))
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer nj_sk_test")

    def test_missing_key_fails_clearly(self) -> None:
        with self.assertRaises(NinjaChatError) as raised:
            NinjaChat(api_key="")
        self.assertEqual(raised.exception.code, "missing_api_key")

    def test_preview_version_is_synchronized(self) -> None:
        self.assertEqual(__version__, "0.1.3")

    def test_reads_public_gateway_health(self) -> None:
        session = Mock()
        response = Mock()
        response.ok = True
        response.json.return_value = {"status": "operational"}
        session.request.return_value = response
        client = NinjaChat(api_key="nj_sk_test", max_retries=0, session=session)

        self.assertEqual(client.health(), {"status": "operational"})
        args, kwargs = session.request.call_args
        self.assertEqual(args[:2], ("GET", "https://www.ninjachat.ai/api/v1/health"))
        self.assertEqual(kwargs["headers"]["Authorization"], "Bearer nj_sk_test")

    def test_compares_models_under_one_idempotency_key(self) -> None:
        client, session = _client({"winner": {"model": "gpt-5"}, "results": [], "failed": []})

        result = client.compare.create(
            messages=[{"role": "user", "content": "Hello"}],
            models=["gpt-5", "claude-sonnet-4.6"],
            rank_by="balanced",
        )

        self.assertEqual(result["winner"]["model"], "gpt-5")
        args, kwargs = session.request.call_args
        self.assertEqual(args[:2], ("POST", "https://www.ninjachat.ai/api/v1/compare"))
        self.assertIn("Idempotency-Key", kwargs["headers"])
        self.assertEqual(kwargs["json"]["models"], ["gpt-5", "claude-sonnet-4.6"])

    def test_streamed_compare_yields_per_model_errors_as_events(self) -> None:
        session = Mock()
        session.request.return_value = _sse_response(
            {"type": "start", "id": "cmp_1", "models": ["gpt-5", "kimi-k2"]},
            {"type": "delta", "model": "gpt-5", "delta": {"content": "hi"}},
            {"type": "model_error", "model": "kimi-k2", "error": "Model timeout after 30s"},
            {"type": "rankings", "winner": {"model": "gpt-5"}, "results": []},
        )
        client = NinjaChat(api_key="nj_sk_test", max_retries=0, session=session)

        events = list(
            client.compare.create(messages=[{"role": "user", "content": "Hello"}], stream=True)
        )

        self.assertEqual([e["type"] for e in events], ["start", "delta", "model_error", "rankings"])

    def test_batches_independent_chat_requests(self) -> None:
        client, session = _client({"results": [], "succeeded": 0, "failed": 0})

        client.batch.create(
            requests=[
                {"model": "gpt-5", "messages": [{"role": "user", "content": "a"}]},
                {"model": "kimi-k2", "messages": [{"role": "user", "content": "b"}]},
            ],
            fail_on_any_error=False,
        )

        args, kwargs = session.request.call_args
        self.assertEqual(args[:2], ("POST", "https://www.ninjachat.ai/api/v1/batch"))
        self.assertIn("Idempotency-Key", kwargs["headers"])
        self.assertEqual(len(kwargs["json"]["requests"]), 2)

    def test_estimate_sends_no_idempotency_key(self) -> None:
        client, session = _client({"model": "gpt-5", "estimated_cents": 0.63})

        estimate = client.estimate.create(
            model="gpt-5", messages=[{"role": "user", "content": "Summarize this."}]
        )

        self.assertEqual(estimate["estimated_cents"], 0.63)
        args, kwargs = session.request.call_args
        self.assertEqual(args[:2], ("POST", "https://www.ninjachat.ai/api/v1/estimate"))
        self.assertNotIn("Idempotency-Key", kwargs["headers"])

    def test_reads_public_rate_sheet(self) -> None:
        client, session = _client({"object": "pricing", "chat": []})

        self.assertEqual(client.pricing.retrieve()["object"], "pricing")
        args, _ = session.request.call_args
        self.assertEqual(args[:2], ("GET", "https://www.ninjachat.ai/api/v1/pricing"))

    def test_submits_a_pipeline_and_polls_it_to_completion(self) -> None:
        pipeline_id = "pl_" + "a" * 32
        session = Mock()
        session.request.side_effect = [
            _json_response({"id": pipeline_id, "status": "running", "steps": []}),
            _json_response({"id": pipeline_id, "status": "running", "steps": []}),
            _json_response(
                {
                    "id": pipeline_id,
                    "status": "completed",
                    "steps": [{"id": "script", "type": "chat", "status": "completed", "output": "text"}],
                }
            ),
        ]
        client = NinjaChat(api_key="nj_sk_test", session=session)

        job = client.pipelines.create(
            steps=[
                {"id": "script", "type": "chat", "model": "gpt-5-mini", "input": "Write a caption."},
                {"id": "art", "type": "image", "prompt": "{{script.output}}"},
            ]
        )
        self.assertEqual(job["status"], "running")

        done = client.pipelines.wait_for(pipeline_id, poll_seconds=0.001)
        self.assertEqual(done["steps"][0]["output"], "text")
        args, kwargs = session.request.call_args
        self.assertEqual(args[:2], ("GET", f"https://www.ninjachat.ai/api/v1/pipelines/{pipeline_id}"))

    def test_failed_pipeline_raises_with_the_failing_step(self) -> None:
        pipeline_id = "pl_" + "b" * 32
        client, _ = _client(
            {
                "id": pipeline_id,
                "status": "failed",
                "steps": [],
                "error": {"step_id": "art", "message": "provider rejected the prompt"},
            }
        )

        with self.assertRaises(NinjaChatError) as raised:
            client.pipelines.wait_for(pipeline_id, poll_seconds=0.001)
        self.assertEqual(raised.exception.code, "pipeline_failed")
        self.assertIn("art", str(raised.exception))

    def test_runs_a_saved_preset_against_its_slug_path(self) -> None:
        client, session = _client({"object": "chat.completion", "choices": []})

        client.presets.run("support-agent", messages=[{"role": "user", "content": "Where is my order?"}])

        args, kwargs = session.request.call_args
        self.assertEqual(
            args[:2],
            ("POST", "https://www.ninjachat.ai/api/v1/presets/support-agent/chat/completions"),
        )
        self.assertIn("Idempotency-Key", kwargs["headers"])
        self.assertNotIn("model", kwargs["json"])


if __name__ == "__main__":
    unittest.main()
