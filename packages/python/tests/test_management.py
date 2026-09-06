import unittest
from unittest.mock import Mock
import httpx
import requests
from ninjachat import NinjaChat, AsyncNinjaChat, NinjaChatError


class ManagementTests(unittest.TestCase):
    def test_pagination_and_delivery_filter(self):
        session = Mock()
        response = requests.Response()
        response.status_code = 200
        response._content = b'{"data":[],"next_cursor":null}'
        session.request.return_value = response
        client = NinjaChat("nj_mk_test", session=session)
        for resource in [client.management.keys, client.management.projects]:
            resource.list(limit=2, before="cursor")
            self.assertTrue(session.request.call_args.args[1].endswith("?limit=2&before=cursor"))
        client.management.audit(limit=10)
        self.assertTrue(session.request.call_args.args[1].endswith("/audit?limit=10"))
        client.management.webhooks.deliveries(endpoint_id="hook")
        self.assertTrue(session.request.call_args.args[1].endswith("?endpointId=hook"))

    def test_write_failure_does_not_retry_and_uses_management_namespace(self):
        session = Mock()
        response = requests.Response()
        response.status_code = 500
        response._content = b'{"error":{"message":"busy","code":"busy"}}'
        session.request.return_value = response
        client = NinjaChat("nj_mk_test", session=session, max_retries=3)
        with self.assertRaises(NinjaChatError):
            client.management.keys.create({"name": "job"})
        self.assertEqual(session.request.call_count, 1)
        self.assertTrue(session.request.call_args.args[1].endswith("/management/keys"))

    def test_patch_budget_and_webhook_paths(self):
        session = Mock()
        response = requests.Response()
        response.status_code = 200
        response._content = b'{"updated":true}'
        session.request.return_value = response
        client = NinjaChat("nj_mk_test", session=session)
        client.management.keys.update("key", {"monthlyBudgetCents": 0})
        self.assertEqual(session.request.call_args.args[0], "PATCH")
        self.assertEqual(session.request.call_args.kwargs["json"], {"monthlyBudgetCents": 0})
        client.management.webhooks.test("hook")
        self.assertTrue(session.request.call_args.args[1].endswith("/management/webhooks/hook/test"))


class AsyncManagementTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_create_never_retries_and_get_uses_management_auth(self):
        calls = []
        async def handle(request):
            calls.append(request)
            return httpx.Response(500 if request.method == "POST" else 200, json={"data": []})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
            client = AsyncNinjaChat("nj_mk_test", http_client=http, max_retries=3)
            with self.assertRaises(NinjaChatError):
                await client.management.keys.rotate("key")
            self.assertEqual(len(calls), 1)
            await client.management.webhooks.deliveries()
            self.assertEqual(calls[-1].headers["authorization"], "Bearer nj_mk_test")
            self.assertTrue(str(calls[-1].url).endswith("/management/webhooks/deliveries"))
            await client.management.keys.list(limit=2, before="cursor")
            self.assertEqual(calls[-1].url.params["before"], "cursor")
            await client.management.projects.list(limit=3)
            self.assertEqual(calls[-1].url.params["limit"], "3")
            await client.management.audit(limit=4)
            self.assertEqual(calls[-1].url.params["limit"], "4")
            await client.management.webhooks.deliveries(endpoint_id="hook")
            self.assertEqual(calls[-1].url.params["endpointId"], "hook")
