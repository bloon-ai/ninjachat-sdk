import assert from "node:assert/strict";
import { inspect } from "node:util";
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

test("does not expose the API key through object inspection", () => {
  const secret = "nj_sk_audit_fake_only";
  const client = new NinjaChat({ apiKey: secret, maxRetries: 0 });

  assert.equal(Object.keys(client).includes("apiKey"), false);
  assert.equal(inspect(client).includes(secret), false);
});

test("rejects insecure remote base URLs and credential-bearing URLs", () => {
  assert.throws(
    () => new NinjaChat({ apiKey: "nj_sk_test", baseUrl: "http://example.com/api/v1" }),
    (error) => error instanceof NinjaChatError && error.code === "insecure_base_url",
  );
  assert.throws(
    () => new NinjaChat({ apiKey: "nj_sk_test", baseUrl: "https://user:pass@example.com/api/v1" }),
    (error) => error instanceof NinjaChatError && error.code === "invalid_base_url",
  );
  assert.doesNotThrow(
    () => new NinjaChat({ apiKey: "nj_sk_test", baseUrl: "http://localhost:3000/api/v1" }),
  );
});

test("blocks secret keys in browser runtimes unless explicitly overridden", () => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { value: {}, configurable: true });
  Object.defineProperty(globalThis, "document", { value: {}, configurable: true });

  try {
    assert.throws(
      () => new NinjaChat({ apiKey: "nj_sk_test" }),
      (error) => error instanceof NinjaChatError && error.code === "browser_api_key_forbidden",
    );
    assert.doesNotThrow(
      () => new NinjaChat({ apiKey: "nj_sk_test", dangerouslyAllowBrowser: true }),
    );
  } finally {
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else delete globalThis.window;
    if (documentDescriptor) Object.defineProperty(globalThis, "document", documentDescriptor);
    else delete globalThis.document;
  }
});
