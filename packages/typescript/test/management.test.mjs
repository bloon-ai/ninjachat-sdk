import assert from "node:assert/strict";
import test from "node:test";
import { NinjaChat } from "../dist/index.js";

test("management pagination and webhook filters survive the packaged transport", async () => {
  const urls = [];
  const client = new NinjaChat({ apiKey: "nj_mk_test", fetch: async url => {
    urls.push(new URL(String(url))); return Response.json({ data: [], next_cursor: null });
  } });
  for (const resource of [client.management.keys, client.management.projects]) {
    await resource.list({ limit: 2, before: "012345678901234567890123" });
    assert.equal(urls.at(-1).searchParams.get("limit"), "2");
    assert.equal(urls.at(-1).searchParams.get("before"), "012345678901234567890123");
  }
  await client.management.audit({ limit: 10 });
  assert.equal(urls.at(-1).searchParams.get("limit"), "10");
  await client.management.webhooks.deliveries({ endpointId: "hook" });
  assert.equal(urls.at(-1).searchParams.get("endpointId"), "hook");
});

test("packaged management client uses PATCH and never retries administrative mutations", async () => {
  const calls = [];
  const client = new NinjaChat({ apiKey: "nj_mk_test", maxRetries: 3, fetch: async (url, init) => {
    calls.push({ url, init });
    return Response.json({ error: { message: "busy", code: "busy" } }, { status: 500 });
  } });
  await assert.rejects(client.management.keys.rotate("key"));
  assert.equal(calls.length, 1);
  assert.ok(String(calls[0].url).endsWith("/management/keys/key/rotate"));
  await assert.rejects(client.management.projects.update("project", { monthlyBudgetCents: 100 }));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, "PATCH");
  assert.equal(new Headers(calls[1].init.headers).get("authorization"), "Bearer nj_mk_test");
});

test("packaged management resources cover metadata and webhook administration", async () => {
  const paths = [];
  const client = new NinjaChat({ apiKey: "nj_mk_test", fetch: async url => {
    paths.push(String(url)); return Response.json({ data: [] });
  } });
  await client.management.whoami();
  await client.management.keys.list();
  await client.management.projects.list();
  await client.management.webhooks.deliveries();
  await client.management.webhooks.test("hook");
  assert.deepEqual(paths.map(url => url.split("/management/")[1]), ["whoami", "keys", "projects", "webhooks/deliveries", "webhooks/hook/test"]);
});
