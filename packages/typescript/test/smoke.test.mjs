import assert from "node:assert/strict";
import test from "node:test";

import { NinjaChat, NinjaChatError } from "../dist/index.js";

test("lists models with the expected auth and base URL", async () => {
  let request;
  const client = new NinjaChat({
    apiKey: "nj_sk_test",
    maxRetries: 0,
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ object: "list", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const models = await client.models.list();
  assert.deepEqual(models, { object: "list", data: [] });
  assert.equal(request.url, "https://www.ninjachat.ai/api/v1/models");
  assert.equal(request.init.headers.Authorization, "Bearer nj_sk_test");
});

test("fails clearly when an API key is missing", () => {
  assert.throws(
    () => new NinjaChat({ apiKey: "" }),
    (error) => error instanceof NinjaChatError && error.code === "missing_api_key",
  );
});
