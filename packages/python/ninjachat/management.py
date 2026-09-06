"""Account-scoped administration. Use a dedicated nj_mk_ client.
Mutation retries are disabled: minting, rotation and webhook tests are not idempotent.
Budgets are integer cents; management credentials are created only in the console.
"""
from typing import Any, Dict, Optional
from urllib.parse import quote, urlencode


def _query(path: str, options: Dict[str, Any], *, deliveries: bool = False) -> str:
    names = {"endpoint_id": "endpointId"} if deliveries else {"limit": "limit", "before": "before"}
    query = {wire: options.pop(name) for name, wire in names.items() if name in options}
    query = {name: value for name, value in query.items() if value is not None}
    return path + ("?" + urlencode(query) if query else "")


class _Resource:
    def __init__(self, client: Any) -> None:
        self._client = client

    def _call(self, method: str, path: str, body: Optional[Dict[str, Any]] = None, **options: Any) -> Dict[str, Any]:
        return self._client._request(method, "/management/" + path, json=body, idempotent_method=method == "GET", **options)


class Management(_Resource):
    def __init__(self, client: Any) -> None:
        super().__init__(client)
        self.keys = _Keys(client)
        self.projects = _Projects(client)
        self.webhooks = _Webhooks(client)

    def whoami(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", "whoami", **options)

    def balance(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", "balance", **options)

    def usage(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", "usage", **options)

    def audit(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", _query("audit", options), **options)


class _Keys(_Resource):
    def list(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", _query("keys", options), **options)

    def retrieve(self, key_id: str, **options: Any) -> Dict[str, Any]:
        return self._call("GET", "keys/" + quote(key_id, safe=""), **options)

    def create(self, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return self._call("POST", "keys", params, **options)

    def update(self, key_id: str, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return self._call("PATCH", "keys/" + quote(key_id, safe=""), params, **options)

    def revoke(self, key_id: str, **options: Any) -> Dict[str, Any]:
        return self._call("DELETE", "keys/" + quote(key_id, safe=""), **options)

    def rotate(self, key_id: str, **options: Any) -> Dict[str, Any]:
        return self._call("POST", "keys/" + quote(key_id, safe="") + "/rotate", **options)


class _Projects(_Resource):
    def list(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", _query("projects", options), **options)

    def retrieve(self, project_id: str, **options: Any) -> Dict[str, Any]:
        return self._call("GET", "projects/" + quote(project_id, safe=""), **options)

    def create(self, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return self._call("POST", "projects", params, **options)

    def update(self, project_id: str, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return self._call("PATCH", "projects/" + quote(project_id, safe=""), params, **options)

    def archive(self, project_id: str, **options: Any) -> Dict[str, Any]:
        return self._call("DELETE", "projects/" + quote(project_id, safe=""), **options)


class _Webhooks(_Resource):
    def list(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", "webhooks", **options)

    def create(self, params: Dict[str, Any], **options: Any) -> Dict[str, Any]:
        return self._call("POST", "webhooks", params, **options)

    def delete(self, endpoint_id: str, **options: Any) -> Dict[str, Any]:
        return self._call("DELETE", "webhooks/" + quote(endpoint_id, safe=""), **options)

    def deliveries(self, **options: Any) -> Dict[str, Any]:
        return self._call("GET", _query("webhooks/deliveries", options, deliveries=True), **options)

    def test(self, endpoint_id: str, **options: Any) -> Dict[str, Any]:
        return self._call("POST", "webhooks/" + quote(endpoint_id, safe="") + "/test", **options)
