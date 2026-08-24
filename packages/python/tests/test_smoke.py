import unittest
from unittest.mock import Mock

from ninjachat import NinjaChat, NinjaChatError, __version__


class NinjaChatSmokeTest(unittest.TestCase):
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
        self.assertEqual(__version__, "0.1.2")

    def test_rejects_insecure_remote_base_urls(self) -> None:
        with self.assertRaises(NinjaChatError) as raised:
            NinjaChat(api_key="nj_sk_test", base_url="http://example.com/api/v1")
        self.assertEqual(raised.exception.code, "insecure_base_url")

        with self.assertRaises(NinjaChatError) as credentialed:
            NinjaChat(api_key="nj_sk_test", base_url="https://user:pass@example.com/api/v1")
        self.assertEqual(credentialed.exception.code, "invalid_base_url")

        client = NinjaChat(api_key="nj_sk_test", base_url="http://localhost:3000/api/v1")
        self.assertEqual(client.base_url, "http://localhost:3000/api/v1")


if __name__ == "__main__":
    unittest.main()
