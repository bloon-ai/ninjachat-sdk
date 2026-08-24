"""ninjachat — Python SDK for the NinjaChat v1 API.

Docs: https://docs.ninjachat.ai
OpenAPI spec: https://www.ninjachat.ai/api/v1/openapi
"""

from .client import DEFAULT_BASE_URL, NinjaChat
from .contract import CONTRACT_SHA256
from .errors import NinjaChatError
from .webhooks import verify_webhook_signature

__all__ = [
    "NinjaChat",
    "NinjaChatError",
    "verify_webhook_signature",
    "DEFAULT_BASE_URL",
    "CONTRACT_SHA256",
]

__version__ = "0.1.2"
