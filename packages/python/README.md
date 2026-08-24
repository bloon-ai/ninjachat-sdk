# NinjaChat Python SDK

Typed client for the clean NinjaChat API v1.

> [!IMPORTANT]
> `nj_sk_` API keys are server-side secrets. Never ship one in browser, mobile, desktop, or other distributed client code. Load keys from a server-side secret manager or environment variable.

```bash
pip install ninjachat
```

```python
import os
from ninjachat import NinjaChat

client = NinjaChat(api_key=os.environ["NINJACHAT_API_KEY"])
response = client.responses.create(
    model="ninja/auto",
    input="Write one sentence about clean APIs.",
    max_output_tokens=64,
    routing={"strategy": "balanced", "data_policy": "no_training"},
)
print(response["output_text"], response["cost_usd"], response["request_id"])
```

Ordered fallbacks and provider constraints are explicit:

```python
completion = client.chat.completions.create(
    models=["gpt-5", "claude-sonnet-4"],
    messages=[{"role": "user", "content": "Hello"}],
    max_completion_tokens=100,
    routing={"strategy": "latency", "allow_fallbacks": True, "caching": "auto", "max_cost_usd": 0.10},
)
```

Streams return iterators of typed-shape dictionaries:

```python
for event in client.responses.create(model="ninja/auto", input="Hello", stream=True):
    if event.get("type") == "response.output_text.delta":
        print(event.get("delta", ""), end="")
```

Models and prices come from `client.models.list()`. Images use `client.images.generate()`, videos use `client.videos.generate()` and `client.videos.wait_for()`, and account observability is available through `client.usage()`, `client.balance()`, and `client.requests.get()`.

Signed webhooks replace video polling and fire spend alerts: `client.webhooks.create(...)` or the [console](https://www.ninjachat.ai/developers/keys#webhooks). Verify deliveries with `verify_webhook_signature`.

The base URL is `https://www.ninjachat.ai/api/v1`. Chat and Responses are billed by actual token usage. See [docs.ninjachat.ai](https://docs.ninjachat.ai).
