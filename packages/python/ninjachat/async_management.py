"""Account-scoped administration. Use a dedicated nj_mk_ client.
Mutation retries are disabled: minting, rotation and webhook tests are not idempotent.
Budgets are integer cents; management credentials are created only in the console.
"""
from typing import Any, Dict, Optional
from urllib.parse import quote
from .management import _query


class _Resource:
    def __init__(self, client: Any) -> None:
        self._client = client

    async def _call(self, method: str, path: str, body: Optional[Dict[str, Any]] = None, **options: Any) -> Dict[str, Any]:
        return await self._client._request(method, "/management/" + path, body=body, idempotent=method == "GET", **options)


class AsyncManagement(_Resource):
    def __init__(self, client: Any) -> None:
        super().__init__(client)
        self.keys = _Keys(client)
        self.projects = _Projects(client)
        self.webhooks = _Webhooks(client)

    async def whoami(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", "whoami", **options)

    async def balance(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", "balance", **options)

    async def usage(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", "usage", **options)

    async def audit(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", _query("audit", options), **options)


class _Keys(_Resource):
    async def list(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", _query("keys", options), **options)

    async def retrieve(self, key_id: str, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", "keys/" + quote(key_id, safe=""), **options)

    async def create(self, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return await self._call("POST", "keys", params, **options)

    async def update(self, key_id: str, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return await self._call("PATCH", "keys/" + quote(key_id, safe=""), params, **options)

    async def revoke(self, key_id: str, **options: Any) -> Dict[str, Any]:
        return await self._call("DELETE", "keys/" + quote(key_id, safe=""), **options)

    async def rotate(self, key_id: str, **options: Any) -> Dict[str, Any]:
        return await self._call("POST", "keys/" + quote(key_id, safe="") + "/rotate", **options)


class _Projects(_Resource):
    async def list(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", _query("projects", options), **options)

    async def retrieve(self, project_id: str, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", "projects/" + quote(project_id, safe=""), **options)

    async def create(self, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return await self._call("POST", "projects", params, **options)

    async def update(self, project_id: str, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return await self._call("PATCH", "projects/" + quote(project_id, safe=""), params, **options)

    async def archive(self, project_id: str, **options: Any) -> Dict[str, Any]:
        return await self._call("DELETE", "projects/" + quote(project_id, safe=""), **options)


class _Webhooks(_Resource):
    async def list(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", "webhooks", **options)

    async def create(self, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return await self._call("POST", "webhooks", params, **options)

    async def delete(self, endpoint_id: str, **options: Any) -> Dict[str, Any]:
        return await self._call("DELETE", "webhooks/" + quote(endpoint_id, safe=""), **options)

    async def deliveries(self, **options: Any) -> Dict[str, Any]:
        return await self._call("GET", _query("webhooks/deliveries", options, deliveries=True), **options)

    async def test(self, endpoint_id: str, **options: Any) -> Dict[str, Any]:
        return await self._call("POST", "webhooks/" + quote(endpoint_id, safe="") + "/test", **options)
